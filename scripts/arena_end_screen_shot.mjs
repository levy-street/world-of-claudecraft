// Visual check for the end-of-match scoreboard modal (#arena-end-window). Renders the
// REAL painter markup shape (arena_end_window.ts) with the REAL CSS block lifted from
// src/styles/components.css, for a ranked 2v2 Victory and an unranked Fiesta Defeat, at
// desktop and phone widths. English strings mirror src/ui/i18n.catalog/hud_chrome.ts.
import { mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const OUT_DIR = 'docs/screenshots/arena-end-screen';
mkdirSync(OUT_DIR, { recursive: true });

// Lift the arena-end scoreboard rules straight out of the shipped stylesheet.
const css = readFileSync('src/styles/components.css', 'utf8');
const start = css.indexOf('  #arena-end-window {');
const end = css.indexOf('/* ---------- The Vale Cup', start);
if (start < 0 || end < 0) throw new Error('could not slice #arena-end-window CSS from components.css');
const arenaCss = css.slice(start, end);

const X_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" fill="none"/></svg>';

const num = (n) => n.toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${num(n)}` : num(n));

// A row descriptor mirrors ArenaEndDisplayRow after buildArenaEndView sorts it.
function rowHtml(r, ranked) {
  const rating = ranked
    ? `<td class="ae-rating">${num(r.ratingAfter)}</td>` +
      `<td class="ae-change ${r.change >= 0 ? 'up' : 'down'}">${signed(r.change)}</td>`
    : '';
  const cls = `ae-${r.ally ? 'ally' : 'enemy'}${r.me ? ' ae-me' : ''}`;
  return (
    `<tr class="${cls}">` +
    `<td class="ae-name"><span class="ae-pname">${r.name}</span> <span class="ae-cls">${r.cls}</span></td>` +
    `<td>${num(r.kb)}</td><td>${num(r.dmg)}</td><td>${num(r.heal)}</td>${rating}</tr>`
  );
}

function modalHtml({ result, resultLabel, ranked, rows, ratingLine, reward }) {
  const header =
    '<th class="ae-name">Name</th><th>Killing Blows</th><th>Damage Done</th><th>Healing Done</th>' +
    (ranked ? '<th>Rating</th><th>Change</th>' : '');
  const footer =
    `<div class="ae-footer">${ratingLine}${reward}` +
    '<button type="button" class="btn ae-leave">Leave</button></div>';
  return (
    `<div id="arena-end-window" class="panel" style="display:block">` +
    `<div class="ae-banner ae-${result}"><span id="arena-end-title">${resultLabel}</span>` +
    `<button type="button" class="x-btn" aria-label="Close">${X_SVG}</button></div>` +
    `<table class="ae-board"><thead><tr>${header}</tr></thead><tbody>` +
    rows.map((r) => rowHtml(r, ranked)).join('') +
    `</tbody></table>${footer}</div>`
  );
}

const rankedModal = modalHtml({
  result: 'win',
  resultLabel: 'Victory',
  ranked: true,
  rows: [
    { name: 'Kaelra', cls: 'Warrior', kb: 3, dmg: 184204, heal: 0, ally: true, me: true, ratingAfter: 1732, change: 16 },
    { name: 'Sunweaver', cls: 'Priest', kb: 1, dmg: 41208, heal: 220145, ally: true, me: false, ratingAfter: 1729, change: 16 },
    { name: 'Grimjaw', cls: 'Rogue', kb: 1, dmg: 151990, heal: 0, ally: false, me: false, ratingAfter: 1698, change: -16 },
    { name: 'Mosswhisper', cls: 'Druid', kb: 0, dmg: 38770, heal: 188402, ally: false, me: false, ratingAfter: 1701, change: -16 },
  ],
  ratingLine: '<div class="ae-rating-summary">Your Rating: 1716 to 1732</div>',
  reward: '<div class="ae-reward">+40 Honor</div>',
});

const fiestaModal = modalHtml({
  result: 'loss',
  resultLabel: 'Defeat',
  ranked: false,
  rows: [
    { name: 'Kaelra', cls: 'Warrior', kb: 4, dmg: 96110, heal: 0, ally: true, me: true },
    { name: 'Embertoss', cls: 'Mage', kb: 2, dmg: 128840, heal: 0, ally: true, me: false },
    { name: 'Ironbark', cls: 'Druid', kb: 6, dmg: 71204, heal: 40188, ally: false, me: false },
    { name: 'Nightfall', cls: 'Hunter', kb: 5, dmg: 142006, heal: 0, ally: false, me: false },
  ],
  ratingLine: '',
  reward: '<div class="ae-reward">+18 Honor</div>',
});

const drawModal = modalHtml({
  result: 'draw',
  resultLabel: 'Draw',
  ranked: true,
  rows: [
    { name: 'Kaelra', cls: 'Warrior', kb: 0, dmg: 96204, heal: 0, ally: true, me: true, ratingAfter: 1716, change: 0 },
    { name: 'Duskblade', cls: 'Rogue', kb: 0, dmg: 88110, heal: 0, ally: false, me: false, ratingAfter: 1522, change: 0 },
  ],
  ratingLine: '<div class="ae-rating-summary">Your Rating: 1716 to 1716</div>',
  reward: '',
});

const yumiModal = modalHtml({
  result: 'win',
  resultLabel: 'Victory',
  ranked: false,
  rows: [
    { name: 'Kaelra', cls: 'Warrior', kb: 2, dmg: 74320, heal: 0, ally: true, me: true },
    { name: 'Sunweaver', cls: 'Priest', kb: 0, dmg: 12040, heal: 168220, ally: true, me: false },
    { name: 'Ashbringer', cls: 'Paladin', kb: 1, dmg: 51900, heal: 33110, ally: true, me: false },
    { name: 'Grimjaw', cls: 'Rogue', kb: 3, dmg: 96110, heal: 0, ally: false, me: false },
    { name: 'Mosswhisper', cls: 'Druid', kb: 1, dmg: 40220, heal: 121400, ally: false, me: false },
    { name: 'Nightfall', cls: 'Hunter', kb: 2, dmg: 88770, heal: 0, ally: false, me: false },
  ],
  ratingLine: '',
  reward: '<div class="ae-reward">+30 Honor</div>',
});

const pageFor = (modal) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
:root { --title-font: 'Trebuchet MS', system-ui, sans-serif; }
* { box-sizing: border-box; }
html,body { margin:0; min-height:100vh; background:#0f1116; font-family: system-ui, sans-serif; }
.panel {
  background: linear-gradient(180deg, #1c2029, #14171e);
  border: 1px solid #3a4150; border-radius: 8px; color: #e8e0c8;
  box-shadow: 0 18px 60px rgba(0,0,0,0.6);
}
.btn { background:#2a3140; color:#e8e0c8; border:1px solid #48505f; border-radius:5px;
  padding:6px 16px; font-size:13px; cursor:pointer; font-family: var(--title-font); }
.x-btn { background:transparent; border:0; color:#c9c1a8; cursor:pointer; padding:4px; line-height:0; }
@layer components { ${arenaCss} }
</style></head><body>${modal}</body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader'],
});
try {
  const shots = [
    { name: 'ranked-2v2-victory-desktop', modal: rankedModal, width: 900, height: 560 },
    { name: 'fiesta-defeat-desktop', modal: fiestaModal, width: 900, height: 560 },
    { name: 'ranked-1v1-draw-desktop', modal: drawModal, width: 900, height: 460 },
    { name: 'yumi5-victory-desktop', modal: yumiModal, width: 900, height: 640 },
    { name: 'ranked-2v2-victory-mobile', modal: rankedModal, width: 393, height: 760 },
  ];
  for (const s of shots) {
    const p = await browser.newPage();
    await p.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 2 });
    await p.setContent(pageFor(s.modal), { waitUntil: 'load' });
    const out = `${OUT_DIR}/${s.name}.png`;
    await p.screenshot({ path: out });
    console.log(`wrote ${out}`);
    await p.close();
  }
} finally {
  await browser.close();
}
