// Evidence shots of the Great Saurian's totem rework in a live offline world
// (the rider throwing a Sunbone Sap Totem from the howdah, a totem arming with
// its short tether, three totems feeding the beast with a mending running down
// a tether, a totem breaking, and the heroic drum beating and silenced).
// Evidence tooling, not a repo test: it stages each beat with the
// `/dev wildheart trigger ...` commands and by standing the bodies on the ford.
//
//   node scripts/saurian_totem_shot.mjs [outDir] [shotId ...]
//
// Env: SHOT_URL (http://127.0.0.1:5184/), SHOT_PRESET (4; 1 is the low
// preset), SHOT_W / SHOT_H (1600x900), SHOT_GPU=0 to force SwiftShader,
// SHOT_PREFIX (default ""), SHOT_DIFFICULTY (normal; the drum shots 5 and 6
// start the drum with its own trigger on either difficulty, the H shots need
// heroic and start nothing), SHOT_DRY=1 to stage and log every beat without
// taking a picture.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5184/';
const OUT = process.argv[2] ?? path.join('tmp', 'saurian_totems');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const PREFIX = process.env.SHOT_PREFIX ?? '';
const DIFFICULTY = process.env.SHOT_DIFFICULTY === 'heroic' ? 'heroic' : 'normal';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each shot: `steps` played in order once the Saurian is pulled, rooted and
// held facing where it stood (a dev trigger, a wait in ms, `frame` to stand
// the player for the picture: `orbit` radians round the beast off its facing
// at `at` yards, or `behind` yards past the newest totem and `side` yards off
// that line; the camera aims at the beast, or between it and the newest
// totem with `aim: 'totem'`), then the camera orbit (`pitch`, `dist`).
const SHOTS = [
  {
    // The rider throws: the hex in his hands, the bundle over the ford.
    id: '1_lanzamiento',
    steps: [{ frame: { orbit: 1.35, at: 24 } }, { wait: 900 }, { trigger: 'totem' }],
    pitch: 0.12,
    dist: 8,
  },
  {
    // A totem arming: its ring filling, the tether reaching out, the beacon.
    id: '2_totem_armando',
    steps: [
      { trigger: 'totem' },
      { wait: 300 },
      { frame: { behind: 15, side: 9, aim: 'totem' } },
      { wait: 1900 },
    ],
    pitch: 0.24,
    dist: 11,
  },
  {
    // Three feeding the beast, a mending running down every tether.
    id: '3_tres_totems',
    steps: [
      { trigger: 'totem' },
      { trigger: 'totem' },
      { trigger: 'totem' },
      { frame: { orbit: 1.35, at: 26 } },
      { wait: 5200 },
      { trigger: 'sap' },
      { wait: 120 },
    ],
    pitch: 0.22,
    dist: 13,
  },
  {
    // A totem breaks: the tether snaps back white-hot, the splinters fly.
    id: '4_rotura',
    steps: [
      { trigger: 'totem' },
      { wait: 300 },
      { frame: { behind: 13, side: 10, aim: 'totem' } },
      { wait: 4800 },
      { breakTotem: true },
    ],
    pitch: 0.24,
    dist: 12,
  },
  {
    // Heroic: the drum on the howdah, a beat landing.
    id: '5_tambor',
    steps: [
      { trigger: 'drum' },
      { frame: { orbit: 2.45, at: 24 } },
      { wait: 1500 },
      { untilBeat: 0 },
    ],
    pitch: 0.12,
    dist: 8,
  },
  {
    // Heroic: a broken totem has knocked the drummer off his beat.
    id: '6_tambor_silenciado',
    steps: [
      { trigger: 'drum' },
      { frame: { orbit: 2.45, at: 24 } },
      { wait: 600 },
      { trigger: 'silence' },
      { wait: 1500 },
    ],
    pitch: 0.12,
    dist: 8,
  },
  // ---- heroic as it plays (run with SHOT_DIFFICULTY=heroic, ids H1 and H2):
  // no drum trigger, the drum starts with the pull on its own; the player
  // targets the Saurian, so the alert's drum rule shows; the camera stands
  // back and up so the howdah's roof, the drummer and the beat's ring fit.
  {
    // The drum beating from the pull: a beat landing.
    id: 'H1_tambor_heroico',
    steps: [{ frame: { orbit: 2.3, at: 34 }, target: true }, { wait: 1500 }, { untilBeat: 0 }],
    pitch: 0.04,
    dist: 12,
  },
  {
    // A broken totem knocks the drummer off his beat (the totem's own
    // backlash, never the silence trigger).
    id: 'H2_tambor_heroico_silenciado',
    steps: [
      { trigger: 'totem' },
      { wait: 500 },
      { frame: { orbit: 2.3, at: 34 }, target: true },
      { wait: 1200 },
      { breakTotem: true },
      { wait: 1600 },
    ],
    pitch: 0.04,
    dist: 12,
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
      charName: 'Fordwalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    const chat = (c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      `/dev wildheart enter ${DIFFICULTY}`,
      '/dev wildheart gates',
      ...Array.from({ length: 13 }, (_, i) => `/dev wildheart kill g${i + 1}`),
      '/dev wildheart tp ford',
    ]) {
      await chat(cmd);
      await sleep(cmd.includes(' kill ') ? 200 : 1300);
    }
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'wildheart-basin-fx') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(6000);
    // Stand the player for the picture and aim the camera.
    const frame = (f, shot) =>
      page.evaluate(
        ([f, pitch, dist]) => {
          const sim = window.__game.world;
          let s = null;
          for (const e of sim.entities.values())
            if (e.kind === 'mob' && !e.dead && e.templateId === 'great_saurian') s = e;
          if (!s) return 'no saurian';
          const me = sim.player;
          let x;
          let z;
          let lx = s.pos.x;
          let lz = s.pos.z;
          let t = null;
          for (const e of sim.entities.values())
            if (e.templateId === 'sunbone_sap_totem' && !e.dead && (!t || e.id > t.id)) t = e;
          if (f.behind !== undefined) {
            if (!t) return 'no totem';
            const dx = t.pos.x - s.pos.x;
            const dz = t.pos.z - s.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            x = t.pos.x + (dx / d) * f.behind + (dz / d) * (f.side ?? 0);
            z = t.pos.z + (dz / d) * f.behind - (dx / d) * (f.side ?? 0);
          } else {
            const a = s.facing + f.orbit;
            x = s.pos.x + Math.sin(a) * f.at;
            z = s.pos.z + Math.cos(a) * f.at;
          }
          if (f.aim === 'totem' && t) {
            lx = t.pos.x * 0.55 + s.pos.x * 0.45;
            lz = t.pos.z * 0.55 + s.pos.z * 0.45;
          }
          const p = sim.groundPos(x, z);
          me.pos.x = p.x;
          me.pos.y = p.y;
          me.pos.z = p.z;
          me.prevPos = { ...me.pos };
          const face = Math.atan2(lx - x, lz - z);
          me.facing = face;
          me.prevFacing = face;
          const input = window.__game.input;
          input.camYaw = face;
          input.camPitch = pitch;
          input.camDist = dist;
          return 'ok';
        },
        [f, shot.pitch, shot.dist],
      );
    // Where the beast, its howdah and the totems fall on the screen (-1..1):
    // the dry run's framing check.
    const onScreen = () =>
      page.evaluate(() => {
        const g = window.__game;
        const cam = g.renderer.camera;
        cam.updateMatrixWorld();
        const v = cam.position.clone();
        const at = (x, y, z) => {
          v.set(x, y, z).project(cam);
          return `${v.x.toFixed(2)},${v.y.toFixed(2)}${v.z > 1 ? '(behind)' : ''}`;
        };
        const out = [];
        for (const e of g.world.entities.values()) {
          if (e.dead) continue;
          if (e.templateId === 'great_saurian')
            out.push(
              `beast feet ${at(e.pos.x, e.pos.y, e.pos.z)} deck ${at(e.pos.x, e.pos.y + 10.5, e.pos.z)} roof ${at(e.pos.x, e.pos.y + 15, e.pos.z)}`,
            );
          if (e.templateId === 'sunbone_sap_totem')
            out.push(`totem ${at(e.pos.x, e.pos.y + 4, e.pos.z)}`);
        }
        return out.join(' | ');
      });
    const state = () =>
      page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.templateId !== 'great_saurian') continue;
          const st = e.wildheartFight;
          return {
            hp: Math.round((e.hp / e.maxHp) * 1000) / 10,
            auras: e.auras.map((a) => `${a.id}${a.stacks ? `x${a.stacks}` : ''}`).join(','),
            totems: st?.totems?.length ?? 0,
            drum: st?.drum ? JSON.stringify(st.drum) : null,
            cast: e.castingAbility,
          };
        }
        return null;
      });
    for (const shot of SHOTS) {
      if (ONLY.length && !ONLY.some((o) => shot.id === o || shot.id.startsWith(o))) continue;
      // Pull it with a pool that lasts, root it, hold its own clocks off the
      // picture.
      const pulled = await page.evaluate(() => {
        const sim = window.__game.world;
        const me = sim.player;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || e.templateId !== 'great_saurian') continue;
          e.maxHp = Math.max(e.maxHp, 1e6);
          e.hp = Math.floor(e.maxHp * 0.8);
          e.dungeonPatrol = undefined;
          e.moveSpeed = 0;
          sim.aggroMob(e, me, false);
          // Hold it facing where it stood, so the picture can stand anywhere.
          const face = e.facing;
          clearInterval(window.__saurianPin);
          window.__saurianPin = setInterval(() => {
            e.facing = face;
            e.prevFacing = face;
          }, 4);
          return true;
        }
        return false;
      });
      if (!pulled) {
        const seen = await page.evaluate(() => {
          const out = [];
          for (const e of window.__game.world.entities.values())
            if (e.kind === 'mob' && /saur|wildheart|totem|raptor/.test(e.templateId))
              out.push(`${e.templateId}${e.dead ? '(dead)' : ''}`);
          const p = window.__game.world.player.pos;
          return `${out.slice(0, 30).join(' ')} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`;
        });
        throw new Error(`no Great Saurian on the ford: ${seen}`);
      }
      await sleep(400);
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          const st = e.wildheartFight;
          if (st?.kind !== 'saurian') continue;
          st.tailTimer = 999;
          st.stompTimer = 999;
          st.totemTimer = 999;
        }
      });
      for (const step of shot.steps) {
        if (step.trigger) {
          await chat(`/dev wildheart trigger ${step.trigger}`);
          await sleep(60);
        }
        if (step.frame) {
          const r = await frame(step.frame, shot);
          if (r !== 'ok') console.log('FRAME', shot.id, r);
        }
        if (step.target)
          await page.evaluate(() => {
            const sim = window.__game.world;
            for (const e of sim.entities.values())
              if (e.kind === 'mob' && !e.dead && e.templateId === 'great_saurian')
                sim.player.targetId = e.id;
          });
        if (step.breakTotem)
          await page.evaluate(() => {
            const sim = window.__game.world;
            const me = sim.player;
            let t = null;
            for (const e of sim.entities.values())
              if (e.templateId === 'sunbone_sap_totem' && !e.dead && (!t || e.id > t.id)) t = e;
            if (t) sim.dealDamage(me, t, t.hp + 10, false, 'physical', 'Strike', 'hit');
          });
        if (step.untilBeat !== undefined) {
          // Wait for a beat to land, then hold `untilBeat` ms past it.
          await page.waitForFunction(
            () => {
              const sim = window.__game.world;
              for (const e of sim.entities.values()) {
                const st = e.wildheartFight;
                if (st?.kind === 'saurian' && st.drum) return st.drum.beat > 0.93;
              }
              return false;
            },
            { timeout: 15000, polling: 10 },
          );
          await sleep(step.untilBeat);
        }
        if (step.wait) await sleep(step.wait);
      }
      console.log('STATE', shot.id, JSON.stringify(await state()));
      console.log('FRAMING', shot.id, await onScreen());
      if (process.env.SHOT_DRY !== '1') {
        const file = path.join(OUT, `${PREFIX}${shot.id}.png`);
        await page.screenshot({ path: file });
        console.log('SHOT', file);
      }
      // Drop the fight before the next shot (an evade resets the ford).
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || !e.inCombat) continue;
          e.inCombat = false;
          e.aggroTargetId = null;
          e.aiState = 'evade';
          e.hp = e.maxHp;
        }
      });
      await sleep(2600);
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
