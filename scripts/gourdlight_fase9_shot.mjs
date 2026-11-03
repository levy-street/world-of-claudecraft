// Screenshot rig for Gourdlight Eve's round 9: Hester's five toys in play, in Eastbrook's
// square at night (and her shelf with them on it). A second offline player stands in for
// the prank's target.
//
//   GAME_URL=http://127.0.0.1:5196 OUT=tmp/fase9 [SHOTS=a,b] [PRESET=4]
//     node scripts/gourdlight_fase9_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5196';
const OUT = process.env.OUT ?? 'tmp/fase9';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !ONLY || ONLY.has(name);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE:', m.text());
  });
  await page.evaluateOnNewDocument(`(() => {
    try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
  })()`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'priest',
    charName: 'Hollowmere',
    settleMs: 4000,
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GPU:', gpu);
  if (/swiftshader/i.test(String(gpu))) throw new Error('refusing to capture on SwiftShader');

  const ev = (code) => page.evaluate(code);
  async function chat(line) {
    await ev(
      `(()=>{const i=document.querySelector('#chat-input');i.value=${JSON.stringify(line)};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`,
    );
    await sleep(250);
  }
  async function frames(n = 6, gap = 250) {
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: `${OUT}/_frame.png` });
      await sleep(gap);
    }
  }
  async function curtainDown() {
    for (let i = 0; i < 160; i++) {
      const up = await ev(
        `(()=>{const l=document.querySelector('#loading-screen');if(!l)return false;const s=getComputedStyle(l);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0.05;})()`,
      );
      if (!up) return;
      await frames(1, 400);
    }
  }
  async function shot(name, settle = 0) {
    await curtainDown();
    if (settle) await frames(settle, 120);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('SHOT', name);
  }
  async function clearMobs(x, z, r = 90) {
    await ev(
      `(()=>{for(const e of window.__game.sim.entities.values()){if(e.kind==='mob'&&Math.hypot(e.pos.x-(${x}),e.pos.z-(${z}))<${r}){e.pos.x+=9000;e.prevPos={...e.pos};}}})()`,
    );
  }
  /** Stand at (x, z) facing `yaw`; the camera `dist` behind at `pitch`, turned by `turn`. */
  async function stand(x, z, yaw, dist = 6, pitch = 0.25, turn = 0) {
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${yaw};p.prevFacing=${yaw};const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${yaw + turn};})()`,
    );
  }
  /** Take every toy look off (between shots) and clear the toys' cooldowns. */
  async function resetToys() {
    await ev(
      `(()=>{const s=window.__game.sim;for(const e of s.entities.values()){if(e.kind!=='player')continue;e.auras=e.auras.filter(a=>!a.id.startsWith('gourdlight_toy_'));}for(const id of ['prankers_pumpkin','wanderwisp_lantern','sack_of_startled_bats','murmurwick_candle','gurglegreen_cauldron'])s.player.cooldowns.delete(id);})()`,
    );
  }
  const use = (id) => ev(`window.__game.sim.useItem(${JSON.stringify(id)})`);

  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );
  await chat('/dev god');
  await page.addStyleTag({ content: '.tut-card{display:none!important}' });
  await curtainDown();
  await chat('/dev season on');
  await frames(10, 400);
  await curtainDown();
  await ev(
    `(()=>{const s=window.__game.sim;for(const id of ['prankers_pumpkin','wanderwisp_lantern','sack_of_startled_bats','murmurwick_candle','gurglegreen_cauldron'])s.addItem(id,1);})()`,
  );

  // Hester's shelf, the five toys after the Jar of Mischief
  const keeper = await ev(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper'&&Math.abs(e.pos.z+110)<20);return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
  );
  if (!keeper) throw new Error('no keeper');
  if (want('fase9-shop-toys')) {
    await chat('/daynight dusk');
    const kx = keeper.x + Math.sin(keeper.f) * 3.5;
    const kz = keeper.z + Math.cos(keeper.f) * 3.5;
    const face = Math.atan2(keeper.x - kx, keeper.z - kz);
    await stand(kx, kz, face, 5, 0.25, 0.3);
    await frames(12, 300);
    await ev(
      `(()=>{const g=window.__game;g.sim.addItem('gourdlight_sweet',40);g.sim.targetEntity(${keeper.id});g.hud.questDialog?.open?.(${keeper.id});})()`,
    );
    await frames(3, 250);
    await ev(`(()=>{const b=document.querySelector('[data-vendor]');b&&b.click();})()`);
    await frames(4, 250);
    await shot('fase9-shop-toys');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await frames(2, 250);
  }

  // the square, west of her stall, at night
  await chat('/daynight midnight');
  const SX = keeper.x - 16;
  const SZ = keeper.z - 4;
  await clearMobs(SX, SZ, 120);

  if (want('fase9-prank-flight') || want('fase9-prank-head')) {
    await resetToys();
    // Pip stands 7 yd ahead of the thrower; the camera looks across them from the side
    await stand(SX, SZ, Math.PI / 2, 7.5, 0.16, -1.15);
    const pip = await ev(
      `(()=>{const s=window.__game.sim;const id=s.addPlayer('mage','Pip');const e=s.entities.get(id);e.pos.x=${SX}+7;e.pos.z=${SZ};e.pos.y=s.groundPos(e.pos.x,e.pos.z).y;e.prevPos={...e.pos};e.facing=-Math.PI/2;e.prevFacing=e.facing;return id;})()`,
    );
    await frames(10, 300);
    await ev(`window.__game.sim.player.targetId=${pip}`);
    await use('prankers_pumpkin');
    if (want('fase9-prank-flight')) await shot('fase9-prank-flight');
    await sleep(350);
    if (want('fase9-prank-splat')) await shot('fase9-prank-splat');
    await frames(6, 300);
    // closer on Pip's new head
    await stand(SX + 3.5, SZ + 1.5, Math.PI / 2, 4.2, 0.12, -0.6);
    await frames(6, 300);
    if (want('fase9-prank-head')) await shot('fase9-prank-head');
    await ev(
      `(()=>{const s=window.__game.sim;const e=s.entities.get(${pip});if(e){e.pos.x+=9000;e.prevPos={...e.pos};}})()`,
    );
  }

  if (want('fase9-lantern')) {
    await resetToys();
    await stand(SX, SZ, Math.PI * 0.75, 6.5, 0.2, 0.5);
    await frames(4, 250);
    await use('wanderwisp_lantern');
    await frames(14, 250);
    await shot('fase9-lantern');
  }

  if (want('fase9-bats')) {
    await resetToys();
    await stand(SX, SZ, Math.PI * 0.75, 8, 0.12, 0.4);
    await frames(4, 250);
    await use('sack_of_startled_bats');
    await sleep(1100);
    await shot('fase9-bats');
    await sleep(900);
    if (want('fase9-bats-scatter')) await shot('fase9-bats-scatter');
  }

  if (want('fase9-candle')) {
    await resetToys();
    await stand(SX, SZ, Math.PI * 0.75, 6, 0.32, 0.6);
    await frames(4, 250);
    await use('murmurwick_candle');
    await frames(16, 250);
    await shot('fase9-candle');
  }
  // (the play broom's shot retired with the toy in round 10: scripts/gourdlight_round10_shot.mjs)
} finally {
  await browser.close();
}
