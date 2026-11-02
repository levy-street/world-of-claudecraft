// Screenshot rig for Gourdlight Eve's round 7: the broom takes five days. Hester's shop
// with the Emberbristle Broom priced in Emberwoven Sheaves (its row hovered, so the
// broom's tooltip shows the price), and the sheaf's own tooltip from the bags.
//
//   GAME_URL=http://127.0.0.1:5196 OUT=tmp/fase7 [SHOTS=a,b] [PRESET=4]
//     node scripts/gourdlight_fase7_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5196';
const OUT = process.env.OUT ?? 'tmp/fase7';
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
  async function hover(selectorCode) {
    const box = await ev(
      `(()=>{const r=${selectorCode};if(!r)return null;const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`,
    );
    if (!box) return false;
    await page.mouse.move(box.x, box.y);
    await frames(2, 250);
    return true;
  }

  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );
  await curtainDown();
  await chat('/dev season on');
  await frames(10, 400);
  await curtainDown();
  await chat('/daynight dusk');
  const keeper = await ev(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
  );
  if (!keeper) throw new Error('no keeper');
  const kx = keeper.x + Math.sin(keeper.f) * 3.5;
  const kz = keeper.z + Math.cos(keeper.f) * 3.5;
  const face = Math.atan2(keeper.x - kx, keeper.z - kz);
  await ev(
    `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${kx};p.pos.z=${kz};p.pos.y=g.sim.groundPos(${kx},${kz}).y;p.prevPos={...p.pos};p.facing=${face};p.prevFacing=${face};const i=g.input;i.camDist=5;i.camPitch=0.25;i.camYaw=${face + 0.3};})()`,
  );
  await frames(8, 250);
  // five sheaves (five days of Old Thatchgrin) and a few sweets
  await ev(
    `(()=>{const g=window.__game;g.sim.addItem('emberwoven_sheaf',5);g.sim.addItem('gourdlight_sweet',40);g.sim.targetEntity(${keeper.id});g.hud.questDialog?.open?.(${keeper.id});})()`,
  );
  await frames(3, 250);
  await ev(`(()=>{const b=document.querySelector('[data-vendor]');b&&b.click();})()`);
  await frames(3, 250);
  // the broom's row sits last on the shelf: bring it into view, then hover it
  await ev(
    `(()=>{const r=document.querySelector('[data-coach-item="reins_emberbristle_broom"]');r&&r.scrollIntoView({block:'center'});})()`,
  );
  await frames(2, 250);
  await hover(`document.querySelector('[data-coach-item="reins_emberbristle_broom"]')`);
  await shot('fase7-shop-broom-sheaves', 0);
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await frames(2, 250);
  // the sheaf's tooltip, from the bags
  await ev(`window.__game.hud.toggleBags()`);
  await frames(3, 250);
  const found = await hover(
    `(()=>{const img=[...document.querySelectorAll('img')].find(i=>/emberwoven_sheaf/.test(i.getAttribute('src')||'')&&i.getBoundingClientRect().width>0);return img?(img.closest('button,[data-focus-key]')||img):null;})()`,
  );
  if (!found) console.log('no sheaf slot found in the bags');
  await shot('fase7-sheaf-tooltip', 0);
} finally {
  await browser.close();
}
