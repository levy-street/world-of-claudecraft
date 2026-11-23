// Screenshot rig for Old Thatchgrin, Gourdlight Eve's field boss (src/sim/seasonal/
// scarecrow*.ts): boots an offline character, stands him up with /dev scarecrow, and
// shoots his field by day and night, the boss beside the player for scale, each telegraph
// of his kit (the gourd's ring, its flight, the burst, the burning chaff), his call (crows,
// then strawlings), a strawling up close, and his collapse.
//
//   GAME_URL=http://127.0.0.1:5192 OUT=tmp/scarecrow [SHOTS=a,b] [PRESET=4] [MOBILE=1] [BEFORE=1] \
//     node scripts/gourdlight_scarecrow_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5192';
const OUT = process.env.OUT ?? 'tmp/scarecrow';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = MOBILE ? 844 : 1600;
const H = MOBILE ? 390 : 900;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: {
    width: W,
    height: H,
    ...(MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  const text = m.text();
  if (/scarecrow|Thatchgrin|seasonal|error|GL_/i.test(text)) console.log('CONSOLE:', text);
});
await page.evaluateOnNewDocument(`(() => {
  try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
})()`);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Strawbane',
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
async function curtainDown() {
  for (let i = 0; i < 160; i++) {
    const up = await page.evaluate(
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
const boss = () =>
  page.evaluate(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing,dead:e.dead,hp:e.hp,max:e.maxHp}:null;})()`,
  );
/** Put the player at (x, z) facing (tx, tz), the camera boom `camTurn` off the facing. */
async function standAt(x, z, tx, tz, dist = 12, pitch = 0.3, camTurn = 0, settle = 6) {
  const f = Math.atan2(tx - x, tz - z);
  await page.evaluate(
    `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${f};p.prevFacing=${f};
      const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${f + camTurn};})()`,
  );
  await frames(settle, 250);
}
async function engage() {
  const b = await boss();
  await page.evaluate(
    `(()=>{const g=window.__game;const s=g.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
  );
  await frames(4, 250);
}
async function freezeBossHp(frac) {
  const b = await boss();
  await page.evaluate(
    `(()=>{const b=window.__game.sim.entities.get(${b.id});b.hp=Math.floor(b.maxHp*${frac});})()`,
  );
}

await page.evaluate(`window.__game.sim.setPlayerLevel(20)`);
await page.evaluate(
  `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
);
await chat('/dev kit');
await chat('/dev immortal');
// BEFORE=1: the same meadow with the event closed (the PR's before shot), then stop.
if (process.env.BEFORE === '1') {
  await chat('/daynight noon');
  await chat('/dev tp 102 -26');
  await frames(12, 400);
  await curtainDown();
  await standAt(102, -26, 109.5, -39.9, 16, 0.32, 0, 8);
  await shot('before_field');
  await browser.close();
  process.exit(0);
}
await chat('/dev scarecrow');
// he holds still for the portraits (no pull), then the fight starts fresh
await chat('/dev noaggro');
await frames(16, 400);
await curtainDown();
// the decor kit (the field's ring and the gourd's model) loads on the event's open
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(
    `(()=>{const r=window.__game.renderer;const s=r.scene.getObjectByName('seasonal-decor');return !!(s&&s.visible&&s.children.length);})()`,
  );
  if (ready) break;
  await frames(1, 300);
}
let b = await boss();
if (!b) throw new Error('no Thatchgrin');
console.log('BOSS', JSON.stringify(b));
// where the player stands to look at him: out in front of him (he faces the town)
const front = (d, side = 0) => ({
  x: b.x + Math.sin(b.f) * d + Math.cos(b.f) * side,
  z: b.z + Math.cos(b.f) * d - Math.sin(b.f) * side,
});

// The field and the boss for scale, by day and by night, from behind the player.
for (const time of ['noon', 'dusk', 'midnight']) {
  await chat(`/daynight ${time}`);
  const p = front(12.5, 3);
  await standAt(p.x, p.z, b.x, b.z, 12, 0.16, 0, 10);
  await shot(`scale_${time}`);
  const w = front(30, 8);
  await standAt(w.x, w.z, b.x, b.z, 16, 0.32, 0, 6);
  await shot(`field_${time}`);
}
await chat('/daynight noon');
// Close: the head, the hat, the crows, looking up at him from just outside his reach.
{
  const p = front(10.5, 1.5);
  await standAt(p.x, p.z, b.x, b.z, 6, -0.38, 0.15, 8);
  await shot('closeup_head');
}

// Side by side: the player a few strides to his left, both seen from the front, so the
// heights compare at one distance from the camera.
await chat('/daynight noon');
{
  const p = { x: b.x + Math.cos(b.f) * 4.5, z: b.z - Math.sin(b.f) * 4.5 };
  const ahead = { x: p.x + Math.sin(b.f) * 10, z: p.z + Math.cos(b.f) * 10 };
  await standAt(p.x, p.z, ahead.x, ahead.z, 16, 0.08, Math.PI * 0.86, 8);
  await shot('scale_side');
  await chat('/daynight midnight');
  await frames(6, 300);
  await shot('scale_side_night');
}

// The fight.
await chat('/dev noaggro');
await chat('/dev scarecrow reset');
await frames(6, 300);
b = await boss();
await chat('/daynight dusk');
{
  const p = front(9, 2);
  await standAt(p.x, p.z, b.x, b.z, 15, 0.42, 0.25, 4);
}
await engage();
await frames(10, 250);
await shot('fight_melee');
// Kindled Gourd: ring, flight, burst, chaff. Step out to 14 yd so the arc reads.
{
  const p = front(14, 3);
  await standAt(p.x, p.z, b.x, b.z, 17, 0.5, 0.35, 2);
  await chat('/dev scarecrow gourd');
  await sleep(450);
  await shot('gourd_telegraph', 0);
  await sleep(650);
  await shot('gourd_flight', 0);
  await sleep(700);
  await shot('gourd_flight_late', 0);
  await sleep(420);
  await shot('gourd_burst', 0);
  await sleep(1500);
  await shot('chaff_burning', 0);
}
await chat('/daynight midnight');
{
  await chat('/dev scarecrow gourd');
  await sleep(2600);
  await shot('chaff_night', 0);
}
await chat('/daynight dusk');
// The calls: crows first, then strawlings.
await freezeBossHp(0.79);
await frames(2, 200);
await sleep(900);
await shot('call_crows_peak', 0);
await sleep(1200);
await shot('call_crows', 0);
await freezeBossHp(0.59);
await sleep(2400);
await shot('call_strawlings', 0);
// a strawling up close
{
  const s = await page.evaluate(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_strawling'&&!e.dead);return e?{x:e.pos.x,z:e.pos.z}:null;})()`,
  );
  if (s) {
    await standAt(s.x + 3, s.z + 3, s.x, s.z, 5, 0.12, 0.4, 4);
    await shot('strawling_close');
  }
}
// The collapse.
{
  const p = front(12, 4);
  await standAt(p.x, p.z, b.x, b.z, 14, 0.25, 0.2, 2);
  await page.evaluate(
    `(()=>{const g=window.__game;const s=g.sim;const b=s.entities.get(${b.id});s.dealDamage(s.player,b,b.hp+50,false,'physical','Finish','hit',true);})()`,
  );
  await sleep(700);
  await shot('death_sag', 0);
  await sleep(900);
  await shot('death_fold', 0);
  await sleep(1500);
  await shot('death_heap', 0);
  await sleep(2500);
  await shot('death_corpse');
}
await browser.close();
