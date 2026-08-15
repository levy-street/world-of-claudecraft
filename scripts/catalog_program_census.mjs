// Catalog program census: the deciding measurement for the first-sight
// freeze strategy. Parades the ENTIRE visual catalog past one observer
// client (every class rig, every weapon model, every Season 1 weapon skin)
// and reads the WebGL program count after each step, so the output says how
// many shader programs the whole catalog actually costs, per family and per
// item, on this checkout.
//
//   npm run db:up ; DATABASE_URL=... ALLOW_DEV_COMMANDS=1 npm run server
//   node scripts/catalog_program_census.mjs
//
// Env: BENCH_PORT (default 5198, strict), BENCH_GFX (default insane),
//      SERVER_URL, DATABASE_URL, BROWSER_PATH, BENCH_OUT,
//      BENCH_STEP_MS (default 1100: settle per equipped item),
//      BENCH_BOOT_TIMEOUT_MS (default 240000).
//
// Bot/observer plumbing duplicated from geared_arrival_bench.mjs on purpose:
// extract to scripts/lib/ when a third consumer appears (rule of three).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays } from './enter_offline_game.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import { worldAuthMessage } from './lib/world_auth.mjs';

const PORT = Number(process.env.BENCH_PORT ?? 5198);
const GFX = process.env.BENCH_GFX ?? 'insane';
const SERVER = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = SERVER.replace(/^http/, 'ws');
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://eastbrook:change-me@127.0.0.1:5433/eastbrook';
const BOOT_TIMEOUT_MS = Number(process.env.BENCH_BOOT_TIMEOUT_MS ?? 240000);
const STEP_MS = Number(process.env.BENCH_STEP_MS ?? 1100);
// The census mints accounts, grants skins straight into Postgres, and drives
// /dev cheats: every target must be local, always.
assertLoopbackUrl(SERVER, 'SERVER_URL');
assertLoopbackDatabaseUrl(DB_URL);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.BENCH_OUT ?? path.join('tmp', `catalog-census-${stamp}.json`);

const OBSERVER = { x: 0, z: 0 };
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const headSha = gitOutput(['rev-parse', 'HEAD']);

// Bundle the sim content tables the parade needs (never import TS raw from a
// script: the export_loot_spreadsheet idiom).
async function loadCatalog() {
  const entry = `
    export { ITEMS } from './src/sim/data.ts';
    export { WEAPON_SKINS } from './src/sim/content/weapon_skins.ts';
    export {
      weaponTypeForItem,
      eligibleClassesForWeaponSkinType,
    } from './src/sim/content/weapon_skin_rules.ts';
  `;
  const build = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  return import(dataUrl);
}

