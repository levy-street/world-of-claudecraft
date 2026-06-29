// Render a .mmd Mermaid file to PNG via headless Edge/Chrome + the Mermaid CDN.
//   node scripts/render_mermaid.mjs <in.mmd> <out.png>
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/render_mermaid.mjs <in.mmd> <out.png>');
  process.exit(1);
}
const src = fs.readFileSync(inPath, 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fff} #d{padding:18px;display:inline-block}</style></head>
<body><div id="d" class="mermaid">${src}</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  const { svg } = await mermaid.render('g', document.getElementById('d').textContent);
  document.getElementById('d').innerHTML = svg;
  window.__done = true;
</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => window.__done === true, { timeout: 30000 });
const el = await page.$('#d');
await el.screenshot({ path: outPath });
console.log('wrote', outPath);
await browser.close();
