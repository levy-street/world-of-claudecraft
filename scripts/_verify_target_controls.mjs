// One-off functional check for the mobile ring targeting rework:
//  1. tapping Attack with no target acquires the nearest hostile and starts auto-attack
//  2. tapping Attack again stops the attack (classic toggle preserved)
//  3. tapping Target swap cycles via the Tab-target path (a hostile stays targeted)
// Runs against a dev server (URL= override); drives the real offline game via __game.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:60858/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => check('no pageerror', false, String(err).slice(0, 160)));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Adventurer', settleMs: 1500 });

  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(1200);

  const out = await page.evaluate(async () => {
    const sleepIn = (ms) => new Promise((r) => setTimeout(r, ms));
    const sim = window.__game.sim;
    const res = { hostiles: 0 };
    let mob = null;
    for (const e of sim.entities.values()) {
      if (e.hostile && !e.dead) {
        res.hostiles++;
        if (!mob) mob = e;
      }
    }
    if (!mob) return res;
    res.mobId = mob.id;
    // park the player right next to the mob, clear any target
    sim.player.pos.x = mob.pos.x + 3;
    sim.player.pos.z = mob.pos.z + 3;
    sim.player.pos.y = mob.pos.y;
    sim.player.prevPos = { ...sim.player.pos };
    sim.targetEntity(null);
    await sleepIn(150);
    document.getElementById('mobile-action-attack').click();
    await sleepIn(200);
    res.afterAttackTap = {
      targetId: sim.player.targetId,
      autoAttack: !!sim.player.autoAttack,
    };
    document.getElementById('mobile-action-attack').click();
    await sleepIn(200);
    res.afterSecondTap = { autoAttack: !!sim.player.autoAttack, targetId: sim.player.targetId };
    document.getElementById('mobile-target-cycle').click();
    await sleepIn(200);
    const cycled = sim.player.targetId;
    res.afterCycle = {
      targetId: cycled,
      targetHostile: cycled !== null ? !!sim.entities.get(cycled)?.hostile : null,
    };
    return res;
  });

  console.log(JSON.stringify(out));
  check('a hostile mob exists to test against', out.hostiles > 0, `hostiles=${out.hostiles}`);
  if (out.hostiles > 0) {
    check(
      'Attack tap with no target acquires a target',
      out.afterAttackTap.targetId !== null,
      `targetId=${out.afterAttackTap.targetId}`,
    );
    check('Attack tap starts auto-attack', out.afterAttackTap.autoAttack === true);
    check('second Attack tap stops auto-attack', out.afterSecondTap.autoAttack === false);
    check(
      'Target swap tap keeps a hostile targeted (Tab cycle)',
      out.afterCycle.targetId !== null && out.afterCycle.targetHostile === true,
      `targetId=${out.afterCycle.targetId}`,
    );
  }
} finally {
  await browser.close();
}
process.exit(fail > 0 ? 1 : 0);