async function api(pathname, body, token, xff) {
  const res = await fetch(SERVER + pathname, {
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
  constructor(i, cls) {
    this.i = i;
    this.cls = cls;
    const li = String(i)
      .split('')
      .map((d) => 'abcdefghij'[+d])
      .join('');
    this.name = `Cc${alpha}${li}`;
    this.username = `census_${uniq}_${i}`;
  }
  async register(db, allSkinIds) {
    const xff = `172.19.${Math.floor(this.i / 254)}.${(this.i % 254) + 1}`;
    this.xff = xff;
    const reg = await api(
      '/api/register',
      { username: this.username, password: 'hunter22', email: `${this.username}@example.com` },
      undefined,
      xff,
    );
    this.token = reg.body.token;
    if (!this.token) throw new Error(`register failed for bot ${this.i}`);
    const row = await db.query('SELECT id FROM accounts WHERE username = $1', [this.username]);
    const accountId = row.rows[0]?.id;
    if (!Number.isInteger(accountId)) throw new Error(`no account id for bot ${this.i}`);
    await db.query(
      `INSERT INTO account_weapon_cosmetics (account_id, skin_ids)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET skin_ids = EXCLUDED.skin_ids`,
      [accountId, JSON.stringify(allSkinIds)],
    );
    const char = await api(
      '/api/characters',
      { name: this.name, class: this.cls },
      this.token,
      xff,
    );
    this.charId = char.body.id;
    if (!this.charId) throw new Error(`char create failed for bot ${this.i} (${this.cls})`);
  }
  async join() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`, { headers: { 'X-Forwarded-For': this.xff } });
      const to = setTimeout(() => reject(new Error(`join timeout bot ${this.i}`)), 15000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId))),
      );
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          clearTimeout(to);
          resolve();
        }
      });
      this.ws.on('error', reject);
    });
    this.cmd({ cmd: 'dev_level', level: 20 });
  }
  cmd(payload) {
    this.ws?.send(JSON.stringify({ t: 'cmd', ...payload }));
  }
  chat(text) {
    this.ws?.send(JSON.stringify({ t: 'chat', text }));
  }
  teleportNear(index) {
    const a = index * 2.39996;
    const r = 3 + 4 * Math.sqrt((index % 12) / 12);
    this.cmd({
      cmd: 'dev_teleport',
      x: OBSERVER.x + Math.cos(a) * r,
      z: OBSERVER.z + Math.sin(a) * r,
    });
  }
  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => {
    output += chunk;
  });
  vite.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`vite exited (port ${PORT} busy?):\n${output}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite not ready on :${PORT}:\n${output}`);
}

async function enterObserver(page) {
  const u = `censuscam_${uniq}`;
  await api(
    '/api/register',
    { username: u, password: 'hunter22', email: `${u}@example.com` },
    undefined,
    '172.19.31.1',
  );
  await page.goto(`http://localhost:${PORT}/?perf&gfx=${GFX}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('#btn-online') &&
          document.querySelector('#login-user') &&
          document.querySelector('#btn-login'),
      ),
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  await page.evaluate(
    (user, pass) => {
      document.querySelector('#btn-online').click();
      document.querySelector('#login-user').value = user;
      document.querySelector('#login-user').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#login-pass').value = pass;
      document.querySelector('#login-pass').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btn-login').click();
    },
    u,
    'hunter22',
  );
  const panelDeadline = Date.now() + BOOT_TIMEOUT_MS;
  let created = false;
  for (;;) {
    if (Date.now() > panelDeadline) throw new Error('observer stuck in the panel flow');
    const entered = await page.evaluate(() =>
      Boolean(window.__game?.world?.player && window.__game?.perf?.report),
    );
    if (entered) break;
    const panel = await page.evaluate(() => document.body.dataset.startPanel ?? '');
    if (panel === 'realm-panel') {
      await page.evaluate(() =>
        document
          .querySelector('#realm-panel .realm-row, #realm-panel [data-realm], #realm-panel button')
          ?.click(),
      );
    } else if (panel === 'charselect-panel') {
      const hasChar = await page.evaluate(() =>
        Boolean(document.querySelector('.char-row .enter-world-btn')),
      );
      if (hasChar) {
        await page.evaluate(() => document.querySelector('.char-row .enter-world-btn')?.click());
      } else {
        await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      }
    } else if (panel === 'charcreate-panel' && !created) {
      created = true;
      await page.evaluate((nm) => {
        const name = document.querySelector('#new-char-name');
        name.value = nm;
        name.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]').click();
        document.querySelector('#btn-create-char').click();
      }, `Cam${alpha}`);
    }
    await sleep(700);
  }
  await dismissEntryOverlays(page);
  await page.evaluate(
    (x, z) => window.__game.world.chat(`/dev tp ${x} ${z}`),
    OBSERVER.x,
    OBSERVER.z,
  );
  await sleep(15000);
}

const readPrograms = (page) =>
  page.evaluate(() => {
    const r = window.__game.renderer.perfStats();
    return { programs: r.programs, textures: r.textures, geometries: r.geometries };
  });

