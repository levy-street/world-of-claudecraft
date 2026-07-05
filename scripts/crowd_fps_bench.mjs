// Real-server crowd FPS benchmark.
//
// Stands a HEADED render client (real GPU, vsync off) in the live world and
// spawns a crowd of WS bots (varied class + level => varied skinned-character
// rigs and gear) clustered around it, measuring how the client frame rate
// degrades as the visible-player count grows, while running through the crowd
// and across a zone boundary. This is the "real gameplay" load the offline
// single-player bench cannot show: many other players' character views.
//
//   npm run db:up
//   ALLOW_DEV_COMMANDS=1 npm run server     # :8787
//   npm run dev                             # :5173 (proxies /api,/ws -> :8787)
//   node scripts/crowd_fps_bench.mjs
//
// Env: CROWD_BATCHES=10,20,30,40 (cumulative crowd sizes), CROWD_W/H, CROWD_DPR,
//      CROWD_SETTLE_MS, GAME_URL, SERVER_URL, BROWSER_PATH.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';

// Stream every sampled row to a file immediately, so a kill/timeout (the render
// client + dozens of bots can outrun a foreground budget) never loses results.
const OUT_FILE = process.env.CROWD_OUT ?? 'tmp/crowd-fps-latest.txt';
function record(line) {
  console.log(line);
  try {
    fs.mkdirSync('tmp', { recursive: true });
    fs.appendFileSync(OUT_FILE, `${line}\n`);
  } catch {
    /* ignore */
  }
}

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SERVER = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = SERVER.replace(/^http/, 'ws');
const BATCHES = (process.env.CROWD_BATCHES ?? '10,20,35,50').split(',').map(Number);
const W = Number(process.env.CROWD_W ?? 1920);
const H = Number(process.env.CROWD_H ?? 1080);
const DPR = Number(process.env.CROWD_DPR ?? 1);
const SETTLE_MS = Number(process.env.CROWD_SETTLE_MS ?? 3500);
const CLUSTER_R = Number(process.env.CROWD_R ?? 9);

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
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token, xff) {
  const res = await fetch(SERVER + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // The server trusts X-Forwarded-For from loopback, so a unique IP per bot
      // gives each its own register/login rate-limit bucket (20/min/IP otherwise
      // caps the crowd at ~20). Load-test only.
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

class Bot {
  constructor(i) {
    this.i = i;
    this.cls = CLASSES[i % CLASSES.length];
    this.level = 1 + ((i * 7) % 40); // spread levels 1..40 for gear variety
    // Character names are letters-only + globally unique: map the index digits to
    // letters and prefix the per-run alpha tag.
    const li = String(i)
      .split('')
      .map((d) => 'abcdefghij'[+d])
      .join('');
    this.name = `Cr${alpha}${li}`;
    this.pid = -1;
    this.self = null;
  }
  async join() {
    const xff = `172.16.${Math.floor(this.i / 254)}.${(this.i % 254) + 1}`;
    const reg = await api(
      '/api/register',
      {
        username: `crowd_${uniq}_${this.i}`,
        password: 'hunter22',
        email: `crowd_${uniq}_${this.i}@example.com`,
      },
      undefined,
      xff,
    );
    this.token = reg.body.token;
    if (!this.token)
      throw new Error(`register failed for ${this.i}: ${JSON.stringify(reg.body).slice(0, 100)}`);
    const char = await api(
      '/api/characters',
      { name: this.name, class: this.cls },
      this.token,
      xff,
    );
    this.charId = char.body.id;
    if (!this.charId)
      throw new Error(
        `char create failed for ${this.i}: ${JSON.stringify(char.body).slice(0, 120)}`,
      );
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('join timeout')), 12000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.charId })),
      );
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'snap' && msg.self) this.self = { ...this.self, ...msg.self };
      });
      this.ws.on('error', reject);
    });
  }
  cmd(payload) {
    this.ws?.send(JSON.stringify({ t: 'cmd', ...payload }));
  }
  input(mi, facing) {
    this.ws?.send(JSON.stringify({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) }));
  }
  place(x, z) {
    const a = this.i * 2.39996; // golden-angle spiral so they fan out, not stack
    const r = CLUSTER_R * Math.sqrt((this.i % 30) / 30);
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

async function enterWorld(page) {
  const u = `crowdcam_${uniq}`;
  // Register the account over REST (robust), then just LOG IN through the UI -
  // the auth panel defaults to login mode, so no fragile register-toggle needed.
  await api(
    '/api/register',
    { username: u, password: 'hunter22', email: `${u}@example.com` },
    undefined,
    '172.31.0.1',
  );
  // CROWD_GFX forces a tier (low|medium|high|ultra) for a branch-independent,
  // tier-consistent before/after; default lets the client auto-detect.
  const gfxQs = process.env.CROWD_GFX ? `&gfx=${process.env.CROWD_GFX}` : '';
  await page.goto(`${GAME_URL}/?perf${gfxQs}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // The homepage/landing mounts the mode-select compat triggers asynchronously
  // (slower under a real GPU than swiftshader), so wait for the hook to exist.
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('#btn-online') &&
          document.querySelector('#login-user') &&
          document.querySelector('#btn-login'),
      ),
    { timeout: 25000, polling: 200 },
  );
  await page.evaluate(
    (u, p) => {
      document.querySelector('#btn-online').click();
      document.querySelector('#login-user').value = u;
      document.querySelector('#login-pass').value = p;
      document.querySelector('#btn-login').click();
    },
    u,
    'hunter22',
  );
  // Panels toggle via the `hidden` attribute + body.dataset.startPanel now. A
  // single local realm may auto-advance to charselect, or pause on realm-panel.
  await page.waitForFunction(
    () => {
      const sp = document.body.dataset.startPanel;
      return sp === 'charselect-panel' || sp === 'realm-panel';
    },
    { timeout: 20000, polling: 200 },
  );
  if (await page.evaluate(() => document.body.dataset.startPanel === 'realm-panel')) {
    await page.evaluate(() =>
      document
        .querySelector('#realm-panel .realm-row, #realm-panel [data-realm], #realm-panel button')
        ?.click(),
    );
    await page.waitForFunction(() => document.body.dataset.startPanel === 'charselect-panel', {
      timeout: 12000,
      polling: 200,
    });
  }
  // Fresh account: open the separate create-character panel, fill it, create.
  await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
  await page.waitForFunction(() => document.body.dataset.startPanel === 'charcreate-panel', {
    timeout: 12000,
    polling: 200,
  });
  const camName = `Cam${alpha}`;
  await page.evaluate((nm) => {
    const name = document.querySelector('#new-char-name');
    name.value = nm;
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]').click();
    document.querySelector('#btn-create-char').click();
  }, camName);
  await page.waitForFunction(
    () =>
      document.body.dataset.startPanel === 'charselect-panel' &&
      document.querySelector('.char-row .enter-world-btn'),
    { timeout: 15000, polling: 200 },
  );
  await page.evaluate((nm) => {
    const row = [...document.querySelectorAll('.char-row')].find(
      (r) => r.querySelector('.char-name')?.textContent === nm,
    );
    (row?.querySelector('.enter-world-btn') ?? document.querySelector('.enter-world-btn'))?.click();
  }, camName);
  await page.waitForFunction(() => window.__game?.world?.player && window.__game?.perf?.report, {
    timeout: 25000,
    polling: 300,
  });
  await sleep(1500);
}

async function sample(page, label) {
  await page.evaluate(() => window.__game.perf.reset());
  await sleep(2500);
  return page.evaluate((label) => {
    const g = window.__game;
    const r = g.perf.report();
    const rr = r.renderer ?? {};
    let _visiblePlayers = 0;
    for (const e of g.world.entities.values())
      if (e.kind === 'player' || e.k === 'player') _visiblePlayers++;
    return {
      label,
      fps: r.fps,
      fps10s: r.windows?.last10s?.fps,
      frameP95: r.frameMs?.p95,
      frameP99: r.frameMs?.p99,
      calls: rr.calls,
      triangles: rr.triangles,
      views: rr.views,
      programs: rr.programs,
      entitiesMs: rr.phaseMs?.entities?.avg ?? rr.phaseMs?.entities,
      submitMs: rr.phaseMs?.submit?.avg ?? rr.phaseMs?.submit,
      rendererMs: r.mainMs?.renderer?.avg,
      entityCount: g.world.entities.size,
      tier: rr.tier,
      scale: rr.effectiveRenderScale,
    };
  }, label);
}

function row(s) {
  const f = (n, w = 6) => String(typeof n === 'number' ? Math.round(n * 10) / 10 : n).padStart(w);
  return `${String(s.label).padEnd(14)} fps=${f(s.fps)} p95=${f(s.frameP95)} p99=${f(s.frameP99)} ents=${f(s.entityCount, 4)} views=${f(s.views, 4)} calls=${f(s.calls)} tris=${f(s.triangles, 9)} entMs=${f(s.entitiesMs, 5)} subMs=${f(s.submitMs, 5)}`;
}

async function main() {
  console.log(
    `Crowd FPS bench: batches=[${BATCHES}] ${W}x${H} dpr=${DPR} (render client HEADED, vsync OFF)`,
  );
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: false,
    protocolTimeout: 120000,
    args: [
      `--window-size=${W},${H + 120}`,
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
    ],
  });
  const bots = [];
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 120)));
    console.log('entering world (render client)...');
    await enterWorld(page);
    const center = await page.evaluate(() => ({
      x: window.__game.world.player.pos.x,
      z: window.__game.world.player.pos.z,
    }));
    console.log(`render client at x=${center.x.toFixed(1)} z=${center.z.toFixed(1)}`);

    results.push(await sample(page, 'solo'));
    record(`  ${row(results.at(-1))}`);

    let spawned = 0;
    for (const target of BATCHES) {
      console.log(`spawning bots to ${target}...`);
      // Join concurrently (each bot has its own XFF rate-limit bucket) so a large
      // crowd comes up in seconds, not minutes - serial joins blew the budget.
      const batch = [];
      for (let i = spawned; i < target; i++) batch.push(new Bot(i));
      await Promise.all(
        batch.map((b) =>
          b
            .join()
            .then(() => {
              b.place(center.x, center.z);
              bots.push(b);
            })
            .catch((e) => console.log(`  bot ${b.i} failed: ${String(e).slice(0, 80)}`)),
        ),
      );
      spawned = target;
      // keep them in the cluster + a few strafing so idle/locomotion anims both run
      for (const b of bots) b.place(center.x, center.z);
      await sleep(SETTLE_MS);
      results.push(await sample(page, `crowd-${target}`));
      record(`  ${row(results.at(-1))}`);
      try {
        await page.screenshot({ path: `tmp/crowd-${target}.png` });
      } catch {
        /* ignore */
      }
    }

    // Run forward through the crowd.
    await page.evaluate(() =>
      window.__game.input.setTouchMove({
        forward: true,
        back: false,
        strafeLeft: false,
        strafeRight: false,
      }),
    );
    results.push(await sample(page, `run-through`));
    record(`  ${row(results.at(-1))}`);
    await page.evaluate(() => window.__game.input.clearTouchMove());

    console.log('\n========== CROWD FPS SUMMARY ==========');
    for (const s of results) record(row(s));
  } finally {
    for (const b of bots) b.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
