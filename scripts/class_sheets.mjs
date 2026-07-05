// Builds a large "character sheet" PNG per class: every wired ability (icon + name +
// description) plus an in-game screenshot of that class's action bar.
// Needs `npm run dev` (:5173). Writes tmp/sheets/<class>.png at ~1920px (x2 DPR = 3840px).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/sheets';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SKILLS_DIR = 'public/ui/skills';
const CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'shaman',
  'druid',
];
const THEME = {
  warrior: ['#ff9d6e', '#150f0c'],
  paladin: ['#f6d98a', '#15110b'],
  hunter: ['#bfe89a', '#0f140d'],
  rogue: ['#7fe0a0', '#0d130f'],
  priest: ['#9ad0ff', '#0d1018'],
  mage: ['#8fd0ff', '#0b1018'],
  warlock: ['#c79bff', '#100b18'],
  shaman: ['#6fd0e0', '#0c1014'],
  druid: ['#9fe07f', '#0d130c'],
};
const TITLE = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  mage: 'Mage',
  warlock: 'Warlock',
  shaman: 'Shaman',
  druid: 'Druid',
};

const b64 = (p) => fs.readFileSync(p).toString('base64');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cleanDesc = (s) =>
  String(s || '')
    .replace(/\$d/g, 'X')
    .replace(/\$N/g, 'you')
    .replace(/\$C/g, 'your class')
    .replace(/\$s\d?/g, 'X');

function iconIds(cls) {
  return fs
    .readdirSync(path.join(SKILLS_DIR, cls))
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.replace('.webp', ''));
}

function buildSheet(cls, abil, barDataUrl) {
  const [accent, bg] = THEME[cls];
  const ids = iconIds(cls);
  // order by learnLevel then name
  ids.sort(
    (a, b) =>
      (abil[a]?.learnLevel ?? 99) - (abil[b]?.learnLevel ?? 99) ||
      (abil[a]?.name ?? a).localeCompare(abil[b]?.name ?? b),
  );
  const cards = ids
    .map((id) => {
      const a = abil[id] || {};
      const name = esc(a.name || id);
      const desc = esc(cleanDesc(a.description));
      const lvl = a.learnLevel ? `Lv ${a.learnLevel}` : '';
      const data = b64(path.join(SKILLS_DIR, cls, `${id}.webp`));
      return `<div class="card"><img src="data:image/webp;base64,${data}" alt="${name}"/>
      <div class="meta"><div class="row1"><span class="name">${name}</span><span class="lvl">${lvl}</span></div>
      <div class="id">${id}</div><div class="desc">${desc || '-'}</div></div></div>`;
    })
    .join('');
  const bar = barDataUrl
    ? `<div class="barwrap"><div class="barlabel">In-game action bar: ${TITLE[cls]}, level 20</div><img class="bar" src="${barDataUrl}"/></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:${bg};color:#eee;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;width:1920px}
    .wrap{padding:48px 56px 64px}
    h1{font-size:54px;margin:0;color:${accent};letter-spacing:.5px}
    .count{color:#aaa;font-size:22px;margin:6px 0 0}
    .barwrap{margin:30px 0 38px;padding:22px;background:#ffffff0a;border:1px solid #ffffff1f;border-radius:16px}
    .barlabel{font-size:20px;color:#cfcfcf;margin-bottom:14px;font-weight:600}
    .bar{max-width:100%;border-radius:10px;display:block}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
    .card{display:flex;gap:20px;background:#ffffff0d;border:1px solid #ffffff1c;border-radius:14px;padding:20px;align-items:flex-start}
    .card img{width:104px;height:104px;border-radius:12px;border:1px solid #ffffff26;background:#000;flex:0 0 auto}
    .meta{min-width:0;padding-top:2px}
    .row1{display:flex;align-items:baseline;gap:12px}
    .name{font-weight:700;color:#fff;font-size:26px;line-height:1.1}
    .lvl{font-size:16px;color:${accent};font-weight:600;white-space:nowrap}
    .id{font-family:ui-monospace,Menlo,monospace;font-size:14px;color:#8a8a8a;margin:3px 0 9px}
    .desc{font-size:19px;color:#d2d2d2;line-height:1.42}
  </style></head><body><div class="wrap">
    <h1>${TITLE[cls]}</h1><div class="count">${ids.length} abilities: icon, name &amp; description</div>
    ${bar}<div class="grid">${cards}</div></div></body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1700,1400', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// headless can reject the Fullscreen request that the enter-world flow fires; no-op it.
await page.evaluateOnNewDocument(() => {
  try {
    const ok = () => Promise.resolve();
    Element.prototype.requestFullscreen = ok;
    if (document.documentElement) document.documentElement.requestFullscreen = ok;
  } catch {
    /* ignore */
  }
});

// grab ability name/description/learnLevel once (dev server serves the TS)
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const abil = await page.evaluate(async () => {
  const m = await import('/src/sim/content/classes.ts');
  const out = {};
  for (const [id, a] of Object.entries(m.ABILITIES))
    out[id] = { name: a.name, description: a.description ?? '', learnLevel: a.learnLevel ?? 1 };
  return out;
});
console.log('loaded', Object.keys(abil).length, 'ability defs');

// render on a blank page so the dev-server homepage's /api polling can't block networkidle
await page.goto('about:blank');

for (const cls of CLASSES) {
  // in-game action bar intentionally omitted; these are icon+name+description sheets.
  const barDataUrl = null;
  try {
    const html = buildSheet(cls, abil, barDataUrl);
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${cls}.png`), fullPage: true });
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
    const dims = fs.statSync(path.join(OUT, `${cls}.png`)).size;
    console.log(
      cls,
      `- wrote sheet (${(dims / 1024).toFixed(0)}KB)${barDataUrl ? ' + bar' : ' (no bar)'}`,
    );
  } catch (e) {
    console.log(cls, '- SHEET ERROR', e.message);
  }
}

await browser.close();
console.log('done -> tmp/sheets/');
