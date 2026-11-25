import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, tiles, whole, fillIn } from '../src/watermark.js';

const page = { width: 1000, height: 600 }, text = { width: 200, height: 40 };

test('corners and centre', () => {
  assert.deepEqual(place(page, text, 1, 20), { x: 20, y: 20 }); // top left
  assert.deepEqual(place(page, text, 9, 20), { x: 780, y: 540 }); // bottom right
  assert.deepEqual(place(page, text, 5, 20), { x: 400, y: 280 }); // centre
  assert.deepEqual(place(page, text, 6, 20), { x: 400, y: 540 }); // bottom centre
  assert.deepEqual(place(page, text, 7, 20), { x: 780, y: 20 }); // top right
});

test('tiles cover the page, corners included', () => {
  const t = tiles(page, text);
  assert.ok(t.length > 10);
  for (const corner of [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 600 }, { x: 1000, y: 600 }]) {
    const near = Math.min(...t.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)));
    assert.ok(near < 300, `corner ${JSON.stringify(corner)} is ${near} px from a copy`);
  }
});

test('{file} becomes the file name without extension', () => {
  assert.equal(fillIn('{file}', 'DSC_1234.JPG'), 'DSC_1234');
  assert.equal(fillIn('© Wim · {FILE}', '/Users/w/Pictures/IMG_0042.cr2'), '© Wim · IMG_0042');
  assert.equal(fillIn('© Your Name', 'photo.jpg'), '© Your Name');
});

test('whole() keeps only copies that fit completely on the page', () => {
  const spots = tiles(page, text);
  const kept = whole(spots, page, text, Math.PI / 6);
  assert.ok(kept.length > 0 && kept.length < spots.length);
  const ex = (200 * Math.cos(Math.PI / 6) + 40 * Math.sin(Math.PI / 6)) / 2;
  for (const p of kept) assert.ok(p.x - ex >= 0 && p.x + ex <= page.width);
  assert.deepEqual(whole([{ x: 500, y: 300 }], page, text, 0), [{ x: 500, y: 300 }]);
  assert.deepEqual(whole([{ x: 50, y: 300 }], page, text, 0), []);
});
