// Contact sheet layout and image shrinking, free of Affinity so the tests can run it. Sizes are in document pixels.

const IMAGE = /\.(jpe?g|png|tiff?|webp|heic|gif|bmp)$/i;
// Affinity documents and camera RAW files can't be loaded as plain images; the script opens them as documents.
const DOCUMENT = /\.(af|afphoto|afdesign|afpub|cr2|cr3|nef|nrw|arw|dng|orf|raf|rw2|pef|srw)$/i;
const RAW = /\.(cr2|cr3|nef|nrw|arw|dng|orf|raf|rw2|pef|srw)$/i;

// Whether `path` has to be opened as a document to get its picture.
export const opensAsDocument = (path) => DOCUMENT.test(path);

// Compares names the way a file browser orders them: numbers by value (IMG_2 before IMG_10), letters ignoring case.
// Written out because Affinity's JavaScript has no Intl, so localeCompare can't take options there.
function natural(a, b) {
  const pa = a.toLowerCase().match(/\d+|\D+/g) || [], pb = b.toLowerCase().match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === y) continue;
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    if (nx && ny) return Number(x) - Number(y) || x.length - y.length;
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

// The pictures among `paths`, in the order a file browser shows them. A RAW file is left out when a JPEG of the same
// name is next to it (cameras set to RAW + JPEG), since that photo is already on the sheet.
export function imageFiles(paths) {
  const name = (p) => String(p).split(/[\\/]/).pop();
  const stem = (p) => name(p).replace(/\.[^.]+$/, '').toLowerCase();
  const jpegs = new Set(paths.filter((p) => /\.jpe?g$/i.test(p)).map(stem));
  return paths
    .filter((p) => (IMAGE.test(p) || DOCUMENT.test(p)) && !name(p).startsWith('.'))
    .filter((p) => !(RAW.test(p) && jpegs.has(stem(p))))
    .sort((a, b) => natural(name(a), name(b)));
}

// `count` cells in `cols` columns filling `page` inside `margin`, with `gap` between cells and `caption` pixels under
// each picture for its file name. Cells are square-ish boxes for the picture: { x, y, width, height }.
export function cells(count, page, { cols = 4, margin = 0, gap = 0, caption = 0 } = {}) {
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = (page.width - 2 * margin - gap * (cols - 1)) / cols;
  const height = Math.min(width, (page.height - 2 * margin - gap * (rows - 1)) / rows - caption);
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    out.push({ x: margin + c * (width + gap), y: margin + r * (height + caption + gap), width, height });
  }
  return out;
}

// The largest rectangle with the picture's shape that fits `cell`, centred across it and sitting on its bottom edge,
// so the file name underneath stays next to the picture.
export function fit(w, h, cell) {
  const s = Math.min(cell.width / w, cell.height / h);
  return { x: cell.x + (cell.width - w * s) / 2, y: cell.y + cell.height - h * s, width: w * s, height: h * s };
}

// A smaller copy of an RGBA8 image whose long side is at most `maxSide`, by averaging blocks of pixels (box filter),
// so a sheet of 24-megapixel photos stays light. Images already small enough come back as they are.
export function shrink(image, maxSide) {
  const { width, height, data } = image;
  const f = Math.ceil(Math.max(width, height) / maxSide);
  if (f <= 1) return image;
  const w = Math.floor(width / f), h = Math.floor(height / f);
  const out = new Uint8Array(w * h * 4);
  const n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}
