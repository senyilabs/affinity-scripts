// Where watermark text goes, free of Affinity so the tests can run it. Sizes are in document pixels; `anchor` is
// Affinity's SpatialAnchor number (1 top left, 2 centre left, 3 bottom left, 4 top centre … 9 bottom right).

// Top-left corner for a text box of size `text` at `anchor` on a `page`, `margin` pixels in from the edges.
export function place(page, text, anchor, margin) {
  const col = Math.floor((anchor - 1) / 3), row = (anchor - 1) % 3;
  const x = [margin, (page.width - text.width) / 2, page.width - text.width - margin][col];
  const y = [margin, (page.height - text.height) / 2, page.height - text.height - margin][row];
  return { x, y };
}

// Centres for repeating the text across the whole page, in staggered rows (like a stock photo watermark), `gap`
// times the text size apart. Covers the corners too, since the copies are drawn at an angle.
export function tiles(page, text, gap = 1.5) {
  const stepX = text.width * gap, stepY = text.height * gap * 3;
  const out = [];
  for (let row = 0, y = stepY / 2; y < page.height + stepY; row++, y += stepY) {
    for (let x = (row % 2 ? stepX / 2 : 0); x < page.width + stepX; x += stepX) out.push({ x, y });
  }
  return out;
}
