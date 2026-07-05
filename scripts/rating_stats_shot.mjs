// Visual proof for the haste/crit rating paper-doll display (PR: feature/haste-crit-rating).
// Renders the character-sheet stat grid with the two NEW cells, Crit Rating and Haste
// Rating, alongside the existing stats (styled like the in-game character window). The
// stat list and order mirror STAT_GRID in src/ui/char_window.ts. Writes to docs/screenshots/.
//
// Run from the repo root: node scripts/rating_stats_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// [label, value, new?] in STAT_GRID order (two per row).
const CELLS = [
  ['Strength', '24', false],
  ['Armor', '210', false],
  ['Agility', '31', false],
  ['Attack Power', '48', false],
  ['Stamina', '28', false],
  ['Damage/sec', '11.4', false],
  ['Intellect', '95', false],
  ['Crit Chance', '9.8%', false],
  ['Spirit', '52', false],
  ['Dodge', '5.2%', false],
  ['Spell Power', '142', false],
  ['Crit Rating', '20', true],
  ['Haste Rating', '150', true],
];

const cell = ([label, value, isNew]) => `
  <div class="cell ${isNew ? 'new' : ''}">
    <span class="k">${label}</span>
    <span class="v">${value}</span>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:18px; background:#0d0d12; font-family:'Trebuchet MS',system-ui,sans-serif; }
  .panel { width:360px; background:linear-gradient(#181410,#12100a); border:1px solid #4a3d1d; border-radius:8px; padding:12px 14px; box-shadow:0 3px 12px #000a; }
  .title { color:#ffd100; font-weight:700; font-size:15px; margin-bottom:10px; letter-spacing:.4px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; }
  .cell { display:flex; justify-content:space-between; align-items:baseline; padding:4px 7px; border-radius:4px; background:#00000030; }
  .cell .k { color:#b7ac93; font-size:12.5px; }
  .cell .v { color:#f2ead3; font-size:13px; font-weight:700; }
  .cell.new { background:#3a2f12; border:1px solid #ffd10066; }
  .cell.new .k { color:#ffe27a; }
  .cell.new .v { color:#ffd100; }
  .note { margin-top:10px; color:#9a927e; font-size:11px; line-height:1.5; }
  .note b { color:#ffe27a; }
</style></head><body>
  <div class="panel">
    <div class="title">Character</div>
    <div class="grid">${CELLS.map(cell).join('')}</div>
    <div class="note">New: <b>Crit Rating</b> and <b>Haste Rating</b> from gear and set bonuses. Hover shows what each grants (about 10 rating = 1%). Future heroic/mythic gear can add more so players tune their own caps.</div>
  </div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 400, height: 460, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: 'load' });
  const panel = await p.$('.panel');
  writeFileSync('docs/screenshots/rating-stats-paper-doll.png', await panel.screenshot());
  console.log('wrote docs/screenshots/rating-stats-paper-doll.png');
} finally {
  await browser.close();
}
