// Before/after evidence for the Hollow Crypt playtest fixes in a live offline
// world: the Gravecaller Adept's Gravespark Volley sight field on the cloister
// floor (and the Processional), Cantor Ilvane's Dirge of the Hollow (planted,
// its build-up, sight cue and release) and the Rite Ring's engraved floor.
// Evidence tooling, not a repo test.
//
//   node scripts/crypt_playtest_fixes_shot.mjs <outDir> <label> [nova|dirge|ring|all]
//
// Env: SHOT_URL (http://127.0.0.1:5256/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5256/';
const OUT = process.argv[2] ?? path.join('tmp', 'crypt_fixes');
const LABEL = process.argv[3] ?? 'shot';
const MODE = process.argv[4] ?? 'all';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = ['c2', 'c3', 'c4', 'drake', 'p2', 'w1', 'w2', 'w3', 'w4'];
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
  const camera = async (yaw, pitch, dist) =>
    page.evaluate(
      ([yaw, pitch, dist]) => {
        const p = window.__game.world.player;
        const input = window.__game.input;
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
      },
      [yaw, pitch, dist],
    );
  const shot = async (name) => {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}_${LABEL}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };

  if (MODE === 'nova' || MODE === 'all') {
    // A fresh Gravecaller Adept stood on its authored spot (its own pack laid
    // to rest at the start, so no corpse or bone dust lies on the floor), its
    // Gravespark Volley started at once: a, b, c from three cameras over the
    // bar, d as it lands.
    const casts = async (x, z, from, tag, cams) => {
      await stand(x + from[0], z + from[1], x, z, cams[0][0], cams[0][1], cams[0][2]);
      await sleep(1500);
      await chat('/dev crypt spawn adept', 400);
      const id = await page.evaluate(
        ([ox, oz, x, z]) => {
          const w = window.__game.world;
          let best = null;
          for (const e of w.ctx.entities.values())
            if (e.templateId === 'crypt_gravecaller_adept' && !e.dead && e.dungeonPackId === 'dev')
              best = e;
          if (!best) return -1;
          const g = w.ctx.groundPos(ox + x, oz + z);
          best.pos = { ...g };
          best.prevPos = { ...g };
          w.player.targetId = best.id;
          return best.id;
        },
        [O.x, O.z, x, z],
      );
      if (id < 0) {
        console.log('no adept spawned at', x, z);
        return;
      }
      await sleep(600);
      await page.evaluate((id) => {
        const e = window.__game.world.ctx.entities.get(id);
        if (e?.trashKit?.timers) e.trashKit.timers.nova = 0;
      }, id);
      await page.waitForFunction(
        (id) => window.__game.world.ctx.entities.get(id)?.castingAbility != null,
        { timeout: 15000, polling: 50 },
        id,
      );
      await sleep(900);
      await shot(`${tag}_a`);
      await camera(cams[1][0], cams[1][1], cams[1][2]);
      await sleep(300);
      await shot(`${tag}_b`);
      await camera(cams[2][0], cams[2][1], cams[2][2]);
      await sleep(300);
      await shot(`${tag}_c`);
      await page.waitForFunction(
        (id) => window.__game.world.ctx.entities.get(id)?.castingAbility == null,
        { timeout: 15000, polling: 30 },
        id,
      );
      await sleep(180);
      await shot(`${tag}_d_golpe`);
      await sleep(2500);
      await page.evaluate((id) => {
        const w = window.__game.world;
        const e = w.ctx.entities.get(id);
        if (e && !e.dead) w.ctx.handleDeath(e, w.player);
      }, id);
      await sleep(1500);
    };
    await chat('/dev crypt kill c1', 600);
    await chat('/dev crypt kill p1', 600);
    // The cloister stair foot (c1, 0 -54): the Chapel Stair climbs behind it.
    await casts(0, -54, [12, -12], 'adepto_claustro', [
      [0.4, 0.55, 30],
      [0.9, 0.42, 24],
      [-0.6, 0.3, 20],
    ]);
    // The Processional (p1, 6 38): the field runs through the Grille gate.
    await casts(6, 38, [8, 20], 'adepto_procesional', [
      [0.25, 0.55, 30],
      [1.2, 0.35, 22],
      [-0.9, 0.7, 26],
    ]);
  }
  if (MODE === 'dirge' || MODE === 'all') {
    await stand(0, 151.5, 0, 163, 0, 0.3, 24);
    await sleep(2500);
    await chat('/dev crypt pull ilvane', 2500);
    await page.evaluate(() => {
      const w = window.__game.world;
      for (const e of w.ctx.entities.values()) {
        const st = e.templateId === 'cantor_ilvane' ? e.cryptBossFight : null;
        if (!st) continue;
        for (const k of Object.keys(st)) if (k.endsWith('Timer')) st[k] = 999;
      }
    });
    // Her place on the loft (0, 163), the organ behind her.
    await page.evaluate(
      ([ox, oz]) => {
        const w = window.__game.world;
        for (const e of w.ctx.entities.values()) {
          if (e.templateId !== 'cantor_ilvane' || e.dead) continue;
          const g = w.ctx.groundPos(ox, oz + 163);
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.facing = Math.PI;
          e.prevFacing = Math.PI;
        }
      },
      [O.x, O.z],
    );
    // Her tank backs away east while she sings: does she follow?
    await stand(5, 158, 0, 163, 0.9, 0.55, 26);
    await sleep(300);
    await chat('/dev crypt trigger dirge', 0);
    await page.waitForFunction(
      () => {
        for (const e of window.__game.world.ctx.entities.values())
          if (e.templateId === 'cantor_ilvane') return e.castingAbility != null;
        return false;
      },
      { timeout: 5000, polling: 20 },
    );
    const start = await page.evaluate(() => {
      const w = window.__game.world;
      for (const e of w.ctx.entities.values())
        if (e.templateId === 'cantor_ilvane') return { x: e.pos.x, z: e.pos.z };
      return null;
    });
    // Her tank walks east; the most she strays from her first spot while the
    // Dirge bar runs is measured in page every walk step.
    await page.evaluate(() => {
      window.__dirgeStray = 0;
    });
    const walk = setInterval(() => {
      page
        .evaluate(
          ([sx, sz]) => {
            const w = window.__game.world;
            w.player.pos.x += 0.35;
            for (const e of w.ctx.entities.values())
              if (e.templateId === 'cantor_ilvane' && e.castingAbility === 'crypt_ilvane_dirge')
                window.__dirgeStray = Math.max(
                  window.__dirgeStray,
                  Math.hypot(e.pos.x - sx, e.pos.z - sz),
                );
          },
          [start.x, start.z],
        )
        .catch(() => {});
    }, 100);
    // Each shot keyed on her bar (screenshots take their own time).
    const atRemaining = (left) =>
      page.waitForFunction(
        (left) => {
          for (const e of window.__game.world.ctx.entities.values())
            if (e.templateId === 'cantor_ilvane')
              return e.castingAbility == null || e.castRemaining <= left;
          return true;
        },
        { timeout: 6000, polling: 16 },
        left,
      );
    await atRemaining(2.0);
    await shot('cantora_endecha_a_inicio');
    await atRemaining(1.15);
    await shot('cantora_endecha_b_crece');
    await atRemaining(0.35);
    await shot('cantora_endecha_c_final');
    clearInterval(walk);
    const stray = await page.evaluate(() => window.__dirgeStray);
    console.log('ILVANE STRAYED DURING THE BAR', stray.toFixed(2), 'yd');
    await atRemaining(0);
    await sleep(120);
    await shot('cantora_endecha_d_golpe');
    await sleep(900);
    await shot('cantora_endecha_e_silenciados');
    // From above: the sight shadows behind the choir pillars.
    await stand(0, 152, 0, 163, 0, 0.3, 24);
    await sleep(1500);
    await chat('/dev crypt trigger dirge', 100);
    await camera(0, 1.15, 34);
    await sleep(1600);
    await shot('cantora_endecha_f_sombras_pilares');
    await sleep(1400);
  }
  if (MODE === 'ring' || MODE === 'all') {
    // Morthen stood at his altar, the rite already played and nobody pulled,
    // so neither his rising nor the Knellwyrm's burning circle covers the floor.
    await chat('/dev noaggro', 300);
    await chat('/dev crypt rise skip', 1500);
    await stand(0, 186, 0, 205, 0, 0.75, 34);
    await sleep(3500);
    await shot('anillo_rito_a');
    await stand(0, 196, 0, 212, 0.2, 1.2, 30);
    await sleep(2000);
    await shot('anillo_rito_b_desde_arriba');
    await stand(0, 203, 0, 212, 0, 1.45, 40);
    await sleep(2000);
    await shot('anillo_rito_c_cenital');
  }
} finally {
  await browser.close();
}
