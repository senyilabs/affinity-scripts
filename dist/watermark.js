/**
 * name: Watermark
 * description: Adds a text watermark (corner, centre or repeated across the photo) to this document or every open one.
 * version: 1.3.1
 * author: Senyi Labs
 */
'use strict';
// Free script by Senyi Labs (https://senyilabs.com). More Affinity scripts: Match Color, Content-Aware Scale.

// Where watermark text goes, free of Affinity so the tests can run it. Sizes are in document pixels; `anchor` is
// Affinity's SpatialAnchor number (1 top left, 2 centre left, 3 bottom left, 4 top centre … 9 bottom right).

// Top-left corner for a text box of size `text` at `anchor` on a `page`, `margin` pixels in from the edges.
function place(page, text, anchor, margin) {
  const col = Math.floor((anchor - 1) / 3), row = (anchor - 1) % 3;
  const x = [margin, (page.width - text.width) / 2, page.width - text.width - margin][col];
  const y = [margin, (page.height - text.height) / 2, page.height - text.height - margin][row];
  return { x, y };
}

// Centres for repeating the text across the whole page, in staggered rows (like a stock photo watermark), `gap`
// times the text size apart. Covers the corners too, since the copies are drawn at an angle.
function tiles(page, text, gap = 1.5) {
  const stepX = text.width * gap, stepY = text.height * gap * 3;
  const out = [];
  for (let row = 0, y = stepY / 2; y < page.height + stepY; row++, y += stepY) {
    for (let x = (row % 2 ? stepX / 2 : 0); x < page.width + stepX; x += stepX) out.push({ x, y });
  }
  return out;
}

// Only the spots where a copy turned by `angle` (radians) fits completely on the page, so no copy is cut off at the
// edges.
function whole(spots, page, text, angle) {
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const ex = (text.width * c + text.height * s) / 2, ey = (text.width * s + text.height * c) / 2;
  return spots.filter((p) => p.x - ex >= 0 && p.y - ey >= 0 && p.x + ex <= page.width && p.y + ey <= page.height);
}

// The watermark text for one photo: {file} becomes the photo's file name without its extension (the number the
// camera gave it, e.g. DSC_1234), so each photo in a batch gets its own. (file) and [file] work too, since curly
// brackets are easy to mistake for round ones in the dialog.
function fillIn(text, title) {
  const stem = String(title || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return String(text).replace(/[{([]file[})\]]/gi, stem);
}

// What the dialog starts with when nothing is remembered. Size and opacity are whole percentages, `anchor` is the
// name of Affinity's SpatialAnchor value.
const DEFAULTS = {
  text: '© Your Name', colour: { r: 255, g: 255, b: 255, alpha: 255 }, size: 4, opacity: 60,
  anchor: 'BottomRight', repeat: false, wholeOnly: true,
};

// The remembered settings from the saved file's text (or null when there is none), checked field by field so a
// damaged or older file falls back to the defaults instead of breaking the dialog. `remembered` is false when there
// was nothing to read, or the file says to forget.
function readSettings(json) {
  let saved = null;
  try { saved = json ? JSON.parse(json) : null; } catch { saved = null; }
  const ok = saved && typeof saved === 'object' && saved.remember === true;
  const s = ok ? saved : {};
  const num = (v, lo, hi, d) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  const byte = (v) => num(v, 0, 255, -1);
  const c = s.colour || {};
  const colour = [c.r, c.g, c.b, c.alpha].map(byte).includes(-1) ? DEFAULTS.colour
    : { r: c.r, g: c.g, b: c.b, alpha: c.alpha };
  return {
    remembered: !!ok,
    settings: {
      text: typeof s.text === 'string' && s.text.trim() ? s.text : DEFAULTS.text,
      colour,
      size: num(s.size, 1, 30, DEFAULTS.size),
      opacity: num(s.opacity, 5, 100, DEFAULTS.opacity),
      anchor: typeof s.anchor === 'string' && /^[A-Za-z]+$/.test(s.anchor) ? s.anchor : DEFAULTS.anchor,
      repeat: typeof s.repeat === 'boolean' ? s.repeat : DEFAULTS.repeat,
      wholeOnly: typeof s.wholeOnly === 'boolean' ? s.wholeOnly : DEFAULTS.wholeOnly,
    },
  };
}

// The text to save: the settings to remember, or only a note to forget them when the switch was turned off.
function writeSettings(settings, remember) {
  return JSON.stringify(remember ? { remember: true, ...settings } : { remember: false }, null, 2) + '\n';
}

// The Affinity side of Watermark. tools/build.mjs puts src/watermark.js in front of this file, so place(), tiles(),
// whole(), fillIn(), DEFAULTS, readSettings() and writeSettings() are in scope. Adds the text to this document or
// to every open one, inside an invisible page-sized frame named Watermark at the top of the layers: the frame clips
// repeated copies at the edges of the photo, and it can be moved, edited or deleted like any other layer.
// "Remember these settings" keeps the dialog's choices in an "Affinity Scripts" folder on the Desktop: the Desktop is
// the only folder Affinity lets scripts write to (other folders allowed in Settings → Scripting were still refused in
// Affinity 3.3), scripts can't ask for more access themselves, and hidden (dot) files are refused.

const { Application } = require('/application.js');
const { File, fs } = require('/fs.js');
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
const settingsFolder = () => `${Application.userDesktopPath}/Affinity Scripts`;
const settingsPath = () => `${settingsFolder()}/Watermark settings.json`;
const oldSettingsPath = () => `${Application.userDesktopPath}/Watermark settings.json`; // 1.3.0 kept it loose on the Desktop

// SpatialAnchor is Affinity's own enum: saved by name, compared by number.
const anchorNumber = (a) => a?.value ?? a;
const anchorName = (n) => SpatialAnchor.keys?.find((k) => anchorNumber(SpatialAnchor[k]) === n) ?? DEFAULTS.anchor;

function loadSettings() {
  for (const path of [settingsPath(), oldSettingsPath()]) {
    try {
      return readSettings(File.readAll(path).toString());
    } catch {
      // no file there, or the Desktop isn't allowed
    }
  }
  return readSettings(null);
}

// Returns null when saved, or the reason it couldn't be. The 1.3.0 file is removed once the new one is written.
function saveSettings(text) {
  try {
    fs.createDirectories(settingsFolder());
    const f = File.create(settingsPath(), 'wb');
    f.writeString(text);
    f.close();
  } catch (e) {
    return e.message || String(e);
  }
  try {
    if (fs.exists(oldSettingsPath())) fs.remove(oldSettingsPath());
  } catch {
    // leaving the old file behind is harmless
  }
  return null;
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
  n.addStaticText('', 'Kept in the "Affinity Scripts" folder on your Desktop. The font is not remembered.');
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
