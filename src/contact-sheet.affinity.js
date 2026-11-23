// The Affinity side of Contact Sheet. tools/build.mjs puts src/contactsheet.js in front of this file, so
// imageFiles(), cells(), fit() and shrink() are in scope. You pick any photo in a folder; a new A4 document gets every
// photo in that folder in a grid, each with its file name underneath.
'use strict';

const { app } = require('/application.js');
const { Document, NewDocumentOptions } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder, DocumentCommand } = require('/commands.js');
const { Transform } = require('/geometry.js');
const { ImageNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { Bitmap, PixelBuffer, RasterFormat } = require('/rasterobject.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { DirectoryIterator } = require('/fs.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

const TITLE = 'Contact Sheet';
const MAX = 120; // more than this on one A4 page and the pictures are too small to see

const folderOf = (path) => String(path).replace(/[\\/][^\\/]*$/, '');
const fileName = (path) => String(path).split(/[\\/]/).pop();

function listFolder(folder) {
  const paths = [];
  for (const it = DirectoryIterator.at(folder); !it.done; it.next()) paths.push(it.path);
  return imageFiles(paths);
}

// The picture at `path`, shrunk to `maxSide` pixels, as an image node definition; null if it can't be read.
function picture(path, maxSide) {
  let bitmap;
  try {
    bitmap = Bitmap.loadFromFile(path, RasterFormat.RGBA8);
  } catch (e) {
    return null;
  }
  const full = PixelBuffer.create(bitmap.width, bitmap.height, RasterFormat.RGBA8);
  bitmap.copyTo(full, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, 0, 0);
  const small = shrink({ width: bitmap.width, height: bitmap.height, data: new Uint8Array(full.buffer) }, maxSide);
  const buffer = PixelBuffer.create(small.width, small.height, RasterFormat.RGBA8);
  new Uint8Array(buffer.buffer).set(small.data);
  const def = ImageNodeDefinition.create(RasterFormat.RGBA8);
  def.setBitmap(buffer.createCompatibleBitmap(true));
  return { def, width: small.width, height: small.height };
}

function caption(doc, text, size) {
  const sb = StoryBuilder.create();
  sb.setToArtisticTextDefaultStyle(doc.dpi, doc.rasterFormat);
  const atts = GlyphAtts.create();
  atts.height = size;
  sb.setGlyphAtts(atts);
  sb.addText(text);
  return ArtTextNodeDefinition.createFromStoryBuilder({ x: 0, y: 0 }, sb);
}

// Adds `def` and moves/scales it so its box becomes `rect` (keeping its shape when `rect` has the same shape).
function addInto(doc, def, rect, scale = true) {
  const b = AddChildNodesCommandBuilder.create();
  b.addNode(def);
  const cmd = b.createCommand(false);
  doc.executeCommand(cmd);
  const node = cmd.newNodes[0];
  const box = node.getSpreadBaseBox();
  const s = scale ? Math.min(rect.width / box.width, rect.height / box.height) : 1;
  const xf = Transform.createTranslate(rect.x, rect.y).multiply(Transform.createScale(s, s)).multiply(Transform.createTranslate(-box.x, -box.y));
  doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, node), xf));
  return node;
}

function main() {
  const dlg = Dialog.create(TITLE);
  const col = dlg.addColumn();
  const g = col.addGroup('Sheet');
  const cols = g.addUnitValueEditor('Columns', UnitType.Number, UnitType.Number, 4, 1, 12).setPrecision(0);
  const names = g.addSwitch('File names under the pictures', true);
  col.addGroup('Next').addStaticText('', 'Then pick any photo in the folder: every photo in that folder goes on the sheet.');
  if (dlg.runModal() !== DialogResult.Ok) return;
  const chosen = app.chooseFile();
  if (!chosen) return;

  const started = Date.now();
  const folder = folderOf(chosen);
  let files = listFolder(folder);
  if (!files.length) return alert(`No photos found in ${folder}.`);
  const skipped = Math.max(0, files.length - MAX);
  files = files.slice(0, MAX);

  const doc = Document.createFromOptions(NewDocumentOptions.createDefault());
  const page = { width: doc.widthPixels, height: doc.heightPixels };
  const margin = page.width * 0.05, gap = page.width * 0.02;
  const columns = Math.round(cols.value);
  const textSize = Math.max(8, page.width / columns / 18);
  const boxes = cells(files.length, page, { cols: columns, margin, gap, caption: names.value ? textSize * 1.8 : 0 });

  let unreadable = 0;
  files.forEach((path, i) => {
    const cell = boxes[i];
    const pic = picture(path, Math.ceil(Math.max(cell.width, cell.height) * 1.5));
    if (!pic) { unreadable++; return; }
    addInto(doc, pic.def, fit(pic.width, pic.height, cell));
    if (names.value) {
      const label = addInto(doc, caption(doc, fileName(path), textSize), { x: cell.x, y: cell.y + cell.height + textSize * 0.4, width: cell.width, height: textSize * 1.4 }, false);
      const box = label.getSpreadBaseBox();
      if (box.width > cell.width) { // a long name: shrink it to the cell's width
        const s = cell.width / box.width;
        doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, label),
          Transform.createTranslate(box.x, box.y).multiply(Transform.createScale(s, s)).multiply(Transform.createTranslate(-box.x, -box.y))));
      }
    }
  });
  const notes = [skipped && `${skipped} more photos didn't fit (the limit is ${MAX})`, unreadable && `${unreadable} files couldn't be opened`].filter(Boolean);
  if (notes.length) alert(notes.join('; ') + '.');
  console.log(`${TITLE}: ${files.length - unreadable} photos from ${folder} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main();
