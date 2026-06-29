// Visual proof for the cooldown-persistence fix: spell/potion cooldowns used to
// reset on logout, letting players bypass them by relogging. Boots the offline
// game, puts the warrior on real ability + combat-potion cooldowns, shows the
// /cooldowns readout, then drives the REAL save/load path (sim.serializeCharacter
// -> sim.addPlayer({state})) to relog the character and shows the cooldowns
// survive. The "old behaviour" panel is the same character loaded with the
// cooldowns field stripped, i.e. exactly what a pre-fix save produced.
// Screenshots land in tmp/. Needs `npm run dev` already running.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.bringToFront();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card = document.querySelector('#offline-select .mini-class[data-class="warrior"]') || document.querySelector('.class-card[data-class="warrior"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => { const n = document.querySelector('#char-name'); if (n) n.value = 'Sprinter'; });
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 60000, polling: 250 });
await sleep(2500);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

// --- stage real cooldowns on the controlled warrior and show the readout.
const before = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const pid = g.world.playerId;
  const e = sim.entities.get(pid);
  e.cooldowns.set('charge', 9);
  e.cooldowns.set('shield_wall', 180);
  e.potionCooldownUntil = sim.time + 42;
  g.world.chat('/cooldowns');
  return { active: [...e.cooldowns.entries()], potionLeft: Math.round(e.potionCooldownUntil - sim.time) };
});
check(before.active.length === 2, `staged 2 ability cooldowns + potion (${before.potionLeft}s)`);
await sleep(700);
await page.screenshot({ path: 'tmp/cooldown_1_active.png' });

// --- relog through the REAL save/load path and compare fixed vs pre-fix load.
const relog = await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = window.__game.world.playerId;
  // REAL serialize: with the fix this now carries a `cooldowns` snapshot.
  const state = sim.serializeCharacter(pid);
  // Fixed load: addPlayer restores the cooldown deltas, re-anchored to the clock.
  const fixedPid = sim.addPlayer('warrior', 'Relogged', { state });
  const fixed = sim.entities.get(fixedPid);
  // Pre-fix load: a save with no `cooldowns` field (exactly the old behaviour).
  const legacy = { ...state }; delete legacy.cooldowns;
  const oldPid = sim.addPlayer('warrior', 'OldRelog', { state: legacy });
  const old = sim.entities.get(oldPid);
  const fmt = (e) => ({
    abilities: [...e.cooldowns.entries()].map(([id, r]) => `${id} (${Math.ceil(r)}s)`),
    potionLeft: e.potionCooldownUntil > sim.time ? Math.round(e.potionCooldownUntil - sim.time) : 0,
  });
  return { saved: state.cooldowns, fixed: fmt(fixed), old: fmt(old) };
});
check(!!relog.saved && !!relog.saved.abilities, 'serializeCharacter now writes a cooldowns snapshot');
check(relog.fixed.abilities.length === 2 && relog.fixed.potionLeft > 0, 'FIXED relog preserves ability + potion cooldowns');
check(relog.old.abilities.length === 0 && relog.old.potionLeft === 0, 'pre-fix relog wiped every cooldown (the exploit)');

// Overlay a labelled evidence card built from the REAL captured values.
await page.evaluate((d) => {
  const card = document.createElement('div');
  card.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;width:760px;font:14px/1.5 system-ui,sans-serif;color:#eee;background:rgba(12,14,20,.94);border:1px solid #3a4256;border-radius:10px;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  const row = (label, v, ok) => `<div style="margin:6px 0"><b style="color:${ok ? '#7fdc7f' : '#ff8a8a'}">${label}</b><br><span style="color:#cfd6e6">abilities: ${v.abilities.join(', ') || '(none)'} &nbsp;|&nbsp; potion: ${v.potionLeft ? v.potionLeft + 's' : '(none)'}</span></div>`;
  card.innerHTML =
    '<div style="font-size:17px;font-weight:700;margin-bottom:4px">Cooldown persistence across logout</div>' +
    '<div style="color:#9aa3b8;margin-bottom:14px">driven through the real sim.serializeCharacter / sim.addPlayer save+load path</div>' +
    `<div style="margin:6px 0;color:#9aa3b8">Before logout: charge (9s), shield_wall (180s), potion (${d.before.potionLeft}s)</div>` +
    row('After relog, BEFORE fix (cooldowns wiped, exploitable):', d.old, false) +
    row('After relog, AFTER fix (cooldowns preserved):', d.fixed, true);
  document.body.appendChild(card);
}, { before, ...relog });
await sleep(400);
await page.screenshot({ path: 'tmp/cooldown_2_relog_compare.png' });

await browser.close();
console.log(fails.length ? `\nFAILURES:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
