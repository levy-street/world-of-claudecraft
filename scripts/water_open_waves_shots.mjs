// Open-water wave verification tour: boots the offline game at ultra and
// captures the sea across the zone-plane / horizon-apron rect edge at golden
// hour and at midday, from a clifftop-height and an aerial camera, looking
// into the sun (where a mismatched shading field shows up as a hard straight
// cut through the glint). Logs any shader/page error. Needs `npm run dev`
// (GAME_URL). PNGs land in tmp/ under the SHOT_PREFIX name.
//
// The seam under test: no zone covers x in [-540, -180] at z in [-180, 180],
// so the west column there is bare apron and x = -180 is a live plane/apron
// boundary, with the whole southern coast z = -180 as a second one.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'waves';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

// Real GPU by default (SOFTWARE_GL=1 falls back to SwiftShader): an ultra-tier
// water shader over a full screen of sea is minutes per frame in software, and
// the glint field this tour exists to inspect needs a faithful rasterizer.
const software = process.env.SOFTWARE_GL === '1';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: software,
  protocolTimeout: 900000,
  args: [
    '--window-size=1600,900',
    '--ignore-gpu-blocklist',
    ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
let sawError = false;
page.on('pageerror', (e) => {
  sawError = true;
  console.log('PAGEERROR:', e.message);
});
page.on('console', (m) => {
  const t = m.text();
  if (/error|invalid|failed to compile|THREE\.WebGLProgram/i.test(t)) {
    sawError = true;
    console.log('CONSOLE:', t.slice(0, 900));
  }
});

await page.goto(`${URL}/?gfx=ultra`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await sleep(800);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(300);
await page.evaluate(() => {
  const el = document.querySelector('#char-name');
  if (el) {
    el.value = 'Swimmer';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.evaluate(() => document.querySelector('.mini-class[data-class="warrior"]')?.click());
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 240000 });
await sleep(3000);

const clearOverlays = () =>
  page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent ?? '').trim().toLowerCase();
      if (t === 'confirm' || t === 'skip tutorial' || t === 'dismiss') b.click();
    }
    document.querySelector('.tut-skip')?.click();
    for (const el of document.querySelectorAll('.mail-banner, .toast, .announce')) el.remove();
  });
await clearOverlays();

const chat = (line) =>
  page.evaluate((text) => {
    const el = document.querySelector('#chat-input');
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, line);

/** Holds the body at a fixed point every frame so an aerial camera can hover. */
const pin = (spot) =>
  page.evaluate((s) => {
    clearInterval(window.__pin);
    window.__pin = setInterval(() => {
      const p = window.__game.sim.player;
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = s.x;
      p.pos.y = s.y;
      p.pos.z = s.z;
      p.prevPos = { x: s.x, y: s.y, z: s.z };
      p.vy = 0;
      p.onGround = false;
    }, 16);
  }, spot);

/** Horizontal bearing of the live key light, so a shot can look into it. */
const sunYaw = () =>
  page.evaluate(() => {
    const water = window.__game.renderer.scene.getObjectByName('water');
    const mesh = water?.children.find((c) => c.material?.uniforms?.uSunDir);
    const d = mesh?.material.uniforms.uSunDir.value;
    return d ? Math.atan2(d.x, d.z) : 0;
  });

/** Leaves only the WebGL canvas on screen, so the sea fills the comparison. */
const hideHud = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    let root = canvas;
    while (root && root.parentElement !== document.body) root = root.parentElement;
    for (const el of [...document.body.children]) if (el !== root) el.style.display = 'none';
  });

async function shoot(name, spot) {
  await pin(spot);
  await sleep(400);
  const yaw = spot.intoSun ? await sunYaw() : (spot.yaw ?? 0);
  await page.evaluate(
    (y, pitch) => {
      const g = window.__game;
      g.sim.player.facing = y;
      g.input.camYaw = y;
      if (pitch !== undefined) g.input.camPitch = pitch;
    },
    yaw,
    spot.pitch,
  );
  await sleep(spot.settleMs ?? 3500);
  await clearOverlays();
  // Re-assert the phase: the cycle keeps running between shots, and the whole
  // point of the golden pass is a LOW sun.
  await chat(spot.phase);
  await sleep(9000); // the day/night grade lerps in
  await hideHud();
  await sleep(400);
  await page.screenshot({ path: `tmp/${PREFIX}_${name}.png` });
  console.log(name, `yaw=${yaw.toFixed(2)}`, JSON.stringify(spot));
}

for (const [phaseName, phase] of [
  ['golden', '/daynight 0.28'],
  ['day', '/daynight day'],
]) {
  await chat(phase);
  await sleep(12000); // the day/night grade lerps in
  // Clifftop height off the Eastbrook Vale south-west corner, looking into the
  // sun across the x = -180 and z = -180 plane/apron edges.
  await shoot(`${phaseName}_1_clifftop_sun`, {
    x: -150,
    y: 46,
    z: -140,
    pitch: 0.1,
    intoSun: true,
    phase,
  });
  // Aerial over the same corner, pitched down so both rect edges cross frame.
  await shoot(`${phaseName}_2_aerial_corner`, {
    x: -120,
    y: 150,
    z: -110,
    yaw: -2.356,
    pitch: 0.5,
    phase,
  });
  // Straight out over the open sea to the west: pure apron, the sheet that
  // used to carry no travelling waves at all.
  await shoot(`${phaseName}_3_open_sea`, {
    x: -260,
    y: 60,
    z: 20,
    yaw: -1.571,
    pitch: 0.08,
    phase,
  });
  // Low over the x = -180 plane / apron boundary, looking along it into the
  // sun: the exact geometry the reported straight cut ran along.
  await shoot(`${phaseName}_4_seam_line`, {
    x: -178,
    y: 24,
    z: 60,
    yaw: -3.0,
    pitch: 0.02,
    phase,
  });
  // Straight down on a waterline: where the surface meets the sand, which is
  // where the shore film and any residual shore tearing both show. Two flat
  // shelves (the film has the most room to read on those), then the spot where
  // the apron beneath interpolates DEEPEST under a shoreline, which is the
  // adversarial case for fading the plane's alpha out over the sand.
  await shoot(`${phaseName}_5_waterline_galecrest`, {
    x: 462,
    y: 11,
    z: 480,
    yaw: 0,
    pitch: 1.45,
    phase,
  });
  await shoot(`${phaseName}_6_waterline_drakelands`, {
    x: 270,
    y: 11,
    z: 1862,
    yaw: 0,
    pitch: 1.45,
    phase,
  });
  await shoot(`${phaseName}_7_waterline_apron_worst`, {
    x: -286,
    y: 11,
    z: 182,
    yaw: 0,
    pitch: 1.45,
    phase,
  });
}

console.log(sawError ? 'ERRORS SEEN (see log above)' : 'no page/shader errors');
await page.evaluate(() => clearInterval(window.__pin));
await browser.close();
