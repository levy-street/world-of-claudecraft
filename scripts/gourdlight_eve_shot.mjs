// Screenshot rig for Gourdlight Eve (the autumn seasonal event, src/sim/seasonal/):
// boots an offline character, opens the event with /dev season on, and shoots
// each dressed city by day and by night, the keeper's stall by day, dusk and
// night, a street of lit pumpkins seen from behind, the trick-or-treat gossip
// row and its answer, a trick, the keeper's shop and the worn pumpkin head on
// several bodies.
//
//   GAME_URL=http://localhost:5192 OUT=tmp/gourdlight [SHOTS=a,b] [PRESET=1] \
//     node scripts/gourdlight_eve_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader): the glow and the bloom
// are the point of these shots. PRESET seeds the graphics preset (1 is the
// lowest, the capture default; 4 is High for the art review).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5192';
const OUT = process.env.OUT ?? 'tmp/gourdlight';
const PRESET = Number(process.env.PRESET ?? 1);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  const text = m.text();
  if (/Gourdlight|seasonal|GL_|WebGL/i.test(text)) console.log('CONSOLE:', text);
});
await page.evaluateOnNewDocument(`(() => {
  try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
})()`);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Hollowmere',
  settleMs: 4000,
  gameBootTimeoutMs: 120000,
  selectorTimeoutMs: 60000,
});
if (!booted) throw new Error('offline world did not boot');
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GPU:', renderer);
if (/swiftshader/i.test(String(renderer))) throw new Error('refusing to capture on SwiftShader');

