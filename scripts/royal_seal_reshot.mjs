// Regenerate the Ancient Diary (royal_seal) evidence in docs/screenshots after
// the closed-cover fix (18b62cda6): the previously committed screenshots still
// showed the earlier open-tray model. Produces the same five images the PR
// body references: two isolated studio angles, a comparison sheet, and two
// in-game shots inside the Abandoned Crypt at its real x:7 z:76 spot.
// Offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE: ' + m.text());
});

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Scribe' });
console.log('booted:', booted);

// --- Isolated studio renders (light background, matching the PR's protocol) ---
// Reuses the game's already-loaded THREE classes (via the real renderer's live
// scene/camera/webgl instances) instead of a raw import('three'), which Vite
// only rewrites inside transformed source files, not in code eval'd in-page.
await page.evaluate(async () => {
  const { buildGroundQuestObject } = await import('/src/render/quest_objects.ts');
  const real = window.__game.renderer;
  const THREE_Scene = real.scene.constructor;
  const THREE_Camera = real.camera.constructor;
  let AmbientCtor = null;
  let DirectionalCtor = null;
  real.scene.traverse((o) => {
    if (!AmbientCtor && o.isLight && o.type === 'AmbientLight') AmbientCtor = o.constructor;
    if (!DirectionalCtor && o.isLight && o.type === 'DirectionalLight')
      DirectionalCtor = o.constructor;
  });

  const studioScene = new THREE_Scene();
  if (AmbientCtor) studioScene.add(new AmbientCtor(0xffffff, 3.0));
  if (DirectionalCtor) {
    const key = new DirectionalCtor(0xffffff, 3.2);
    key.position.set(3, 5, 4);
    studioScene.add(key);
    const fillLight = new DirectionalCtor(0xffffff, 1.6);
    fillLight.position.set(-3, 2, -3);
    studioScene.add(fillLight);
  }
  const { group } = buildGroundQuestObject('royal_seal', -1);
  studioScene.add(group);

  const studioCamera = new THREE_Camera(35, 900 / 700, 0.05, 50);
  window.__studio = { studioScene, studioCamera };
  // Tag the real WebGL canvas: the page has several stacked canvases (nameplate/FCT
  // overlays included), so a generic 'canvas' query can grab the wrong one.
  real.webgl.domElement.id = '__webgl_canvas';
});

