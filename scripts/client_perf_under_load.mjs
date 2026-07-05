// Client-side stutter check: is the hitch the server, the renderer, or both?
//
// Logs a REAL browser into the running server, then measures its renderer frame
// timing (window.__game.perf.report) in two phases:
//   baseline: a crowd of bots parked far away (browser renders an empty scene)
//   loaded:   the same crowd teleported on top of the browser, circle-strafing
// A big frame-p95 / long-frame jump between the two means the client itself
// stutters under a crowd (models + nameplates + bigger snapshots to apply), not
// just the server loop.
//
// Needs: ALLOW_DEV_COMMANDS=1 npm run server  (serves the built client at :8787)
//        and a prior `npm run build` so dist/ exists.
//   node scripts/client_perf_under_load.mjs
// Env: BOTS, GAME_URL, PHASE_MS.
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const BOTS = Number(process.env.BOTS ?? 60);
const PHASE_MS = Number(process.env.PHASE_MS ?? 14000);
const uniq = Date.now().toString(36);
const L = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n) =>
  n === 0
    ? 'a'
    : (() => {
        let s = '';
        let x = n;
        while (x > 0) {
          s = L[x % 26] + s;
          x = Math.floor(x / 26);
        }
        return s;
      })();
const ipFor = (n) => `9.${(n >> 8) & 255}.${n & 255}.7`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token, ip) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// minimal ws bot: join, level up, teleport, circle-strafe on demand
class Bot {
  constructor(i) {
    this.i = i;
    this.ip = ipFor(i + 1);
    this.pid = -1;
    this.self = null;
  }
  async join() {
    const name = `Crowd${lettersOf(this.i)}${uniq.replace(/[0-9]/g, (d) => L[Number(d)])}`.slice(
      0,
      20,
    );
    const reg = await api(
      '/api/register',
      { username: `cpl_${this.i}_${uniq}`, password: 'hunter22' },
      null,
      this.ip,
    );
    if (!reg.body.token) throw new Error(`reg ${reg.status}`);
    const ch = await api(
      '/api/characters',
      { name, class: ['warrior', 'mage', 'hunter', 'priest', 'rogue'][this.i % 5] },
      reg.body.token,
      this.ip,
    );
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`, { headers: { 'X-Forwarded-For': this.ip } });
      const to = setTimeout(() => reject(new Error('join timeout')), 10000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ t: 'auth', token: reg.body.token, character: ch.body.id })),
      );
      this.ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.t === 'hello') {
          this.pid = m.pid;
          clearTimeout(to);
          resolve();
        } else if (m.t === 'snap') this.self = { ...this.self, ...m.self };
      });
      this.ws.on('error', (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
  }
  cmd(p) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  input(mi, facing) {
    if (this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }
  teleport(x, z) {
    this.cmd({ cmd: 'dev_teleport', x, z });
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* closing */
    }
  }
}

async function browserPos(page) {
  return page.evaluate(() => {
    const p = window.__game?.world?.player?.pos;
    return p ? { x: p.x, z: p.z } : null;
  });
}
async function perfReport(page) {
  return page.evaluate(() => {
    const r = window.__game.perf.report();
    const w = r.windows?.last10s ?? {};
    return {
      fps10s: w.fps ?? 0,
      frameP95: w.frameMs?.p95 ?? r.frameMs?.p95 ?? 0,
      frameMax: w.frameMs?.max ?? r.frameMs?.max ?? 0,
      long50: w.frameMs?.long50 ?? r.frameMs?.long50 ?? 0,
      longTasks: r.browser?.longTasks?.count ?? 0,
      longTaskP95: r.browser?.longTasks?.p95 ?? 0,
      entities: window.__game.world.entities.size,
      players: [...window.__game.world.entities.values()].filter((e) => e.kind === 'player').length,
      calls: r.renderer?.calls ?? 0,
      tris: r.renderer?.triangles ?? 0,
    };
  });
}
// walk the browser player in a circle for `ms`, then sample perf
async function walkAndSample(page, ms) {
  await page.evaluate(() => {
    window.__game.input.setTouchMove({
      forward: true,
      back: false,
      strafeLeft: true,
      strafeRight: false,
    });
  });
  const start = Date.now();
  while (Date.now() - start < ms) {
    await page.evaluate((t) => {
      window.__game.input.setTouchLook(true);
      window.__game.input.setTouchLookVector({ x: Math.sin(t / 700) * 0.6, y: 0 });
    }, Date.now());
    await sleep(250);
  }
  await page.evaluate(() => {
    window.__game.input.clearTouchMove();
    window.__game.input.setTouchLook(false);
  });
  await sleep(400);
  return perfReport(page);
}

async function main() {
  const st = await fetch(`${BASE}/api/status`)
    .then((r) => r.json())
    .catch(() => null);
  if (!st?.ok) {
    console.error('server not reachable at', BASE);
    process.exit(1);
  }

  console.log(`[client-perf] joining ${BOTS} bots...`);
  const bots = [];
  for (let i = 0; i < BOTS; i++) {
    const b = new Bot(i);
    try {
      await b.join();
      bots.push(b);
    } catch (e) {
      console.error(`bot ${i}:`, e.message);
    }
    await sleep(35);
  }
  for (const b of bots) b.cmd({ cmd: 'dev_level', level: 12 });
  // park the crowd far away for the baseline
  for (const b of bots) b.teleport(280 + (b.i % 8), 280 + Math.floor(b.i / 8));
  console.log(`[client-perf] ${bots.length} bots up, parked far`);

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 90000,
    args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 760 },
  });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  const user = `viewer_${uniq}`;
  const charName =
    `Vw${lettersOf(7).toUpperCase().slice(0, 1)}${uniq.replace(/[0-9]/g, (d) => L[Number(d)])}`.slice(
      0,
      14,
    );
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1000);
  // online → switch the single auth form to "create account" mode → submit
  await page.evaluate(() => document.querySelector('#btn-online').click());
  await sleep(300);
  await page.evaluate(
    (u, pw) => {
      const form = document.querySelector('#login-panel');
      if (form.dataset.authMode !== 'register') document.querySelector('#btn-auth-toggle').click();
      const setVal = (sel, v) => {
        const el = document.querySelector(sel);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setVal('#login-user', u);
      setVal('#login-pass', pw);
      form.requestSubmit();
    },
    user,
    'hunter22',
  );
  // realm selection (single realm → pick the first row; may auto-skip)
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('#realm-panel');
        return el && getComputedStyle(el).display !== 'none';
      },
      { timeout: 12000, polling: 200 },
    )
    .catch(() => {});
  await page.evaluate(() => {
    const el = document.querySelector('#realm-panel');
    if (el && getComputedStyle(el).display !== 'none')
      document.querySelector('#realm-list .realm-row')?.click();
  });
  // no characters yet → the create screen auto-opens
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#charcreate-panel');
      return el && getComputedStyle(el).display !== 'none';
    },
    { timeout: 14000, polling: 200 },
  );
  await page.evaluate((name) => {
    const n = document.querySelector('#new-char-name');
    n.value = name;
    n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]').click();
    document.querySelector('#btn-create-char').click();
  }, charName);
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.char-row .char-name')].some((s) => s.textContent === name),
    { timeout: 14000, polling: 200 },
    charName,
  );
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('.char-row')].find(
      (r) => r.querySelector('.char-name')?.textContent === name,
    );
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  await page.waitForFunction(
    () =>
      window.__game?.world && window.__game?.perf?.report && window.__game.world.entities.size > 3,
    { timeout: 25000, polling: 300 },
  );
  await sleep(1500);
  console.log('[client-perf] browser in world');

  // BASELINE: crowd is far; walk + sample
  const baseline = await walkAndSample(page, PHASE_MS);
  console.log('BASELINE (crowd far):', JSON.stringify(baseline));

  // LOADED: drop the whole crowd on top of the browser, circle-strafing
  const p = await browserPos(page);
  console.log(
    `[client-perf] browser at (${p?.x?.toFixed(1)}, ${p?.z?.toFixed(1)}), bringing the crowd in`,
  );
  let step = 0;
  const mover = setInterval(() => {
    step++;
    for (const b of bots) {
      const a = (b.i / bots.length) * Math.PI * 2 + step * 0.05;
      if (step % 30 === 1) b.teleport(p.x + Math.cos(a) * 10, p.z + Math.sin(a) * 10);
      b.input({ f: 1, sl: step % 4 < 2 ? 1 : 0, sr: step % 4 < 2 ? 0 : 1 }, a);
    }
  }, 200);
  await sleep(1500);
  const loaded = await walkAndSample(page, PHASE_MS);
  clearInterval(mover);
  console.log('LOADED   (crowd here):', JSON.stringify(loaded));

  console.log('\n===== CLIENT FRAME PERF (swiftshader software GL, compare RELATIVE) =====');
  const d = (k) => `${baseline[k]} -> ${loaded[k]}`;
  console.log(`players visible: ${d('players')}   entities: ${d('entities')}`);
  console.log(`fps(10s):        ${d('fps10s')}`);
  console.log(`frame p95 (ms):  ${d('frameP95')}`);
  console.log(`frame max (ms):  ${d('frameMax')}`);
  console.log(`long frames>=50: ${d('long50')}`);
  console.log(`browser longtasks: ${d('longTasks')} (p95 ${d('longTaskP95')}ms)`);
  console.log(`draw calls: ${d('calls')}   tris: ${d('tris')}`);
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 8).join('\n'));

  for (const b of bots) b.close();
  await browser.close();
  process.exit(0);
}
main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
