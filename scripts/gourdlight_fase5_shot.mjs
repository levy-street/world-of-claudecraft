// Screenshot rig for Gourdlight Eve's round 5: the thinned city straw (the same vantages
// as gourdlight_eve_shot.mjs, for a before/after), the indoor candle-lit pumpkins, the
// candy shelf at Hester's shop, the right-click cancel of a costume, and Old Thatchgrin's
// Thatchbound (the cast, the puppets on their strings, their eyes and sigils).
//
//   GAME_URL=http://127.0.0.1:5192 OUT=tmp/fase5 [SECTIONS=decor,interior,shop,cancel,puppet]
//     [SHOTS=a,b] [PRESET=4] node scripts/gourdlight_fase5_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5192';
const OUT = process.env.OUT ?? 'tmp/fase5';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'decor,interior,shop,cancel,puppet').split(',').filter(Boolean),
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

  if (SECTIONS.has('decor')) {
    // the same vantages as gourdlight_eve_shot.mjs (its shots are this round's "before")
    const views = {
      eastbrook: { x: -22, z: -96, look: [-13.9, -101.9], dist: 14, pitch: 0.42 },
      eastbrook_street: { x: -38, z: -88, look: [-44, -96] },
      fenbridge: { x: -2, z: 284, look: [-1, 305] },
      highwatch: { x: 4, z: 670, look: [-10, 660] },
    };
    await chat('/daynight noon');
    for (const [city, v] of Object.entries(views)) {
      await standAt(v.x, v.z, v.look[0], v.look[1], v.dist ?? 10, v.pitch ?? 0.3, 0, 8);
      await shot(`decor_${city}_day`);
    }
    await chat('/daynight midnight');
    await standAt(-22, -96, -13.9, -101.9, 14, 0.42, 0, 8);
    await shot('decor_eastbrook_night');
  }

  if (SECTIONS.has('interior')) {
    const spots = await ev(`(async()=>{
      const m = await import('/src/sim/seasonal_interior_pumpkins.ts');
      const t = await import('/src/sim/authored_town_registry.ts');
      const seed = window.__game.sim.cfg.seed;
      return m.interiorPumpkins(seed).map((p) => {
        const b = t.AUTHORED_TOWN_BUILDINGS.find((h) => h.id === p.buildingId);
        return { id: p.buildingId, x: p.x, y: p.y, z: p.z, cx: b.reach.center.x, cz: b.reach.center.z };
      });
    })()`);
    console.log('interior pumpkins', JSON.stringify(spots));
    await chat('/daynight midnight');
    for (const s of spots) {
      // stand two yards from it, toward the room's middle, looking at it
      const dx = s.cx - s.x;
      const dz = s.cz - s.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      const px = s.x + (dx / d) * 2.4;
      const pz = s.z + (dz / d) * 2.4;
      await standAt(px, pz, s.x, s.z, 3.6, 0.32, 0.5, 10);
      await shot(`interior_${s.id}`);
    }
  }

  if (SECTIONS.has('shop')) {
    const keeper = await ev(
      `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
    );
    if (keeper) {
      await chat('/daynight dusk');
      const kx = keeper.x + Math.sin(keeper.f) * 3.5;
      const kz = keeper.z + Math.cos(keeper.f) * 3.5;
      await standAt(kx, kz, keeper.x, keeper.z, 5, 0.25, 0.3, 8);
      await ev(
        `(()=>{const g=window.__game;g.sim.addItem('gourdlight_sweet',40);g.sim.targetEntity(${keeper.id});g.hud.questDialog?.open?.(${keeper.id});})()`,
      );
      await frames(3, 250);
      await ev(`(()=>{const b=document.querySelector('[data-vendor]');b&&b.click();})()`);
      await frames(3, 250);
      await shot('shop_candies');
      // hover the first candy row for its tooltip
      const box = await ev(
        `(()=>{const rows=[...document.querySelectorAll('.vendor-row, [data-vendor-item], .vendor-item')];const r=rows.find(e=>/Toffee|Brittle|Chew|Fudge|Mint/.test(e.textContent||''));if(!r)return null;const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`,
      );
      if (box) {
        await page.mouse.move(box.x, box.y);
        await frames(2, 250);
        await shot('shop_candy_tooltip', 0);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
  }

  if (SECTIONS.has('cancel')) {
    await chat('/daynight noon');
    await standAt(-20, -100, -14, -100, 6, 0.2, Math.PI, 6);
    await ev(
      `(()=>{const g=window.__game;g.sim.addItem('haunting_draught',1);g.sim.useItem('haunting_draught');})()`,
    );
    await frames(8, 300);
    await shot('cancel_before');
    const icon = await ev(
      `(()=>{const el=document.querySelector('#buff-bar .buff.cancelable');if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`,
    );
    if (icon) {
      await page.mouse.move(icon.x, icon.y);
      await frames(2, 250);
      await shot('cancel_hover', 0);
      await page.mouse.click(icon.x, icon.y, { button: 'right' });
      await frames(8, 300);
      await shot('cancel_after');
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
      // in front of him, to one side, so the strings, the puppets and he all read
      const p = {
        x: b.x + Math.sin(b.f) * 7 + Math.cos(b.f) * 3,
        z: b.z + Math.cos(b.f) * 7 - Math.sin(b.f) * 3,
      };
      await standAt(p.x, p.z, b.x, b.z, 15, 0.38, 0.9, 4);
      await ev(
        `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);b.aggroTargetId=s.player.id;})()`,
      );
      await frames(4, 200);
      // keep his rain and calls out of these frames: only the strings
      await ev(
        `(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;if(k){k.rainTimer=999;k.callsFired=99;k.rain=[];k.chaff=[];}})()`,
      );
      await chat('/dev scarecrow puppet');
      await sleep(1200);
      await shot(`puppet_cast_${time}`, 0);
      await sleep(1800);
      await shot(`puppet_land_${time}`, 0);
      await sleep(1500);
      await shot(`puppet_held_${time}`, 0);
      await sleep(1500);
      await shot(`puppet_swing_${time}`, 0);
    }
    // close on each puppet body: a fresh cast, then the camera over each victim's shoulder
    await chat('/dev scarecrow puppet');
    await sleep(3600);
    const pups = await ev(
      `(()=>{return [...window.__game.sim.entities.values()].filter(e=>e.auras&&e.auras.some(a=>a.id==='thatchbound_strawling'||a.id==='thatchbound_crow')).map(e=>({x:e.pos.x,z:e.pos.z,crow:e.auras.some(a=>a.id==='thatchbound_crow')}));})()`,
    );
    for (const pp of pups) {
      const name = pp.crow ? 'puppet_close_crow' : 'puppet_close_strawling';
      // stand five yards off it (it walks to you: you are its nearest friend), look at it
      const sx = pp.x + 7;
      const sz = pp.z + 2;
      await standAt(sx, sz, pp.x, pp.z, 7.5, 0.2, 0.45, 2);
      await shot(name, 2);
      await sleep(900);
      await shot(`${name}_2`, 0);
    }
  }
} finally {
  await browser.close();
}
