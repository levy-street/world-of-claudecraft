// Regression guard: boarding the Last Bell ferry must never raise the blocking
// loading screen. Needs `npm run dev` (offline world, no server required).
//
// The authored voyage is not a stock teleport: the fare answer moves the rider
// across the strait and the cinematic covers the seam with its own fades, so the
// classic loading screen appearing mid-crossing is a defect, not a slow load.
// This has now regressed twice from two different directions (the event-fed
// scene-director check lagging the synchronous fare answer, then the frame
// sampling the decision before its own drain), which is why it is worth a
// browser guard on top of the vitest pins.
//
// Two deliberate choices:
//   - It drives the REAL path (target Ewald, interact, then answerSceneChoice,
//     which is what the gossip fare button calls synchronously off the click)
//     rather than calling playSceneForPlayer directly. The bug lived in the gap
//     between the synchronous teleport and the queued scene events, so a driver
//     that skips the click handler cannot see it.
//   - It watches #loading-screen with a MutationObserver installed BEFORE the
//     fare, not a poll. The failure is a race lasting a frame or two; a sampler
//     can step straight over a screen that shows and hides between samples.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
// q_lb_q0_ashore is minLevel 3, so a fresh level 1 rider would take the crossing
// while the Q0 accept refuses ("That quest is not available"). Level up first so
// this exercises the true first-crossing path: campaign quest plus full voyage.
const RIDER_LEVEL = 5;
// The Q0 voyage runs past its 26.95s toll beat before the gangplank walk lands,
// so watch well beyond the teleport and the arrival shot.
const WATCH_MARKS_S = [1, 3, 6, 10, 15, 22, 30, 38];

fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
check(
  'offline world booted',
  await enterOfflineGame(page, { charClass: 'warrior', settleMs: 8000 }),
);

// Recorder first, so nothing between here and the crossing can slip past it.
await page.evaluate(() => {
  const el = document.querySelector('#loading-screen');
  window.__lsLog = [];
  window.__lsArmed = false;
  const snap = (why) => {
    window.__lsLog.push({
      why,
      t: Math.round(performance.now()),
      visible: el.classList.contains('visible'),
      armed: window.__lsArmed,
      status: document.querySelector('#ls-status')?.textContent ?? '',
    });
  };
  snap('install');
  new MutationObserver(() => snap('mutation')).observe(el, {
    attributes: true,
    attributeFilter: ['class'],
  });
});

// Put the rider on the mainland gangplank beside Ewald, where a player who
// walked the bridge down to the boat would be standing.
const setup = await page.evaluate((level) => {
  const w = window.__game.world;
  const ewald = [...w.entities.values()].find((e) => e.templateId === 'ferryman_ewald');
  if (!ewald) return { ok: false, why: 'no ferryman_ewald in the world' };
  w.setPlayerLevel?.(level);
  const p = w.player;
  const gp = w.groundPos(ewald.pos.x + 1.5, ewald.pos.z + 1.5);
  p.pos = { x: gp.x, y: gp.y, z: gp.z };
  p.prevPos = { ...p.pos };
  w.rebucket?.(p);
  return {
    ok: true,
    ewaldId: ewald.id,
    level: p.level,
    ewaldAt: { x: Math.round(ewald.pos.x), z: Math.round(ewald.pos.z) },
  };
}, RIDER_LEVEL);
check('found Ewald and placed the rider at the gangplank', setup.ok, JSON.stringify(setup));
if (!setup.ok) {
  await browser.close();
  process.exit(1);
}

// Let the renderer settle at the departure harbor: the "walked to the boat" state.
await sleep(4000);
const pre = await page.evaluate(() => {
  window.__lsArmed = true;
  const w = window.__game.world;
  return {
    zoneReady: window.__game.renderer.isZoneReadyAt(w.player.pos.x, w.player.pos.z),
    loadingVisible: document.querySelector('#loading-screen').classList.contains('visible'),
  };
});
check(
  'departure harbor is resident and no screen is up before the fare',
  !pre.loadingVisible,
  JSON.stringify(pre),
);
await page.screenshot({ path: 'tmp/ferry_01_before.png' });

