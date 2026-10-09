// Evidence shots of the Hollow Crypt finale in a live offline world: Morthen's
// entrance at the Rite Ring (the rite waking, the rise into the sky, the
// proclamation, the descent) and the Knellwyrm (the burning circle warning,
// the flight in from the sky, the touchdown, Pyre Strafe and Dread Bellow),
// each a timed series beside the player. Evidence tooling, not a repo test.
//
//   node scripts/hollow_crypt_finale_shot.mjs <outDir> [rise|wyrm|all]
//
// Env: SHOT_URL (http://127.0.0.1:5200/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5200/';
const OUT = process.argv[2] ?? path.join('tmp', 'hollow_crypt_finale');
const MODE = process.argv[3] ?? 'all';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = [
  'c1',
  'c2',
  'c3',
  'c4',
  'p1',
  'drake',
  'p2',
  'w1',
  'w2',
  'w3',
  'w4',
  'e1',
  'e2',
  'e3',
  'q1',
  'q2',
  's1',
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Riteborn',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev crypt enter', '/dev crypt gates'])
    await chat(c, 1300);
  for (const p of PACKS) await chat(`/dev crypt kill ${p}`, 150);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'hollowCryptField') found = true;
      });
      return found;
    },
    { timeout: 120000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const origin = await page.evaluate(() => {
    window.__game.world.chat('/dev crypt tp landing');
    return null;
  });
  void origin;
  await sleep(1500);
  const O = await page.evaluate(() => {
    const p = window.__game.world.player;
    return { x: p.pos.x, z: p.pos.z + 130 };
  });
  /** Stand at instance-local (x, z) facing (fx, fz), camera orbit yaw/pitch/dist. */
  const stand = async (x, z, fx, fz, yaw, pitch, dist) =>
    page.evaluate(
      ([ox, oz, x, z, fx, fz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        const g = w.ctx.groundPos(ox + x, oz + z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        const input = window.__game.input;
        // The orbit's world yaw looks along the player's facing (plus an offset).
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
      },
      [O.x, O.z, x, z, fx, fz, yaw, pitch, dist],
    );
  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };
  /** Take shots at the given seconds after `t0` (ms). */
  const series = async (t0, marks) => {
    for (const [sec, name, cam] of marks) {
      const wait = t0 + sec * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      if (cam) await cam();
      await shot(name);
    }
  };
  if (MODE === 'rise' || MODE === 'all') {
    // Wait at the stair's mouth, then walk into the ring: the rite wakes.
    await stand(40, 239, 0, 212, 0, 0.25, 22);
    await sleep(2500);
    await shot('morthen_00_ring_vacio');
    await stand(9, 193, 0, 212, 0, 0.16, 15);
    const t0 = Date.now();
    await series(t0, [
      [1.2, 'morthen_01_ritual_despierta'],
      [2.6, 'morthen_02_circulo_arde'],
      [4.2, 'morthen_03_rompe_el_suelo'],
      [6.0, 'morthen_04_asciende', async () => stand(9, 193, 0, 212, 0, 0.08, 17)],
      [8.0, 'morthen_05_asciende_alto'],
      [10.0, 'morthen_06_habla_en_el_cielo'],
      [11.8, 'morthen_07_columna_de_luz', async () => stand(12, 190, 0, 212, 0, 0.05, 22)],
      [13.8, 'morthen_08_desciende', async () => stand(9, 193, 0, 212, 0, 0.16, 15)],
      [15.2, 'morthen_09_aterriza'],
    ]);
    await sleep(1500);
    await shot('morthen_10_combate');
  }
  if (MODE === 'wyrm' || MODE === 'all') {
    await chat('/dev crypt wyrm', 200);
    await stand(14, 190, 0, 212, 0, 0.18, 22);
    const t0 = Date.now();
    await series(t0, [
      [0.8, 'dragon_01_circulo_en_llamas'],
      [3.5, 'dragon_02_aviso_de_fuego'],
      [5.8, 'dragon_03_llega_del_cielo', async () => stand(12, 196, -40, 245, 0, 0.05, 16)],
      [7.6, 'dragon_04_planea_hacia_el_anillo'],
      [9.2, 'dragon_05_desciende', async () => stand(15, 191, 0, 212, 0, 0.12, 24)],
      [10.4, 'dragon_06_aterriza_en_la_pira'],
      [13.0, 'dragon_07_combate'],
    ]);
    await chat('/dev noaggro', 300);
    await chat('/dev crypt trigger strafe', 100);
    const t1 = Date.now();
    await series(t1, [
      [0.9, 'dragon_08_marca_el_carril', async () => stand(26, 200, 0, 212, 0, 0.45, 34)],
      [2.9, 'dragon_09_barrido_de_fuego'],
      [4.2, 'dragon_10_carril_ardiendo'],
    ]);
    await sleep(7000);
    await chat('/dev crypt trigger bellow', 100);
    const t2 = Date.now();
    await series(t2, [
      [1.0, 'dragon_11_bramido_aviso', async () => stand(26, 200, 0, 212, 0, 0.25, 30)],
      [2.15, 'dragon_12_bramido'],
    ]);
  }
} finally {
  await browser.close();
}
