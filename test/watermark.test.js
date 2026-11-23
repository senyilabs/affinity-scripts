import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, tiles } from '../src/watermark.js';

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
