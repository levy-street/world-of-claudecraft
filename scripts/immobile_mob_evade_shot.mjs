// Before/after screenshots for the "invincible Broodmother Egg" fix: a moveSpeed 0
// egg shoved off its spawn point (a player aoeKnockback) that then evaded (its
// last attacker ran off) never left the evade state, because the evade walk home
// (mob/locomotion.ts) only resets on moveToward arrival and a zero step never
// arrives. Every hit floated Evade and dealt nothing. mob/immobile_evade.ts snaps
// an immobile mob home instead so the clutch is attackable again.
//
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
// GAME_URL, e.g.: GAME_URL=http://localhost:5273 SHOT_TAG=before node
// scripts/immobile_mob_evade_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'shot';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960 });
// Standing capture rule: the lowest graphics preset, seeded before the app boots.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Fenn', settleMs: 3000 });
await new Promise((r) => setTimeout(r, 500));
await page
  .waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 30000 },
  )
  .catch(() => {});

// Stage the report: a quester beside a live egg (the rest of Widow Thicket cleared
// so nothing else joins the fight), the egg pulled once, shoved a yard off its
// spawn point, then abandoned so it evades home. Then the quester comes back and
// auto-attacks it.
const staged = await page.evaluate(() => {
  const { sim } = window.__game;
  const egg = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'spider_egg' && !e.dead,
  );
  if (!egg) return null;
  const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (const [id, e] of sim.entities) {
    if (e.kind === 'mob' && e.id !== egg.id && e.ownerId === null && dist2d(e.pos, egg.pos) < 60)
      sim.entities.delete(id);
  }
  sim.setPlayerLevel(12);
  sim.questLog.set('q_broodmother', { questId: 'q_broodmother', counts: [0, 0], state: 'active' });
  const pos = sim.groundPos(egg.pos.x + 1.5, egg.pos.z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.player.facing = Math.atan2(egg.pos.x - pos.x, egg.pos.z - pos.z);
  sim.grid.refresh(sim.entities.values());
  // The pull, the shove, and the abandonment.
  sim.dealDamage(sim.player, egg, 1, false, 'physical', 'Heroic Strike', 'hit');
  egg.pos.x += 1;
  egg.threat.clear();
  egg.aggroTargetId = null;
  egg.aiState = 'evade';
  return { eggId: egg.id };
});
if (!staged) throw new Error('no live spider_egg found in the offline world');
// Let the evade arm run for a few seconds (offline the sim ticks at 20 Hz).
await new Promise((r) => setTimeout(r, 3000));
const mid = await page.evaluate((eggId) => {
  const { sim } = window.__game;
  const egg = sim.entities.get(eggId);
  return { aiState: egg.aiState, hp: egg.hp, maxHp: egg.maxHp };
}, staged.eggId);
console.log(TAG, 'after evade window', JSON.stringify(mid));

// The quester attacks the clutch.
await page.evaluate((eggId) => {
  const { sim } = window.__game;
  sim.targetEntity(eggId, sim.player.id);
  sim.startAutoAttack(sim.player.id);
}, staged.eggId);
// Three swings' worth of floating combat text (a warrior's white swing every ~2.6 s).
await new Promise((r) => setTimeout(r, 7000));
await page.evaluate(() => {
  document.querySelector('#loading-screen')?.classList.remove('visible', 'fade');
  document.getElementById('tutorial-greeting')?.remove();
  // The headless SwiftShader "no GPU acceleration" notice is rig noise, not the shot.
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent?.trim() === 'Dismiss') b.click();
  }
  // The Combat Log tab is the durable evidence: "evades" lines before, damage
  // lines after, whatever instant the floating text is caught at.
  for (const tab of document.querySelectorAll('#chatlog-tabs .chat-tab')) {
    if (tab.textContent?.trim().toLowerCase() === 'combat log') tab.click();
  }
});
await new Promise((r) => setTimeout(r, 300));

await page.screenshot({ path: `tmp/immobile_mob_evade_${TAG}_wide.png` });
const frameBox = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (frameBox && frameBox.width > 0) {
  await page.screenshot({
    path: `tmp/immobile_mob_evade_${TAG}_target.png`,
    clip: {
      x: Math.max(0, frameBox.x - 12),
      y: Math.max(0, frameBox.y - 12),
      width: frameBox.width + 24,
      height: frameBox.height + 24,
    },
  });
}

const state = await page.evaluate((eggId) => {
  const { sim } = window.__game;
  const egg = sim.entities.get(eggId);
  const fct = [...document.querySelectorAll('.fct, .fct-text, [class*="fct"]')]
    .map((n) => n.textContent?.trim())
    .filter(Boolean)
    .slice(0, 12);
  return {
    eggAiState: egg?.aiState,
    eggHp: egg?.hp,
    eggMaxHp: egg?.maxHp,
    playerAutoAttack: sim.player.autoAttack,
    fct,
  };
}, staged.eggId);
console.log(TAG, JSON.stringify(state));

if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
await browser.close();
console.log('done');
