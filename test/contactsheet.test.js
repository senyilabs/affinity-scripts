import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFiles, opensAsDocument, perPage, cells, fit, shrink } from '../src/contactsheet.js';

test('only images, in file browser order', () => {
  assert.deepEqual(imageFiles(['/a/IMG_10.jpg', '/a/notes.txt', '/a/IMG_2.JPG', '/a/.hidden.png', '/a/b.png', '/a/c.heic']),
    ['/a/b.png', '/a/c.heic', '/a/IMG_2.JPG', '/a/IMG_10.jpg']);
});

test('cells fill the page in rows and stay inside it', () => {
  const page = { width: 1000, height: 1400 };
  const c = cells(10, page, { cols: 4, margin: 50, gap: 20, caption: 30 });
  assert.equal(c.length, 10);
  assert.deepEqual(c[0], { x: 50, y: 50, width: 210, height: 210 });
  assert.equal(c[4].x, 50); // second row starts at the left again
  assert.equal(c[4].y, 50 + 210 + 30 + 20);
  for (const r of c) assert.ok(r.x + r.width <= 950.0001 && r.y + r.height + 30 <= 1350.0001);
});

test('many pictures shrink the cells to keep them on the page', () => {
  const c = cells(40, { width: 1000, height: 1000 }, { cols: 4, margin: 0, gap: 0, caption: 0 });
  assert.ok(c.at(-1).y + c.at(-1).height <= 1000.0001);
});

test('fit keeps the shape, centres across and sits on the bottom', () => {
  assert.deepEqual(fit(400, 200, { x: 0, y: 0, width: 100, height: 100 }), { x: 0, y: 50, width: 100, height: 50 });
  assert.deepEqual(fit(200, 400, { x: 10, y: 10, width: 100, height: 100 }), { x: 35, y: 10, width: 50, height: 100 });
});

test('shrink averages blocks and leaves small images alone', () => {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set(i % 2 ? [200, 100, 0, 255] : [0, 100, 200, 255], i * 4);
  const s = shrink({ width: 4, height: 4, data }, 2);
  assert.equal(s.width, 2);
  assert.deepEqual([...s.data.slice(0, 4)], [100, 100, 100, 255]);
  const small = { width: 3, height: 2, data: new Uint8Array(24) };
  assert.equal(shrink(small, 10), small);
});

test('Affinity documents and RAW files are included; a RAW next to its JPEG is not', () => {
  assert.deepEqual(imageFiles(['/a/IMG_3.CR2', '/a/IMG_3.JPG', '/a/IMG_4.CR2', '/a/edit.afphoto', '/a/new.af', '/a/x.nef']),
    ['/a/edit.afphoto', '/a/IMG_3.JPG', '/a/IMG_4.CR2', '/a/new.af', '/a/x.nef']);
  assert.equal(opensAsDocument('/a/IMG_4.CR2'), true);
  assert.equal(opensAsDocument('/a/b.jpg'), false);
});

test('perPage fits rows of square cells, so big folders get more pages instead of tiny pictures', () => {
  const a4 = { width: 2480, height: 3508 };
  const opts = { cols: 4, margin: 124, gap: 50, caption: 60 };
  const n = perPage(a4, opts);
  assert.equal(n % 4, 0);
  assert.ok(n >= 16 && n <= 28, String(n));
  const boxes = cells(n, a4, opts);
  assert.ok(boxes.at(-1).y + boxes.at(-1).height <= a4.height - 124 + 1);
  assert.ok(Math.abs(boxes[0].width - boxes[0].height) < 1);
});