async function chat(line) {
  await page.evaluate(
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
/** Wait out the loading curtain (a teleport into an unstreamed zone raises it). */
async function curtainDown() {
  for (let i = 0; i < 120; i++) {
    const up = await page.evaluate(
      `(()=>{const l=document.querySelector('#loading-screen');if(!l)return false;const s=getComputedStyle(l);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0.05;})()`,
    );
    if (!up) return;
    await frames(1, 400);
  }
}
async function shot(name) {
  if (ONLY && !ONLY.has(name)) return;
  await curtainDown();
  await frames(4, 200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('SHOT', name);
}
/** Stand at (x, z) facing `facing`, the camera boom `camTurn` off the facing
 *  (0 = over the shoulder, PI = in front, looking back at the character). */
async function standAt(x, z, facing, dist = 9, pitch = 0.32, camTurn = 0) {
  await page.evaluate(
    `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${facing};p.prevFacing=${facing};
      const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${facing + camTurn};})()`,
  );
  await frames(8, 300);
}
/** Face from (x, z) toward (tx, tz). */
const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const wearHead = () =>
  page.evaluate(
    `(()=>{const g=window.__game;const p=g.sim.player;p.auras=p.auras.filter(a=>a.kind!=='seasonal_cosmetic');g.sim.addItem('carved_pumpkin_head',1);g.sim.useItem('carved_pumpkin_head');})()`,
  );

await page.evaluate(`window.__game.sim.setPlayerLevel(30)`);
// the new-character tutorial card never belongs in an art shot
await page.evaluate(
  `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
);
await chat('/dev season on');
await frames(10, 400);
// Wait for the event's kit to load and attach.
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(
    `(()=>{const r=window.__game.renderer;const s=r.scene.getObjectByName('seasonal-decor');return !!(s&&s.visible&&s.children.length);})()`,
  );
  if (ready) break;
  await frames(1, 300);
}

const views = {
  // Gameplay-camera vantages, each over a dressed stretch of its city: Eastbrook's
  // square round the statue and its lantern street, Fenbridge's market lane,
  // Highwatch's square.
  // the square from its south-west corner: the statue, the lanterned street and
  // the keeper's stall beyond
  eastbrook: { x: -22, z: -96, look: [-13.9, -101.9], dist: 14, pitch: 0.42 },
  eastbrook_street: { x: -38, z: -88, look: [-44, -96] },
  fenbridge: { x: -2, z: 284, look: [-1, 305] },
  highwatch: { x: 4, z: 670, look: [-10, 660] },
};
for (const [city, v] of Object.entries(views)) {
  for (const time of ['day', 'night']) {
    if (ONLY && !ONLY.has(`${city}_${time}`)) continue;
    await chat(`/daynight ${time === 'day' ? 'noon' : 'midnight'}`);
    await standAt(v.x, v.z, toward(v.x, v.z, v.look[0], v.look[1]), v.dist ?? 10, v.pitch ?? 0.3);
    await shot(`${city}_${time}`);
  }
}

// Lit pumpkins seen from BEHIND at night: the rind, the lid's cut and the halo
// carry the candle from every side, not only the carved face.
if (!ONLY || ONLY.has('pumpkins_behind_night')) {
  await chat('/daynight midnight');
  await standAt(-2, 296, Math.PI, 9, 0.35);
  await shot('pumpkins_behind_night');
}

// The keeper at her stall: the whole booth by day, dusk and night, then close.
const keeper = await page.evaluate(
  `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
);
if (keeper) {
  // out in front of the counter, a little to one side so the player never hides her
  const fx = Math.sin(keeper.f);
  const fz = Math.cos(keeper.f);
  const sx = keeper.x + fx * 9.8 - fz * 1.5;
  const sz = keeper.z + fz * 9.8 + fx * 1.5;
  for (const time of ['day', 'dusk', 'night']) {
    if (ONLY && !ONLY.has(`stall_${time}`)) continue;
    await chat(`/daynight ${time === 'day' ? 'noon' : time === 'dusk' ? 'dusk' : 'midnight'}`);
    await standAt(sx, sz, toward(sx, sz, keeper.x, keeper.z), 9, 0.36);
    await shot(`stall_${time}`);
  }
  await chat('/daynight dusk');
  const kx = keeper.x + fx * 4.2 + fz * 1.6;
  const kz = keeper.z + fz * 4.2 - fx * 1.6;
  await standAt(kx, kz, toward(kx, kz, keeper.x, keeper.z), 4.2, 0.22, 0.35);
  await shot('keeper');
  await page.evaluate(
    `(()=>{const g=window.__game;g.sim.addItem('gourdlight_sweet',60);g.sim.targetEntity(${keeper.id});g.hud.questDialog?.open?.(${keeper.id});})()`,
  );
  await shot('keeper_dialog');
  await page.evaluate(`(()=>{const b=document.querySelector('[data-vendor]');b&&b.click();})()`);
  await shot('shop');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

// Trick-or-treat at Trader Wilkes: the gossip row, then the answer.
const wilkes = await page.evaluate(
  `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='trader_wilkes');return e?{id:e.id,x:e.pos.x,z:e.pos.z}:null;})()`,
);
if (wilkes) {
  await standAt(wilkes.x + 2.5, wilkes.z, -Math.PI / 2, 6, 0.22, Math.PI / 2);
  await page.evaluate(
    `(()=>{const g=window.__game;g.sim.targetEntity(${wilkes.id});g.hud.questDialog?.open?.(${wilkes.id});})()`,
  );
  await shot('trick_or_treat_dialog');
  await page.evaluate(
    `(()=>{const b=document.querySelector('[data-trick-or-treat]');b&&b.click();})()`,
  );
  await shot('trick_or_treat_answer');
}
// A trick, forced: each harmless body in turn.
for (const trick of [
  'gourdlight_trick_bat',
  'gourdlight_trick_skeleton',
  'gourdlight_trick_fumes',
]) {
  if (ONLY && !ONLY.has(trick)) continue;
  await page.evaluate(
    `(()=>{const g=window.__game;const p=g.sim.player;p.auras=p.auras.filter(a=>a.kind!=='seasonal_cosmetic');p.auras.push({id:'${trick}',name:'trick',kind:'seasonal_cosmetic',value:0,remaining:20,duration:20,sourceId:p.id,school:'physical',undispellable:true});})()`,
  );
  await frames(14, 300);
  await shot(trick);
}
// The pumpkin head, worn: from the front by night and by day, from the side, on
// the male body, the female one, and a tall bearded build and a slight dark-skinned
// one (the head and its fit must hold on every body and face the builder makes).
await wearHead();
const BODIES = {
  male: 'null',
  female: "{gender:'female',skinHue:28,skinLight:0.5}",
  male_tall_bearded: "{gender:'male',bodyScale:1.05,headBeard:'long',skinHue:20,skinLight:0.62}",
  female_slight: "{gender:'female',bodyScale:0.95,skinHue:24,skinLight:0.28}",
};
for (const [body, look] of Object.entries(BODIES)) {
  if (ONLY && ![...ONLY].some((n) => n.startsWith(`pumpkin_head_${body}_`))) continue;
  // a body swap mid-wear: the pumpkin must follow onto the new body
  await page.evaluate(`(()=>{window.__game.sim.player.modularAppearance=${look};})()`);
  await frames(10, 300);
  await chat('/daynight midnight');
  await standAt(-14, -96, 0, 3.4, 0.1, Math.PI);
  await shot(`pumpkin_head_${body}_night`);
  await chat('/daynight noon');
  await frames(4);
  await shot(`pumpkin_head_${body}_day`);
  await standAt(-14, -96, 0, 3.4, 0.1, Math.PI / 2);
  await shot(`pumpkin_head_${body}_side`);
}
await browser.close();
