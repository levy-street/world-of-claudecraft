// Evidence shots of the trash engine's pieces and the Gravewyrm Sanctum's
// trash mechanics pass in a live OFFLINE world (src/sim/mob/trash_kit/CLAUDE.md
// "Engine pieces"; MECANICAS_TRASH.md section 8): Thaw the Held, the
// Counterweight Lash, heroic Boiling Meltwater, the Branding Iron and the
// meltwater pools, Topple Brazier (the G3 use and its prompt), the Rime Breath
// and its freeze, the Ice Slab wall, Fracture; and the engine demo kit's G6
// line-of-sight nova and G5 walker. Each scenario writes a burst of frames
// (`<id>_<ms>.png`); a strip per scenario is stitched with ffmpeg afterwards.
// Evidence tooling, not a repo test.
//
//   node scripts/trash_engine_shot.mjs <outSanctum> <outEngine> [scenario ...]
//
// Env: SHOT_URL (http://127.0.0.1:5248/), SHOT_PRESET (4), SHOT_W / SHOT_H
// (1600x900), SHOT_GPU=0 to force SwiftShader.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5248/';
const OUT_SANCTUM = process.argv[2] ?? path.join('tmp', 'trash_sanctum');
const OUT_ENGINE = process.argv[3] ?? path.join('tmp', 'trash_engine');
const ONLY = process.argv.slice(4);
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT_SANCTUM, { recursive: true });
fs.mkdirSync(OUT_ENGINE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page: the newest living mob of a template (or null). */
function pageNewest(templateId) {
  const sim = window.__game.world;
  let mob = null;
  for (const e of sim.entities.values())
    if (e.kind === 'mob' && !e.dead && e.templateId === templateId && (!mob || e.id > mob.id))
      mob = e;
  return mob ? mob.id : null;
}

/** In-page: move a mob to `yards` ahead of the player at `angle` off its
 *  facing, facing back at the player, held (no AI step) for the shot. */
function pagePlace([id, yards, angle, face]) {
  const sim = window.__game.world;
  const me = sim.player;
  const mob = sim.entities.get(id);
  if (!mob) return false;
  const a = me.facing + angle;
  const at = sim.groundPos(me.pos.x + Math.sin(a) * yards, me.pos.z + Math.cos(a) * yards);
  mob.pos.x = at.x;
  mob.pos.y = at.y;
  mob.pos.z = at.z;
  mob.prevPos = { ...mob.pos };
  mob.facing = face ?? Math.atan2(me.pos.x - at.x, me.pos.z - at.z);
  mob.prevFacing = mob.facing;
  mob.maxHp = Math.max(mob.maxHp, 1e5);
  mob.hp = mob.maxHp;
  return true;
}

/** In-page: a second player standing `yards` behind a mob (the tail's side). */
function pageBehind([mobId, yards]) {
  const sim = window.__game.world;
  const mob = sim.entities.get(mobId);
  if (!mob || typeof sim.addPlayer !== 'function') return null;
  const pid = sim.addPlayer('mage', 'Tailwatcher');
  const e = sim.entities.get(pid);
  if (!e) return null;
  const a = mob.facing + Math.PI;
  const at = sim.groundPos(mob.pos.x + Math.sin(a) * yards, mob.pos.z + Math.cos(a) * yards);
  e.pos = at;
  e.prevPos = { ...at };
  e.facing = mob.facing;
  e.maxHp = 1e6;
  e.hp = 1e6;
  return pid;
}

/** In-page: target an entity. */
function pageTarget(id) {
  window.__game.world.player.targetId = id;
  return true;
}

/** In-page: kill one entity through the sim (credited to the player). */
function pageKill(id) {
  const sim = window.__game.world;
  const e = sim.entities.get(id);
  if (!e || e.dead) return false;
  e.hp = Math.min(e.hp, e.maxHp);
  sim.dealDamage(sim.player, e, e.hp + 10, false, 'physical', 'Shot', 'hit', true);
  return true;
}

/** In-page: wait-friendly read of an entity's cast. */
function pageCast(id) {
  const e = window.__game.world.entities.get(id);
  return e ? { cast: e.castingAbility, rem: e.castRemaining, tot: e.castTotal } : null;
}

/** In-page: set the camera. */
function pageCamera([yawOff, pitch, dist]) {
  const p = window.__game.world.player;
  const input = window.__game.input;
  input.camYaw = p.facing + yawOff;
  input.camPitch = pitch;
  input.camDist = dist;
}

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
  const page = await browser.newPage();
  const chat = async (c, wait = 400) => {
    await page.evaluate((cmd) => {
      const w = window.__game.world;
      w.ctx?.chatTokens?.delete?.(w.player.id);
      w.chat(cmd);
    }, c);
    await sleep(wait);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shoot = async (dir, id, ms, t0) => {
    await sleep(Math.max(0, t0 + ms - Date.now()));
    const file = path.join(dir, `${id}_${String(ms).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  };
  const burst = async (dir, id, frames) => {
    const t0 = Date.now();
    for (const ms of frames) await shoot(dir, id, ms, t0);
  };
  const hud = (on) =>
    page.evaluate((show) => {
      let tag = document.getElementById('shot-hide-ui');
      if (!tag) {
        tag = document.createElement('style');
        tag.id = 'shot-hide-ui';
        document.head.appendChild(tag);
      }
      tag.textContent = show ? '' : '#ui, #nameplates { display: none !important; }';
    }, on);
  const spawn = async (dev) => {
    await chat(`/dev sanctum spawn ${dev}`, 500);
  };
  const fresh = async (area, difficulty = 'normal') => {
    await chat('/dev sanctum reset', 2500);
    if (difficulty === 'heroic') {
      await chat('/dev sanctum enter heroic', 6000);
    }
    await chat('/dev sanctum gates', 600);
    await chat(`/dev sanctum kill trash`, 600);
    await chat(`/dev sanctum tp ${area}`, 1500);
    // Step 12 yd east, clear of the corpses of the patrol that walks the
    // works road (they would crowd every frame).
    const at = await page.evaluate(() => {
      const p = window.__game.world.player.pos;
      return { x: p.x + 12, z: p.z };
    });
    await chat(`/dev tp ${at.x} ${at.z}`, 1200);
    await page.evaluate(() => {
      const w = window.__game.world;
      w.player.hp = w.player.maxHp;
      w.player.devNoAggro = false;
    });
  };

  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.startsWith('Failed to send error to Vite'))
      console.log('CONSOLE:', text.slice(0, 300));
  });
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
  await page.evaluateOnNewDocument(() => {
    window.__shotErrors = [];
    window.addEventListener('error', (e) =>
      window.__shotErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`),
    );
    window.addEventListener('unhandledrejection', (e) =>
      window.__shotErrors.push(`rejection: ${e.reason?.stack ?? e.reason}`),
    );
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);

  const SCENARIOS = {
    // ---- the Sanctum ----
    async thaw_the_held() {
      await fresh('works');
      await spawn('thawcaller');
      await spawn('boneguard');
      const thaw = await ev(pageNewest, 'broodsworn_thawcaller');
      const guard = await ev(pageNewest, 'sanctum_boneguard');
      await ev(pagePlace, [thaw, 9, 0.3]);
      await ev(pagePlace, [guard, 5, -0.4]);
      await ev(pageKill, guard);
      await ev(pageTarget, thaw);
      await chat('/dev trashkit cast reanimate', 200);
      await ev(pageCamera, [0.9, 0.38, 16]);
      await hud(true);
      await burst(OUT_SANCTUM, 'deshielo_retenidos', [300, 1200, 2200, 3200, 3700, 4600]);
    },
    async counterweight_lash() {
      await fresh('works');
      await spawn('scaleguard');
      const s = await ev(pageNewest, 'sanctum_drakonid');
      await ev(pagePlace, [s, 4, 0]);
      await sleep(300);
      console.log('BEHIND', await ev(pageBehind, [s, 4]));
      await ev(pageTarget, s);
      await chat('/dev trashkit cast tailLash', 100);
      await ev(pageCamera, [1.2, 1.05, 20]);
      await hud(false);
      await burst(OUT_SANCTUM, 'coletazo_contrapeso', [150, 500, 900, 1150, 1500]);
    },
    async branding_iron() {
      await fresh('works');
      await spawn('goadsmith');
      const g = await ev(pageNewest, 'broodsworn_goadsmith');
      await ev(pagePlace, [g, 8, 0]);
      await ev(pageTarget, g);
      await chat('/dev trashkit cast brand', 100);
      await ev(pageCamera, [0.8, 0.3, 12]);
      await hud(true);
      await burst(OUT_SANCTUM, 'hierro_marcar', [400, 1200, 2300, 3500, 5000]);
      await chat('/dev trashkit quench', 100);
      await ev(pageCamera, [0.4, 0.45, 10]);
      await burst(OUT_SANCTUM, 'hierro_marcar_apagado', [80, 400, 1200]);
    },
    async quench_pools() {
      await fresh('works');
      await chat('/dev trashkit quench', 600);
      await ev(pageCamera, [0.3, 1.0, 34]);
      await hud(false);
      await burst(OUT_SANCTUM, 'charcos_deshielo', [800]);
    },
    async topple_brazier() {
      await fresh('works');
      await spawn('brazier');
      await spawn('ogre');
      await spawn('goadsmith');
      const b = await ev(pageNewest, 'soul_brazier');
      const o = await ev(pageNewest, 'ogre_sledge_hauler');
      const g = await ev(pageNewest, 'broodsworn_goadsmith');
      await ev(pagePlace, [b, 2.5, 0]);
      await ev(pagePlace, [o, 5.5, 0.35]);
      await ev(pagePlace, [g, 5.5, -0.35]);
      await ev(pageTarget, b);
      await ev(pageCamera, [0.7, 0.45, 13]);
      await hud(true);
      await burst(OUT_SANCTUM, 'volcar_brasero_aviso', [600]);
      await page.evaluate(() => window.__game.world.interact());
      await burst(OUT_SANCTUM, 'volcar_brasero', [150, 600, 1050, 1400, 2400, 4000]);
    },
    async rime_breath() {
      await fresh('works');
      for (let i = 0; i < 4; i++) await spawn('whelp');
      await ev(pageCamera, [1.0, 0.5, 14]);
      await hud(true);
      for (let i = 0; i < 4; i++) await chat('/dev trashkit freeze', 150);
      await burst(OUT_SANCTUM, 'escarcha_capas', [300]);
      await chat('/dev trashkit freeze', 50);
      await burst(OUT_SANCTUM, 'escarcha_congelado', [100, 800, 1900, 2400]);
      const w = await ev(pageNewest, 'rime_whelp');
      await ev(pagePlace, [w, 3, 0]);
      await ev(pageTarget, w);
      await chat('/dev trashkit cast cone', 50);
      await burst(OUT_SANCTUM, 'aliento_escarcha', [150, 450, 650, 900]);
    },
    async ice_slab() {
      await fresh('works');
      await spawn('ogre');
      const o = await ev(pageNewest, 'ogre_sledge_hauler');
      await ev(pagePlace, [o, 14, 0]);
      await ev(pageTarget, o);
      await chat('/dev trashkit cast toss', 100);
      await ev(pageCamera, [1.3, 0.5, 22]);
      await hud(false);
      await burst(OUT_SANCTUM, 'bloque_que_se_queda', [500, 1500, 2050, 2600, 4500]);
      await ev(pageCamera, [0.2, 1.1, 30]);
      await burst(OUT_SANCTUM, 'bloque_que_se_queda_alto', [200]);
      await burst(OUT_SANCTUM, 'bloque_que_se_queda_rompe', [9700, 10200, 10700]);
    },
    async fracture() {
      await fresh('works');
      await spawn('splinter');
      const s = await ev(pageNewest, 'glacier_splinter');
      await ev(pagePlace, [s, 6, 0]);
      await ev(pageTarget, s);
      await ev(pageCamera, [0.8, 0.35, 15]);
      await hud(true);
      await burst(OUT_SANCTUM, 'partirse_antes', [200]);
      await chat('/dev trashkit split', 50);
      await burst(OUT_SANCTUM, 'partirse_en_dos', [100, 400, 900, 1800]);
    },
    async boiling_meltwater() {
      await fresh('works', 'heroic');
      await spawn('scaleguard');
      const s = await ev(pageNewest, 'sanctum_drakonid');
      await ev(pagePlace, [s, 5, 0]);
      await chat('/dev trashkit pool boiling', 100);
      await ev(pageCamera, [0.6, 0.55, 14]);
      await hud(false);
      await burst(OUT_SANCTUM, 'agua_hirviendo', [300, 1500, 3000]);
    },
    // ---- the engine ----
    async nova_los() {
      await fresh('works');
      await spawn('thawcaller');
      const c = await ev(pageNewest, 'broodsworn_thawcaller');
      await ev(pagePlace, [c, 12, 0]);
      await ev(pageTarget, c);
      await chat('/dev trashkit demo', 100);
      await chat('/dev trashkit wall', 100);
      await ev(pageTarget, c);
      await chat('/dev trashkit cast nova', 100);
      await ev(pageCamera, [1.4, 0.75, 26]);
      await hud(true);
      await burst(OUT_ENGINE, 'nova_vision', [300, 1200, 2200, 2700, 3100]);
    },
    async walker_orb() {
      await fresh('works');
      await spawn('thawcaller');
      await spawn('ogre');
      const c = await ev(pageNewest, 'broodsworn_thawcaller');
      const o = await ev(pageNewest, 'ogre_sledge_hauler');
      await ev(pagePlace, [c, 8, -0.6]);
      await ev(pagePlace, [o, 8, 0.6]);
      await ev(pageTarget, c);
      await chat('/dev trashkit demo', 100);
      await chat('/dev trashkit cast walker', 100);
      await ev(pageCamera, [0.0, 0.6, 18]);
      await hud(false);
      await burst(OUT_ENGINE, 'orbe_caminante', [600, 1700, 2300, 2900, 3600, 4400]);
    },
    async combat_wall() {
      await fresh('works');
      await chat('/dev trashkit wall', 100);
      await ev(pageCamera, [0.5, 0.3, 14]);
      await hud(false);
      await burst(OUT_ENGINE, 'pared_combate', [80, 400, 1500]);
      await ev(pageCamera, [0.2, 1.2, 22]);
      await burst(OUT_ENGINE, 'pared_combate_alto', [100]);
    },
  };

  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Icewalker',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    for (const cmd of ['/dev level 20', '/dev immortal', '/dev sanctum enter'])
      await chat(cmd, 1500);
    await sleep(12000);
    for (const [id, run] of Object.entries(SCENARIOS)) {
      if (ONLY.length && !ONLY.includes(id)) continue;
      console.log('SCENARIO', id);
      console.log(
        'PLAYER',
        JSON.stringify(
          await page.evaluate(() => {
            const p = window.__game.world.player;
            return {
              hp: p.hp,
              maxHp: p.maxHp,
              dead: p.dead,
              auras: p.auras.map((a) => a.id),
              sitting: p.sitting,
              mount: p.mountKey,
              cast: p.castingAbility,
              flags: Object.entries(p)
                .filter(([, v]) => v === true || (typeof v === 'string' && v && v.length < 24))
                .map(([k, v]) => `${k}=${v}`)
                .join(','),
              anim: window.__game.renderer?.debugAnimOf?.(p.id),
            };
          }),
        ),
      );
      try {
        await run();
      } catch (e) {
        console.log('FAILED', id, e.message);
      }
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
    const errs = await page.evaluate(() => [...new Set(window.__shotErrors ?? [])].slice(0, 12));
    for (const e of errs) console.log('PAGE ERROR:', e.slice(0, 400));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
