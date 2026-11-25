// The Affinity side of Watermark. tools/build.mjs puts src/watermark.js in front of this file, so place() and tiles()
// are in scope. Adds the text to this document or to every open one, inside an invisible page-sized frame named
// Watermark at the top of the layers: the frame clips repeated copies at the edges of the photo, and it can be moved,
// edited or deleted like any other layer.
'use strict';

const { Document, SpatialAnchor } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { ShapeNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { ShapeRectangle } = require('/shapes.js');
const { Rectangle, Transform } = require('/geometry.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { FillDescriptor, SolidFill } = require('/fills.js');
const { Colour } = require('/colours.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

const TITLE = 'Watermark';
const pct = (v) => (v > 1 ? v / 100 : v); // whole percentages in Affinity 3.3; a fraction would mean an older build

function textDefinition(doc, text, size, colour, font) {
  const sb = StoryBuilder.create();
  sb.setToArtisticTextDefaultStyle(doc.dpi, doc.rasterFormat);
  const atts = GlyphAtts.create();
  atts.height = size;
  atts.brushFill = FillDescriptor.createSolid(SolidFill.create(colour));
  if (font) atts.font = font;
  sb.setGlyphAtts(atts);
  sb.addText(text);
  return ArtTextNodeDefinition.createFromStoryBuilder({ x: 0, y: 0 }, sb);
}

function watermark(doc, o) {
  const page = { width: doc.widthPixels, height: doc.heightPixels };
  const size = page.width * o.size;

  // An unfilled rectangle the size of the page: whatever is inside it is clipped to it.
  const frame = ShapeNodeDefinition.createDefault();
  frame.shape = ShapeRectangle.create();
  frame.setBoundingRectangle(new Rectangle(0, 0, page.width, page.height));
  const add = AddChildNodesCommandBuilder.create();
  add.addNode(frame);
  const made = add.createCommand(false);
  doc.executeCommand(made);
  const group = made.newNodes[0];
  group.userDescription = TITLE;

  const inner = AddChildNodesCommandBuilder.create();
  inner.setInsertionTarget(group);
  inner.addNode(textDefinition(doc, o.text, size, o.colour, o.font));
  const typed = inner.createCommand(false);
  doc.executeCommand(typed);
  const node = typed.newNodes[0];
  const box = node.getSpreadBaseBox();

  if (!o.repeat) {
    const at = place(page, box, o.anchor, size * 0.8);
    doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, node), Transform.createTranslate(at.x - box.x, at.y - box.y)));
  } else {
    // Copies at an angle across the page; the first one is moved to the first spot instead of copied.
    const centre = Transform.createTranslate(-(box.x + box.width / 2), -(box.y + box.height / 2));
    const spots = tiles(page, box);
    const all = CompoundCommandBuilder.create();
    spots.forEach((c, i) => {
      const xf = Transform.createTranslate(c.x, c.y).multiply(Transform.createRotate(-Math.PI / 6)).multiply(centre);
      all.addCommand(DocumentCommand.createTransform(Selection.create(doc, node), xf, { duplicateNodes: i < spots.length - 1 }));
    });
    doc.executeCommand(all.createCommand());
  }
  doc.executeCommand(DocumentCommand.createSetOpacity(Selection.create(doc, group), o.opacity));
  return group;
}

function main() {
  const current = Document.current;
  if (!current) return alert('Open a photo first.');
  const others = [...Document.all].length - 1;

  const dlg = Dialog.create(TITLE);
  const col = dlg.addColumn();
  const g = col.addGroup('Text');
  const text = g.addTextBox('Text', '© Your Name');
  const font = g.addFontPicker('Font');
  const colour = g.addColourPicker('Colour', Colour.createRGBA8({ r: 255, g: 255, b: 255, alpha: 255 }));
  const size = g.addUnitValueEditor('Size (of the photo width)', UnitType.Percentage, UnitType.Percentage, 4, 1, 30).setPrecision(1);
  const opacity = g.addUnitValueEditor('Opacity', UnitType.Percentage, UnitType.Percentage, 60, 5, 100).setPrecision(0);
  const p = col.addGroup('Placement');
  const anchor = p.addSpatialAnchor('Position', SpatialAnchor.BottomRight);
  const repeat = p.addSwitch('Repeat across the whole photo', false);
  const scope = p.addComboBox('Add to', ['This document', `All open documents (${others + 1})`], 0);
  if (dlg.runModal() !== DialogResult.Ok) return;

  const words = String(text.text ?? '').trim();
  if (!words) return alert('Type the watermark text.');
  const options = {
    text: words, font: font.font, colour: colour.value, size: pct(size.value), opacity: pct(opacity.value),
    anchor: anchor.value?.value ?? anchor.value, repeat: repeat.value,
  };
  const docs = scope.selectedIndex === 1 ? [...Document.all] : [current];
  for (const doc of docs) watermark(doc, options);
  console.log(`${TITLE}: added to ${docs.length} document${docs.length === 1 ? '' : 's'}`);
}

main();
