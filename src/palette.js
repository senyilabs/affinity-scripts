// Main colours of a photo, free of Affinity so the tests can run it. k-means in Oklab (a colour space where distances
// match what we see), started with k-means++ from a fixed seed so the same photo always gives the same palette.
// Pixels with alpha below 128 are ignored.

function toLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toSrgb8(x) {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

export function rgbToOklab(r, g, b) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb8(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb8(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb8(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// Small fixed-seed generator (mulberry32), so palettes don't change between runs.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Groups the pixels into `k` clusters by k-means: [{ lab, share }], most common first.
function clusters({ width, height, data }, count, { samples = 40000, rounds = 15 } = {}) {
  const step = Math.max(1, Math.floor((width * height) / samples));
  const points = [];
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    points.push(rgbToOklab(data[i], data[i + 1], data[i + 2]));
  }
  if (!points.length) return [];

  const dist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const rnd = random(1);
  const centres = [points[Math.floor(rnd() * points.length)]];
  const nearest = points.map((p) => dist(p, centres[0]));
  while (centres.length < count) {
    const total = nearest.reduce((s, d) => s + d, 0);
    if (total < 1e-9) break; // every pixel is already on a centre
    let pick = rnd() * total, i = 0;
    while (pick > nearest[i] && i < points.length - 1) pick -= nearest[i++];
    centres.push(points[i]);
    for (let j = 0; j < points.length; j++) nearest[j] = Math.min(nearest[j], dist(points[j], points[i]));
  }

  const owner = new Int32Array(points.length);
  for (let round = 0; round < rounds; round++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < points.length; j++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist(points[j], centres[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      owner[j] = best;
      const s = sum[best];
      s[0] += points[j][0]; s[1] += points[j][1]; s[2] += points[j][2]; s[3]++;
    }
    for (let c = 0; c < centres.length; c++) if (sum[c][3]) centres[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }

  const counts = new Array(centres.length).fill(0);
  for (const o of owner) counts[o]++;
  return centres
    .map((lab, i) => ({ lab, share: counts[i] / points.length }))
    .filter((c) => c.share > 0)
    .sort((x, y) => y.share - x.share);
}

// Up to `count` colours: [{ rgb: [r, g, b], hex, share, lightness }], most common first. `share` is the part of the
// visible pixels (0–1) nearest to that colour. Plain k-means with `count` clusters averages small vivid areas (a
// sunset, a red coat) into mud, so the photo is split into three times as many clusters first, and `count` of them
// are picked one by one: the most common, then each time the one that is both common and far from those picked.
// "Far" counts colour three times as much as lightness, or a photo's light and dark greys crowd out its accents.
// Fewer colours come back if the photo has fewer distinct ones.
export function palette(image, count = 6, options) {
  const all = clusters(image, Math.max(count * 3, 12), options);
  if (!all.length) return [];
  const dist = (p, q) => Math.sqrt((p[0] - q[0]) ** 2 + 9 * ((p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2));
  const picked = [all[0]];
  while (picked.length < Math.min(count, all.length)) {
    let best = null, bestScore = 0;
    for (const c of all) {
      if (picked.includes(c)) continue;
      const score = Math.sqrt(c.share) * Math.min(...picked.map((p) => dist(p.lab, c.lab)));
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best || bestScore < 1e-4) break; // what's left is a copy of a picked colour
    picked.push(best);
  }
  // Every cluster's pixels count towards the picked colour nearest to it.
  const share = picked.map(() => 0);
  for (const c of all) {
    let near = 0;
    picked.forEach((p, i) => { if (dist(p.lab, c.lab) < dist(picked[near].lab, c.lab)) near = i; });
    share[near] += c.share;
  }
  return picked
    .map((c, i) => ({ rgb: oklabToRgb(...c.lab), share: share[i], lightness: c.lab[0] }))
    .sort((x, y) => y.share - x.share)
    .map(({ rgb, share, lightness }) => ({ rgb, hex: hex(rgb), share, lightness }));
}
