// The Affinity side of Watermark. tools/build.mjs puts src/watermark.js in front of this file, so place(), tiles(),
// whole(), fillIn(), DEFAULTS, readSettings() and writeSettings() are in scope. Adds the text to this document or
// to every open one, inside an invisible page-sized frame named Watermark at the top of the layers: the frame clips
// repeated copies at the edges of the photo, and it can be moved, edited or deleted like any other layer.
// "Remember these settings" keeps the dialog's choices in a file on the Desktop, the one folder Affinity lets scripts
// write to (Settings → Scripting); scripts can't ask for more access themselves. Hidden (dot) files are refused, so
// the file has a plain name.
'use strict';

const { Application } = require('/application.js');
const { File } = require('/fs.js');
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
const settingsPath = () => `${Application.userDesktopPath}/Watermark settings.json`;

// SpatialAnchor is Affinity's own enum: saved by name, compared by number.
const anchorNumber = (a) => a?.value ?? a;
const anchorName = (n) => SpatialAnchor.keys?.find((k) => anchorNumber(SpatialAnchor[k]) === n) ?? DEFAULTS.anchor;

function loadSettings() {
  try {
    return readSettings(File.readAll(settingsPath()).toString());
  } catch {
    return readSettings(null); // no file yet, or the Desktop isn't allowed
  }
}

// Returns null when saved, or the reason it couldn't be.
function saveSettings(text) {
  try {
    const f = File.create(settingsPath(), 'wb');
    f.writeString(text);
    f.close();
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

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
  inner.addNode(textDefinition(doc, fillIn(o.text, doc.title), size, o.colour, o.font));
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
    const all = tiles(page, box);
    const spots = o.wholeOnly ? whole(all, page, box, Math.PI / 6) : all;
    if (!spots.length) spots.push({ x: page.width / 2, y: page.height / 2 });
    const moves = CompoundCommandBuilder.create();
    spots.forEach((c, i) => {
      const xf = Transform.createTranslate(c.x, c.y).multiply(Transform.createRotate(-Math.PI / 6)).multiply(centre);
      moves.addCommand(DocumentCommand.createTransform(Selection.create(doc, node), xf, { duplicateNodes: i < spots.length - 1 }));
    });
    doc.executeCommand(moves.createCommand());
  }
  doc.executeCommand(DocumentCommand.createSetOpacity(Selection.create(doc, group), o.opacity));
  return group;
}

function main() {
  const current = Document.current;
  if (!current) return alert('Open a photo first.');
  const others = [...Document.all].length - 1;
  const { remembered, settings: s } = loadSettings();

  const dlg = Dialog.create(TITLE);
  const col = dlg.addColumn();
  const g = col.addGroup('Text');
  const text = g.addTextBox('Text', s.text);
  g.addStaticText('', 'Type {file} to add each photo\'s file name, e.g. the camera\'s photo number.');
  const font = g.addFontPicker('Font');
  const colour = g.addColourPicker('Colour', Colour.createRGBA8(s.colour));
  const size = g.addUnitValueEditor('Size (of the photo width)', UnitType.Percentage, UnitType.Percentage, s.size, 1, 30).setPrecision(1);
  const opacity = g.addUnitValueEditor('Opacity', UnitType.Percentage, UnitType.Percentage, s.opacity, 5, 100).setPrecision(0);
  const p = col.addGroup('Placement');
  const anchor = p.addSpatialAnchor('Position', SpatialAnchor[s.anchor] ?? SpatialAnchor.BottomRight);
  const repeat = p.addSwitch('Repeat across the whole photo', s.repeat);
  const wholeOnly = p.addSwitch('When repeating, only whole copies (none cut off at the edges)', s.wholeOnly);
  const scope = p.addComboBox('Add to', ['This document', `All open documents (${others + 1})`], 0);
  const n = col.addGroup('Next time');
  const remember = n.addSwitch('Remember these settings', remembered);
  n.addStaticText('', 'Kept in "Watermark settings.json" on your Desktop. The font is not remembered.');
  if (dlg.runModal() !== DialogResult.Ok) return;

  const words = String(text.text ?? '').trim();
  if (!words) return alert('Type the watermark text.');
  const options = {
    text: words, font: font.font, colour: colour.value, size: pct(size.value), opacity: pct(opacity.value),
    anchor: anchorNumber(anchor.value), repeat: repeat.value, wholeOnly: wholeOnly.value,
  };
  const docs = scope.selectedIndex === 1 ? [...Document.all] : [current];
  for (const doc of docs) watermark(doc, options);
  console.log(`${TITLE}: added to ${docs.length} document${docs.length === 1 ? '' : 's'}`);

  // Turning the switch off writes a note to forget, so the next run starts from the defaults again.
  if (!remember.value && !remembered) return;
  const failed = saveSettings(writeSettings({
    text: words, colour: colour.value.rgba8, size: Math.round(options.size * 1000) / 10,
    opacity: Math.round(options.opacity * 100), anchor: anchorName(options.anchor),
    repeat: options.repeat, wholeOnly: options.wholeOnly,
  }, remember.value));
  if (failed && remember.value) {
    alert(`The watermark was added, but the settings couldn't be remembered: Affinity didn't let the script save a file on your Desktop (${failed}).\n\nTo have them remembered, open Settings → Scripting in Affinity and allow scripts to use your Desktop. Then run Watermark again.`);
  }
}

main();
