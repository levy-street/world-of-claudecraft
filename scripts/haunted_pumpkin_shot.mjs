// Actual GLB, pickup and personal-lighting evidence on desktop and touch.
// Run with Vite on GAME_URL (default http://localhost:5192).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const out = process.env.OUT ?? 'docs/screenshots/haunted-pumpkins';
const mobile = process.env.MOBILE === '1';
const label = mobile ? 'mobile-landscape' : 'desktop';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: mobile
    ? { width: 844, height: 390, isMobile: true, hasTouch: true }
    : { width: 1600, height: 900 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (/entry-guard.*done|failed|WebGL/i.test(m.text())) console.log('Console:', m.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(
    (preset) => {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    },
    Number(process.env.PRESET ?? 2),
  );
  async function curtainDown() {
    for (let i = 0; i < 180; i++) {
      const up = await page.evaluate(() => {
        const l = document.querySelector('#loading-screen');
        if (!l) return false;
        const s = getComputedStyle(l);
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
      });
      if (!up) return;
      await page.screenshot();
      await sleep(400);
    }
    throw new Error('Loading curtain did not clear');
  }
  await page.goto(process.env.GAME_URL ?? 'http://localhost:5192', {
    waitUntil: 'networkidle0',
    timeout: 90000,
  });
  if (
    !(await enterOfflineGame(page, {
      charName: 'Pumpkinwatch',
      settleMs: 4000,
      gameBootTimeoutMs: 150000,
      selectorTimeoutMs: 90000,
    }))
  )
    throw new Error('Offline world did not boot');
  await curtainDown();
  console.log('World ready');
  await page.evaluate((phase) => {
    const { sim } = window.__game;
    sim.chat('/dev season on');
    sim.chat('/dev god');
    sim.setPlayerLevel(30);
    const chat = document.querySelector('#chat-input');
    chat.value = `/daynight ${phase}`;
    chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, process.env.PHASE ?? 'day');
  await page.waitForFunction(
    () =>
      [...window.__game.sim.entities.values()].some(
        (entity) => entity.templateId === 'ground_haunted_pumpkin',
      ),
    { timeout: 30000 },
  );
  const pumpkinId = await page.evaluate(() => {
    const { sim, input } = window.__game;
    const pumpkin = sim.entities.get(-910001);
    const player = sim.player;
    player.pos = { ...sim.groundPos(pumpkin.pos.x + 2.3, pumpkin.pos.z + 1.4) };
    player.prevPos = { ...player.pos };
    player.facing = player.prevFacing = 0;
    input.camDist = 5;
    input.camPitch = 0.6;
    input.camYaw = Math.PI;
    return pumpkin.id;
  });
  await page.waitForFunction(
    (id) => {
      const view = window.__game.renderer.views.get(id);
      return view?.group.visible && view?.objectMesh;
    },
    { timeout: 90000 },
    pumpkinId,
  );
  await curtainDown();
  await sleep(3000);
  console.log('Pumpkin view ready');
  await page.screenshot({ path: `${out}/${label}-before.png` });
  // Use the real screen picker and click path rather than granting discovery.
  const point = await page.evaluate((id) => {
    const { sim, renderer } = window.__game;
    const entity = sim.entities.get(id);
    const object = renderer.views.get(id).objectMesh;
    const mesh = object.children.find((child) => child.isMesh);
    mesh.geometry.computeBoundingBox();
    const p = renderer.camera.position.clone();
    mesh.geometry.boundingBox.getCenter(p);
    mesh.localToWorld(p);
    const center = { x: p.x, y: p.y, z: p.z };
    p.project(renderer.camera);
    const x = ((p.x + 1) * innerWidth) / 2,
      y = ((1 - p.y) * innerHeight) / 2;
    return {
      x,
      y,
      center,
      pos: entity.pos,
      picked: renderer.picking.pick(x, y),
      parts: object.children.map((m) => ({
        name: m.material?.name,
        visible: m.visible,
        position: m.position.toArray(),
        bounds: m.geometry?.boundingBox,
      })),
    };
  }, pumpkinId);
  console.log('Click', point);
  if (point.picked !== pumpkinId)
    throw new Error(`Screen picker selected ${point.picked}, expected ${pumpkinId}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.waitForFunction(() => window.__game.sim.hauntedPumpkinsFound.length === 1, {
    timeout: 10000,
  });
  console.log('Discovery credited');
  await page.screenshot({ path: `${out}/${label}-ignition.png` });
  await sleep(1500);
  await page.screenshot({ path: `${out}/${label}-after.png` });
  const result = await page.evaluate(() => ({
    found: window.__game.sim.hauntedPumpkinsFound,
    tracker: document.querySelector('#qt-body')?.textContent,
  }));
  if (mobile) {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await sleep(1500);
    await page.screenshot({ path: `${out}/mobile-portrait-after.png` });
  }
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) throw new Error('Browser reported page errors');
} finally {
  await browser.close();
}