// The fare: target, interact to open the prompt, then answer 'pay' exactly the
// way the gossip fare button does (synchronously, straight off the click).
await page.evaluate((id) => {
  const w = window.__game.world;
  w.player.targetId = id;
  w.interact();
}, setup.ewaldId);
await sleep(300);

const answered = await page.evaluate(() => {
  const w = window.__game.world;
  const before = { ...w.player.pos };
  w.answerSceneChoice('ch_lb_ferry_fare_out', 'pay');
  const after = { ...w.player.pos };
  return {
    jumped: Math.hypot(after.x - before.x, after.z - before.z),
    from: { x: Math.round(before.x), z: Math.round(before.z) },
    to: { x: Math.round(after.x), z: Math.round(after.z) },
    // Both read in the SAME synchronous turn as the teleport, before any frame
    // runs: this is precisely the window the loading screen used to win.
    sceneActiveSynchronously: w.sceneActiveForLocalPlayer(),
    loadingVisibleSameTurn: document.querySelector('#loading-screen').classList.contains('visible'),
  };
});
check(
  'the fare answer teleported the rider across the strait',
  answered.jumped > 400,
  `${JSON.stringify(answered.from)} to ${JSON.stringify(answered.to)} (${Math.round(answered.jumped)} yd)`,
);
check(
  'sceneActiveForLocalPlayer() is true in the same synchronous turn as the teleport',
  answered.sceneActiveSynchronously === true,
);
check('no loading screen in that same synchronous turn', !answered.loadingVisibleSameTurn);

for (let i = 0, elapsed = 0; i < WATCH_MARKS_S.length; i++) {
  const at = WATCH_MARKS_S[i];
  await sleep((at - elapsed) * 1000);
  elapsed = at;
  const s = await page.evaluate(() => ({
    visible: document.querySelector('#loading-screen').classList.contains('visible'),
    scene: window.__game.world.sceneActiveForLocalPlayer(),
    x: Math.round(window.__game.world.player.pos.x),
    z: Math.round(window.__game.world.player.pos.z),
  }));
  console.log(`  t+${at}s  loadingVisible=${s.visible} sceneActive=${s.scene} pos=${s.x},${s.z}`);
  if (at === 6) await page.screenshot({ path: 'tmp/ferry_02_crossing.png' });
  if (at === WATCH_MARKS_S[WATCH_MARKS_S.length - 1]) {
    await page.screenshot({ path: 'tmp/ferry_03_after.png' });
  }
}

const post = await page.evaluate(() => {
  const w = window.__game.world;
  return {
    log: window.__lsLog,
    // The first crossing is what starts the campaign, so a silent failure to
    // accept Q0 would leave every later crossing replaying the full voyage.
    hasQ0: [...(w.questLog?.keys?.() ?? [])].includes('q_lb_q0_ashore'),
  };
});
const shownAfterArmed = post.log.filter((r) => r.armed && r.visible);
check(
  'the loading screen never became visible from the fare onward',
  shownAfterArmed.length === 0,
  shownAfterArmed.length ? JSON.stringify(shownAfterArmed) : '',
);
check('the first crossing accepted the Q0 campaign quest', post.hasQ0);

console.log('\n--- #loading-screen transition log ---');
for (const r of post.log) {
  console.log(`  ${r.why} t=${r.t} visible=${r.visible} armed=${r.armed} "${r.status}"`);
}
// Offline play has no game server, so /api 502s are expected here and are not
// counted as failures; they are printed only to keep a real page error visible.
if (pageErrors.length) {
  console.log('\n--- page errors (first 10) ---');
  for (const e of pageErrors.slice(0, 10)) console.log(`  ${e}`);
}

await browser.close();
console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail > 0 ? 1 : 0);
