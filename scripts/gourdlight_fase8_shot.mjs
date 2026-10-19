// Screenshot rig for Gourdlight Eve's round 8: the pumpkin lanterns along the road
// between Fenbridge and Highwatch at night, Hester's shop with no pumpkin head on the
// shelf, and one of her rotating dailies offered beside the rounds.
//
//   GAME_URL=http://127.0.0.1:5196 OUT=tmp/fase8 [SHOTS=a,b] [PRESET=4]
//     node scripts/gourdlight_fase8_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5196';
const OUT = process.env.OUT ?? 'tmp/fase8';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
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
  async function shot(name, settle = 2) {
    if (ONLY && !ONLY.has(name)) return;
    await curtainDown();
    if (settle) await frames(settle, 120);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('SHOT', name);
  }
  /** Clear the wild mobs out of a shot (offline sim, screenshot only): moved far away. */
  async function clearMobs(x, z, r = 90) {
    await ev(
      `(()=>{for(const e of window.__game.sim.entities.values()){if(e.kind==='mob'&&Math.hypot(e.pos.x-${x},e.pos.z-${z})<${r}){e.pos.x+=9000;e.prevPos={...e.pos};}}})()`,
    );
  }
  /** Stand at (x, z) looking along yaw, the camera `dist` behind at `pitch`. */
  async function stand(x, z, yaw, dist = 5, pitch = 0.25) {
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${yaw};p.prevFacing=${yaw};const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${yaw};})()`,
    );
  }

  await ev(
    `(()=>{for(const b of document.querySelectorAll('button,[role=button],a,div')){if(b.children.length===0&&/^s*skip tutorials*$/i.test(b.textContent||''))b.click();}})()`,
  );
  // a level-one courier on the wild road: keep her standing for the shot
  await chat('/dev god');
  // the new-character tutorial card would cover the sky: hidden for the shots
  await page.addStyleTag({ content: '.tut-card{display:none!important}' });
  await curtainDown();
  await chat('/dev season on');
  await frames(10, 400);
  await curtainDown();
  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );

  // 1. the road lanterns between Fenbridge and Highwatch, at night, looking north up the
  //    road (the posts resolve from the live road; this stands on the road among them)
  if (!ONLY || ONLY.has('fase8-road-lanterns-night')) {
    await chat('/daynight midnight');
    // the resolved posts themselves (the sim module, served by the dev server)
    const posts = await ev(
      `(async()=>{const m=await import('/src/sim/seasonal_road_lanterns.ts');return m.seasonalRoadLanterns(window.__game.sim.cfg.seed).map(l=>({x:l.x,z:l.z,yaw:l.yaw,route:l.route}));})()`,
    );
    console.log('posts', posts.length);
    /** Stand on the road a few yards past post `i`, looking back along the road at it
     *  and the next posts beyond. */
    async function framePost(i, back, side) {
      const a = posts[i];
      const b = posts[i + 1] ?? posts[i - 1];
      const dirx = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z);
      const dirz = (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z);
      // the road point the post faces, then back along the road
      const rx = a.x + Math.sin(a.yaw) * 5 - dirx * back;
      const rz = a.z + Math.cos(a.yaw) * 5 - dirz * back;
      const yaw = Math.atan2(dirx, dirz) + side;
      await stand(rx, rz, yaw, 5, 0.1);
      await clearMobs(a.x, a.z, 120);
    }
    await framePost(5, 7, 0.25);
    await frames(24, 400);
    await shot('fase8-road-lanterns-night', 4);
    await chat('/daynight dusk');
    await framePost(9, 9, -0.2);
    await frames(20, 400);
    await shot('fase8-road-lanterns-dusk', 4);
  }

  // 2. Hester's shop (no pumpkin head on the shelf) and 3. her daily beside the rounds
  await chat('/daynight dusk');
  const keeper = await ev(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper'&&Math.abs(e.pos.z+110)<20);return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
  );
  if (!keeper) throw new Error('no keeper');
  const kx = keeper.x + Math.sin(keeper.f) * 3.5;
  const kz = keeper.z + Math.cos(keeper.f) * 3.5;
  const face = Math.atan2(keeper.x - kx, keeper.z - kz);
  await stand(kx, kz, face, 5, 0.25);
  await ev(`(()=>{const i=window.__game.input;i.camYaw=${face + 0.3};})()`);
  await frames(16, 300);
  await ev(
    `(()=>{const g=window.__game;g.sim.addItem('gourdlight_sweet',40);g.sim.targetEntity(${keeper.id});g.hud.questDialog?.open?.(${keeper.id});})()`,
  );
  await frames(3, 250);
  await ev(`(()=>{const b=document.querySelector('[data-vendor]');b&&b.click();})()`);
  await frames(4, 250);
  await shot('fase8-shop-no-head', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await frames(2, 250);
  // the Boo! errand pinned for the shot (the day picks one; /dev season daily pins it)
  await chat('/dev season daily q_gourdlight_daily_boo');
  await ev(`(()=>{const g=window.__game;g.hud.questDialog?.open?.(${keeper.id});})()`);
  await frames(3, 250);
  await shot('fase8-daily-offered', 0);
  await ev(
    `(()=>{const b=document.querySelector('[data-quest="q_gourdlight_daily_boo"]');b&&b.click();})()`,
  );
  await frames(3, 250);
  await shot('fase8-daily-boo', 0);
} finally {
  await browser.close();
}
