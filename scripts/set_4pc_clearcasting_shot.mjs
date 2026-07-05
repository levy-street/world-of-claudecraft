// Visual proof for the 4-piece set-bonus proc + Mournweave Clearcasting
// (PR: feature/set-4pc-clearcasting). Renders the Mournweave Raiment set tooltip with
// its new 4-piece Clearcasting bonus (highlighted), plus the Clearcasting buff that the
// proc grants. Styled like the in-game item-set tooltip. Writes to docs/screenshots/.
//
// Run from the repo root: node scripts/set_4pc_clearcasting_shot.mjs
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// [pieces, text, isNew]
const BONUSES = [
  [2, 'You cannot be knocked back (100% knockback resistance).', false],
  [3, 'Increases Intellect by 10 and Stamina by 10.', false],
  [4, 'Your spells have a chance to grant Clearcasting, making your next spell free.', true],
];

const line = ([pieces, text, isNew]) => `
  <div class="bonus ${isNew ? 'new' : 'active'}">
    <span class="pc">(${pieces})</span> ${text}${isNew ? ' <span class="tag">NEW 4-set</span>' : ''}
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:18px; background:#0d0d12; font-family:'Trebuchet MS',system-ui,sans-serif; }
  .col { display:flex; flex-direction:column; gap:12px; width:380px; }
  .cap { color:#cdbd8f; font-weight:700; font-size:12px; letter-spacing:.5px; text-transform:uppercase; }
  .tt { background:#12100a; border:1px solid #4a3d1d; border-radius:6px; padding:10px 13px; box-shadow:0 2px 8px #000a; }
  .hdr { color:#ffd100; font-weight:700; font-size:15px; margin-bottom:2px; }
  .sub { color:#8c8472; font-size:11px; margin-bottom:7px; }
  .bonus { color:#7fdc55; font-size:13px; line-height:1.6; }
  .bonus .pc { color:#cdbd8f; font-weight:700; }
  .bonus.new { color:#ffe27a; }
  .bonus.new .pc { color:#ffd100; }
  .tag { font-size:10px; color:#0d0d12; background:#ffd100; border-radius:3px; padding:0 5px; font-weight:700; vertical-align:1px; }
  .buff { display:flex; align-items:center; gap:9px; background:#12100a; border:1px solid #6a86c9; border-radius:6px; padding:8px 11px; box-shadow:0 0 8px #6a86c955; }
  .buff .icon { width:30px; height:30px; border-radius:5px; background:radial-gradient(circle at 40% 30%,#bcd2ff,#3a56a0); border:1px solid #cfe; box-shadow:0 0 6px #8fb3ff88; flex:0 0 auto; }
  .buff .k { color:#bcd2ff; font-weight:700; font-size:13px; }
  .buff .d { color:#9aa7c4; font-size:11px; }
</style></head><body><div class="col">
  <div class="cap">Item-set tooltip</div>
  <div class="tt">
    <div class="hdr">Mournweave Raiment</div>
    <div class="sub">Cloth (caster), Tier 1</div>
    ${BONUSES.map(line).join('')}
  </div>
  <div class="cap">On proc (10% per cast, 4s cooldown)</div>
  <div class="buff">
    <div class="icon"></div>
    <div>
      <div class="k">Clearcasting</div>
      <div class="d">Your next spell is free.</div>
    </div>
  </div>
</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 420, height: 320, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: 'load' });
  const col = await p.$('.col');
  writeFileSync('docs/screenshots/set-4pc-clearcasting.png', await col.screenshot());
  console.log('wrote docs/screenshots/set-4pc-clearcasting.png');
} finally {
  await browser.close();
}
