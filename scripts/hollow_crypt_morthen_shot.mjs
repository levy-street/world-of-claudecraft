// Evidence shots of Morthen the Gravecaller's rite in a live offline world:
// his hover from the default MMO camera, the telegraphed Shadow Pulse,
// Gravecall's Bound Souls, the Rite of the Unquiet (the ward, the dark
// candles, a relight channel, the ward shattering), Reap the Unquiet, the
// heroic Name the Dead and Grasp of the Grave, and the Knellwyrm's heroic
// Burning Knell. Evidence tooling, not a repo test.
//
//   node scripts/hollow_crypt_morthen_shot.mjs <outDir> [hover|normal|heroic|all] [prefix]
//
// Env: SHOT_URL (http://127.0.0.1:5257/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5257/';
const OUT = process.argv[2] ?? path.join('tmp', 'morthen_rite');
const MODE = process.argv[3] ?? 'all';
const PREFIX = process.argv[4] ?? '';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = ['c1', 'c2', 'c3', 'c4', 'p1', 'drake', 'p2', 'w1', 'w2', 'w3', 'w4'];
const PACKS2 = ['e1', 'e2', 'e3', 'q1', 'q2', 's1', 'marrow', 'rimeweb', 'ilvane'];
// The Rite Ring (instance-local): centre (0, 205), Morthen's spot (0, 212).
const SPOT = { x: 0, z: 212 };

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
  // The chat throttle drops lines sent too quickly: never less than 1.15 s apart.
  const chat = async (c, wait = 1200) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(Math.max(1150, wait));
  };
  const enter = async (difficulty) => {
    for (const c of [
      '/dev level 20',
      '/dev god',
      `/dev crypt enter ${difficulty}`,
      '/dev crypt gates',
    ])
      await chat(c, 1300);
    for (const p of [...PACKS, ...PACKS2]) await chat(`/dev crypt kill ${p}`, 700);
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
  };
  // The claim's origin: the instance the player stands in.
  const origin = async () =>
    page.evaluate(() => {
      const w = window.__game.world;
      const p = w.player;
      for (const inst of w.ctx.instances) {
        if (inst.partyKey === null || inst.dungeonId !== 'hollow_crypt') continue;
        const o = w.ctx.instanceOriginOf(inst);
        if (Math.abs(p.pos.x - o.x) < 120 && Math.abs(p.pos.z - o.z) < 250) return o;
      }
      return null;
    });
  let O = { x: 0, z: 0 };
  /** Stand at instance-local (x, z) facing (fx, fz); camera yaw offset, pitch, distance. */
  const stand = async (x, z, fx, fz, yaw = 0, pitch = 0.32, dist = 12) =>
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
  /** Hold every one of Morthen's timers off (each strip fires its own). */
  const quiet = async (id = 'morthen', field = 'cryptBossFight') =>
    page.evaluate(
      ([id, field]) => {
        const w = window.__game.world;
        for (const e of w.ctx.entities.values()) {
          const st = e.templateId === id ? e[field] : null;
          if (!st) continue;
          for (const k of Object.keys(st)) if (k.endsWith('Timer')) st[k] = 999;
        }
      },
      [id, field],
    );
  const placeMorthen = async (x, z, facing) =>
    page.evaluate(
      ([ox, oz, x, z, facing]) => {
        const w = window.__game.world;
        for (const e of w.ctx.entities.values()) {
          if (e.templateId !== 'morthen' || e.dead) continue;
          const g = w.ctx.groundPos(ox + x, oz + z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.facing = facing;
          e.prevFacing = facing;
        }
      },
      [O.x, O.z, x, z, facing],
    );
  const dir = (sub) => {
    const d = path.join(OUT, sub);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const shot = async (sub, name) => {
    const file = path.join(dir(sub), `${PREFIX}${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };
  const hideUi = (hide) =>
    page.evaluate((h) => {
      const ui = document.getElementById('ui');
      if (ui) ui.style.display = h ? 'none' : '';
    }, hide);
  /** Light candle `i` by hand: stand at its foot, target its body, interact. */
  const relight = async (i) =>
    page.evaluate(
      ([ox, oz, i]) => {
        const w = window.__game.world;
        const spots = [
          [0, 225],
          [20, 205],
          [0, 185],
          [-20, 205],
        ];
        const [cx, cz] = spots[i];
        const dx = 0 - cx;
        const dz = 205 - cz;
        const d = Math.hypot(dx, dz);
        const at = { x: cx + (dx / d) * 3.4, z: cz + (dz / d) * 3.4 };
        const p = w.player;
        const g = w.ctx.groundPos(ox + at.x, oz + at.z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(cx - at.x, cz - at.z);
        p.prevFacing = p.facing;
        let body = null;
        for (const e of w.ctx.entities.values()) {
          if (e.templateId !== 'crypt_remembrance_candle' || e.dead) continue;
          if (Math.hypot(e.pos.x - ox - cx, e.pos.z - oz - cz) < 4) body = e;
        }
        if (!body) return false;
        p.targetId = body.id;
        w.interact(p.id);
        const input = window.__game.input;
        input.camYaw = p.facing + 0.5;
        input.camPitch = 0.3;
        input.camDist = 13;
        return p.castingAbility;
      },
      [O.x, O.z, i],
    );

  const fight = async (difficulty) => {
    await enter(difficulty);
    await hideUi(true);
    await chat('/dev crypt pull morthen', 2500);
    O = (await origin()) ?? O;
    await quiet();
    await placeMorthen(SPOT.x, SPOT.z, Math.PI);
  };

  if (MODE === 'hover') {
    // Only the default-camera read of his hover (the before/after pair): from
    // the melee spot and from a step back, the default pitch and distance.
    await fight('normal');
    await chat('/dev noaggro', 200);
    await stand(SPOT.x, SPOT.z - 4.5, SPOT.x, SPOT.z);
    await sleep(2500);
    await shot('altura', 'morthen_camara_por_defecto_cuerpo_a_cuerpo');
    await stand(SPOT.x, SPOT.z - 8, SPOT.x, SPOT.z);
    await sleep(1500);
    await shot('altura', 'morthen_camara_por_defecto');
    await hideUi(false);
    await sleep(800);
    await shot('altura', 'morthen_camara_por_defecto_con_hud');
  }

  if (MODE === 'normal' || MODE === 'all') {
    await fight('normal');
    await chat('/dev noaggro', 200);
    await stand(SPOT.x, SPOT.z - 7, SPOT.x, SPOT.z);
    await sleep(2500);
    await shot('altura', 'morthen_camara_por_defecto');
    // Shadow Pulse: the charge and the toll.
    await stand(SPOT.x + 4, SPOT.z - 15, SPOT.x, SPOT.z, 0.2, 0.5, 26);
    await placeMorthen(SPOT.x, SPOT.z, Math.PI);
    await chat('/dev crypt trigger pulse', 900);
    await shot('acto1', 'a1_01_pulso_carga');
    await sleep(950);
    await shot('acto1', 'a1_02_pulso_golpe');
    // Gravecall: a soul leaves its alcove and drifts in.
    await sleep(1500);
    await placeMorthen(SPOT.x, SPOT.z, Math.PI);
    await stand(SPOT.x + 6, SPOT.z - 14, 15, 220, 0.3, 0.45, 30);
    await chat('/dev crypt trigger gravecall', 1300);
    await shot('acto1', 'a1_03_alma_sale_del_nicho');
    await sleep(2500);
    await shot('acto1', 'a1_04_alma_en_camino');
    await sleep(3200);
    await shot('acto1', 'a1_05_alma_lo_alimenta');
    // The Rite: the ward rises, the candles gutter out.
    await chat('/dev crypt trigger rite', 3500);
    await stand(0, 186, 0, 212, 0, 0.55, 34);
    await sleep(1200);
    await shot('acto2', 'a2_01_rito_velas_apagadas');
    await stand(SPOT.x + 5, SPOT.z - 10, SPOT.x, SPOT.z, 0.2, 0.3, 16);
    await sleep(800);
    await shot('acto2', 'a2_02_escudo_inquieto');
    // A relight channel by hand, then the burst.
    await hideUi(false);
    const casting = await relight(0);
    console.log('relight cast:', casting);
    await sleep(1600);
    await shot('acto2', 'a2_03_reencendiendo_drena_vida');
    await sleep(2700);
    await shot('acto2', 'a2_04_vela_encendida');
    await hideUi(true);
    await chat('/dev crypt trigger candle', 900);
    await chat('/dev crypt trigger candle', 900);
    await stand(0, 190, 0, 212, 0, 0.4, 28);
    await sleep(600);
    await shot('acto2', 'a2_05_escudo_agrietado_tres_velas');
    await chat('/dev crypt trigger candle', 600);
    await shot('acto2', 'a2_06_escudo_estalla');
    await sleep(1500);
    await shot('acto2', 'a2_07_aturdido_vulnerable');
    await sleep(7500);
    // Last Rites: the Reap.
    await chat('/dev crypt hp 34', 2600);
    await quiet();
    await placeMorthen(SPOT.x, SPOT.z, Math.PI);
    await stand(SPOT.x + 9, SPOT.z - 12, SPOT.x, SPOT.z, 0.3, 0.55, 26);
    await chat('/dev crypt trigger reap', 1000);
    await shot('acto3', 'a3_01_siega_aviso');
    await sleep(950);
    await shot('acto3', 'a3_02_siega_golpe');
    await chat('/dev crypt kill morthen', 2500);
    await chat('/dev crypt reset', 3000);
  }

  if (MODE === 'heroic' || MODE === 'all') {
    await fight('heroic');
    await chat('/dev noaggro', 200);
    // Name the Dead: the Ledger names the next candle.
    await chat('/dev crypt trigger rite', 3500);
    await stand(0, 190, 0, 212, 0.4, 0.5, 30);
    await sleep(1000);
    await shot('heroico', 'h_01_nombra_a_los_muertos');
    await chat('/dev crypt trigger candle', 900);
    await shot('heroico', 'h_02_siguiente_vela_nombrada');
    // Grasp of the Grave.
    await chat('/dev crypt trigger grasp', 700);
    await stand(-24, 205, 0, 205, 0.6, 0.55, 18);
    await sleep(100);
    await shot('heroico', 'h_03_garra_aviso');
    await sleep(1100);
    await shot('heroico', 'h_04_garra_manos');
    // The Knellwyrm and its Burning Knell.
    for (let i = 0; i < 3; i++) await chat('/dev crypt trigger candle', 400);
    await sleep(9000);
    // The wyrm must be able to take the player as its foe: noaggro off again.
    await chat('/dev noaggro', 400);
    await chat('/dev crypt wyrm', 13500);
    await stand(0, 196, 0, 205, 0, 0.45, 30);
    await sleep(3000);
    // Take wing as soon as it is free (not mid-bite, mid-breath or mid-strafe).
    const flying = () =>
      page.evaluate(() => {
        for (const e of window.__game.world.ctx.entities.values())
          if (e.templateId === 'crypt_knellwyrm' && e.knellwyrmFight?.knell) return true;
        return false;
      });
    // Hand it the fight on this player (the god-mode camera stand-in may have
    // been dropped from its threat), then take wing as soon as it is free.
    const aggro = () =>
      page.evaluate(() => {
        const w = window.__game.world;
        for (const e of w.ctx.entities.values())
          if (e.templateId === 'crypt_knellwyrm' && !e.dead) {
            w.ctx.aggroMob(e, w.player, false);
            return `${e.aiState} ${e.castingAbility} ${!!e.knellwyrmFight}`;
          }
        return 'no wyrm';
      });
    for (let i = 0; i < 12 && !(await flying()); i++) {
      console.log('wyrm:', await aggro());
      await sleep(300);
      await chat('/dev crypt trigger knell', 1150);
    }
    await quiet('crypt_knellwyrm', 'knellwyrmFight');
    await stand(0, 182, 0, 205, 0, 0.5, 30);
    await sleep(100);
    await shot('dragon', 'k_01_alza_el_vuelo');
    await sleep(1600);
    await stand(0, 181, 0, 205, 0, 0.8, 42);
    await sleep(400);
    await shot('dragon', 'k_02_mitad_marcada_en_rojo');
    await sleep(2400);
    await shot('dragon', 'k_03_mitad_a_punto');
    await sleep(700);
    await shot('dragon', 'k_04_fuego_sobre_la_mitad');
    await sleep(1600);
    await shot('dragon', 'k_05_segunda_mitad');
    await sleep(4300);
    await shot('dragon', 'k_06_segundo_fuego');
    await sleep(8000);
    await stand(0, 186, 0, 205, 0, 0.45, 26);
    await sleep(400);
    await shot('dragon', 'k_07_aterriza');
  }
} finally {
  await browser.close();
}
