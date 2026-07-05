// Animation integration check for the Reedbound Acolyte (Stone Cantor rig):
// boots the offline world, enters The Drowned Litany, and records which clips
// the acolyte's visual actually plays in live combat. Expects 'Cast' while it
// hurls Rotwater Vials (the spellfx-launch one-shot) and 'Hit' when melee
// blows land (the synthesized flinch). Needs the dev server (GAME_URL,
// default :5175).
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 90000,
  args: ['--window-size=1280,820', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 150)));
await page.goto('http://localhost:5175/?gfx=ultra', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
await sleep(900);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(400);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Animcheck';
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 300 });
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'normal');
});
await sleep(2500);
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.playerId);
  for (let hop = 0; hop < 8; hop++) {
    const aco = [...sim.entities.values()].find(
      (e) => e.templateId === 'reedbound_acolyte' && !e.dead,
    );
    if (aco) return run.modules[run.moduleIndex];
    if (run.moduleIndex >= run.modules.length - 1) break;
    run.exitPortalOpen = true;
    sim.advanceDelveModule(run);
  }
  return null;
});
if (!found) {
  console.log('NO acolyte');
  process.exit(1);
}
console.log('module:', found);
await sleep(2600);

// Phase 1: stand at spell range and record which clips the acolyte plays.
const phase1 = await page.evaluate(async () => {
  const g = window.__game;
  const sim = g.sim;
  const aco = [...sim.entities.values()].find(
    (e) => e.templateId === 'reedbound_acolyte' && !e.dead,
  );
  const p = sim.player;
  p.pos.x = aco.pos.x;
  p.pos.z = aco.pos.z + 12;
  p.pos.y = aco.pos.y;
  p.prevPos = { ...p.pos };
  const seen = new Set();
  const t0 = performance.now();
  while (performance.now() - t0 < 9000) {
    const v = g.renderer.views.get(aco.id);
    const vis = v && g.renderer.activeVisual(v);
    const clip = vis?.current?.getClip?.()?.name;
    if (clip) seen.add(clip);
    if (aco.dead) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  return {
    seen: [...seen],
    acoDead: aco.dead,
    acoHp: aco.hp,
    aggro: aco.aggroTargetId,
    ai: aco.aiState,
    hostile: aco.hostile,
  };
});
console.log('ranged phase clips:', JSON.stringify(phase1));

// Phase 2: melee the acolyte and record clips (expect the Hit flinch).
const phase2 = await page.evaluate(async () => {
  const g = window.__game;
  const sim = g.sim;
  const aco = [...sim.entities.values()].find(
    (e) => e.templateId === 'reedbound_acolyte' && !e.dead,
  );
  if (!aco) return { error: 'no live acolyte' };
  const p = sim.player;
  p.pos.x = aco.pos.x + 1.5;
  p.pos.z = aco.pos.z;
  p.pos.y = aco.pos.y;
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(aco.pos.x - p.pos.x, aco.pos.z - p.pos.z);
  sim.targetEntity(aco.id);
  sim.startAutoAttack();
  const hp0 = aco.hp;
  const seen = new Set();
  const t0 = performance.now();
  while (performance.now() - t0 < 14000) {
    const v = g.renderer.views.get(aco.id);
    const vis = v && g.renderer.activeVisual(v);
    const clip = vis?.current?.getClip?.()?.name;
    if (clip) seen.add(clip);
    if (aco.dead) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return { seen: [...seen], acoDead: aco.dead, hp0, hp: aco.hp, aggro: aco.aggroTargetId };
});
console.log('melee phase clips:', JSON.stringify(phase2));
await browser.close();
