// The Affinity side of Contact Sheet. tools/build.mjs puts src/contactsheet.js in front of this file, so
// imageFiles(), opensAsDocument(), perPage(), cells(), fit() and shrink() are in scope. You pick any photo in a folder; a new A4
// document gets every photo in that folder in a grid, each with its file name underneath. Affinity files and RAW
// photos are included too.
'use strict';

const { app } = require('/application.js');
const { Document, NewDocumentOptions } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder, DocumentCommand } = require('/commands.js');
const { Transform } = require('/geometry.js');
const { ImageNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { Bitmap, NodeRenderingEngine, PixelBuffer, RasterFormat } = require('/rasterobject.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAtts } = require('/glyphatts.js');
const { DirectoryIterator } = require('/fs.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

const TITLE = 'Contact Sheet';
const MAX = 400; // photos per run; they are spread over as many A4 pages as needed

const folderOf = (path) => String(path).replace(/[\\/][^\\/]*$/, '');
const fileName = (path) => String(path).split(/[\\/]/).pop();

function listFolder(folder) {
  const paths = [];
  for (const it = DirectoryIterator.at(folder); !it.done; it.next()) paths.push(it.path);
  return imageFiles(paths);
}

// All pixels of a raster object (a bitmap, a layer or a rendered page) as { width, height, data }.
function pixelsOf(source) {
  const buffer = PixelBuffer.create(source.width, source.height, RasterFormat.RGBA8);
  source.copyTo(buffer, { x: 0, y: 0, width: source.width, height: source.height }, 0, 0);
  return { width: source.width, height: source.height, data: new Uint8Array(buffer.buffer) };
}

// Affinity documents and RAW files: opened, read, then closed again. A file with a single pixel layer (a RAW photo
// opens as one develop layer, which renders blank) is read from that layer; anything else is rendered as a page.
// A file the user already has open is read as it is and left open.
function renderDocument(path) {
  const wasOpen = [...Document.all].some((d) => String(d.path || '') === String(path));
  const doc = Document.load(path);
  try {
    const layers = [...doc.layers];
    if (layers.length === 1 && layers[0].rasterInterface) return pixelsOf(layers[0].rasterInterface);
    return pixelsOf(NodeRenderingEngine.createDefault(doc.currentSpread, RasterFormat.RGBA8));
  } finally {
    if (!wasOpen) doc.close();
  }
}

// The picture at `path`, shrunk to `maxSide` pixels, as an image node definition; null if it can't be read.
function picture(path, maxSide) {
  let full;
  try {
    full = opensAsDocument(path) ? renderDocument(path) : pixelsOf(Bitmap.loadFromFile(path, RasterFormat.RGBA8));
  } catch (e) {
    return null;
  }
  const small = shrink(full, maxSide);
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

// Adds `def` to the page `spread` and moves/scales it so its box becomes `rect` (keeping its shape when `rect` has the same shape).
function addInto(doc, spread, def, rect, scale = true) {
  const b = AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(spread);
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
  let files;
  try {
    files = listFolder(folder);
  } catch (e) {
    // Affinity lets scripts read only the folders allowed in its settings (the Desktop, plus any you add).
    return alert(`Affinity didn't let the script read the folder ${folder} (${e.message}).\n\nIn Affinity, open Settings → Scripting and add this folder (or a folder above it) to the folders scripts may access, or copy the photos into a folder on your Desktop. Then run Contact Sheet again.`);
  }
  if (!files.length) return alert(`No photos found in ${folder}.`);
  const skipped = Math.max(0, files.length - MAX);
  files = files.slice(0, MAX);

  const columns = Math.round(cols.value);
  const layout = (page) => {
    const textSize = Math.max(8, page.width / columns / 18);
    return { textSize, cols: columns, margin: page.width * 0.05, gap: page.width * 0.02, caption: names.value ? textSize * 1.8 : 0 };
  };
  // The page size is only known once a document exists, so a sheet that needs more pages is made again with them.
  let doc = Document.createFromOptions(NewDocumentOptions.createDefault());
  const page = { width: doc.widthPixels, height: doc.heightPixels };
  const L = layout(page);
  const n = perPage(page, L);
  const pages = Math.ceil(files.length / n);
  if (pages > 1) {
    doc.close();
    const options = NewDocumentOptions.createDefault();
    options.isMultiPage = true;
    options.pageCount = pages;
    options.isFacing = false;
    doc = Document.createFromOptions(options);
  }
  const boxes = cells(n, page, L);
  const spreads = [...doc.spreads];

  let unreadable = 0;
  files.forEach((path, i) => {
    const spread = spreads[Math.min(spreads.length - 1, Math.floor(i / n))];
    const cell = boxes[i % n];
    const pic = picture(path, Math.ceil(Math.max(cell.width, cell.height) * 1.5));
    if (!pic) { unreadable++; return; }
    addInto(doc, spread, pic.def, fit(pic.width, pic.height, cell));
    if (names.value) {
      const label = addInto(doc, spread, caption(doc, fileName(path), L.textSize), { x: cell.x, y: cell.y + cell.height + L.textSize * 0.4, width: cell.width, height: L.textSize * 1.4 }, false);
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
  console.log(`${TITLE}: ${files.length - unreadable} photos on ${spreads.length} page${spreads.length === 1 ? '' : 's'} from ${folder} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main();
