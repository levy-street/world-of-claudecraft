// Visual proof for #3520: Duskhide Wraps (leatherworking, rare quality) was
// permanently gray/"no skill gain" for a pre-archetype crafter because its
// skillReq (75, recipe tier 3) sat one tier above the rare ceiling every
// craft carries before an archetype is chosen (archetype.ts
// archetypeCeilingFor). Fixed by rebucketing the recipe to skillReq 50 (tier
// 2), matching the tier its own declared 'rare' quality implies and the rung
// every other rare-quality leatherworking piece already uses (mirewarden_*).
// Boots the offline game, opens the crafting window on the leatherworking
// tab with the character parked at skill 60 (capability tier 2, matching the
// recipe's tier), and shoots the Duskhide Wraps row so its difficulty label
// is legible.
//   node scripts/duskhide_wraps_skill_gain_shot.mjs   (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/leatherworking-skill-gain';
const LABEL = process.env.SHOT_LABEL ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// Lowest graphics preset, per the repo's standing capture rule, seeded before
// the app boots.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Tanner', settleMs: 2000 });

// Stage: a pre-archetype leatherworker at skill 60 (capability tier 2, the
// same rung the fixed recipe now occupies), holding the reagents so the row
// reads craftable.
const staged = await page.evaluate(() => {
  const sim = window.__game?.sim;
  const meta = sim?.players?.get(sim.primaryId);
  if (meta) meta.craftSkills = { ...meta.craftSkills, leatherworking: 60 };
  const ids = [
    ['thorium_ore', 6],
    ['pristine_hide', 3],
    ['rough_hide', 2],
    ['tanning_agent', 1],
  ];
  for (const [id, count] of ids) {
    try {
      sim?.addItem(id, count);
    } catch {}
  }
  sim?.tick?.();
  return meta?.craftSkills.leatherworking;
});
console.log('leatherworking skill staged at:', staged);
await wait(500);

await page.evaluate(() => window.__game?.hud?.toggleCrafting?.());
await wait(1200);
await page.evaluate(() => document.querySelector('[data-craft="leatherworking"]')?.click());
await wait(500);

const row = await page.evaluate(() => {
  // The craft button's own innerHTML embeds the difficulty span (see
  // crafting_window.ts craftBtn.innerHTML), so it's a DESCENDANT of the
  // focus-key element, not a sibling row wrapper.
  const btn = document.querySelector('[data-focus-key="craft:recipe_duskhide_wraps"]');
  const wrapper = btn?.closest('.crafting-row') ?? btn?.parentElement;
  wrapper?.scrollIntoView({ block: 'center' });
  const diff = btn?.querySelector('.crafting-difficulty');
  return {
    found: !!btn,
    difficulty: diff?.getAttribute('data-difficulty') ?? null,
    label: diff?.textContent ?? null,
  };
});
console.log('recipe_duskhide_wraps row:', JSON.stringify(row));
await wait(300);

const clipBox = await page.evaluate(() => {
  const btn = document.querySelector('[data-focus-key="craft:recipe_duskhide_wraps"]');
  const wrapper = btn?.closest('.crafting-row') ?? btn?.parentElement;
  const b = (wrapper ?? document.querySelector('#crafting-window')).getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
const pad = 6;
await page.screenshot({
  path: `${OUT}/${LABEL}-duskhide-wraps-row.png`,
  clip: {
    x: Math.max(0, clipBox.x - pad),
    y: Math.max(0, clipBox.y - pad),
    width: clipBox.width + pad * 2,
    height: clipBox.height + pad * 2,
  },
});

const windowShot = await page.evaluate(() => {
  const b = document.querySelector('#crafting-window').getBoundingClientRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
await page.screenshot({
  path: `${OUT}/${LABEL}-crafting-window-leatherworking.png`,
  clip: windowShot,
});

await browser.close();
