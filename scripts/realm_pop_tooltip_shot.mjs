// Visual demo for fix/realm-population-tooltip.
// Renders the REAL realm-list markup + the REAL .realm-row/.realm-pop CSS from
// index.html, showing the new explanatory tooltip on the population badge.
// Native `title` tooltips don't appear in screenshots, so we draw the tooltip
// bubble (its text is the exact realm.popTip* string) to show what a hovering
// user reads. Output: docs/realm_pop_before.png, docs/realm_pop_after.png
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';

const BROWSER = ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find((p) => {
  try { readFileSync(p); return true; } catch { return false; }
});

// the exact strings added to src/ui/i18n.catalog/shell.ts (en)
const TIP = {
  low: 'Low population: fewer than 15 players online right now. Plenty of room; great for a fresh start.',
  med: 'Medium population: 15 to 39 players online right now. A healthy, active realm.',
  high: 'High population: 40 to 79 players online right now. Busy, with lots of players around.',
  full: 'Full population: 80 or more players online right now. Very busy; you may wait in a login queue.',
};

const rows = [
  { name: 'Claudemoon', sub: '8 online now', type: 'Normal', cls: 'low', label: 'Low', tip: TIP.low, rec: true },
  { name: 'Ashen Reach', sub: '27 online now', type: 'PvP', cls: 'med', label: 'Medium', tip: TIP.med },
  { name: 'Stormhollow', sub: '54 online now', type: 'RP', cls: 'high', label: 'High', tip: TIP.high },
  { name: 'Ironwatch', sub: '92 online now', type: 'RP-PvP', cls: 'full', label: 'Full', tip: TIP.full },
];

function rowHtml(r, showTip) {
  const rec = r.rec ? `<span class="rn-rec">Recommended</span>` : '';
  // only the hovered ("Low") badge shows its bubble, as a real hover would
  const tip = showTip && r.cls === 'low'
    ? `<div class="tip-bubble"><div class="tip-arrow"></div>${r.tip}</div>`
    : '';
  return `<div class="realm-row">
    <div><div class="realm-name">${r.name}<span class="rn-chars">2 characters</span>${rec}</div>
      <div class="realm-sub">${r.sub}</div></div>
    <div class="realm-meta">
      <div class="realm-type">${r.type}</div>
      <div class="realm-pop ${r.cls}" title="${r.tip || ''}">${r.label}${tip}</div>
    </div>
  </div>`;
}

function page(showTip) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --title-font: 'Trebuchet MS', sans-serif; --gold: #d4af37; }
    body { margin: 0; background: #14100c; font-family: var(--title-font); padding: 40px; }
    #wrap { width: 440px; margin: 0 auto; }
    h2 { color: #c9b27a; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
    #realm-list { margin: 8px 0 12px; border: 1px solid #463a1c; border-radius: 5px; background: #1b160f; }
    .realm-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
      padding: 12px 14px; border-bottom: 1px solid #2a2316; }
    .realm-row:last-child { border-bottom: none; }
    .realm-name { font-family: var(--title-font); font-size: 15px; color: #f0ead8; }
    .realm-name .rn-chars { color: #7fd4ff; font-size: 11px; margin-left: 8px; }
    .realm-name .rn-rec { color: #40d264; font-size: 10px; margin-left: 6px; border: 1px solid #2f5a22; border-radius: 3px; padding: 0 4px; }
    .realm-sub { font-size: 11px; color: #998d6a; margin-top: 2px; }
    .realm-type { font-size: 11px; color: #c9b27a; font-family: var(--title-font); }
    .realm-pop { font-size: 12px; font-family: var(--title-font); min-width: 64px; text-align: right; position: relative; cursor: help; }
    .realm-pop.low { color: #46d246; } .realm-pop.med { color: #ffd100; }
    .realm-pop.high { color: #ff9030; } .realm-pop.full { color: #ff5040; }
    .realm-meta { display: contents; }
    .tip-bubble { position: absolute; right: 0; top: 22px; width: 230px; text-align: left;
      background: #0c0a07; border: 1px solid var(--gold); border-radius: 6px; padding: 8px 10px;
      color: #e8dfc4; font-size: 11px; line-height: 1.45; z-index: 5; box-shadow: 0 6px 18px #000a; }
    .tip-arrow { position: absolute; right: 24px; top: -6px; width: 10px; height: 10px;
      background: #0c0a07; border-left: 1px solid var(--gold); border-top: 1px solid var(--gold); transform: rotate(45deg); }
    .cap { color: #6f6650; font-size: 11px; text-align: center; margin-top: 6px; }
  </style></head><body><div id="wrap">
    <h2>Realm List</h2>
    <div id="realm-list">${rows.map((r) => rowHtml(r, showTip)).join('')}</div>
    <div class="cap">${showTip ? 'AFTER: hovering the "Low" badge explains the population band' : 'BEFORE: "Low" / "Full" with no explanation'}</div>
  </div></body></html>`;
}

const out = 'docs';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: BROWSER, args: ['--no-sandbox'] });
for (const [name, showTip] of [['before', false], ['after', true]]) {
  const p = await browser.newPage();
  await p.setViewport({ width: 520, height: 360, deviceScaleFactor: 2 });
  await p.setContent(page(showTip), { waitUntil: 'load' });
  await p.screenshot({ path: `${out}/realm_pop_${name}.png` });
  console.log(`wrote ${out}/realm_pop_${name}.png`);
}
await browser.close();
