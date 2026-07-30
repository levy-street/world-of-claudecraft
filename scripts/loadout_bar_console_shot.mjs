// Renders the loadout_bar_scramble_shot.mjs repro's console output (captured
// separately, before/after the fix) as a static image, since the actual DOM
// icon differs for well under one rendered frame: hud.update() always calls
// syncSlotMap() (which self-heals any hotbar entry the ACTIVE spec no longer
// grants) before it repaints the action bar in the same call, so a
// screenshot of the live UI cannot show a persistent before/after visual
// diff for this bug (see the PR body). This captures the one place the
// difference actually is observable: the internal state read immediately
// after the loadout switch, exactly as `loadout_bar_scramble_shot.mjs`
// prints it.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const MODE = process.env.CONSOLE_MODE ?? 'after'; // 'before' | 'after'
const OUT = process.env.CONSOLE_OUT ?? `tmp/${MODE}-console.png`;

const isBefore = MODE === 'before';
const heading = isBefore
  ? 'BEFORE FIX: applyLoadoutBar validated against ABILITIES (global existence)'
  : 'AFTER FIX: applyLoadoutBar validates against the loadout’s OWN target build';
const slot1 = isBefore ? `{ "type": "ability", "id": "stormstrike" }` : `null`;
const verdict = isBefore
  ? 'BEFORE-FIX BEHAVIOR: slot 1 still shows the foreign-spec stormstrike icon\n(Enhancement-only) after switching to the Restoration loadout.'
  : 'AFTER-FIX BEHAVIOR: slot 1 was rejected for the active Restoration build\n(loadoutKnownAbilityIds resolves from the loadout’s own alloc).';
const accent = isBefore ? '#d9534f' : '#4caf50';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0b0e12; font-family: 'Cascadia Code', 'Courier New', monospace; color:#d7dde3; }
  .wrap { padding:28px 32px; width: 900px; }
  h1 { font-size:16px; color:${accent}; margin:0 0 16px; }
  pre { background:#12161c; border:1px solid #2a313b; border-radius:6px; padding:16px; font-size:14px; line-height:1.5; overflow:auto; }
  .key { color:#8ab4f8; }
  .verdict { margin-top:16px; padding:12px 16px; border-left:4px solid ${accent}; background:#12161c; font-size:14px; white-space:pre-wrap; }
</style></head><body><div class="wrap">
  <h1>${heading}</h1>
  <pre>loadout bar scramble result: {
  <span class="key">"slot1"</span>: ${slot1},
  <span class="key">"loadoutBar"</span>: ["lightning_bolt", "stormstrike", "healing_wave", null, ...],
  <span class="key">"activeSpec"</span>: "restoration"
}</pre>
  <div class="verdict">${verdict}</div>
</div></body></html>`;

fs.mkdirSync('tmp', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=960,420', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 960, height: 420 },
});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT });
console.log(`saved ${OUT}`);
await browser.close();
