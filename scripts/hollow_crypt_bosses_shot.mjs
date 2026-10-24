// Evidence shots of the Hollow Crypt wing bosses in a live offline world: each
// boss in its arena and a strip of every mechanic (Sexton Marrow's Shovelful,
// grave mark, Open Graves and Burial Toll; the Lady of the Bonechill's grave
// lanterns, Lament, Frozen Embrace, Rime Path and Bridal Freeze; Cantor
// Ilvane's Dirge with the pillar shadows, Harmony and the Bone Organ).
// Evidence tooling, not a repo test.
//
//   node scripts/hollow_crypt_bosses_shot.mjs <outDir> [marrow|lady|ilvane|all]
//
// Env: SHOT_URL (http://127.0.0.1:5251/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5251/';
const OUT = process.argv[2] ?? path.join('tmp', 'hollow_crypt_bosses');
const MODE = process.argv[3] ?? 'all';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = ['c1', 'c2', 'c3', 'c4', 'p1', 'drake', 'p2', 'w1', 'w2', 'w3', 'w4'];
const PACKS2 = ['e1', 'e2', 'e3', 'q1', 'q2', 's1'];

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
    charName: 'Gravewalker',
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
  for (const p of [...PACKS, ...PACKS2]) await chat(`/dev crypt kill ${p}`, 150);
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
  await chat('/dev crypt tp landing', 1500);
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
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
      },
      [O.x, O.z, x, z, fx, fz, yaw, pitch, dist],
    );
  /** Put the boss (and its timers) where the shot wants it. */
  const placeBoss = async (templateId, x, z, facing) =>
    page.evaluate(
      ([ox, oz, id, x, z, facing]) => {
        const w = window.__game.world;
        for (const e of w.ctx.entities.values()) {
          if (e.templateId !== id || e.dead) continue;
          const g = w.ctx.groundPos(ox + x, oz + z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.facing = facing;
          e.prevFacing = facing;
        }
      },
      [O.x, O.z, templateId, x, z, facing],
    );
  /** Hold every one of the boss's timers off (each strip fires its own). */
  const quiet = async (templateId) =>
    page.evaluate((id) => {
      const w = window.__game.world;
      for (const e of w.ctx.entities.values()) {
        const st = e.templateId === id ? e.cryptBossFight : null;
        if (!st) continue;
        for (const k of Object.keys(st)) if (k.endsWith('Timer')) st[k] = 999;
      }
    }, templateId);
  const dir = (sub) => {
    const d = path.join(OUT, sub);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const shot = async (sub, name) => {
    const file = path.join(dir(sub), `${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };

  if (MODE === 'marrow' || MODE === 'all') {
    // Sexton Marrow in the Bell Yard (centre -82, 116; the rope near -92, 121).
    await stand(-82, 98, -82, 116, 0, 0.2, 26);
    await sleep(2500);
    await shot('sexton', 'marrow_00_bell_yard');
    await chat('/dev crypt pull marrow', 1500);
    await quiet('sexton_marrow');
    await placeBoss('sexton_marrow', -82, 114, Math.PI);
    await stand(-82, 109, -82, 114, 0.6, 0.25, 16);
    await sleep(1500);
    await shot('sexton', 'marrow_01_combate');
    await chat('/dev crypt trigger shovel', 500);
    await shot('sexton', 'marrow_02_paletada_aviso');
    await sleep(800);
    await shot('sexton', 'marrow_03_paletada_tierra');
    await sleep(2000);
    await chat('/dev noaggro', 200);
    await chat('/dev crypt trigger grave', 1300);
    await shot('sexton', 'marrow_04_tomado_medidas');
    await sleep(3000);
    await shot('sexton', 'marrow_05_tumba_abierta');
    await chat('/dev crypt trigger grave', 4800);
    await stand(-82, 104, -82, 116, 0.3, 0.45, 26);
    await sleep(600);
    await shot('sexton', 'marrow_06_tumbas_en_el_suelo');
    await chat('/dev crypt trigger toll', 400);
    await stand(-80, 106, -92, 121, 0.4, 0.15, 22);
    await sleep(1600);
    await shot('sexton', 'marrow_07_toque_cuerda');
    await sleep(1000);
    await shot('sexton', 'marrow_08_toque_tanido');
    await sleep(1400);
    await shot('sexton', 'marrow_09_toque_final');
    await sleep(800);
    await shot('sexton', 'marrow_10_huesos_se_levantan');
    // Lay him to rest so he never chases the camera into the next arena.
    await chat('/dev crypt kill marrow', 2500);
  }
  if (MODE === 'lady' || MODE === 'all') {
    // The Lady of the Bonechill on the frozen ravine floor (centre 80, 112).
    await stand(80, 94, 80, 112, 0, 0.3, 30);
    await sleep(2500);
    await shot('dama', 'dama_00_barranco');
    await sleep(2500);
    await chat('/dev crypt pull lady', 2500);
    await quiet('rimeweb');
    await stand(80, 100, 80, 114, 0.4, 0.3, 24);
    await sleep(1200);
    await shot('dama', 'dama_01_combate_faroles');
    await chat('/dev crypt trigger lament', 1500);
    await shot('dama', 'dama_02_lamento_aviso');
    await sleep(1600);
    await shot('dama', 'dama_03_lamento_golpe');
    await sleep(800);
    await shot('dama', 'dama_04_farol_apagado');
    await chat('/dev noaggro', 200);
    await chat('/dev crypt trigger embrace', 900);
    await shot('dama', 'dama_05_abrazo_aviso');
    await sleep(1800);
    await shot('dama', 'dama_06_abrazo_en_el_aire');
    await sleep(8000);
    await shot('dama', 'dama_07_abrazo_caida');
    await chat('/dev crypt hp 49', 300);
    await sleep(1400);
    await shot('dama', 'dama_08_congelacion_aviso');
    await sleep(1600);
    await stand(80, 96, 80, 112, 0, 0.5, 34);
    await sleep(800);
    await shot('dama', 'dama_09_barranco_helado');
    await chat('/dev crypt kill lady', 2500);
  }
  if (MODE === 'ilvane' || MODE === 'all') {
    // Cantor Ilvane on the Choir Loft (her spot 0, 163; the organ at z 170).
    await stand(0, 151.5, 0, 163, 0, 0.3, 24);
    await sleep(2500);
    await shot('cantora', 'cantora_00_coro');
    await sleep(2500);
    await chat('/dev crypt pull ilvane', 2500);
    await quiet('cantor_ilvane');
    await placeBoss('cantor_ilvane', 0, 163, Math.PI);
    await stand(3, 156, 0, 163, 0.5, 0.3, 18);
    await sleep(1200);
    await shot('cantora', 'cantora_01_armonia');
    await chat('/dev crypt trigger dirge', 1200);
    await stand(10, 152.5, 0, 163, 0.25, 0.7, 26);
    await sleep(200);
    await shot('cantora', 'cantora_02_endecha_sombras');
    await sleep(1300);
    await shot('cantora', 'cantora_03_endecha_golpe');
    await sleep(3500);
    await chat('/dev crypt trigger organ', 2400);
    await stand(-2, 152.5, 0, 168, 0.1, 0.65, 24);
    await sleep(600);
    await shot('cantora', 'cantora_04_organo_carriles');
    await sleep(1400);
    await shot('cantora', 'cantora_05_organo_estallido');
    await sleep(1600);
    await shot('cantora', 'cantora_06_organo_segunda_ola');
  }
} finally {
  await browser.close();
}
