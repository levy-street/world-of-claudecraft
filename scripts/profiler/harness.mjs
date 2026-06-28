// Profiler core: drives the real game (headed, real GPU, vsync off) and turns a
// scenario into rich, structured perf metrics. Shared by the CLI today and an
// MCP server later. Reuses the world hooks on window.__game (sim/world/renderer/
// input/perf) and, online, spawns WS bot crowds (X-Forwarded-For per bot to clear
// the 20/min/IP register limit). Pure metric math lives in ./metrics.mjs.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from '../browser_path.mjs';
import { attributeFreezes, frameStats, normalizeReport } from './metrics.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLASSES = [
  'warrior',
  'paladin',
  'priest',
  'mage',
  'hunter',
  'rogue',
  'warlock',
  'druid',
  'shaman',
];

// Injected once per session. A rAF loop records per-frame {dt, programs, views}
// plus longtasks (so the profiler gets real 1%/0.1% lows + freeze attribution),
// gathers a live scene inventory (entities by kind, loaded models, shader
// variants, textures, geometries), and paints an on-screen overlay so the headed
// window (and every screenshot) shows the live readout.
const COLLECTOR = `
window.__prof = {
  on: false, frames: [], samples: [], _last: 0, _lt: 0, _obs: null, el: null, label: '', _n: 0,
  _ensureObs() {
    if (this._obs) return;
    try {
      this._obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) this._lt = Math.max(this._lt, e.duration); });
      this._obs.observe({ entryTypes: ['longtask'] });
    } catch {}
  },
  _ensureOverlay() {
    if (this.el || typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.id = '__prof_overlay';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:11px/1.4 ui-monospace,monospace;color:#9effa0;background:rgba(0,0,0,.74);padding:7px 9px;border:1px solid #2a6e3a;border-radius:5px;white-space:pre;pointer-events:none;text-shadow:0 1px 1px #000;max-width:46ch';
    document.body.appendChild(el);
    this.el = el;
  },
  scene() {
    const g = window.__game; if (!g) return {};
    const ents = g.world && g.world.entities;
    const byKind = {};
    if (ents) for (const e of ents.values()) { const k = e.kind || e.k || 'other'; byKind[k] = (byKind[k] || 0) + 1; }
    const views = g.renderer && g.renderer.views;
    const models = {};
    if (views) for (const v of views.values()) { const k = v.visualKey || 'unknown'; models[k] = (models[k] || 0) + 1; }
    const info = (g.renderer && g.renderer.webgl && g.renderer.webgl.info) || {};
    const progs = info.programs || [];
    const variants = new Set();
    for (const pr of progs) if (pr && pr.cacheKey) variants.add(pr.cacheKey);
    const render = info.render || {};
    const mem = info.memory || {};
    return {
      entityCount: ents ? ents.size : 0,
      entitiesByKind: byKind,
      viewCount: views ? views.size : 0,
      modelCount: Object.keys(models).length,
      models,
      programs: progs.length,
      shaderVariants: variants.size,
      textures: mem.textures || 0,
      geometries: mem.geometries || 0,
      render: { calls: render.calls || 0, triangles: render.triangles || 0, points: render.points || 0, lines: render.lines || 0 },
    };
  },
  _rolling() {
    const r = this.frames.slice(-150);
    if (!r.length) return { fps: 0, low: 0, max: 0 };
    const sum = r.reduce((a, b) => a + b, 0);
    const sorted = r.slice().sort((a, b) => a - b);
    const k = Math.max(1, Math.ceil(r.length * 0.01));
    const worst = sorted.slice(sorted.length - k);
    const lowAvg = worst.reduce((a, b) => a + b, 0) / k;
    return { fps: 1000 / (sum / r.length), low: lowAvg > 0 ? 1000 / lowAvg : 0, max: sorted[sorted.length - 1] };
  },
  _paint() {
    if (!this.el) return;
    const sc = this._scene || {};
    const ro = this._rolling();
    const kinds = Object.entries(sc.entitiesByKind || {}).map(([k, n]) => k + ':' + n).join(' ');
    const lastHitch = this.samples.length ? this.samples[this.samples.length - 1] : null;
    this.el.textContent =
      'PROFILER  ' + (this.label || '') + '\\n' +
      'fps ' + ro.fps.toFixed(0) + '  1%low ' + ro.low.toFixed(0) + '  worst ' + ro.max.toFixed(0) + 'ms\\n' +
      'entities ' + (sc.entityCount || 0) + '  views ' + (sc.viewCount || 0) + '  ' + kinds + '\\n' +
      'models ' + (sc.modelCount || 0) + '  shaders ' + (sc.programs || 0) + '/' + (sc.shaderVariants || 0) + 'var  tex ' + (sc.textures || 0) + '  geo ' + (sc.geometries || 0) + '\\n' +
      'draws ' + (sc.render ? sc.render.calls : 0) + '  tris ' + (sc.render ? (sc.render.triangles / 1e6).toFixed(2) : 0) + 'M';
  },
  _progKeys() {
    const g = window.__game;
    const info = g && g.renderer && g.renderer.webgl && g.renderer.webgl.info;
    const out = [];
    if (info && info.programs) for (const pr of info.programs) if (pr && pr.cacheKey) out.push(pr.cacheKey);
    return out;
  },
  start() {
    this._ensureObs(); this._ensureOverlay();
    this.frames = []; this.samples = []; this._lt = 0; this.on = true; this._n = 0;
    this._keys0 = new Set(this._progKeys()); // shader programs present at sample start
    this._last = performance.now();
    const loop = () => {
      if (!this.on) return;
      const now = performance.now();
      const dt = now - this._last; this._last = now;
      const g = window.__game;
      const info = g && g.renderer && g.renderer.webgl && g.renderer.webgl.info;
      const programs = info && info.programs ? info.programs.length : 0;
      const views = g && g.renderer && g.renderer.views ? g.renderer.views.size : 0;
      const mem = info && info.memory ? info.memory : null;
      this.frames.push(dt);
      this.samples.push({ dt, programs, createdViews: views, textures: mem ? mem.textures : 0, geometries: mem ? mem.geometries : 0, longTaskMs: this._lt });
      this._lt = 0;
      // scene inventory + overlay are heavier, so refresh ~5x/sec, not per frame
      if ((this._n++ % 12) === 0) { this._scene = this.scene(); this._paint(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  stop() {
    this.on = false; this._scene = this.scene(); this._paint();
    const k0 = this._keys0 || new Set();
    const newPrograms = this._progKeys().filter((k) => !k0.has(k)); // shaders that linked during the window
    return { frames: this.frames.slice(), samples: this.samples.slice(), scene: this._scene, newPrograms };
  },
};
`;

