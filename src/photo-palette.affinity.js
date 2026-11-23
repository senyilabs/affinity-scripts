// The Affinity side of Photo Palette. tools/build.mjs puts src/palette.js in front of this file, so palette() is in
// scope. Draws the main colours of the selected photo as a strip of swatches (with hex codes) along its bottom edge,
// in a group of its own that can be moved, resized or deleted.
'use strict';

const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { Rectangle } = require('/geometry.js');
const { ShapeNodeDefinition, ContainerNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { ShapeRectangle } = require('/shapes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { FillDescriptor, SolidFill } = require('/fills.js');
const { Colour } = require('/colours.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

const TITLE = 'Photo Palette';

function pixelsOf(node) {
  const ri = node && node.rasterInterface;
  if (!ri) return null;
  const buffer = ri.createCompatibleBuffer(true);
  if (String(buffer.format) !== 'RGBA8') return null;
  return { width: ri.width, height: ri.height, data: new Uint8Array(buffer.buffer) };
}

const solid = ([r, g, b]) => FillDescriptor.createSolid(SolidFill.create(Colour.createRGBA8({ r, g, b, alpha: 255 })));

function label(doc, text, x, y, size, dark) {
  const sb = StoryBuilder.create();
  sb.setToArtisticTextDefaultStyle(doc.dpi, doc.rasterFormat);
  const atts = GlyphAtts.create();
  atts.height = size;
  atts.brushFill = solid(dark ? [20, 20, 20] : [250, 250, 250]);
  sb.setGlyphAtts(atts);
  sb.addText(text);
  return ArtTextNodeDefinition.createFromStoryBuilder({ x, y }, sb);
}

// The swatches as one command: a "Palette" group, then a rectangle (and hex code) per colour inside it.
function paletteCommand(doc, box, colours, { height, byShare, codes }) {
  const strip = box.height * height;
  const top = box.y + box.height - strip;
  const total = colours.reduce((s, c) => s + (byShare ? c.share : 1), 0);
  const group = AddChildNodesCommandBuilder.create();
  group.addNode(ContainerNodeDefinition.create('Palette'));
  const add = group.createCommand(false);
  return { add, fill(container) {
    const b = AddChildNodesCommandBuilder.create();
    b.setInsertionTarget(container);
    let x = box.x;
    for (const c of colours) {
      const w = (box.width * (byShare ? c.share : 1)) / total;
      const def = ShapeNodeDefinition.createDefault();
      def.shape = ShapeRectangle.create();
      def.setBoundingRectangle(new Rectangle(x, top, w, strip));
      def.addBrushFillDescriptor(solid(c.rgb));
      b.addNode(def);
      const size = Math.min(strip * 0.16, w * 0.14);
      if (codes && size >= 4) b.addNode(label(doc, c.hex, x + size * 0.6, top + strip - size * 0.7, size, c.lightness > 0.62));
      x += w;
    }
    return b.createCommand(false);
  } };
}

function main() {
  const doc = Document.current;
  if (!doc) return alert('Open a photo first.');
  const target = [...doc.selection.nodes][0];
  const image = pixelsOf(target);
  if (!image) return alert('Select the photo\'s pixel layer (for example the Background layer of a JPEG), then run the script again.');
  const box = target.getSpreadBaseBox();

  const dlg = Dialog.create(TITLE);
  const col = dlg.addColumn();
  const g = col.addGroup('Palette');
  const count = g.addUnitValueEditor('Colours', UnitType.Number, UnitType.Number, 6, 2, 12).setPrecision(0);
  const height = g.addUnitValueEditor('Strip height', UnitType.Percentage, UnitType.Percentage, 18, 5, 100).setPrecision(0);
  const byShare = g.addSwitch('Width shows how much of the photo each colour covers', false);
  const codes = g.addSwitch('Show hex codes', true);
  col.addGroup('Tip').addStaticText('', 'The swatches go in a group named Palette, so you can move, resize or delete them.');
  if (dlg.runModal() !== DialogResult.Ok) return;

  const started = Date.now();
  // Percentages come back whole (18 = 18%) in Affinity 3.3; a fraction would mean an older build.
  const h = height.value > 1 ? height.value / 100 : height.value;
  const colours = palette(image, Math.round(count.value));
  if (!colours.length) return alert('The layer has no visible pixels.');
  const cmd = paletteCommand(doc, box, colours, { height: h, byShare: byShare.value, codes: codes.value });
  doc.executeCommand(cmd.add);
  const container = cmd.add.newNodes[0];
  doc.executeCommand(cmd.fill(container));
  doc.selection = Selection.create(doc, container);
  console.log(`${TITLE}: ${colours.map((c) => c.hex).join(' ')} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main();