async function main() {
  const { ITEMS, WEAPON_SKINS, weaponTypeForItem, eligibleClassesForWeaponSkinType } =
    await loadCatalog();
  const weapons = Object.values(ITEMS).filter(
    (item) => item.kind === 'weapon' && (item.slot === 'mainhand' || item.slot === 'offhand'),
  );
  const skins = Object.values(WEAPON_SKINS);
  const skinIds = skins.map((s) => s.id);
  // One default weapon per skinnable type, for the skin parade's type gate.
  const weaponByType = new Map();
  for (const item of weapons) {
    const type = weaponTypeForItem(item.id);
    if (type && !weaponByType.has(type)) weaponByType.set(type, item.id);
  }
  const classes = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'priest',
    'shaman',
    'mage',
    'warlock',
    'druid',
  ];
  console.log(
    `catalog: ${classes.length} classes, ${weapons.length} weapons, ${skins.length} skins @ ${headSha}`,
  );

  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const bots = classes.map((cls, i) => new Bot(i, cls));
  for (const bot of bots) {
    await bot.register(db, skinIds);
    await bot.join();
  }
  const botByClass = new Map(bots.map((b) => [b.cls, b]));
  const eligibleBotFor = (type) => {
    for (const cls of eligibleClassesForWeaponSkinType(type)) {
      const bot = botByClass.get(cls);
      if (bot) return bot;
    }
    return null;
  };

  const vite = await startVite();
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: false,
      args: [
        '--window-size=1600,900',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--use-gl=angle',
        '--use-angle=gl',
        '--enable-webgl',
        '--no-sandbox',
        '--mute-audio',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    console.log('entering observer...');
    await enterObserver(page);
    const baseline = await readPrograms(page);
    console.log(`baseline: ${JSON.stringify(baseline)}`);

    // Phase 1: the nine class rigs appear (naked).
    for (const [index, bot] of bots.entries()) bot.teleportNear(index);
    await sleep(8000);
    const afterRigs = await readPrograms(page);
    console.log(
      `after rigs: programs ${afterRigs.programs} (+${afterRigs.programs - baseline.programs})`,
    );

    // Phase 2: every weapon model, equipped by an eligible class in turn.
    const perItem = [];
    let prev = afterRigs.programs;
    for (const item of weapons) {
      const type = weaponTypeForItem(item.id);
      const bot = (type && eligibleBotFor(type)) ?? bots[0];
      bot.chat(`/dev give ${item.id}`);
      await sleep(120);
      bot.cmd({ cmd: 'equip', item: item.id });
      await sleep(STEP_MS);
      const now = (await readPrograms(page)).programs;
      if (now !== prev) perItem.push({ kind: 'weapon', id: item.id, programs: now - prev });
      prev = now;
    }
    const afterWeapons = await readPrograms(page);
    console.log(
      `after weapons: programs ${afterWeapons.programs} (+${afterWeapons.programs - afterRigs.programs})`,
    );

    // Phase 3: every skin, applied over a matching-type weapon.
    for (const skin of skins) {
      const bot = eligibleBotFor(skin.weaponType);
      const weaponId = weaponByType.get(skin.weaponType);
      if (!bot || !weaponId) {
        perItem.push({ kind: 'skin', id: skin.id, programs: null, skipped: true });
        continue;
      }
      bot.chat(`/dev give ${weaponId}`);
      await sleep(120);
      bot.cmd({ cmd: 'equip', item: weaponId });
      await sleep(250);
      bot.cmd({ cmd: 'change_weapon_skin', skin: skin.id });
      await sleep(STEP_MS + 400);
      const now = (await readPrograms(page)).programs;
      if (now !== prev) perItem.push({ kind: 'skin', id: skin.id, programs: now - prev });
      prev = now;
    }
    const afterSkins = await readPrograms(page);
    console.log(
      `after skins: programs ${afterSkins.programs} (+${afterSkins.programs - afterWeapons.programs})`,
    );

    const evidence = {
      headSha,
      gfx: GFX,
      startedAt: stamp,
      catalog: { classes: classes.length, weapons: weapons.length, skins: skins.length },
      baseline,
      afterRigs,
      afterWeapons,
      afterSkins,
      families: {
        rigs: afterRigs.programs - baseline.programs,
        weapons: afterWeapons.programs - afterRigs.programs,
        skins: afterSkins.programs - afterWeapons.programs,
        total: afterSkins.programs - baseline.programs,
      },
      perItem: perItem.sort((a, b) => (b.programs ?? 0) - (a.programs ?? 0)),
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    console.log(`\nfamilies: ${JSON.stringify(evidence.families)}`);
    console.log(`top costs: ${JSON.stringify(evidence.perItem.slice(0, 10))}`);
    console.log(`evidence: ${OUT}`);
  } finally {
    await browser?.close().catch(() => {});
    vite.kill('SIGTERM');
    for (const bot of bots) bot.close();
    await db.end().catch(() => {});
  }
}

await main();
