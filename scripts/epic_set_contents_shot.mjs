// Set-contents reference for the epic set-name reconciliation PR
// (fix/epic-name-reconciliation). Renders one card per reconciled set with its
// 2- and 3-piece bonuses and every member piece (name, slot, and where it drops),
// so a player knows the full set and how to collect it. Pieces renamed by this PR
// are highlighted. Writes docs/screenshots/epic-set-contents.png.
//
// Data mirrors the sim content (src/sim/content/items.ts + zone3.ts + dungeons.ts)
// as of release/v0.21.0. Run from the repo root: node scripts/epic_set_contents_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// [name, slot, source, renamedByThisPR?]
const SETS = [
  {
    header: 'Barrowlord Battlegear',
    bonuses: ['(2) +40 attack power', '(3) +15 Strength, +15 Stamina'],
    pieces: [
      ['Barrowlord Warplate', 'Chest', 'Gravewyrm Sanctum (Korzul)', false],
      ['Barrowlord Legguards', 'Legs', 'Gravewyrm Sanctum (Velkhar)', false],
      ['Barrowlord Dread Visage', 'Head', 'Gravewyrm Sanctum (Korzul)', true],
      ['Barrowlord Sabatons', 'Feet', 'Ironvein Foreman / Deeprock 0.1%', false],
    ],
  },
  {
    header: 'Bonewrought Regalia',
    bonuses: ['(2) +40 attack power', '(3) +15 Strength, +15 Stamina, +15% haste'],
    pieces: [
      ['Bonewrought Dreadhelm', 'Head', 'Nythraxis raid', false],
      ['Bonewrought Warspaulders', 'Shoulder', 'Nythraxis raid', false],
      ['Bonewrought Gauntlets', 'Hands', 'Thunzharr (world boss)', true],
      ['Bonewrought Girdle', 'Waist', 'Thunzharr (world boss)', true],
    ],
  },
  {
    header: 'Direfang Pelt',
    bonuses: ['(2) +40 attack power', '(3) +15 Agility, +2% crit, +15% haste'],
    pieces: [
      ['Direfang Crown', 'Head', 'Nythraxis raid', false],
      ['Direfang Shoulderguards', 'Shoulder', 'Nythraxis raid', false],
      ['Direfang Grips', 'Hands', 'Thunzharr (world boss)', true],
      ['Direfang Waistband', 'Waist', 'Thunzharr (world boss)', true],
    ],
  },
  {
    header: 'Wraithfire Regalia',
    bonuses: ['(2) 100% knockback resistance', '(3) +15 Intellect, +15 Spirit, +15% haste'],
    pieces: [
      ['Wraithfire Cowl', 'Head', 'Nythraxis raid', false],
      ['Wraithfire Mantle', 'Shoulder', 'Nythraxis raid', false],
      ['Wraithfire Gloves', 'Hands', 'Thunzharr (world boss)', true],
      ['Wraithfire Cord', 'Waist', 'Thunzharr (world boss)', true],
    ],
  },
  {
    header: 'Galecall Vestments',
    bonuses: ['(2) 100% knockback resistance', '(3) +15 Intellect, +15 Spirit, +15% haste'],
    pieces: [
      ['Galecall Crown', 'Head', 'Nythraxis raid', false],
      ['Galecall Spaulders', 'Shoulder', 'Nythraxis raid', false],
      ['Galecall Handguards', 'Hands', 'Thunzharr (world boss)', true],
      ['Galecall Waistguard', 'Waist', 'Thunzharr (world boss)', true],
    ],
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const card = (set) => `
  <div class="tt">
    <div class="hdr">${esc(set.header)}</div>
    ${set.bonuses.map((b) => `<div class="bonus">${esc(b)}</div>`).join('')}
    <div class="rule"></div>
    ${set.pieces
      .map(
        ([name, slot, src, renamed]) => `
      <div class="row">
        <span class="name ${renamed ? 'renamed' : ''}">${esc(name)}</span>
        <span class="slot">${esc(slot)}</span>
        <span class="src">${esc(src)}</span>
      </div>`,
      )
      .join('')}
  </div>`;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 18px; background: #0d0d12; font-family: 'Trebuchet MS', system-ui, sans-serif; }
  .col { display: flex; flex-direction: column; gap: 12px; width: 540px; }
  .cap { color: #cdbd8f; font-weight: 700; font-size: 13px; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 2px; }
  .sub { color: #8c8472; font-weight: 400; font-size: 11px; text-transform: none; letter-spacing: 0; }
  .tt { background: #12100a; border: 1px solid #4a3d1d; border-radius: 6px; padding: 9px 12px; box-shadow: 0 2px 8px #000a; }
  .hdr { color: #ffd100; font-weight: 700; font-size: 16px; margin-bottom: 4px; }
  .bonus { color: #7fdc55; font-size: 12px; line-height: 1.5; }
  .rule { height: 1px; background: #4a3d1d; margin: 6px 0; }
  .row { display: flex; align-items: baseline; font-size: 13px; line-height: 1.7; }
  .name { color: #ffe27a; flex: 0 0 205px; }
  .name.renamed { color: #ffd100; font-weight: 700; }
  .name.renamed::after { content: ' *'; color: #cdbd8f; }
  .slot { color: #9a927e; flex: 0 0 75px; font-size: 12px; }
  .src { color: #b9c4d0; font-size: 12px; }
</style></head><body><div class="col">
  <div class="cap">Epic set contents <span class="sub">(* = renamed by this PR; sources as of v0.21.0)</span></div>
  ${SETS.map(card).join('')}
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 580, height: 1200, deviceScaleFactor: 2 });
  await p.setContent(page, { waitUntil: 'load' });
  const col = await p.$('.col');
  writeFileSync('docs/screenshots/epic-set-contents.png', await col.screenshot());
  console.log('wrote docs/screenshots/epic-set-contents.png');
} finally {
  await browser.close();
}
