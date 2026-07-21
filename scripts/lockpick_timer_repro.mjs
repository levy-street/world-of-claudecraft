// Repro the player-reported "press correctly but it goes straight to FAIL".
// Drives the REAL HUD input path (keyboard) with HUMAN timing, which the tight
// E2E loop never did. Tests whether the per-page countdown burns the single
// premium try when the player pauses to read the board.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  userDataDir: `C:/Users/Sud0S/AppData/Local/Temp/woc-lp-timer-${Date.now()}`,
  args: [
    '--window-size=1280,800',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE.error:', m.text());
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(2500);
const step1 = await page.evaluate(() => {
  const off = document.querySelector('.server-select-option[data-mode="offline"]');
  off?.click();
  const play = document.querySelector('#btn-play');
  play?.click();
  return { off: !!off, play: !!play };
});
console.log('boot step1:', JSON.stringify(step1));
await sleep(1200);
const step2 = await page.evaluate(() => {
  const name = document.querySelector('#char-name');
  if (name) name.value = 'Picker';
  const cls = document.querySelector('#offline-select .mini-class[data-class="warrior"]');
  cls?.click();
  const start = document.querySelector('#btn-start-offline');
  start?.click();
  return { name: !!name, cls: !!cls, start: !!start, hasGame: !!window.__game };
});
console.log('boot step2:', JSON.stringify(step2));
try {
  await page.waitForFunction(() => window.__game?.sim?.player?.pos, {
    timeout: 20000,
    polling: 200,
  });
} catch {
  const dump = await page.evaluate(() => ({
    hasGame: !!window.__game,
    hasSim: !!window.__game?.sim,
    visiblePanels: [...document.querySelectorAll('[id]')]
      .filter((e) => e.offsetParent)
      .map((e) => e.id)
      .slice(0, 20),
  }));
  console.log('BOOT FAILED dump:', JSON.stringify(dump));
  await page.screenshot({ path: 'tmp/lp_timer_boot_fail.png' });
  await browser.close();
  process.exit(2);
}
await sleep(1500);

const spawnChest = async () =>
  page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.level = 12;
    const prev = sim.delveRunForPlayer(p.id);
    if (prev) {
      sim.leaveDelve();
      sim.freeDelveRun(prev);
    }
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(p.id);
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    sim.spawnDelveModule(run);
    sim.onDelveBossDefeated(run);
    const chest = sim.entities.get(run.rewardChestId);
    if (chest) {
      p.pos.x = chest.pos.x;
      p.pos.z = chest.pos.z;
      p.prevPos.x = chest.pos.x;
      p.prevPos.z = chest.pos.z;
    }
    return run.rewardChestId;
  });

// ---- TEST A: engage premium, do nothing, watch the clock ----
const chestA = await spawnChest();
await page.evaluate((id) => window.__game.lockpickEngage(id, 1), chestA);
await sleep(150);
const t0 = await page.evaluate(() => ({
  inProgress: !!window.__game.sim.lockpickState,
  timerText: document.getElementById('lp-timer-value')?.textContent ?? null,
}));
console.log('A: just engaged ->', JSON.stringify(t0));
await sleep(6000); // a human studying the board for 6 seconds
const tA = await page.evaluate((id) => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.player.id);
  return {
    stillInProgress: !!sim.lockpickState,
    looted: !!run.objectState[id]?.looted,
    attemptAvailable: run.objectState[id]?.attemptAvailable ?? null,
  };
}, chestA);
console.log('A after 6s idle ->', JSON.stringify(tA));
console.log(
  tA.stillInProgress
    ? '  RESULT A: lock survived the pause (timer did NOT burn the try)'
    : `  RESULT A: lock ENDED during the pause; looted=${tA.looted}  <-- timer killed it`,
);

// ---- TEST B: engage premium, press CORRECT keys but with a 2s human pause each ----
const chestB = await spawnChest();
await page.evaluate((id) => window.__game.lockpickEngage(id, 1), chestB);
await sleep(150);
const KEY = { hardSet: 'q', set: 'w', steady: 'e', ease: 'a', drop: 'z' };
const DELTA = { hardSet: -2, set: -1, steady: 0, ease: 1, drop: 2 };
const nextCorrectKey = async () =>
  page.evaluate((DELTA) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.player.id);
    const s = run?.lockpick;
    if (!s) return null;
    const spec = s.pages[s.pageIndex];
    const W = spec.open.length;
    const deltas = spec.tier.allowedActions.map((a) => DELTA[a]);
    let reach = new Set([spec.startRow]);
    const parents = [new Map()];
    for (let c = 1; c < W; c++) {
      const next = new Set();
      const par = new Map();
      for (const r of reach)
        for (const d of deltas) {
          const nr = r + d;
          const trapped = spec.traps[c]?.includes(nr);
          if (spec.open[c].includes(nr) && !trapped && !par.has(nr)) {
            par.set(nr, r);
            next.add(nr);
          }
        }
      parents[c] = par;
      reach = next;
    }
    const path = new Array(W);
    path[W - 1] = spec.seatRow;
    for (let c = W - 1; c > 0; c--) path[c - 1] = parents[c].get(path[c]);
    const col = s.col;
    const need = path[col + 1] - path[col];
    return Object.keys(DELTA).find((a) => DELTA[a] === need) ?? null;
  }, DELTA);

const readTimer = () =>
  page.evaluate(() => {
    const v = document.getElementById('lp-timer-value')?.textContent ?? '';
    const m = v.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
let pressed = 0,
  failedMid = false;
let minRefill = 99; // smallest "just after a press" reading; proves the bar refills
for (let i = 0; i < 40; i++) {
  const stillGoing = await page.evaluate(() => !!window.__game.sim.lockpickState);
  if (!stillGoing) break;
  const action = await nextCorrectKey();
  if (!action) break;
  await page.keyboard.press(KEY[action]); // REAL keypress through the capture handler
  pressed++;
  await sleep(120);
  const justAfter = await readTimer(); // should jump back near the full per-page time
  if (justAfter != null && pressed > 1) minRefill = Math.min(minRefill, justAfter);
  await sleep(3900); // human pause: ~4s, just under the 5s HARD limit
  const beforeNext = await readTimer();
  if (i < 3)
    console.log(
      `  move ${pressed}: timer ${justAfter}s just after press -> ${beforeNext}s after ~4s wait`,
    );
  const ended = await page.evaluate((id) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.player.id);
    return { gone: !sim.lockpickState, looted: !!run.objectState[id]?.looted };
  }, chestB);
  if (ended.gone && !ended.looted) {
    failedMid = true;
    break;
  }
  if (ended.gone && ended.looted) break;
}
console.log(`  smallest refill reading just after a press: ${minRefill}s (should be ~5s on hard)`);
const tB = await page.evaluate((id) => {
  const sim = window.__game.sim;
  const run = sim.delveRunForPlayer(sim.player.id);
  return { looted: !!run.objectState[id]?.looted, inProgress: !!sim.lockpickState };
}, chestB);
console.log(
  `B: pressed ${pressed} CORRECT keys with 2s human pauses -> looted=${tB.looted} failedMidway=${failedMid}`,
);
console.log(
  tB.looted
    ? '  RESULT B: opened despite slow-but-correct play'
    : '  RESULT B: FAILED despite pressing correctly  <-- this is the player report',
);

await browser.close();
process.exit(0);
