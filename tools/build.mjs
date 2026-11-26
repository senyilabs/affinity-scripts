// Builds each free script into one self-contained file in dist/ for Affinity's Scripts panel and for the community
// registry: the Script Manager header, the pure module (exports stripped), then the Affinity glue.
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const REPO = 'https://raw.githubusercontent.com/senyilabs/affinity-scripts/main';
const SCRIPTS = [
  { file: 'photo-palette', name: 'Photo Palette', module: 'palette', version: '1.0.0',
    category: 'Color', description: 'Pulls the main colours out of a photo and adds them as swatches with hex codes along its bottom edge.' },
  { file: 'watermark', name: 'Watermark', module: 'watermark', version: '1.3.0',
    category: 'Export', description: 'Adds a text watermark (corner, centre or repeated across the photo) to this document or every open one.' },
  { file: 'contact-sheet', name: 'Contact Sheet', module: 'contactsheet', version: '1.2.0',
    category: 'Print', description: 'Puts every photo in a folder on a new A4 page in a grid, with file names: for proofs, picks and printing.' },
];
fs.mkdirSync(root + 'dist', { recursive: true });
for (const s of SCRIPTS) {
  const pure = fs.readFileSync(`${root}src/${s.module}.js`, 'utf8').replace(/^export /gm, '');
  const glue = fs.readFileSync(`${root}src/${s.file}.affinity.js`, 'utf8').replace(/^'use strict';\n/m, '');
  const out = `/**
 * name: ${s.name}
 * description: ${s.description}
 * version: ${s.version}
 * author: Senyi Labs
 */
'use strict';
// Free script by Senyi Labs (https://senyilabs.com). More Affinity scripts: Match Color, Content-Aware Scale.

${pure}
${glue}`;
  fs.writeFileSync(`${root}dist/${s.file}.js`, out);
  console.log(`dist/${s.file}.js ${out.length} bytes`);
}

// registry.json for Script Manager for Affinity (github.com/JiriKrblich/Affinity-script-manager): anyone who adds this
// repository in the app can install the scripts with one click.
const registry = { scripts: SCRIPTS.map((s) => ({
  id: `senyilabs-${s.file}`, name: s.name, description: s.description, version: s.version, author: 'Senyi Labs',
  category: s.category, image: `previews/${s.file}.jpg`, url: 'https://senyilabs.com', download_url: `${REPO}/dist/${s.file}.js`,
})) };
fs.writeFileSync(root + 'registry.json', JSON.stringify(registry, null, 2) + '\n');
console.log(`registry.json ${registry.scripts.length} scripts`);
