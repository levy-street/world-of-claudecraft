// Screenshot rig for Gourdlight Eve's round 6: Thatchbound without its marionette strings
// (the cast sigils, the held puppets' eyes, sigil and swirl), the Eastbrook street where a
// garland used to cross the road, the three chapels left undressed, and an overview of
// each city's spread-out dressing.
//
//   GAME_URL=http://127.0.0.1:5196 OUT=tmp/fase6 [SECTIONS=garland,chapel,overview,puppet]
//     [SHOTS=a,b] [PRESET=4] node scripts/gourdlight_fase6_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5196';
const OUT = process.env.OUT ?? 'tmp/fase6';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'garland,chapel,overview,puppet').split(',').filter(Boolean),
);
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
  page.on('console', (m) => {
    const text = m.text();
    if (/error|GL_|scarecrow|seasonal|thatch/i.test(text)) console.log('CONSOLE:', text);
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
  async function shot(name, settle = 2) {
    if (ONLY && !ONLY.has(name)) return;
    await curtainDown();
    if (settle) await frames(settle, 120);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('SHOT', name);
  }
  /** Put the player at (x, z) facing (tx, tz), the camera boom `camTurn` off the facing. */
  async function standAt(x, z, tx, tz, dist = 12, pitch = 0.3, camTurn = 0, settle = 6) {
    const f = Math.atan2(tx - x, tz - z);
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${f};p.prevFacing=${f};
        const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${f + camTurn};})()`,
    );
    await frames(settle, 250);
  }

  await ev(`window.__game.sim.setPlayerLevel(20)`);
  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );
  await chat('/dev season on');
  await frames(10, 400);
  for (let i = 0; i < 60; i++) {
    const ready = await ev(
      `(()=>{const r=window.__game.renderer;const s=r.scene.getObjectByName('seasonal-decor');return !!(s&&s.visible&&s.children.length);})()`,
    );
    if (ready) break;
    await frames(1, 300);
  }

  if (SECTIONS.has('garland')) {
    // the owner's screenshot: Eastbrook, standing at (-48, -95) looking west down the
    // path, where a garland used to run diagonally over it
    for (const time of ['dusk', 'midnight']) {
      await chat(`/daynight ${time}`);
      await standAt(-56, -92, -20, -100, 16, 0.55, 0, 8);
      await shot(`garland_eastbrook_${time}`);
    }
  }

  if (SECTIONS.has('chapel')) {
    const chapels = await ev(`(async()=>{
      const t = await import('/src/sim/authored_town_registry.ts');
      return t.AUTHORED_TOWN_BUILDINGS.filter((b) => b.kind === 'chapel').map((b) => ({
        id: b.id, x: b.position.x, z: b.position.z, door: b.frontStandingPoint,
      }));
    })()`);
    console.log('chapels', JSON.stringify(chapels));
    await chat('/daynight dusk');
    for (const c of chapels) {
      // out in front of the door, looking back at the chapel, wide
      const dx = c.door.x - c.x;
      const dz = c.door.z - c.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      const px = c.door.x + (dx / d) * 9;
      const pz = c.door.z + (dz / d) * 9;
      // the boom swings off the door axis so it never clips a neighbouring house
      if (c.id === 'fenbridge_lantern_chapel') {
        // a lane of houses faces its door: shoot from its flank, over the square
        await standAt(c.door.x + 2, c.door.z, c.x, c.z, 16, 0.75, -1.6, 8);
        await shot(`chapel_${c.id}`);
        continue;
      }
      await standAt(px, pz, c.x, c.z, 20, 0.85, 0, 8);
      await shot(`chapel_${c.id}`);
    }
  }

  if (SECTIONS.has('overview')) {
    const hubs = await ev(`(async()=>{
      const d = await import('/src/sim/data.ts');
      const z = d.getActiveWorldContent().zones;
      return ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'].map((id) => {
        const h = z.find((q) => q.id === id).hub;
        return { id, x: h.x, z: h.z };
      });
    })()`);
    await chat('/daynight dusk');
    for (const h of hubs) {
      // straight over the square, looking down: the whole town's dressing at once
      // (Fenbridge's square is a narrow lane: down its length from the south instead)
      if (h.id === 'mirefen_marsh')
        await standAt(h.x + 4, h.z - 14, h.x + 4, h.z + 10, 30, 0.95, 0, 10);
      else await standAt(h.x, h.z + 2, h.x, h.z, 38, 1.3, 0, 10);
      await shot(`overview_${h.id}`);
    }
  }

  if (SECTIONS.has('puppet')) {
    const boss = () =>
      ev(
        `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
      );
    await chat('/dev scarecrow');
    await frames(16, 400);
    await curtainDown();
    await chat('/dev god');
    let b = await boss();
    if (!b) throw new Error('no Thatchgrin');
    for (const time of ['dusk', 'midnight']) {
      await chat('/dev scarecrow reset');
      await frames(4, 250);
      b = await boss();
      await chat(`/daynight ${time}`);
      const p = {
        x: b.x + Math.sin(b.f) * 7 + Math.cos(b.f) * 3,
        z: b.z + Math.cos(b.f) * 7 - Math.sin(b.f) * 3,
      };
      await standAt(p.x, p.z, b.x, b.z, 15, 0.38, 0.9, 4);
      await ev(
        `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);b.aggroTargetId=s.player.id;})()`,
      );
      await frames(4, 200);
      // keep his rain and calls out of these frames: only the curse
      await ev(
        `(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;if(k){k.rainTimer=999;k.callsFired=99;k.rain=[];k.chaff=[];}})()`,
      );
      await chat('/dev scarecrow puppet');
      await sleep(1500);
      await shot(`puppet_cast_${time}`, 0);
      await sleep(1500);
      await shot(`puppet_land_${time}`, 0);
      await sleep(1500);
      await shot(`puppet_held_${time}`, 0);
    }
    await chat('/dev scarecrow puppet');
    await sleep(3600);
    const pups = await ev(
      `(()=>{return [...window.__game.sim.entities.values()].filter(e=>e.auras&&e.auras.some(a=>a.id==='thatchbound_strawling'||a.id==='thatchbound_crow')).map(e=>({x:e.pos.x,z:e.pos.z,crow:e.auras.some(a=>a.id==='thatchbound_crow')}));})()`,
    );
    for (const pp of pups) {
      const name = pp.crow ? 'puppet_close_crow' : 'puppet_close_strawling';
      await standAt(pp.x + 7, pp.z + 2, pp.x, pp.z, 7.5, 0.2, 0.45, 2);
      await shot(name, 2);
    }
  }
} finally {
  await browser.close();
}
