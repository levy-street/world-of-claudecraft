// Headless screenshots of the Undermount raid content (offline client).
// Boots a warrior, poses at the surface fissure entrance (Maerin + door), then
// enters wing 1 and frames the Kiln-Keepers duo (Vosh + Saan). Run from the main
// repo (has puppeteer-core) against the WORKTREE dev server on :5173.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT =
  '/Users/maxc/code/world-of-claudecraft/.claude/worktrees/undermount-raid/docs/screenshots/undermount';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(500);
await page.type('#char-name', 'Delver');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click(),
);
await page.click('#btn-start-offline');
// Poll Node-side (NOT page.waitForFunction): software-GL rendering starves the
// page's requestAnimationFrame, so rAF-based waiting never fires.
{
  let booted = false;
  for (let i = 0; i < 30 && !booted; i++) {
    booted = await page.evaluate(() => !!window.__game?.sim?.player);
    if (!booted) await sleep(2000);
  }
  if (!booted) throw new Error('world did not boot');
}
await sleep(1200);
await page.keyboard.press('Escape'); // skip the intro cinematic (else #ui is hidden)
await sleep(600);

// Pose helper runs in-page against the offline Sim, then settles ticks so the
// renderer catches up before the shot.
async function pose(fn) {
  await page.evaluate(fn);
  await sleep(1000);
}

// Aim: the offline camera locks to input.camYaw, so aim THAT at the target
// (p.facing does not move the camera). camYaw is atan2(dx, dz) from player to target.
const aimAt = (g, px, pz, tx, tz) => {
  const yaw = Math.atan2(tx - px, tz - pz);
  g.input.camYaw = yaw;
  g.input.interpFacing = yaw;
  g.sim.player.facing = yaw;
};

// 1) The seal in action: entering wing 2 before wing 1 is cleared is refused
//    with the "The way down is sealed" banner (proof of the wing-gate mechanic).
await pose(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20);
  p.gm = true;
  sim.enterDungeon('undermount_wing2', p.id); // sealed -> error banner
});
await sleep(400);
await page.screenshot({ path: `${OUT}/01_wing_sealed.png` });
console.log('shot 1: sealed-wing banner');

// Enter wing 1, frame the duo, and optionally target a boss so its frame shows.
const frameDuo = (targetTid) =>
  page.evaluate((tid) => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const bosses = [...sim.entities.values()].filter(
      (e) => e.templateId === 'vosh_the_glazier' || e.templateId === 'saan_the_stoker',
    );
    if (bosses.length) {
      const cx = bosses.reduce((s, b) => s + b.pos.x, 0) / bosses.length;
      const cz = bosses.reduce((s, b) => s + b.pos.z, 0) / bosses.length;
      const px = cx;
      const pz = cz - 24; // pull back to show the lava floor
      p.pos = { x: px, y: 1, z: pz };
      p.prevPos = { ...p.pos };
      sim.rebucket(p);
      const yaw = Math.atan2(cx - px, cz - pz);
      g.input.camYaw = yaw;
      g.input.interpFacing = yaw;
      p.facing = yaw;
    }
    if (tid) {
      const t = [...sim.entities.values()].find((e) => e.templateId === tid && !e.dead);
      if (t) p.targetId = t.id;
    }
    for (let i = 0; i < 20; i++) sim.tick();
  }, targetTid);

// 2) The Kiln-Keepers duo in the warm molten chamber (target Vosh for his frame).
await pose(() => {
  const g = window.__game;
  const sim = g.sim;
  g.hud?.closeAll?.();
  sim.enterDungeon('undermount_wing1', sim.player.id);
  for (let i = 0; i < 10; i++) sim.tick();
});
await frameDuo('vosh_the_glazier');
await sleep(700);
await page.screenshot({ path: `${OUT}/02_kiln_keepers_duo.png` });
console.log('shot 2: kiln-keepers duo (warm interior)');

// 3) Kill Vosh -> Saan gains Kiln Fury; target her so the buff shows on her frame.
await pose(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const vosh = [...sim.entities.values()].find((e) => e.templateId === 'vosh_the_glazier');
  if (vosh) sim.dealDamage(p, vosh, vosh.hp, false, 'physical', null, 'hit', true);
  for (let i = 0; i < 6; i++) sim.tick();
});
await frameDuo('saan_the_stoker');
await sleep(700);
await page.screenshot({ path: `${OUT}/03_kiln_fury_buff.png` });
console.log('shot 3: Kiln Fury buff on the survivor');

const shots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'));
console.log('DONE, wrote', shots.length, 'shots to', OUT, shots);
await browser.close();
