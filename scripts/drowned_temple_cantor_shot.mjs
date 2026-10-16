// Evidence shots of Laverock, the Drowned Temple's lore guide, in a live
// offline world: his offer dialog on the Moongate Landing, his first line as a
// bubble over him, him following the player down the Pilgrim Steps, and his
// finale at the Moon Altar: the column of moonlight on him, the fallen breaking
// into moonlight and their streams climbing to the moon, the calm after, and
// what a late arrival finds. Evidence tooling, not a repo test.
//
//   node scripts/drowned_temple_cantor_shot.mjs [outDir]
//
// Env: SHOT_URL (http://127.0.0.1:5243/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5243/';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_cantor');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const gpu = process.env.SHOT_GPU !== '0';
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      ...(gpu
        ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 300000,
  });
  const shot = async (page, name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };
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
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 240000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'priest',
      charName: 'Steplight',
      gameBootTimeoutMs: 240000,
      selectorTimeoutMs: 120000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of ['/dev level 20', '/dev god', '/dev temple enter']) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1500);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'drownedTempleField') found = true;
        });
        return found;
      },
      { timeout: 240000, polling: 1000 },
    );
    await sleep(6000);
    // The guide and the claim origin (the landing arrival is (0, -230) local).
    const info = await page.evaluate(() => {
      const sim = window.__game.world;
      const p = sim.player;
      let guide = null;
      for (const e of sim.entities.values()) if (e.templateId === 'cantor_laverock') guide = e;
      return { ox: p.pos.x, oz: p.pos.z + 230, guide: guide?.id ?? null };
    });
    console.log('INFO', JSON.stringify(info));
    if (info.guide === null) throw new Error('no guide');
    const stand = async (lx, lz, face, cam) => {
      await page.evaluate(
        (a) => {
          const sim = window.__game.world;
          const p = sim.player;
          p.pos = sim.ctx.groundPos(a.ox + a.lx, a.oz + a.lz);
          p.prevPos = { ...p.pos };
          p.facing = a.face;
          p.prevFacing = a.face;
          const input = window.__game.input;
          input.camYaw = a.cam.yaw ?? 0;
          input.camPitch = a.cam.pitch;
          input.camDist = a.cam.dist;
        },
        { ox: info.ox, oz: info.oz, lx, lz, face, cam },
      );
    };

    // 1. The offer: beside him on the landing, his dialog open.
    await stand(1, -226, Math.PI / 2 + 0.35, { yaw: 0.9, pitch: 0.18, dist: 7 });
    await sleep(2500);
    await page.evaluate((id) => window.__game.hud.openQuestDialog(id), info.guide);
    await sleep(1800);
    await shot(page, 'laverock_1_oferta');

    // 2. "Come with us": his thanks as a bubble over him (and in the chat).
    await page.evaluate(() => {
      const row = document.querySelector('[data-guide-answer="join"]');
      if (row) row.click();
    });
    await sleep(1400);
    await shot(page, 'laverock_2_bocadillo');

    // 3. He follows down the Pilgrim Steps (the trash cleared so nothing fights).
    await page.evaluate(() => window.__game.world.chat('/dev temple kill trash'));
    await sleep(8000);
    const route = [
      [0, -224],
      [3.9, -218.1],
      [0, -215],
      [-24, -196],
      [-28, -193],
      [-31, -183],
    ];
    await page.evaluate(
      async (a) => {
        const sim = window.__game.world;
        const p = sim.player;
        const pts = [];
        for (let i = 0; i < a.route.length - 1; i++) {
          const [ax, az] = a.route[i];
          const [bx, bz] = a.route[i + 1];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.3));
          for (let k = 0; k < n; k++)
            pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
        }
        for (const [x, z] of pts) {
          p.pos = sim.ctx.groundPos(a.ox + x, a.oz + z);
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      { ox: info.ox, oz: info.oz, route },
    );
    await page.evaluate(() => {
      const input = window.__game.input;
      input.camYaw = Math.PI * 0.85;
      input.camPitch = 0.32;
      input.camDist = 13;
      const p = window.__game.world.player;
      p.facing = 0.9;
      p.prevFacing = 0.9;
    });
    await sleep(2600);
    await shot(page, 'laverock_3_siguiendo');

    // 4. The finale: every boss down, the group on the Altar Landing, Ysolei falls.
    await page.evaluate(() => {
      const sim = window.__game.world;
      for (const e of sim.entities.values()) {
        if (e.kind !== 'mob' || e.dead) continue;
        if (/^(choirmother_selthe|tideglass_colossus|mere_hydra_head_)/.test(e.templateId))
          sim.ctx.handleDeath(e, sim.player);
      }
    });
    await sleep(1500);
    await stand(30, 206, -Math.PI / 2, { yaw: -Math.PI / 2, pitch: 0.2, dist: 12 });
    await sleep(1200);
    // Walk along the landing: he catches up on his own once the trail behind
    // the jump is long enough to land on.
    await page.evaluate(
      async (a) => {
        const sim = window.__game.world;
        const p = sim.player;
        for (let x = 30; x >= 14; x -= 0.3) {
          p.pos = sim.ctx.groundPos(a.ox + x, a.oz + 206);
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      { ox: info.ox, oz: info.oz },
    );
    await sleep(6000);
    await page.evaluate(() => {
      const sim = window.__game.world;
      for (const e of sim.entities.values())
        if (e.kind === 'mob' && !e.dead && e.templateId === 'ysolei')
          sim.ctx.handleDeath(e, sim.player);
    });
    // His walk to the altar and his farewell (five lines, six seconds apart).
    const t0 = Date.now();
    await page.waitForFunction(
      (id) => window.__game.world.entities.get(id)?.guideState === 'singing',
      { timeout: 150000, polling: 500 },
      info.guide,
    );
    console.log('SINGING after', Date.now() - t0, 'ms');
    const sung = Date.now();
    const at = async (sec) => {
      const wait = sung + sec * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
    };
    // 5. The first notes: the column falls on him, the pool of light opens, the
    //    lagoon stills; an ordinary over-the-shoulder camera from the island's west.
    await stand(-49, 206.5, Math.PI / 2, { yaw: Math.PI / 2, pitch: 0.24, dist: 12 });
    await at(3.2);
    await shot(page, 'laverock_5_canto_columna');
    // 6. Close on one of the fallen as it breaks into moonlight (the one whose
    //    outline is kindling now): the outline glowing on the stones, the
    //    light peeling up off it, its stream climbing north to the moon.
    const closeOnRising = async (name, lead) => {
      const spot = await page.evaluate((lead) => {
        const fx = window.__game.renderer.riftDeathZoneVisuals?.templeFx?.cantor;
        if (!fx) return null;
        let best = null;
        for (const r of fx.rises) {
          const d = r.spot.at - fx.clock;
          if (d > lead && (best === null || d < best.d)) best = { d, x: r.spot.x, z: r.spot.z };
        }
        return best;
      }, lead);
      if (!spot) return;
      await stand(spot.x - info.ox - 4.5, spot.z - info.oz - 6, 0.62, {
        yaw: 0.62,
        pitch: 0.3,
        dist: 8,
      });
      await sleep(Math.max(0, (spot.d + 1.4) * 1000));
      await shot(page, name);
    };
    await at(5);
    await closeOnRising('laverock_6_caidos_luz', 1.2);
    await closeOnRising('laverock_6b_caidos_luz_2', 0.9);
    // The lagoon from the island's north rim: still, glowing, the moon's road.
    await stand(-30, 229, 0.35, { yaw: 0.35, pitch: 0.42, dist: 13 });
    await sleep(2500);
    await shot(page, 'laverock_6c_laguna');
    // 7. From the Altar Ward over the island: streams rising across the temple.
    await stand(4, 206, -Math.PI / 2, { yaw: -Math.PI / 2 + 0.3, pitch: 0.34, dist: 24 });
    await at(14);
    await shot(page, 'laverock_7_corrientes');
    // 4. Close on him singing (the Sing loop, the column on him).
    await stand(-33.5, 211.5, -2.4, { yaw: -2.4 + 0.75, pitch: 0.12, dist: 6 });
    await at(22);
    await shot(page, 'laverock_4_canto_cerca');
    // 8. The calm after: the steady glow that stays while he sings.
    await stand(-49, 206.5, Math.PI / 2, { yaw: Math.PI / 2 - 0.35, pitch: 0.22, dist: 11 });
    await at(40);
    await shot(page, 'laverock_8_canto_sereno');
    // 9. A late arrival (no song-start event seen): the steady glow alone.
    await page.evaluate(() => {
      const fx = window.__game.renderer.riftDeathZoneVisuals?.templeFx?.cantor;
      if (fx) {
        fx.songAt = -1;
        fx.seenAt = -1;
      }
    });
    await stand(-48, 200, 0.9, { yaw: 0.9, pitch: 0.26, dist: 13 });
    await sleep(3500);
    await shot(page, 'laverock_9_llegada_tarde');
    const fx = await page.evaluate(() => {
      let out = null;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'drowned-temple-cantor-finale')
          out = { kids: o.children.length, vis: o.children[0]?.visible };
      });
      return out;
    });
    console.log('FX', JSON.stringify(fx));
    // The GPU-prep acceptance read (src/render/CLAUDE.md): programs linked on a
    // live frame after the curtain, across the whole tour and the finale.
    const prep = await page.evaluate(() => {
      const ev = window.__game.renderer.perfStats().gpuPrep?.events?.events ?? [];
      return ev.filter((e) => e.kind === 'live-program').map((e) => e.key);
    });
    console.log('LIVE_PROGRAMS', prep.length, JSON.stringify(prep.slice(0, 20)));
    const probe = await page.evaluate((id) => {
      const g = window.__game.world.entities.get(id);
      return { state: g?.guideState, cast: g?.castingAbility, x: g?.pos.x, z: g?.pos.z };
    }, info.guide);
    console.log('PROBE', JSON.stringify(probe));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
