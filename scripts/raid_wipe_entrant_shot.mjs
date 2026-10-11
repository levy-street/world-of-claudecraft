// Screenshot rig for the raid-wipe entrant reset (fix/raid-wipe-entrant-reset).
//
// Stages the reported race in the OFFLINE client: a bot raider is the sole
// participant of an Ignivar attempt at half health; the bot dies while the
// local player (a non-participant who just zoned in) stands in the room. One
// encounter tick later the target frame shows what the entrant sees.
// BEFORE: Ignivar keeps his half-health pull and swings at the entrant.
// AFTER: Ignivar resets to full health and idles home.
//
// Needs `npm run dev` (GAME_URL, default :5173). SHOT_PATH names the PNG.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_PATH = process.env.SHOT_PATH ?? 'tmp/raid_wipe_entrant.png';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// Lowest graphics preset, the standing capture rule.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, { charClass: 'mage', charName: 'Portal Waiter' });
if (!booted) throw new Error('offline world did not boot');
await sleep(1500);

async function awaitWorldPainted() {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    },
    { timeout: 120000 },
  );
}
async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

// Stage: zone into the arena, spawn the bot participant, engage.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  sim.setPlayerLevel(60);
  const pid = sim.player.id;
  sim.chat('/dev dungeon ignivar_raid_arena', pid);
  const inst = sim.instances.find((i) => i.dungeonId === 'ignivar_raid_arena');
  if (!inst) return { ok: false, why: 'no arena claim' };
  const boss = [...sim.entities.values()].find(
    (e) => e.templateId === 'ignivar_herald_of_the_last_flame',
  );
  if (!boss)
    return {
      ok: false,
      why: 'no boss',
      ids: inst.mobIds.map((id) => sim.entities.get(id)?.templateId),
    };
  const botPid = sim.addPlayer('warrior', 'Doomed Tank');
  const bot = sim.entities.get(sim.players.get(botPid).entityId);
  bot.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 3 };
  bot.prevPos = { ...bot.pos };
  // The entrant stands a few yards off, facing the boss, and targets him.
  const p = sim.player;
  p.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 9 };
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
  p.targetId = boss.id;
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = bot.id;
  boss.swingTimer = 999;
  window.__stage = { bossId: boss.id, botId: bot.id };
  return { ok: true, template: boss.templateId };
});
console.log('staged', JSON.stringify(staged));
if (!staged.ok) throw new Error(`stage failed: ${JSON.stringify(staged)}`);
await sleep(4000);
await awaitWorldPainted();
await frame();

// The race: the sole participant dies with the entrant in the room. The
// roster is pinned to the bot alone so the local player's earlier presence
// does not make them a participant (they "just zoned in").
const raced = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const boss = sim.entities.get(window.__stage.bossId);
  const bot = sim.entities.get(window.__stage.botId);
  if (!boss.ignivar) return { ok: false, why: 'encounter never ticked' };
  boss.hp = Math.floor(boss.maxHp / 2);
  boss.ignivar.attemptParticipantIds = [bot.id];
  boss.swingTimer = 999;
  sim.ctx.handleDeath(bot, boss);
  return { ok: true, roster: boss.ignivar.attemptParticipantIds, hp: boss.hp, max: boss.maxHp };
});
console.log('raced', JSON.stringify(raced));
if (!raced.ok) throw new Error(`race failed: ${JSON.stringify(raced)}`);
await sleep(1500);
await frame();
const after = await page.evaluate(() => {
  const g = window.__game;
  const boss = g.sim.entities.get(window.__stage.bossId);
  g.sim.player.targetId = boss.id;
  return {
    hp: boss.hp,
    max: boss.maxHp,
    inCombat: boss.inCombat,
    aiState: boss.aiState,
    target: boss.aggroTargetId,
    me: g.sim.player.id,
    encounter: boss.ignivar !== undefined,
  };
});
console.log('result', JSON.stringify(after));
await sleep(1200);
await awaitWorldPainted();
await page.screenshot({ path: SHOT_PATH });
console.log('wrote', SHOT_PATH);
await browser.close();