async function studioShot(angleDeg, outPath) {
  // Read the framebuffer back via toDataURL in the SAME evaluate call as the
  // render: the game's WebGLRenderer is built without preserveDrawingBuffer
  // (renderer.ts), so the drawing buffer can be cleared by the browser's own
  // compositor before an out-of-process CDP screenshot gets to it. toDataURL
  // forces a synchronous, in-process readback of exactly what was just drawn.
  const dataUrl = await page.evaluate(
    ({ angleDeg }) => {
      const real = window.__game.renderer;
      const { studioScene, studioCamera } = window.__studio;
      const rad = (angleDeg * Math.PI) / 180;
      const dist = 2.2;
      studioCamera.position.set(Math.sin(rad) * dist, 1.4, Math.cos(rad) * dist);
      studioCamera.lookAt(0, 0.15, 0);

      const gl = real.webgl;
      gl.setClearColor(0xf2ede1, 1);
      gl.setScissorTest(false);
      gl.setViewport(0, 0, 900, 700);
      gl.setSize(900, 700, false);
      gl.render(studioScene, studioCamera);
      const url = gl.domElement.toDataURL('image/png');

      gl.setSize(window.innerWidth, window.innerHeight, false);
      studioCamera.aspect = 900 / 700;
      return url;
    },
    { angleDeg },
  );
  fs.writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

await studioShot(0, 'tmp/royal_seal_angle0.png');
await studioShot(100, 'tmp/royal_seal_angle100.png');

// Comparison sheet: reference icon + both freshly rendered angles, side by
// side. Embeds the two angle PNGs already captured above as data URLs rather
// than re-rendering, so there is exactly one render code path per angle.
const angle0DataUrl =
  'data:image/png;base64,' + fs.readFileSync('tmp/royal_seal_angle0.png').toString('base64');
const angle100DataUrl =
  'data:image/png;base64,' + fs.readFileSync('tmp/royal_seal_angle100.png').toString('base64');
await page.evaluate(
  ({ angle0DataUrl, angle100DataUrl }) => {
    const wrap = document.createElement('div');
    wrap.id = '__compare_wrap';
    wrap.style.cssText =
      'position:fixed;top:0;left:0;z-index:99999;display:flex;gap:16px;background:#f2ede1;padding:16px;';
    const mk = (src, label) => {
      const col = document.createElement('div');
      col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:280px;height:auto;border:1px solid #999;';
      const cap = document.createElement('div');
      cap.textContent = label;
      cap.style.cssText = 'font:14px sans-serif;color:#333;';
      col.appendChild(img);
      col.appendChild(cap);
      return col;
    };
    wrap.appendChild(mk('/ui/items/royal_seal.webp', 'reference icon'));
    wrap.appendChild(mk(angle0DataUrl, 'render, angle 0'));
    wrap.appendChild(mk(angle100DataUrl, 'render, angle 100'));
    document.body.appendChild(wrap);
  },
  { angle0DataUrl, angle100DataUrl },
);
await new Promise((r) => setTimeout(r, 300));
const wrapHandle = await page.$('#__compare_wrap');
await wrapHandle.screenshot({ path: 'tmp/royal_seal_comparison.png' });
await page.evaluate(() => document.getElementById('__compare_wrap')?.remove());

// --- In-game: the real Abandoned Crypt spot, x:7 z:76 ---
// Instance-local coordinates are relative to the instance's world-space origin
// (each dungeon slot gets its own offset, sim/instances/dungeons.ts
// instanceOriginOf); the door's local x:7 z:76 keystone spot has to be added to
// that origin, not used as an absolute world position.
const info = await page.evaluate(async () => {
  const { instanceOrigin } = await import('/src/sim/data.ts');
  const sim = window.__game.sim;
  const pid = sim.player.id ?? sim.player.entityId;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
  sim.player.level = 60;
  sim.enterDungeon('nythraxis_crypt', pid);
  const inst = sim.instances.find((i) => i.dungeonId === 'nythraxis_crypt');
  const origin = inst ? instanceOrigin(4, inst.slot) : { x: 0, z: 0 };
  window.__originX = origin.x;
  window.__originZ = origin.z;
  let obj = null;
  for (const e of sim.entities.values()) {
    if (e.objectItemId === 'royal_seal') obj = e;
  }
  const p = sim.entities.get(pid);
  p.pos.x = obj.pos.x;
  p.pos.z = obj.pos.z - 5;
  p.facing = Math.atan2(obj.pos.x - p.pos.x, obj.pos.z - p.pos.z);
  window.__game.input.camYaw = p.facing;
  window.__game.input.camDist = 9;
  window.__game.input.camPitch = 0.6;
  sim.targetEntity(obj.id);
  return {
    pos: { x: p.pos.x, z: p.pos.z },
    zone: sim.player.zone,
    origin,
    objPos: obj ? { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z } : null,
  };
});
console.log('in-game entry:', JSON.stringify(info));
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => {
    if (b.textContent?.trim() === 'Dismiss') b.click();
  });
});
await page.screenshot({ path: 'tmp/royal_seal_ingame.png' });

const closeInfo = await page.evaluate(() => {
  const sim = window.__game.sim;
  const pid = sim.player.id ?? sim.player.entityId;
  let obj = null;
  for (const e of sim.entities.values()) {
    if (e.objectItemId === 'royal_seal') obj = e;
  }
  const p = sim.entities.get(pid);
  p.pos.x = obj.pos.x - 2.6;
  p.pos.z = obj.pos.z;
  p.facing = Math.atan2(obj.pos.x - p.pos.x, obj.pos.z - p.pos.z);
  window.__game.input.camYaw = p.facing;
  window.__game.input.camDist = 6;
  window.__game.input.camPitch = 0.9;
  sim.targetEntity(obj.id);
  return { playerPos: { x: p.pos.x, z: p.pos.z }, objPos: { x: obj.pos.x, z: obj.pos.z } };
});
console.log('close-up:', JSON.stringify(closeInfo));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/royal_seal_ingame_2.png' });

await browser.close();
console.log('done');
