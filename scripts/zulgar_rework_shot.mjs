// Evidence shots of Zulgar's hunt rework in a live offline world (the sun
// glyphs dark, lit and being lit; the avatar Sunstruck; a player Pinned by the
// Hunting Spear; the Idol's Breath warning half the terrace and then pouring
// over it). Evidence tooling, not a repo test: it stages each beat with the
// `/dev wildheart trigger` commands (and, where a beat needs a mixed board,
// by standing the player or Zulgar where the sim's own rules then act).
//
//   node scripts/zulgar_rework_shot.mjs [outDir] [shotId ...]
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
const OUT = process.argv[2] ?? path.join('tmp', 'zulgar_rework');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? '';
const DIFFICULTY = process.env.SHOT_DIFFICULTY === 'heroic' ? 'heroic' : 'normal';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each shot: `player` where the player stands (instance-local), `zulgar` where
// he is held, `face` the player's facing (0 = north, at the idol), the camera
// orbit (`yaw` off the facing, `pitch`, `dist`), `cmds` the dev triggers, then
// `stage` an in-page step, `wait` ms before the frame, `hud` to keep the HUD.
const SHOTS = [
  {
    id: '1_glifos_apagados',
    player: [0, 203],
    zulgar: [0, 222],
    pitch: 0.5,
    dist: 30,
    hud: true,
    wait: 1500,
  },
  {
    // A hunt: three glyphs lit, two dark, and the player lighting the sixth.
    id: '2_glifo_encendiendose',
    player: [-7, 205.9],
    zulgar: [10, 236],
    pitch: 0.55,
    dist: 30,
    hud: true,
    cmds: ['/dev wildheart trigger prey'],
    stage: 'mixedBoard',
    wait: 520,
  },
  {
    // He crosses a lit glyph: the spirit jaguar burns gold, the ring drains.
    id: '3_avatar_insolado',
    // Out of his reach, so the picture is the window and not a maul.
    player: [6, 198],
    zulgar: [-7, 205.9],
    yaw: -0.35,
    pitch: 0.4,
    dist: 24,
    hud: true,
    cmds: ['/dev wildheart trigger prey', '/dev wildheart trigger glyphs'],
    stage: 'holdZulgar',
    wait: 900,
  },
  {
    id: '4_lanza_clavado',
    player: [9, 210],
    zulgar: [0, 224],
    face: -0.55,
    yaw: 0.5,
    pitch: 0.4,
    dist: 15,
    hud: true,
    cmds: ['/dev wildheart trigger pin'],
    stage: 'holdZulgar',
    wait: 1300,
  },
  {
    id: '5_idolo_aviso',
    player: [0, 200],
    zulgar: [0, 226],
    pitch: 0.5,
    dist: 34,
    hud: true,
    cmds: ['/dev wildheart trigger breath'],
    stage: 'intoMarkedHalf',
    wait: 2600,
  },
  {
    id: '6_idolo_aliento',
    player: [0, 200],
    zulgar: [0, 226],
    pitch: 0.5,
    dist: 34,
    hud: true,
    cmds: ['/dev wildheart trigger breath'],
    stage: 'holdZulgar',
    // The warning is 5 s; the pour's front has crossed by 0.5 s after it.
    wait: 5450,
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
      charName: 'Basinwalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of ['/dev level 20', '/dev god']) {
      await chat(cmd);
      await sleep(1300);
    }
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      // A fresh run per shot: every beat starts from a clean pull.
      await chat(`/dev wildheart ${shot === SHOTS[0] ? 'enter' : 'reset'} ${DIFFICULTY}`);
      await sleep(1500);
      await page.waitForFunction(
        () => {
          let found = false;
          window.__game.renderer.scene.traverse((o) => {
            if (o.name === 'wildheartBasinField') found = true;
          });
          return found;
        },
        { timeout: 180000, polling: 1000 },
      );
      await sleep(shot === SHOTS[0] || ONLY.length ? 5000 : 2500);
      for (const cmd of ['/dev wildheart gates', '/dev wildheart kill trash']) {
        await chat(cmd);
        await sleep(700);
      }
      await chat('/dev wildheart tp landing');
      await sleep(700);
      // The landing arrival is instance-local (0, -217): recover the slot origin.
      const origin = await page.evaluate(() => {
        const p = window.__game.world.player;
        return { x: p.pos.x, z: p.pos.z + 217 };
      });
      await page.evaluate((hide) => {
        let tag = document.getElementById('shot-hide-ui');
        if (!tag) {
          tag = document.createElement('style');
          tag.id = 'shot-hide-ui';
          document.head.appendChild(tag);
        }
        tag.textContent = hide ? '#ui, #nameplates { display: none !important; }' : '';
      }, !shot.hud);
      await chat(`/dev tp ${origin.x + shot.player[0]} ${origin.z + shot.player[1]}`);
      await sleep(900);
      // Pull him where the shot wants him, with a pool that lasts.
      await page.evaluate(
        ([lx, lz, ox, oz]) => {
          const sim = window.__game.world;
          const me = sim.player;
          for (const e of sim.entities.values()) {
            if (e.kind !== 'mob' || e.dead || e.templateId !== 'wildheart_high_priest') continue;
            const at = sim.groundPos(ox + lx, oz + lz);
            e.pos.x = at.x;
            e.pos.y = at.y;
            e.pos.z = at.z;
            e.prevPos = { ...e.pos };
            e.maxHp = Math.max(e.maxHp, 1e6);
            e.hp = e.maxHp;
            me.hp = me.maxHp;
            sim.aggroMob(e, me, false);
          }
        },
        [...shot.zulgar, origin.x, origin.z],
      );
      await sleep(1200);
      const setCamera = () =>
        page.evaluate((s) => {
          const p = window.__game.world.player;
          p.facing = s.face ?? 0;
          p.prevFacing = s.face ?? 0;
          const input = window.__game.input;
          input.camYaw = (s.face ?? 0) + (s.yaw ?? 0);
          input.camPitch = s.pitch;
          input.camDist = s.dist;
        }, shot);
      await setCamera();
      for (const c of shot.cmds ?? []) {
        await chat(c);
        await sleep(120);
      }
      // The in-page stage: it also holds Zulgar where the shot wants him, on
      // every animation frame until the picture is taken.
      await page.evaluate(
        ([stage, lx, lz, ox, oz, px, pz]) => {
          const sim = window.__game.world;
          const me = sim.player;
          let z = null;
          for (const e of sim.entities.values())
            if (e.kind === 'mob' && !e.dead && e.templateId === 'wildheart_high_priest') z = e;
          if (!z) return;
          const st = z.wildheartFight;
          const put = (e, x, zz) => {
            const at = sim.groundPos(ox + x, oz + zz);
            e.pos.x = at.x;
            e.pos.y = at.y;
            e.pos.z = at.z;
            e.prevPos = { ...e.pos };
          };
          if (stage === 'mixedBoard' && st) {
            // Back on the dark glyph (a Jaguar Roar may have thrown the player
            // off it while the pull settled).
            put(me, px, pz);
            // Three lit, the player's own left dark for the sim to light: the
            // glyph objects are written the way the sim's own lightGlyph does.
            for (const i of [0, 1, 5]) {
              st.glyphs[i].lit = true;
              const obj = sim.entities.get(st.glyphs[i].objectId);
              if (obj) obj.templateId = 'wildheart_sun_glyph_lit';
            }
          }
          if (stage === 'intoMarkedHalf' && st?.idol?.breath) {
            // Stand the player in the half the idol marked.
            put(me, st.idol.breath.side * 12, 208);
          }
          window.__shotHold = () => put(z, lx, lz);
          const loop = () => {
            if (!window.__shotHold) return;
            window.__shotHold();
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        },
        [shot.stage ?? 'holdZulgar', ...shot.zulgar, origin.x, origin.z, ...shot.player],
      );
      await setCamera();
      await sleep(shot.wait ?? 1500);
      const info = await page.evaluate(() => {
        const sim = window.__game.world;
        let z = null;
        for (const e of sim.entities.values())
          if (e.kind === 'mob' && !e.dead && e.templateId === 'wildheart_high_priest') z = e;
        return {
          phase: z?.wildheartFight?.phase,
          zulgar: z?.auras.map((a) => a.id).join(','),
          me: sim.player.auras.map((a) => a.id).join(','),
          lit: z?.wildheartFight?.glyphs.filter((g) => g.lit).length,
        };
      });
      console.log('STATE', shot.id, JSON.stringify(info));
      const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
      await page.evaluate(() => {
        window.__shotHold = null;
      });
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
