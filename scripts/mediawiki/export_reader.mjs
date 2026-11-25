// Produce the same reader as the web entry in one self-contained, shareable HTML file.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { COMPANION_ASSETS } from '../../mediawiki/reader/companion_assets.js';
import { DIRECTORY_ART, directoryArt } from '../../mediawiki/reader/directory_art.js';

const output = process.argv[2];
if (!output) throw Error('Pass the output HTML path.');
const html = await readFile('encyclopedia.html', 'utf8');
const styles = Object.fromEntries(
  await Promise.all(
    ['reader', 'hover_tooltip', 'directory_layout'].map(async (name) => [
      name,
      await readFile('mediawiki/reader/' + name + '.css', 'utf8'),
    ]),
  ),
);
const cards = await readFile('mediawiki/seed/pages.tooltips.json');
const xml = await readFile('mediawiki/seed/pages.xml');
const body = xml.toString('utf8');
const paths = new Set([
  ...COMPANION_ASSETS,
  ...Object.keys(DIRECTORY_ART).map(directoryArt),
  ...Array.from(
    body.matchAll(/data-zone=&quot;([a-z0-9_]+)&quot;/g),
    (m) => '/map_bg/' + m[1] + '.webp',
  ),
  ...Array.from(
    body.matchAll(
      /&lt;woc-art path=&quot;([^&]+)&quot;(?: size=&quot;(?:icon|model|attack)&quot;)? \/&gt;/g,
    ),
    (m) => m[1],
  ),
]);
for (const html of Object.values(JSON.parse(cards))) {
  for (const match of html.matchAll(/src="\/?((?:ui|textures)\/[\w/-]+\.(?:webp|png))"/g))
    paths.add('/' + match[1]);
}
const assets = {};
for (const path of paths) {
  const mime = path.endsWith('.woff2')
    ? 'font/woff2'
    : path.endsWith('.png')
      ? 'image/png'
      : path.endsWith('.jpg')
        ? 'image/jpeg'
        : 'image/webp';
  assets[path] = 'data:' + mime + ';base64,' + (await readFile('public' + path)).toString('base64');
}
const packed = gzipSync(xml, { level: 9 }).toString('base64');
const packedCards = gzipSync(cards, { level: 9 }).toString('base64');
const { outputFiles } = await build({
  stdin: {
    contents:
      "import {mountCompanion} from './mediawiki/reader/companion.js';import {openReader} from './mediawiki/reader/reader.js';const assets=JSON.parse(document.getElementById('game-art').textContent); const assetUrl=path=>assets[path];mountCompanion(assetUrl);openReader({assetUrl,packed:" +
      JSON.stringify(packed) +
      ',packedCards:' +
      JSON.stringify(packedCards) +
      '});',
    resolveDir: process.cwd(),
  },
  loader: { '.css': 'text' },
  bundle: true,
  format: 'iife',
  write: false,
  minify: true,
});
await writeFile(
  resolve(output),
  html
    .replace(
      /<link rel="stylesheet" href="\.\/mediawiki\/reader\/(reader|hover_tooltip|directory_layout)\.css"[^>]*>/g,
      (_, name) => '<style>' + styles[name] + '</style>',
    )
    .replace(
      /<script type="module"[^>]*><\/script>/,
      () =>
        '<script type="application/json" id="game-art">' +
        JSON.stringify(assets).replaceAll('<', '\\u003c') +
        '</script><script>' +
        outputFiles[0].text.replace(/<\/script/gi, '<\\/script') +
        '</script>',
    ),
);
