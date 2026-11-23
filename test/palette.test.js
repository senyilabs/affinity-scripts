import { test } from 'node:test';
import assert from 'node:assert/strict';
import { palette, hex, rgbToOklab, oklabToRgb } from '../src/palette.js';

// An image made of colour blocks: [[r, g, b, a], pixel count], ...
function image(blocks) {
  const total = blocks.reduce((s, [, n]) => s + n, 0);
  const data = new Uint8Array(total * 4);
  let i = 0;
  for (const [rgba, n] of blocks) for (let k = 0; k < n; k++) data.set(rgba, 4 * i++);
  return { width: total, height: 1, data };
}

test('Oklab round trip', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [200, 80, 40], [12, 140, 220]]) assert.deepEqual(oklabToRgb(...rgbToOklab(...rgb)), rgb);
});

test('finds the colours of a photo, most common first', () => {
  const p = palette(image([[[200, 30, 30, 255], 600], [[20, 60, 200, 255], 300], [[240, 240, 240, 255], 100]]), 3);
  assert.deepEqual(p.map((c) => c.hex), ['#C81E1E', '#143CC8', '#F0F0F0']);
  assert.deepEqual(p.map((c) => Math.round(c.share * 10)), [6, 3, 1]);
});

test('asks for more colours than there are: gives what there is', () => {
  const p = palette(image([[[10, 10, 10, 255], 50], [[250, 250, 250, 255], 50]]), 6);
  assert.equal(p.length, 2);
});

test('transparent pixels are ignored', () => {
  const p = palette(image([[[0, 200, 0, 255], 10], [[255, 0, 0, 0], 1000]]), 3);
  assert.deepEqual(p.map((c) => c.hex), ['#00C800']);
  assert.deepEqual(palette(image([[[1, 2, 3, 0], 5]])), []);
});

test('same photo, same palette', () => {
  const noise = image(Array.from({ length: 500 }, (_, i) => [[(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], 1]));
  assert.deepEqual(palette(noise, 5), palette(noise, 5));
});

test('hex', () => assert.equal(hex([0, 128, 255]), '#0080FF'));

test('a small vivid area makes it into the palette', () => {
  const grey = [[[120, 120, 120, 255], 450], [[128, 128, 128, 255], 450], [[60, 60, 60, 255], 50], [[255, 120, 0, 255], 50]];
  const p = palette(image(grey), 3).map((c) => c.hex);
  assert.ok(p.includes('#FF7800'), p.join(' '));
});
