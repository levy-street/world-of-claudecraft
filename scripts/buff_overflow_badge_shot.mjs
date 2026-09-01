// Visual proof for the buff-bar overflow badge (issue: "cannot see all buffs when
// there are a lot", reported on the LOW graphics preset). Boots the offline game on
// the LOW preset (the only tier whose aura cap can shed a buff icon,
// src/game/ui_tier_knobs.ts AURA_VISIBLE_CAP_LOW), stages 13 self buffs on the
// player (well past the cap of 8), and screenshots the buff bar. Needs `npm run dev`
// already running. Screenshots land in tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before the app boots (the
// preset whose aura cap this shot is specifically about).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    // ignore
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Buffington' });

// Stage 13 self buffs (past the 8-buff low-tier cap) directly on the player entity.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const me = sim.entities.get(g.world.playerId);
  const BUFFS = [
    ['buff_ap', 'Battle Shout', 30],
    ['buff_armor', 'Thorns', 25],
    ['buff_int', 'Arcane Intellect', 40],
    ['buff_spellpower', 'Blessing of Kings', 35],
    ['buff_haste', 'Trueshot Aura', 20],
    ['buff_dodge', 'Fortitude', 45],
    ['buff_healing_done', 'Blessing of Wisdom', 28],
    ['buff_agi', 'Mark of the Wild', 32],
    ['buff_spellcrit', 'Moonkin Aura', 24],
    ['buff_speed', 'Sprint', 15],
    ['buff_sta', 'Grace of Air', 38],
    ['buff_spelldmg', 'Flask of Power', 60],
    ['buff_maxhp_pct', 'Well Fed', 50],
  ];
  for (const [kind, name, remaining] of BUFFS) {
    me.auras.push({
      id: `test_${name.toLowerCase().replace(/[^a-z]+/g, '_')}`,
      name,
      kind,
      remaining,
      duration: remaining,
      value: 10,
      sourceId: me.id,
      school: 'physical',
    });
  }
  return { fxLevel: document.documentElement.dataset.fxLevel, count: me.auras.length };
});
console.log('staged', staged);

await sleep(600); // let Hud.update() repaint the buff bar a few frames
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

await page.screenshot({ path: 'tmp/buff_overflow_full.png' });

// Tight crop on the buff bar region for a legible before/after diff.
const box = await page.evaluate(() => {
  const el = document.querySelector('#buff-bar');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: Math.max(r.height, 40) };
});
await page.screenshot({
  path: 'tmp/buff_overflow_crop.png',
  clip: {
    x: Math.max(0, box.x - 20),
    y: Math.max(0, box.y - 10),
    width: box.width + 60,
    height: box.height + 40,
  },
});

const badge = await page.evaluate(() => {
  const el = document.querySelector('#buff-bar .buff-overflow');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  return {
    present: true,
    display: cs.display,
    text: el.textContent,
    title: el.getAttribute('title'),
  };
});
console.log('badge', badge);

await browser.close();
