// Visual proof for the epic set-name reconciliation (PR: fix/epic-name-reconciliation).
// Renders the five affected set tooltips BEFORE (stray item names that do not match
// the set header, highlighted) and AFTER (every member renamed to match its set),
// writing two PNGs to docs/screenshots/. The AFTER names are the ones now in the
// sim data (src/sim/content/zone3.ts) + the i18n catalog.
//
// Run from the repo root: node scripts/epic_set_names_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Each set: header, then [name, changed?] members. `changed` marks the pieces the
// reconciliation renames (highlighted so the before/after difference reads at a glance).
const SETS = (state) => [
  {
    header: 'Barrowlord Battlegear',
    members: [
      ['Barrowlord Warplate', false],
      ['Barrowlord Sabatons', false],
      [state === 'before' ? "Barrowlord's Dread Visage" : 'Barrowlord Dread Visage', true],
      ['Barrowlord Legguards', false],
    ],
  },
  {
    header: 'Bonewrought Regalia',
    members: [
      [state === 'before' ? 'Crownforged Gauntlets' : 'Bonewrought Gauntlets', true],
      ['Bonewrought Dreadhelm', false],
      ['Bonewrought Warspaulders', false],
      [state === 'before' ? 'Crownforged Girdle' : 'Bonewrought Girdle', true],
    ],
  },
  {
    header: 'Direfang Pelt',
    members: [
      [state === 'before' ? 'Nighttalon Grips' : 'Direfang Grips', true],
      ['Direfang Crown', false],
      ['Direfang Shoulderguards', false],
      [state === 'before' ? 'Nighttalon Waistband' : 'Direfang Waistband', true],
    ],
  },
  {
    header: 'Wraithfire Regalia',
    members: [
      [state === 'before' ? 'Soulflame Gloves' : 'Wraithfire Gloves', true],
      ['Wraithfire Cowl', false],
      ['Wraithfire Mantle', false],
      [state === 'before' ? 'Soulflame Cord' : 'Wraithfire Cord', true],
    ],
  },
  {
    header: 'Galecall Vestments',
    members: [
      [state === 'before' ? "Stormcaller's Handguards" : 'Galecall Handguards', true],
      ['Galecall Crown', false],
      ['Galecall Spaulders', false],
      [state === 'before' ? "Stormcaller's Waistguard" : 'Galecall Waistguard', true],
    ],
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const tooltip = (set, state) => `
  <div class="tt">
    <div class="hdr">${esc(set.header)} <span class="pc">${set.members.length} pieces</span></div>
    ${set.members
      .map(
        ([name, changed]) =>
          `<div class="mem ${changed ? (state === 'before' ? 'bad' : 'good') : ''}">${esc(name)}</div>`,
      )
      .join('')}
  </div>`;

const page = (state) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 18px; background: #0d0d12; font-family: 'Trebuchet MS', system-ui, sans-serif; }
  .col { display: flex; flex-direction: column; gap: 12px; width: 320px; }
  .cap { color: #cdbd8f; font-weight: 700; font-size: 13px; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 2px; }
  .tt { background: #12100a; border: 1px solid #4a3d1d; border-radius: 6px; padding: 8px 11px; box-shadow: 0 2px 8px #000a; }
  .hdr { color: #ffd100; font-weight: 700; font-size: 15px; margin-bottom: 5px; }
  .pc { color: #8c8472; font-weight: 400; font-size: 12px; }
  .mem { color: #7fdc55; font-size: 13px; line-height: 1.55; }
  .mem.bad { color: #ff7a6b; }
  .mem.bad::after { content: ' (mismatched)'; color: #a05046; font-size: 11px; }
  .mem.good { color: #ffe27a; }
</style></head><body><div class="col">
  <div class="cap">${state === 'before' ? 'Before: names split across themes' : 'After: names match the set'}</div>
  ${SETS(state)
    .map((s) => tooltip(s, state))
    .join('')}
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 360, height: 900, deviceScaleFactor: 2 });
  for (const state of ['before', 'after']) {
    await p.setContent(page(state), { waitUntil: 'load' });
    const col = await p.$('.col');
    writeFileSync(`docs/screenshots/epic-set-names-${state}.png`, await col.screenshot());
    console.log(`wrote docs/screenshots/epic-set-names-${state}.png`);
  }
} finally {
  await browser.close();
}
