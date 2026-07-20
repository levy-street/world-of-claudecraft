// Screenshot harness for the Phase 10 QA crafted-consumable icon change.
// Renders the eleven Phase 10 crafted potions/elixirs (plus the curated
// elixir_of_the_bear for reference) as a labeled grid of procedural item
// icons. Pure-icon render, no game boot needed. Run once per code state
// (SHOT_STATE=before|after) around a temporary checkout of the old
// src/ui/icons.ts to produce the PR's before/after pair.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const STATE = process.env.SHOT_STATE ?? 'after';
const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });

const CONSUMABLES = [
  'silverleaf_healing_draught',
  'silverleaf_mana_draught',
  'goldleaf_healing_draught',
  'goldleaf_mana_draught',
  'sunpetal_healing_draught',
  'sunpetal_mana_draught',
  'elixir_of_the_boar',
  'venomfire_elixir',
  'elixir_of_the_serpent',
  'elixir_of_the_bear',
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1100,420', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 420, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

await page.evaluate(
  async (ids, state) => {
    const [{ iconDataUrl }, { ITEMS }] = await Promise.all([
      import('/src/ui/icons.ts'),
      import('/src/sim/data.ts'),
    ]);
    document.body.innerHTML = '';
    document.title = 'Crafted consumable icons';
    const root = document.createElement('div');
    root.style.cssText =
      'background:#15110c;color:#e9dcc0;font:14px system-ui;padding:24px;min-height:100vh;' +
      'background-image:radial-gradient(circle at 30% 0%,#241a10,#0d0a06);';
    document.body.style.margin = '0';
    document.body.appendChild(root);

    const title = document.createElement('h1');
    title.textContent = `Phase 10 crafted draughts and elixirs (${state})`;
    title.style.cssText = 'font:700 22px Georgia,serif;color:#d4af37;margin:0 0 16px';
    root.appendChild(title);

    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:12px;flex-wrap:wrap;padding:10px 12px;' +
      'background:#1d1610;border:1px solid #2c2114;border-radius:10px';
    for (const id of ids) {
      const c = document.createElement('div');
      c.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:92px;gap:4px';
      const img = document.createElement('img');
      img.src = iconDataUrl('item', id, 192);
      img.width = 64;
      img.height = 64;
      img.style.cssText = 'border-radius:8px;border:1px solid #3a2c18;box-shadow:0 2px 6px #0008';
      const lbl = document.createElement('div');
      lbl.textContent = ITEMS[id]?.name ?? id;
      lbl.style.cssText = 'font-size:11px;color:#cdbb8e;text-align:center;line-height:1.15';
      c.appendChild(img);
      c.appendChild(lbl);
      row.appendChild(c);
    }
    root.appendChild(row);
  },
  CONSUMABLES,
  STATE,
);

await new Promise((r) => setTimeout(r, 400));
const out = `tmp/consumable_icons_${STATE}.png`;
await page.screenshot({ path: out, fullPage: false });
console.log('wrote', out);
await browser.close();