async function api(server, path, body, token, xff) {
  const res = await fetch(server + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

class Bot {
  constructor(server, wsBase, uniq, i) {
    this.server = server;
    this.wsBase = wsBase;
    this.i = i;
    this.cls = CLASSES[i % CLASSES.length];
    this.level = 1 + ((i * 7) % 40);
    const li = String(i)
      .split('')
      .map((d) => 'abcdefghij'[+d])
      .join('');
    this.name = `Pb${uniq}${li}`;
    this.uniq = uniq;
  }
  async join() {
    const xff = `172.16.${Math.floor(this.i / 254)}.${(this.i % 254) + 1}`;
    const reg = await api(
      this.server,
      '/api/register',
      { username: `prof_${this.uniq}_${this.i}`, password: 'hunter22' },
      undefined,
      xff,
    );
    this.token = reg.body.token;
    if (!this.token)
      throw new Error(`register ${this.i}: ${JSON.stringify(reg.body).slice(0, 80)}`);
    const char = await api(
      this.server,
      '/api/characters',
      { name: this.name, class: this.cls },
      this.token,
      xff,
    );
    this.charId = char.body.id;
    if (!this.charId)
      throw new Error(`charcreate ${this.i}: ${JSON.stringify(char.body).slice(0, 80)}`);
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.wsBase}/ws`);
      const to = setTimeout(() => reject(new Error('join timeout')), 12000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })),
      );
      this.ws.on('message', (data) => {
        const m = JSON.parse(String(data));
        if (m.t === 'hello') {
          clearTimeout(to);
          resolve();
        }
      });
      this.ws.on('error', reject);
    });
  }
  cmd(p) {
    this.ws?.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  place(x, z, radius) {
    const a = this.i * 2.39996;
    const r = radius * Math.sqrt((this.i % 30) / 30);
    this.cmd({ cmd: 'dev_level', level: this.level });
    this.cmd({ cmd: 'dev_teleport', x: x + Math.cos(a) * r, z: z + Math.sin(a) * r });
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

export class Profiler {
  constructor(opts = {}) {
    this.gameUrl = opts.gameUrl ?? process.env.GAME_URL ?? 'http://localhost:5173';
    this.server = opts.server ?? process.env.SERVER_URL ?? 'http://localhost:8787';
    this.wsBase = this.server.replace(/^http/, 'ws');
    this.width = opts.width ?? 1920;
    this.height = opts.height ?? 1080;
    this.dpr = opts.dpr ?? 1;
    this.targetFps = opts.targetFps ?? 60;
    this.browserPath = opts.browserPath ?? process.env.BROWSER_PATH ?? BROWSER_PATH;
    this.shotDir = opts.shotDir ?? process.env.PROF_SHOT ?? null; // screenshot each sample (overlay visible)
    this.uniq = (process.env.PROF_UNIQ ?? String(Math.floor(performance.now())) + 'x')
      .replace(/[^a-z0-9]/gi, '')
      .slice(-6);
    this.bots = [];
    this.mode = 'offline';
  }

  log(...a) {
    if (!this.quiet) console.log(...a);
  }

  async launch() {
    this.browser = await puppeteer.launch({
      executablePath: this.browserPath,
      headless: false,
      protocolTimeout: 180000,
      args: [
        `--window-size=${this.width},${this.height + 120}`,
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({
      width: this.width,
      height: this.height,
      deviceScaleFactor: this.dpr,
    });
    this.page.on('pageerror', (e) => this.log('  [pageerror]', String(e).slice(0, 140)));
    return this;
  }

  gfxQs(tier) {
    return tier ? `&gfx=${tier}` : '';
  }

  async enter({ mode = 'offline', cls = 'warrior', tier } = {}) {
    this.mode = mode;
    const page = this.page;
    if (mode === 'offline') {
      await page.goto(`${this.gameUrl}/?perf${this.gfxQs(tier)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForSelector('#char-name', { timeout: 60000 });
      await page.$eval('#char-name', (el) => {
        el.value = 'Probe';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.$eval(`#offline-select .mini-class[data-class="${cls}"]`, (el) => el.click());
      await page.$eval('#btn-start-offline', (el) => el.click());
    } else {
      const u = `prof_cam_${this.uniq}`;
      await api(
        this.server,
        '/api/register',
        { username: u, password: 'hunter22' },
        undefined,
        '172.31.0.1',
      );
      await page.goto(`${this.gameUrl}/?perf${this.gfxQs(tier)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#btn-online') &&
          document.querySelector('#login-user') &&
          document.querySelector('#btn-login'),
        { timeout: 25000, polling: 200 },
      );
      await page.evaluate((u) => {
        document.querySelector('#btn-online').click();
        document.querySelector('#login-user').value = u;
        document.querySelector('#login-pass').value = 'hunter22';
        document.querySelector('#btn-login').click();
      }, u);
      await page.waitForFunction(
        () => ['charselect-panel', 'realm-panel'].includes(document.body.dataset.startPanel),
        { timeout: 20000, polling: 200 },
      );
      if (await page.evaluate(() => document.body.dataset.startPanel === 'realm-panel')) {
        await page.evaluate(() =>
          document.querySelector('#realm-panel .realm-row, #realm-panel button')?.click(),
        );
        await page.waitForFunction(() => document.body.dataset.startPanel === 'charselect-panel', {
          timeout: 12000,
          polling: 200,
        });
      }
      await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      await page.waitForFunction(() => document.body.dataset.startPanel === 'charcreate-panel', {
        timeout: 12000,
        polling: 200,
      });
      const nm = `Pcam${this.uniq}`;
      await page.evaluate(
        (nm, cls) => {
          const n = document.querySelector('#new-char-name');
          n.value = nm;
          n.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector(`#charcreate-panel .mini-class[data-class="${cls}"]`).click();
          document.querySelector('#btn-create-char').click();
        },
        nm,
        cls,
      );
      await page.waitForFunction(() => document.querySelector('.char-row .enter-world-btn'), {
        timeout: 15000,
        polling: 200,
      });
      await page.evaluate((nm) => {
        const row = [...document.querySelectorAll('.char-row')].find(
          (r) => r.querySelector('.char-name')?.textContent === nm,
        );
        (
          row?.querySelector('.enter-world-btn') ?? document.querySelector('.enter-world-btn')
        )?.click();
      }, nm);
    }
    await page.waitForFunction(() => window.__game?.world?.player && window.__game?.perf?.report, {
      timeout: 30000,
      polling: 300,
    });
    await sleep(1500);
    await page.evaluate(COLLECTOR);
    this.center = await page.evaluate(() => ({
      x: window.__game.world.player.pos.x,
      z: window.__game.world.player.pos.z,
    }));
    await this._startGodMode();
    return this;
  }

  // Keep the profiled player immortal so a scenario that fights mobs (combat, play)
  // runs uninterrupted instead of dying, releasing spirit, and teleporting to a
  // graveyard mid-measurement. Assigning hp does NOT work (the sim re-derives/clamps
  // it every tick, and a single multi-mob tick can burst past maxHp before any
  // top-up, which just makes a die/revive FLICKER). Instead redefine `hp` as a getter
  // that always reads full (maxHp) with a no-op setter: the sim's `hp -= damage`
  // becomes a no-op and the `hp <= 0` death check can never trip. Applied at enter,
  // before any combat, so the player simply never dies. Re-asserted at 1 Hz in case
  // the player entity is swapped (e.g. zone change). Damage DEALT is untouched, so
  // the combat/cast/VFX load we profile is unchanged.
  async _startGodMode() {
    await this.page.evaluate(() => {
      if (window.__godTimer) return;
      const apply = () => {
        try {
          const w = window.__game && (window.__game.world ?? window.__game.sim);
          const p = w && w.player;
          if (!p) return;
          const d = Object.getOwnPropertyDescriptor(p, 'hp');
          if (!d || !d.get) {
            Object.defineProperty(p, 'hp', {
              configurable: true,
              enumerable: true,
              get() {
                return this.maxHp || 1;
              },
              set() {
                /* immortal: ignore damage writes */
              },
            });
          }
          if (p.dead) p.dead = false;
        } catch {
          /* world not ready / sealed entity */
        }
      };
      apply();
      window.__godTimer = setInterval(apply, 1000);
    });
  }

  async teleport(x, z, facing = 0) {
    await this.page.evaluate(
      (x, z, f) => {
        const p = window.__game.world.player ?? window.__game.sim.player;
        p.pos.x = x;
        p.pos.z = z;
        p.facing = f;
        window.__game.input.camYaw = f;
      },
      x,
      z,
      facing,
    );
    await sleep(400);
  }

  async setMove(dir) {
    await this.page.evaluate((d) => window.__game.input.setTouchMove(d), {
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
      ...dir,
    });
  }
  async stopMove() {
    await this.page.evaluate(() => window.__game.input.clearTouchMove());
  }
  async look(vec, ms = 1500) {
    await this.page.evaluate((v) => {
      window.__game.input.setTouchLook(true);
      window.__game.input.setTouchLookVector(v);
    }, vec);
    await sleep(ms);
    await this.page.evaluate(() => {
      window.__game.input.setTouchLookVector({ x: 0, y: 0 });
      window.__game.input.setTouchLook(false);
    });
  }

  async tour(waypoints, { dwellMs = 0 } = {}) {
    for (const wp of waypoints) {
      await this.teleport(wp.x, wp.z, wp.facing ?? 0);
      if (dwellMs) await sleep(dwellMs);
    }
  }

  async spawnCrowd(n, { radius = 24 } = {}) {
    if (this.mode !== 'online') throw new Error('spawnCrowd needs online mode');
    const c = this.center;
    const batch = [];
    for (let i = this.bots.length; i < n; i++)
      batch.push(new Bot(this.server, this.wsBase, this.uniq, i));
    await Promise.all(
      batch.map((b) =>
        b
          .join()
          .then(() => {
            b.place(c.x, c.z, radius);
            this.bots.push(b);
          })
          .catch((e) => this.log(`  bot ${b.i}: ${String(e).slice(0, 60)}`)),
      ),
    );
    for (const b of this.bots) b.place(c.x, c.z, radius);
    return this.bots.length;
  }
  async despawnCrowd() {
    for (const b of this.bots) b.close();
    this.bots = [];
  }

  // Combat / VFX: target the nearest hostile and cycle the action bar so each
  // ability (and its first-use particle program) fires.
  async combat({ ms = 6000, keys = '1234567890' } = {}) {
    await this.page.keyboard.press('Tab');
    const end = performance.now() + ms;
    let k = 0;
    while (performance.now() < end) {
      await this.page.keyboard.press(keys[k % keys.length]);
      k++;
      await sleep(450);
    }
  }

  async jump() {
    await this.page.keyboard.press('Space');
  }

  // Right-button camera mouselook, the way a player turns to look around. The real
  // input path reads e.movementX/Y (input.ts) to drive camYaw/camPitch, so we send
  // PointerEvents WITH movementX set; we also nudge input.camYaw directly so the
  // sweep is reliable even when a synthetic movementX is dropped. Turning the camera
  // pulls newly-visible models into the frame, surfacing first-draw shader compiles
  // and texture/geometry uploads a straight forward walk never points the camera at.
  async lookSweep({ yaw = 1, frames = 18, dx = 16, dy = 0 } = {}) {
    await this.page.evaluate(
      ({ frames, dx, dy, yaw }) =>
        new Promise((res) => {
          const cv = document.querySelector('canvas');
          const r = cv.getBoundingClientRect();
          const c4 = {
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.top + r.height / 2),
          };
          const mk = (type, extra) =>
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: 'mouse',
              ...c4,
              ...extra,
            });
          cv.dispatchEvent(mk('pointerdown', { button: 2, buttons: 2 }));
          let i = 0;
          const step = () => {
            cv.dispatchEvent(
              mk('pointermove', { button: -1, buttons: 2, movementX: dx * yaw, movementY: dy }),
            );
            try {
              window.__game.input.camYaw -= 0.06 * yaw;
              if (dy)
                window.__game.input.camPitch = Math.min(
                  1.2,
                  Math.max(-0.35, window.__game.input.camPitch + dy * 0.004),
                );
            } catch {
              /* input shape differs: the PointerEvent path above still drives it */
            }
            if (++i < frames) requestAnimationFrame(step);
            else {
              window.dispatchEvent(mk('pointerup', { button: 2, buttons: 0 }));
              res();
            }
          };
          requestAnimationFrame(step);
        }),
      { frames, dx, dy, yaw },
    );
  }

  async _pos() {
    return this.page.evaluate(() => {
      const g = window.__game;
      const p = g.world.player ?? g.sim.player;
      let zone = null;
      try {
        zone = (g.world && g.world.zoneName) || (g.sim && g.sim.currentZoneId) || null;
      } catch {
        /* ignore */
      }
      return { x: p.pos.x, z: p.pos.z, zone };
    });
  }
  async _face(f) {
    await this.page.evaluate((f) => {
      const p = window.__game.world.player ?? window.__game.sim.player;
      p.facing = f;
      window.__game.input.camYaw = f;
    }, f);
  }

  // Acquire the nearest enemy + start auto-attacking via the IWorld API (more
  // reliable than a Tab keypress, which needs a mob already in tab range): with a
  // live target + in range, the ability keypresses in `play` actually CAST, so their
  // first-use VFX shaders compile - the freeze the user hits "especially with abilities".
  // Acquire a target + start auto-attacking through the IWorld API. NOTE: in the
  // OFFLINE sim, targeting is driven by the input/screen path and the sim reconciles
  // the player's target each tick, so neither tabTarget() nor writing targetId from
  // outside reliably sticks - target-requiring abilities may not fire offline. What
  // DOES exercise the ability pipeline here: instant/self abilities (buffs, shouts)
  // fire on the keypress regardless, auto-target kicks in when an attack key is hit
  // next to a mob, and `play` walks the character through mobs. For exhaustive
  // targeted-ability coverage run `play` against an online server (`--mode online`),
  // where the server resolves targeting. Both keep auto-attack on for swing VFX.
  async _engage() {
    await this.page.evaluate(() => {
      const w = window.__game.world ?? window.__game.sim;
      try {
        w.tabTarget?.();
      } catch {
        /* no enemy in range / offline targeting path differs */
      }
      try {
        w.startAutoAttack?.();
      } catch {
        /* ignore */
      }
    });
  }

  // Continuous on-foot traversal of the world (no teleports): walk forward for
  // `ms`, keeping the collector running the WHOLE time, steering when a collider
  // stalls progress, and logging every hitch WITH the world position + cause as it
  // happens. This is the realistic streaming/zone-crossing test a teleport skips.
  async walk({ ms = 70000, label = 'walk', heading = 0 } = {}) {
    await this.page.evaluate((l) => {
      window.__prof.label = l;
      window.__game.perf.reset();
      window.__prof.start();
    }, label);
    await this._face(heading);
    await this.setMove({ forward: true });
    const t0 = performance.now();
    let facing = heading;
    let last = await this._pos();
    let consumed = 0;
    let stuck = 0;
    let checkpoint = 0;
    const events = [];
    const trail = [];
    while (performance.now() - t0 < ms) {
      await sleep(2500);
      const pos = await this._pos();
      const moved = Math.hypot(pos.x - last.x, pos.z - last.z);
      trail.push({
        x: Math.round(pos.x),
        z: Math.round(pos.z),
        moved: Math.round(moved),
        zone: pos.zone,
      });
      if (moved < 2.5) {
        // stuck on terrain/water: escalate the turn each consecutive stall so it
        // breaks free instead of hugging the same wall
        stuck++;
        facing += 1.7 + stuck * 0.6;
        await this._face(facing);
      } else {
        stuck = 0;
        // serpentine every ~6 checkpoints so the walk roams across maps, not a line
        if (++checkpoint % 6 === 0) {
          facing += (checkpoint % 12 === 0 ? -1 : 1) * 0.9;
          await this._face(facing);
        }
      }
      last = pos;
      // drain new collector samples since last check, attribute, log hitches with position
      const slice = await this.page.evaluate((from) => window.__prof.samples.slice(from), consumed);
      consumed += slice.length;
      const fz = attributeFreezes(slice, 8, 50);
      for (const w of fz.worst) {
        const e = {
          ms: w.ms,
          cause: w.cause,
          x: Math.round(pos.x),
          z: Math.round(pos.z),
          zone: pos.zone,
        };
        events.push(e);
        this.log(
          `  FREEZE ${String(w.ms).padStart(6)}ms  ${w.cause.padEnd(13)} @ (${e.x}, ${e.z})${pos.zone ? ` ${pos.zone}` : ''}`,
        );
      }
    }
    await this.stopMove();
    const raw = await this.page.evaluate(() => ({
      ...window.__prof.stop(),
      report: window.__game.perf.report(),
      entities: window.__game.world.entities.size,
    }));
    const norm = normalizeReport(raw.report);
    norm.entities = raw.entities;
    let dist = 0;
    for (let i = 1; i < trail.length; i++) {
      dist += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
    }
    return {
      label,
      mode: this.mode,
      ...norm,
      scene: raw.scene ?? null,
      newPrograms: raw.newPrograms ?? [],
      frame: frameStats(raw.frames, this.targetFps),
      freezes: attributeFreezes(raw.samples),
      trail,
      events,
      distance: Math.round(dist),
    };
  }

  // A realistic play session: walk while turning the camera (RMB mouselook),
  // jumping, retargeting, and casting EVERY ability on a short cycle. These are the
  // inputs a human actually uses and the ones that surface "weird" freezes a plain
  // walk misses: first-cast ability VFX shader compiles, camera-reveal compiles as
  // the view turns, and jump/landing hitches. Logs each freeze with position + cause.
  async play({ ms = 60000, label = 'play', keys = '1234567890' } = {}) {
    await this.page.evaluate((l) => {
      window.__prof.label = l;
      window.__game.perf.reset();
      window.__prof.start();
    }, label);
    await this.setMove({ forward: true });
    await this._engage(); // acquire nearest enemy + auto-attack so abilities actually fire
    const t0 = performance.now();
    let facing = 0,
      last = await this._pos(),
      consumed = 0,
      stuck = 0,
      checkpoint = 0,
      k = 0,
      tick = 0;
    const events = [];
    const trail = [];
    while (performance.now() - t0 < ms) {
      await this.page.keyboard.press(keys[k++ % keys.length]); // cast the next ability
      if (tick % 2 === 0) await this.jump();
      if (tick % 3 === 0)
        await this.lookSweep({ yaw: tick % 6 === 0 ? 1 : -1, dy: tick % 9 === 0 ? 6 : 0 });
      if (tick % 4 === 0) await this._engage(); // retarget (mobs die / leave range)
      tick++;
      await sleep(850);
      if (tick % 3 !== 0) continue; // sample position/steer/freezes every 3rd tick (~2.5s)
      const pos = await this._pos();
      const moved = Math.hypot(pos.x - last.x, pos.z - last.z);
      trail.push({
        x: Math.round(pos.x),
        z: Math.round(pos.z),
        moved: Math.round(moved),
        zone: pos.zone,
      });
      if (moved < 2.5) {
        stuck++;
        facing += 1.7 + stuck * 0.6;
        await this._face(facing);
      } else {
        stuck = 0;
        if (++checkpoint % 6 === 0) {
          facing += (checkpoint % 12 === 0 ? -1 : 1) * 0.9;
          await this._face(facing);
        }
      }
      last = pos;
      const slice = await this.page.evaluate((from) => window.__prof.samples.slice(from), consumed);
      consumed += slice.length;
      const fz = attributeFreezes(slice, 8, 50);
      for (const w of fz.worst) {
        const e = {
          ms: w.ms,
          cause: w.cause,
          x: Math.round(pos.x),
          z: Math.round(pos.z),
          zone: pos.zone,
        };
        events.push(e);
        this.log(
          `  FREEZE ${String(w.ms).padStart(6)}ms  ${w.cause.padEnd(13)} @ (${e.x}, ${e.z})${pos.zone ? ` ${pos.zone}` : ''}`,
        );
      }
    }
    await this.stopMove();
    const raw = await this.page.evaluate(() => ({
      ...window.__prof.stop(),
      report: window.__game.perf.report(),
      entities: window.__game.world.entities.size,
    }));
    const norm = normalizeReport(raw.report);
    norm.entities = raw.entities;
    let dist = 0;
    for (let i = 1; i < trail.length; i++) {
      dist += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
    }
    return {
      label,
      mode: this.mode,
      ...norm,
      scene: raw.scene ?? null,
      newPrograms: raw.newPrograms ?? [],
      frame: frameStats(raw.frames, this.targetFps),
      freezes: attributeFreezes(raw.samples),
      trail,
      events,
      distance: Math.round(dist),
    };
  }

  async setTier(tier) {
    await this.page.evaluate(COLLECTOR); /* re-enter via reload */
    this.pendingTier = tier;
    await this.enter({ mode: this.mode, tier });
  }

  async screenshot(path) {
    try {
      await this.page.screenshot({ path });
    } catch {
      /* ignore */
    }
  }

  // The rich measurement: collect raw frames for `ms`, then fold the perf report,
  // advanced frame stats (1%/0.1% lows, jank, stdev) and freeze attribution.
  async sample({ ms = 4000, label = 'sample' } = {}) {
    await this.page.evaluate((label) => {
      window.__prof.label = label;
      window.__game.perf.reset();
      window.__prof.start();
    }, label);
    await sleep(ms);
    const raw = await this.page.evaluate(() => ({
      ...window.__prof.stop(),
      report: window.__game.perf.report(),
      entities: window.__game.world.entities.size,
    }));
    const norm = normalizeReport(raw.report);
    norm.entities = raw.entities;
    if (this.shotDir) {
      try {
        fs.mkdirSync(this.shotDir, { recursive: true });
      } catch {
        /* ignore */
      }
      await this.screenshot(`${this.shotDir}/${label}.png`);
    }
    return {
      label,
      mode: this.mode,
      ...norm,
      scene: raw.scene ?? null, // entity-by-kind, loaded models, shader variants, tex/geo
      newPrograms: raw.newPrograms ?? [], // shader cacheKeys that linked during the window
      frame: frameStats(raw.frames, this.targetFps),
      freezes: attributeFreezes(raw.samples),
    };
  }

  async close() {
    await this.despawnCrowd();
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
  }
}
