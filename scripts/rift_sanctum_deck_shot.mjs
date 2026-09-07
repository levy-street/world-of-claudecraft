// Before/after rig for the rift sanctum deck width fix (rift_platform_core.ts):
// the seed-5 S-rank rift boss floor (Warcamp Sanctum, wallX 35,
// polygon shell) with a raised sanctum. Stands the player on the deck near its
// side edge and looks toward the wall, where the old 22-yd cap left a gap.
// Needs `npm run dev` (override GAME_URL). Knobs: YAW, CAMDIST, PITCH, LX, LZ, OUT.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/rift-deck.png';
const CAMDIST = process.env.CAMDIST ?? '10';
const PITCH = process.env.PITCH ?? '0.42';
const YAW = process.env.YAW ?? String(-Math.PI / 2);
const LX = process.env.LX ?? '22';
const LZ = process.env.LZ ?? '86';
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
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }),
    );
  } catch {}
});
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Deckwalk',
  gameBootTimeoutMs: 90000,
});
if (!booted) {
  await page.screenshot({ path: 'tmp/_boot_debug.png' });
  throw new Error('no boot');
}
await sleep(500);

const state = await page.evaluate(
  async (LX_V, LZ_V) => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(28);
    sim.player.gm = true;
    sim.enterRift(5, 28, sim.player.id);
    const inst = () => sim.riftInstances.find((i) => i.partyKey !== null);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let guard = 0; guard < 6 && inst().floorIndex < inst().floorCount - 1; guard++) {
      const i = inst();
      for (const id of i.mobIds) {
        const e = sim.entities.get(id);
        if (e) {
          e.hp = 0;
          e.dead = true;
        }
      }
      // Clear the floor the way a party would: trash dead + puzzle solved, then the
      // sim's own tick opens the descent; walk onto it so descendRift runs the real
      // teardown + arrival path.
      i.puzzleSolved = true;
      i.pylonTotal = 0;
      for (let w = 0; w < 30 && i.descentId === null; w++) await sleep(100);
      const desc = sim.entities.get(i.descentId);
      if (!desc) throw new Error('descent never opened on floor ' + i.floorIndex);
      sim.player.pos = { ...desc.pos };
      sim.player.prevPos = { ...desc.pos };
      await sleep(500);
    }
    const i = inst();
    for (const id of i.mobIds) {
      const e = sim.entities.get(id);
      if (e) {
        e.hp = 0;
        e.dead = true;
      }
    }
    // origin = arrival pos - floor.entry (entry is (0,-11) for this floor)
    const origin = { x: sim.player.pos.x - 0, z: sim.player.pos.z + 11 };
    const lx = Number(LX_V),
      lz = Number(LZ_V);
    sim.player.pos = { x: origin.x + lx, y: sim.player.pos.y, z: origin.z + lz };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.hp = sim.player.maxHp;
    return { floorIndex: i.floorIndex, floorCount: i.floorCount, origin, pos: sim.player.pos };
  },
  LX,
  LZ,
);
console.log('state', JSON.stringify(state));
for (let k = 0; k < 8; k++) {
  await page.screenshot({ path: 'tmp/_frame.png' });
  await sleep(120);
}
await page.evaluate(
  (CAMDIST_V, PITCH_V, YAW_V) => {
    const inp = window.__game.input;
    inp.camYaw = Number(YAW_V);
    inp.camDist = Number(CAMDIST_V);
    inp.camPitch = Number(PITCH_V);
  },
  CAMDIST,
  PITCH,
  YAW,
);
const diag = await page.evaluate(() => {
  const p = window.__game.sim.player;
  const r = window.__game.renderer;
  const boxes = [];
  const scene = r?.scene;
  scene?.traverse((o) => {
    if (
      o.isMesh &&
      o.geometry?.type === 'BoxGeometry' &&
      o.material?.color?.getHex?.() === 0x4a4652
    ) {
      const w = new o.position.constructor();
      o.getWorldPosition(w);
      boxes.push([
        +w.x.toFixed(1),
        +w.y.toFixed(2),
        +w.z.toFixed(1),
        o.geometry.parameters.width,
        o.geometry.parameters.height.toFixed(2),
        o.geometry.parameters.depth.toFixed(2),
      ]);
    }
  });
  return {
    y: p.pos.y,
    x: p.pos.x,
    z: p.pos.z,
    boxes: boxes.length,
    sample: boxes,
    cam: [window.__game.input.camYaw, window.__game.input.camDist],
  };
});
console.log('diag', JSON.stringify(diag));
for (let i = 0; i < 12; i++) {
  const d = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => x.textContent.trim() === 'Dismiss',
    );
    if (!b) return false;
    b.click();
    return true;
  });
  if (d) break;
  await sleep(250);
}
await page.evaluate(() => {
  document.querySelector('#tutorial-greeting')?.remove();
});
await sleep(300);
await page.screenshot({ path: 'tmp/_frame.png' });
await sleep(150);
await page.screenshot({ path: OUT });
console.log('wrote', OUT);
await browser.close();
process.exit(0);
