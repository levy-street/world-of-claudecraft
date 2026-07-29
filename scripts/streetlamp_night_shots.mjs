// Night capture of EVERY streetlamp style, in the real game.
//
// The lamps are the authored-illumination pass: each GLB carries a LIGHT_SOCKET
// plus named LAMP_GLASS / LAMP_SOURCE materials, and the night light field does
// the ground illumination from that socket (no draped decal pools). This script
// exists to answer the only question that matters for that work: does every
// fixture visibly glow, at the same strength, without blowing out its housing.
//
// It does NOT hard-code lamp coordinates. It reads the placed streetlamp scene
// graph back out of the renderer, so the vantage is a real lamp the world put
// there, and a placement change can never leave this script shooting empty road.
//
// Needs `npm run dev` for THIS worktree.
//
//   GAME_URL=http://localhost:5174 node scripts/streetlamp_night_shots.mjs
//
// ONLY=style,style limits the set. GFX defaults to high ON PURPOSE: the night
// light field needs standard materials, and a SwiftShader run silently drops to
// the low tier, where the field is absent and this capture would prove nothing.
// Use a real-GPU headless browser (HEADLESS=false to watch it).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5174';
const GFX = process.env.GFX ?? 'high';
const OUT = process.env.OUT ?? 'tmp/streetlamps';
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const BOOT_MS = Number(process.env.BOOT_MS ?? 150000);
const URL = `${BASE}?gfx=${GFX}`;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: process.env.HEADLESS === 'false' ? false : 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
page.on('pageerror', (e) => problems.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

let booted = false;
for (let attempt = 1; attempt <= 3 && !booted; attempt++) {
  booted = await enterOfflineGame(page, {
    charName: 'Lamplighter',
    settleMs: 3000,
    gameBootTimeoutMs: BOOT_MS,
    selectorTimeoutMs: 60000,
  }).catch(() => false);
  if (!booted) console.log(`[boot] attempt ${attempt} stalled, retrying`);
}
if (!booted) {
  console.log('BOOT-FAILED: window.__game never appeared');
  await browser.close();
  process.exit(3);
}

// enterOfflineGame can leave the Game Menu open headless.
for (let i = 0; i < 3; i++) {
  const open = await page.evaluate(() => {
    window.__game?.hud?.closeOptions?.();
    return !!document.querySelector('.window.options, #options-window:not([hidden])');
  });
  if (!open) break;
  await page.evaluate(() => window.__game?.hud?.toggleOptionsMenu?.());
  await sleep(300);
}
await sleep(500);

// Keep the survey character alive and never falling: a death overlay or a
// landing grade would wreck the lighting read.
await page.evaluate(() => {
  if (window.__shotKeepAlive) return;
  window.__shotKeepAlive = setInterval(() => {
    const p = window.__game?.sim?.player;
    if (!p) return;
    p.maxHp = 999999;
    p.hp = 999999;
    p.fallStartY = p.pos.y;
  }, 100);
});

/** Confirm the tier really is field-capable; a low-tier run proves nothing. */
const tier = await page.evaluate(() => {
  const r = window.__game?.renderer;
  return {
    tier: window.__GFX?.tier ?? r?.gfx?.tier ?? null,
    standardMaterials: window.__GFX?.standardMaterials ?? null,
  };
});
console.log('[tier]', JSON.stringify(tier));
if (tier.standardMaterials === false) {
  problems.push('LOW-TIER: standard materials are off, the night light field is not running');
}

/** Drive /daynight through a real click plus a real Enter. */
async function setTimeOfDay(arg) {
  const marker = `time of day set to ${arg}`;
  const before = await page.evaluate(
    (m) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1,
    marker,
  );
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.click('#chat-input').catch(async () => {
    await page.focus('#chat-input');
  });
  await sleep(200);
  await page.evaluate((a) => {
    const c = document.querySelector('#chat-input');
    c.value = `/daynight ${a}`;
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }, arg);
  await page.keyboard.press('Enter');
  const took = await page
    .waitForFunction(
      (m, n) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1 > n,
      { timeout: 15000 },
      marker,
      before,
    )
    .then(() => true)
    .catch(() => false);
  if (!took) throw new Error(`/daynight ${arg} did not register in #chatlog`);
  await page.evaluate(() => document.querySelector('#chat-input')?.blur());
  await sleep(12000); // the grade lerps in
}

await setTimeOfDay('night');

/**
 * Read the placed lamps back out of the scene: one representative world
 * position per style, taken from the style group's own instance matrix.
 */
const sites = await page.evaluate(() => {
  const scene = window.__game?.renderer?.scene;
  if (!scene) return { error: 'no scene' };
  let lampRoot = null;
  scene.traverse((o) => {
    if (!lampRoot && o.name === 'streetlamps') lampRoot = o;
  });
  if (!lampRoot) return { error: 'no streetlamps group' };
  const out = {};
  lampRoot.traverse((o) => {
    if (!o.name?.startsWith('streetlamps-') || o.name.startsWith('streetlamps-zone')) return;
    const style = o.name.slice('streetlamps-'.length);
    if (out[style]) return;
    const mesh = o.children.find((c) => c.isInstancedMesh && c.count > 0);
    if (!mesh) return;
    const m = mesh.instanceMatrix.array;
    out[style] = { x: m[12], y: m[13], z: m[14], instances: mesh.count, parts: o.children.length };
  });
  return out;
});
if (sites.error) {
  console.log('PROBE-FAILED:', sites.error);
  await browser.close();
  process.exit(4);
}
console.log(`[probe] ${Object.keys(sites).length} lamp styles placed`);

/** Read what the fixture materials actually are, straight off the scene. */
const materials = await page.evaluate(() => {
  const scene = window.__game?.renderer?.scene;
  const out = {};
  scene.traverse((o) => {
    if (!o.name?.startsWith('streetlamps-') || o.name.startsWith('streetlamps-zone')) return;
    const style = o.name.slice('streetlamps-'.length);
    if (out[style]) return;
    out[style] = o.children
      .filter((c) => c.isInstancedMesh)
      .map((c) => ({
        material: c.material?.name ?? null,
        emissive: c.material?.emissive?.getHexString?.() ?? null,
        emissiveIntensity: c.material?.emissiveIntensity ?? null,
        transparent: c.material?.transparent ?? null,
        opacity: c.material?.opacity ?? null,
        depthWrite: c.material?.depthWrite ?? null,
      }));
  });
  return out;
});
fs.writeFileSync(`${OUT}/materials.json`, JSON.stringify(materials, null, 1));

// Every lit lamp must be driving its authored emitter above zero at night.
for (const [style, parts] of Object.entries(materials)) {
  const source = parts.find((p) => p.material?.endsWith('LAMP_SOURCE'));
  if (!source) {
    problems.push(`NO-EMITTER ${style}: no LAMP_SOURCE material in the placed fixture`);
    continue;
  }
  if (!(source.emissiveIntensity > 0)) {
    problems.push(`DARK ${style}: LAMP_SOURCE emissiveIntensity is ${source.emissiveIntensity}`);
  }
}

async function hopTo(target, stepYd = 40) {
  for (let i = 0; i < 400; i++) {
    const arrived = await page.evaluate(
      (s, step) => {
        const p = window.__game?.sim?.player;
        if (!p) return false;
        const dx = s.x - p.pos.x;
        const dz = s.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.0) return true;
        const k = Math.min(step, d) / d;
        p.pos.x += dx * k;
        p.pos.z += dz * k;
        p.prevPos = { ...p.pos };
        return false;
      },
      target,
      stepYd,
    );
    if (arrived) return true;
    await sleep(220);
  }
  problems.push(`NO-ARRIVAL ${target.name}: hop walk never reached the lamp`);
  return false;
}

