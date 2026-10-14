// Evidence shots of Choirmother Selthe's Score in a live offline world (the
// melody ringing on the moon tiles, the answer under way, a tile stepped out
// of turn, her broken voice, Discord, and the heroic answer with the tiles
// dark). Evidence tooling, not a repo test: it stages each beat with the
// `/dev temple trigger score...` commands and, for the steps, by standing the
// player on a tile so the sim's own rule counts the step.
//
//   node scripts/selthe_score_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5184/), SHOT_PRESET (4; 1 is the low
// preset), SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader,
// SHOT_PREFIX (default ""), SHOT_DIFFICULTY (normal).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5184/';
const OUT = process.argv[2] ?? path.join('tmp', 'selthe_score');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? '';
const DIFFICULTY = process.env.SHOT_DIFFICULTY === 'heroic' ? 'heroic' : 'normal';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each shot: `player` where the player stands to watch (instance-local; her
// pool is at (0, 10) and the tiles arc round its south side), the camera orbit
// (`pitch`, `dist`; it looks north at her), `trigger` the dev trigger that
// opens the beat, `until` the in-page moment to wait for, `step` a tile to
// stand the player on once the answer is open ('first': the tile the answer
// wants; 'wrong': a tile outside the melody), `after` a second dev trigger
// fired at that moment (the Score answered, or run out), `wait` ms from that
// moment to the frame.
const SHOTS = [
  {
    // The second note ringing: the first tile keeps its place, the rest dark.
    id: '1_melodia',
    player: [0, -9],
    pitch: 0.95,
    dist: 28,
    trigger: 'score',
    until: 'secondNote',
    wait: 380,
  },
  {
    // The first tile sounded under the player, the second called out.
    id: '2_respuesta',
    player: [0, -9],
    pitch: 0.75,
    dist: 26,
    trigger: 'score2',
    until: 'answer',
    step: 'first',
    wait: 900,
  },
  {
    id: '3_baldosa_equivocada',
    player: [0, -9],
    pitch: 0.7,
    dist: 22,
    trigger: 'score',
    until: 'answer',
    step: 'wrong',
    wait: 260,
  },
  {
    id: '4_voz_rota',
    player: [0, -6],
    pitch: 0.7,
    dist: 26,
    trigger: 'score',
    until: 'answer',
    after: 'scorewin',
    wait: 230,
  },
  {
    id: '5_discordia',
    player: [0, -9],
    pitch: 0.95,
    dist: 28,
    trigger: 'score',
    until: 'answer',
    after: 'scorefail',
    wait: 520,
  },
];

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
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Vite server'))
        console.log('CONSOLE:', m.text().slice(0, 300));
    });
    // Other work in the same tree edits files while the shots run: a dead HMR
    // socket keeps the dev server's full reloads off the page.
    await page.evaluateOnNewDocument(() => {
      const Native = window.WebSocket;
      window.WebSocket = (url, protocols) => {
        if (String(protocols ?? '').includes('vite')) {
          return {
            readyState: 0,
            addEventListener() {},
            removeEventListener() {},
            send() {},
            close() {},
          };
        }
        return new Native(url, protocols);
      };
      Object.assign(window.WebSocket, Native);
      window.WebSocket.prototype = Native.prototype;
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
      charName: 'Tidewader',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      `/dev temple enter ${DIFFICULTY}`,
      '/dev temple gates',
      '/dev temple kill trash',
    ]) {
      await chat(cmd);
      await sleep(1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'drownedTempleField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    await chat('/dev temple tp landing');
    await sleep(900);
    // The landing arrival is instance-local (0, -230): recover the slot origin.
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 230 };
    });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      await chat(`/dev tp ${origin.x + shot.player[0]} ${origin.z + shot.player[1]}`);
      await sleep(1500);
      // Pull her with a pool that lasts, and hold her own kit off the picture.
      await page.evaluate(() => {
        const sim = window.__game.world;
        const me = sim.player;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || e.templateId !== 'choirmother_selthe') continue;
          e.maxHp = Math.max(e.maxHp, 1e6);
          e.hp = e.maxHp;
          me.hp = me.maxHp;
          sim.aggroMob(e, me, false);
        }
      });
      await sleep(1200);
      const setCamera = () =>
        page.evaluate((s) => {
          const sim = window.__game.world;
          const p = sim.player;
          let boss = null;
          for (const e of sim.entities.values())
            if (e.kind === 'mob' && !e.dead && e.templateId === 'choirmother_selthe') boss = e;
          // Look at her from wherever the player stands.
          const face = boss ? Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z) : 0;
          p.facing = face;
          p.prevFacing = face;
          const input = window.__game.input;
          input.camYaw = face;
          input.camPitch = s.pitch;
          input.camDist = s.dist;
        }, shot);
      await setCamera();
      await chat(`/dev temple trigger ${shot.trigger}`);
      // Wait for the beat inside the page, on the sim's own state.
      await page.waitForFunction(
        (until) => {
          const sim = window.__game.world;
          for (const e of sim.entities.values()) {
            const st = e.templeFight;
            if (st?.kind !== 'selthe' || !st.score) continue;
            if (until === 'secondNote') return st.score.phase === 'melody' && st.score.rung >= 2;
            return st.score.phase === 'answer';
          }
          return false;
        },
        { timeout: 30000, polling: 50 },
        shot.until,
      );
      if (shot.step) {
        // Stand the player on a tile: the sim counts the step on its next tick.
        await page.evaluate(
          ([which, ox, oz]) => {
            const sim = window.__game.world;
            for (const e of sim.entities.values()) {
              const st = e.templeFight;
              if (st?.kind !== 'selthe' || !st.score) continue;
              let tile = st.score.order[0];
              if (which === 'wrong')
                for (let i = 0; i < st.tiles.length; i++) if (!st.score.order.includes(i)) tile = i;
              const at = sim.groundPos(ox + st.tiles[tile].x, oz + st.tiles[tile].z);
              const me = sim.player;
              me.pos.x = at.x;
              me.pos.y = at.y;
              me.pos.z = at.z;
              me.prevPos = { ...me.pos };
            }
          },
          [shot.step, origin.x, origin.z],
        );
        await sleep(120);
        await setCamera();
      }
      if (shot.after) await chat(`/dev temple trigger ${shot.after}`);
      await sleep(shot.wait ?? 500);
      const info = await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          const st = e.templeFight;
          if (st?.kind !== 'selthe') continue;
          return {
            cast: e.castingAbility,
            auras: e.auras.map((a) => a.id).join(','),
            phase: st.score?.phase,
            order: st.score?.order,
            progress: st.score?.progress,
            tiles: st.tiles.map((t) => sim.entities.get(t.objectId)?.templateId.slice(17)),
          };
        }
        return null;
      });
      console.log('STATE', shot.id, JSON.stringify(info));
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      // Drop the fight before the next shot (an evade resets the whole Score).
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || !e.inCombat) continue;
          e.inCombat = false;
          e.aggroTargetId = null;
          e.aiState = 'evade';
        }
      });
      await sleep(1500);
    }
    const gpuPrep = await page.evaluate(() => {
      const s = window.__game.renderer.perfStats?.().gpuPrep;
      const raw = s?.events ?? s?.ring ?? [];
      const events = Array.isArray(raw) ? raw : [];
      return {
        livePrograms: events.filter((e) => e.kind === 'live-program').length,
        gateTimeouts: events.filter((e) => e.kind === 'gate-timeout').length,
      };
    });
    console.log('GPUPREP', JSON.stringify(gpuPrep));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