async function waitLoaderGone(name) {
  await sleep(700);
  const gone = await page
    .waitForFunction(
      () => {
        const el = document.querySelector('#loading-screen');
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0.01;
      },
      { timeout: 240000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  if (!gone) problems.push(`LOADER-STUCK ${name}`);
  return gone;
}

const styles = Object.keys(sites).filter((s) => ONLY.length === 0 || ONLY.includes(s));
for (const style of styles) {
  const site = sites[style];
  // Stand back and slightly off the lamp so both the fixture and the pool of
  // ground it lights are in frame; look at it, not past it.
  const away = 7;
  const target = { name: style, x: site.x + away * 0.7, z: site.z + away * 0.7 };
  await hopTo(target);
  if (!(await waitLoaderGone(style))) continue;
  await page.evaluate(
    (s, lamp) => {
      const g = window.__game;
      const p = g.sim.player;
      p.pos.x = s.x;
      p.pos.z = s.z;
      p.prevPos = { ...p.pos };
      const yaw = Math.atan2(lamp.x - s.x, lamp.z - s.z);
      p.facing = yaw;
      g.input.camYaw = yaw;
      g.input.camPitch = 0.1;
      if ('camDist' in g.input) g.input.camDist = 9;
    },
    target,
    site,
  );
  await sleep(2200);
  await page.screenshot({ path: `${OUT}/${style}.png` });

  // Nameplates sit exactly over the lantern head in most vantages. Hide just
  // that overlay for the fixture crop: hiding #ui/#hud as well detaches the
  // page (the HUD relayouts off its own visibility), and the crop is centred on
  // the lamp anyway, well inside the screen-edge chrome.
  await page.evaluate(() => {
    const el = document.querySelector('#nameplates');
    if (el) el.style.visibility = 'hidden';
  });
  await sleep(400);

  // Close-up: project the fixture head to screen space and crop to it, rather
  // than guessing a camera pitch. A wide frame cannot answer "does the housing
  // blow out", which is the whole question this capture exists for.
  const head = await page.evaluate((lamp) => {
    const r = window.__game?.renderer;
    const cam = r?.camera;
    if (!cam) return null;
    const THREE = window.THREE ?? null;
    const v = { x: lamp.x, y: lamp.y + 4.6, z: lamp.z };
    // Project without needing the THREE global: use the camera matrices.
    cam.updateMatrixWorld();
    const m = cam.matrixWorldInverse.elements;
    const p = cam.projectionMatrix.elements;
    const ex = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
    const ey = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13];
    const ez = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
    const cw = -ez;
    if (cw <= 0.01) return null;
    const cx = p[0] * ex + p[8] * ez;
    const cy = p[5] * ey + p[9] * ez;
    void THREE;
    return {
      x: ((cx / cw) * 0.5 + 0.5) * window.innerWidth,
      y: (-(cy / cw) * 0.5 + 0.5) * window.innerHeight,
    };
  }, site);
  if (head) {
    const w = 520;
    const h = 420;
    const x = Math.max(0, Math.min(1280 - w, Math.round(head.x - w / 2)));
    const y = Math.max(0, Math.min(860 - h, Math.round(head.y - h / 2)));
    await page.screenshot({
      path: `${OUT}/${style}_head.png`,
      clip: { x, y, width: w, height: h },
    });
  } else {
    problems.push(`NO-PROJECTION ${style}: fixture head was behind the camera`);
  }

  // Chrome-free wide frame: this is the one that shows whether the ground under
  // the lamp is actually being lit, now that the draped decal pools are gone.
  await page.screenshot({ path: `${OUT}/${style}_scene.png` });
  await page.evaluate(() => {
    const el = document.querySelector('#nameplates');
    if (el) el.style.visibility = '';
  });
  console.log(`[shot] ${style}`);
}

fs.writeFileSync(`${OUT}/problems.txt`, problems.join('\n'));
console.log(problems.length ? `\nPROBLEMS:\n${problems.join('\n')}` : '\nno problems reported');
await browser.close();
