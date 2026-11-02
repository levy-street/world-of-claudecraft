// Screenshot rig for Gourdlight Eve's polish pass (phase 4): the strawling in the target
// frame, Hester's Fenbridge stall and the camera round it, a strawling's swing, the corn
// shocks, Old Thatchgrin's coat up close, Boar Meadow's wildlife round his field, his two
// swings at their hit frame, and the Emberbristle Broom on the move.
//
//   GAME_URL=http://127.0.0.1:5193 OUT=tmp/fase4 [SECTIONS=portrait,stall,...] [SHOTS=a,b]
//     [PRESET=4] [MOBILE=1] node scripts/gourdlight_fase4_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5193';
const OUT = process.env.OUT ?? 'tmp/fase4';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'portrait,stall,strawling,corn,coat,meadow,attacks,broom')
    .split(',')
    .filter(Boolean),
);
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
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (/error|GL_|broom|scarecrow|seasonal/i.test(text)) console.log('CONSOLE:', text);
  });
  await page.evaluateOnNewDocument(`(() => {
    try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
  })()`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Gourdrider',
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
  async function shot(name, settle = 2, clip = undefined) {
    if (ONLY && !ONLY.has(name)) return;
    await curtainDown();
    if (settle) await frames(settle, 120);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
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
  async function camera(dist, pitch, turn) {
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=p.facing+${turn};})()`,
    );
  }
  const find = (tpl) =>
    ev(
      `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='${tpl}'&&!e.dead);return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
    );
  /** The clip a view plays now, and how far into it (seconds). */
  const clipOf = (id) =>
    ev(
      `(()=>{const r=window.__game.renderer;const v=r.views.get(${id});const c=v&&v.visual&&v.visual.current;return c&&c.getClip?{name:c.getClip().name,t:c.time}:null;})()`,
    );
  /** Wait for a view to reach `at` seconds into a clip named `clip`, then freeze the mobs. */
  async function catchClip(id, clip, at, tries = 400) {
    for (let i = 0; i < tries; i++) {
      // caught and pinned in one round trip, so the pose cannot run on past the frame
      const hit = await ev(
        `(()=>{const r=window.__game.renderer;const v=r.views.get(${id});const c=v&&v.visual&&v.visual.current;if(!c||!c.getClip||!c.getClip().name.includes('${clip}'))return false;if(c.time<${at - 0.25})return false;const m=v.visual.mixer;c.time=${at};if(m){m.update(0);m.timeScale=0;}return true;})()`,
      );
      if (hit) return true;
      await sleep(10);
    }
    return false;
  }
  /** A free camera at `pos` looking at `at` (the renderer's editor pose); null hands it back. */
  async function freeCam(pos, at) {
    await ev(
      pos
        ? `(()=>{const r=window.__game.renderer;const v=r.camera.position;r.editorCam={pos:v.clone().set(${pos.x},${pos.y},${pos.z}),target:v.clone().set(${at.x},${at.y},${at.z})};})()`
        : `(()=>{window.__game.renderer.editorCam=null;})()`,
    );
  }
  const groundY = (x, z) => ev(`window.__game.sim.groundPos(${x},${z}).y`);
  /** A point `d` ahead of an entity facing `f`, `s` to its right, at height `h` over the ground. */
  async function around(e, d, s, h) {
    const x = e.x + Math.sin(e.f) * d + Math.cos(e.f) * s;
    const z = e.z + Math.cos(e.f) * d - Math.sin(e.f) * s;
    return { x, y: (await groundY(x, z)) + h, z };
  }
  /** Pin a view's playing clip on `at` seconds (paused), or let it run again. */
  async function pinClip(id, at) {
    await ev(
      `(()=>{const r=window.__game.renderer;const v=r.views.get(${id});const c=v&&v.visual&&v.visual.current;const m=v&&v.visual&&v.visual.mixer;if(!c)return;${at === null ? 'if(m)m.timeScale=1;' : `c.time=${at};if(m){m.update(0);m.timeScale=0;}`}})()`,
    );
  }
  async function freezeRender(on) {
    await ev(
      `(()=>{const r=window.__game.renderer;r.__fase4Frozen=${on ? 'true' : 'false'};for(const v of r.views.values()){const m=v.visual&&v.visual.mixer;if(m)m.timeScale=${on ? 0 : 1};}})()`,
    );
  }

  await ev(`window.__game.sim.setPlayerLevel(20)`);
  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );
  await chat('/dev kit');
  await chat('/dev immortal');
  await chat('/dev season on');
  await chat('/daynight noon');
  await frames(4, 250);

  if (SECTIONS.has('meadow')) {
    // Boar Meadow round his field: let the wildlife graze a while, then look straight down.
    await chat('/dev noaggro');
    await chat('/dev scarecrow');
    await frames(10, 400);
    await curtainDown();
    const b = await find('gourdlight_thatchgrin');
    if (b) {
      await standAt(b.x + 30, b.z + 30, b.x, b.z, 6, 0.3, 0, 2);
      // a minute of grazing at sim speed
      await frames(120, 500);
      const field = await ev(
        `(()=>{const s=window.__game.sim;const b=[...s.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');let n=0;const who=[];for(const e of s.entities.values()){if(e.kind!=='mob'||e.dead||e.templateId.startsWith('gourdlight'))continue;const d=Math.hypot(e.pos.x-b.pos.x,e.pos.z-b.pos.z);if(d<18){n++;who.push(e.templateId+'@'+d.toFixed(1));}}return {n,who};})()`,
      );
      console.log('MEADOW INTRUDERS', JSON.stringify(field));
      await standAt(b.x + 0.5, b.z - 26, b.x, b.z, 34, 1.0, 0, 6);
      await shot('meadow_field');
    }
    await chat('/dev noaggro');
  }

  if (SECTIONS.has('portrait') || SECTIONS.has('strawling')) {
    await chat('/dev scarecrow reset');
    await frames(8, 300);
    await curtainDown();
    const b = await find('gourdlight_thatchgrin');
    await standAt(b.x + Math.sin(b.f) * 9, b.z + Math.cos(b.f) * 9, b.x, b.z, 10, 0.2, 0, 4);
    await ev(
      `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
    );
    await frames(4, 200);
    await chat('/dev scarecrow call');
    let st = null;
    for (let i = 0; i < 40 && !st; i++) {
      await frames(1, 250);
      st = await find('gourdlight_strawling');
    }
    if (!st || SECTIONS.has('strawling')) {
      // stand one up on open ground away from him (him reset and out of the fight, so
      // he never walks into the frame), so nothing hides its swing
      await chat('/dev scarecrow reset');
      await chat('/dev combatreset');
      await standAt(b.x - 30, b.z - 12, b.x - 30, b.z - 22, 6, 0.2, 0, 4);
      await chat('/dev spawn gourdlight_strawling 1');
      st = null;
      for (let i = 0; i < 20 && !st; i++) {
        await frames(1, 250);
        st = await find('gourdlight_strawling');
      }
    }
    console.log('STRAWLING', JSON.stringify(st));
    if (st && SECTIONS.has('portrait')) {
      await ev(`window.__game.sim.targetEntity(${st.id})`);
      await frames(4, 200);
      const box = await ev(
        `(()=>{const r=document.querySelector('#target-frame').getBoundingClientRect();return {x:Math.max(0,r.x-8),y:Math.max(0,r.y-8),width:r.width+16,height:r.height+16};})()`,
      );
      await shot('portrait_target_frame', 1, box);
      await shot('portrait_target_frame_full', 0);
    }
    if (st && SECTIONS.has('strawling')) {
      // a strawling swinging at us, caught at its hit frame by a free camera side-on
      const s2 = await find('gourdlight_strawling');
      const px = s2.x + Math.sin(s2.f) * 2.4;
      const pz = s2.z + Math.cos(s2.f) * 2.4;
      await standAt(px, pz, s2.x, s2.z, 4, 0.12, 0, 2);
      await ev(
        `(()=>{const s=window.__game.sim;const m=s.entities.get(${s2.id});s.targetEntity(${s2.id});s.dealDamage(s.player,m,1,false,'physical','Poke','hit',true);})()`,
      );
      for (const [clip, at, tag] of [
        ['Claw', 0.42, 'strawling_claw'],
        ['Lunge', 0.5, 'strawling_lunge'],
        ['Swipe', 0.66, 'strawling_swipe'],
        ['Chop', 0.78, 'strawling_chop'],
      ]) {
        if (ONLY && !ONLY.has(tag)) continue;
        if (await catchClip(s2.id, clip, at, 250)) {
          await pinClip(s2.id, at);
          const m = await find('gourdlight_strawling');
          const e = { x: m.x, z: m.z, f: m.f };
          const cam = await around(e, 2.2, 6.5, 2.0);
          const look = await around(e, 1.2, 0, 1.4);
          await freeCam(cam, look);
          await frames(2, 120);
          await shot(tag, 0);
          await freeCam(null);
          await pinClip(s2.id, null);
        }
      }
      await chat('/dev despawn spawned');
      await chat('/dev combatreset');
    }
  }

  if (SECTIONS.has('attacks')) {
    // his two swings, frozen on the frame the blade lands, by a free camera
    await chat('/dev scarecrow reset');
    await frames(8, 300);
    await curtainDown();
    let b = await find('gourdlight_thatchgrin');
    const p = { x: b.x + Math.sin(b.f) * 4.5, z: b.z + Math.cos(b.f) * 4.5 };
    await standAt(p.x, p.z, b.x, b.z, 4, 0.12, 0, 4);
    await ev(
      `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
    );
    for (const [clip, at, tag] of [
      ['Swipe', 0.66, 'attack_reap_hit'],
      ['Chop', 0.78, 'attack_slam_hit'],
    ]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await catchClip(b.id, clip, at, 600)) {
          await pinClip(b.id, at);
          b = await find('gourdlight_thatchgrin');
          // three-quarter front, low, wide enough for the whole arc and the player
          await freeCam(await around(b, 9, 8, 3.2), await around(b, 2.2, 0, 2.6));
          await frames(2, 120);
          await shot(tag, 0);
          await freeCam(await around(b, 5, -12, 2.6), await around(b, 2.4, 0, 2.6));
          await frames(2, 120);
          await shot(`${tag}_side`, 0);
          await freeCam(null);
          await pinClip(b.id, null);
          break;
        }
      }
    }
  }

  if (SECTIONS.has('coat')) {
    await chat('/dev scarecrow reset');
    await chat('/dev freezemobs on');
    await frames(8, 300);
    const b = await find('gourdlight_thatchgrin');
    await standAt(b.x + Math.sin(b.f) * 12, b.z + Math.cos(b.f) * 12, b.x, b.z, 3, 0.1, 0, 4);
    // up close on his chest, his flank and the whole coat, the player out of frame
    for (const [tag, d, side, h, lh] of [
      ['coat_close', 3.4, 0.6, 4.4, 4.3],
      ['coat_flank', 2.0, 3.6, 3.6, 3.7],
      ['coat_three_quarter', 6.5, 4.5, 4.2, 3.8],
    ]) {
      await freeCam(await around(b, d, side, h), await around(b, 0, 0, lh));
      await frames(3, 200);
      await shot(tag, 0);
    }
    await chat('/daynight dusk');
    await frames(8, 250);
    await shot('coat_dusk', 0);
    await freeCam(null);
    await chat('/daynight noon');
    await chat('/dev freezemobs off');
  }

  if (SECTIONS.has('stall')) {
    const posts = await ev(
      `(()=>{const g=window.__game;return [...g.sim.entities.values()].filter(e=>e.templateId==='gourdlight_keeper').map(e=>({id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}));})()`,
    );
    const sorted = posts.sort((a, c) => a.id - c.id);
    const names = ['eastbrook', 'fenbridge', 'highwatch'];
    for (const name of (process.env.STALLS ?? 'fenbridge').split(',')) {
      const k = sorted[names.indexOf(name)];
      console.log('KEEPER', name, JSON.stringify(k));
      await chat(
        `/dev tp ${Math.round(k.x + Math.sin(k.f) * 6)} ${Math.round(k.z + Math.cos(k.f) * 6)}`,
      );
      await frames(14, 350);
      await curtainDown();
      // a customer at the counter, the camera on its usual boom behind them
      const c = { x: k.x + Math.sin(k.f) * 3.2, z: k.z + Math.cos(k.f) * 3.2 };
      await standAt(c.x, c.z, k.x, k.z, 9, 0.28, 0, 10);
      await shot(`stall_${name}_customer`);
      await standAt(c.x, c.z, k.x, k.z, 12, 0.3, 0.7, 6);
      await shot(`stall_${name}_customer_left`);
      await standAt(c.x, c.z, k.x, k.z, 12, 0.3, -0.7, 6);
      await shot(`stall_${name}_customer_right`);
      const w = { x: k.x + Math.sin(k.f + 0.4) * 15, z: k.z + Math.cos(k.f + 0.4) * 15 };
      await standAt(w.x, w.z, k.x, k.z, 12, 0.4, 0, 6);
      await shot(`stall_${name}_wide`);
      await chat('/daynight midnight');
      await frames(8, 250);
      await shot(`stall_${name}_night`);
      await chat('/daynight noon');
      await frames(4, 250);
      const y = (await groundY(k.x, k.z)) + 45;
      await freeCam({ x: k.x, y, z: k.z - 0.01 }, { x: k.x, y: y - 50, z: k.z });
      await frames(8, 300);
      await shot(`stall_${name}_overview`);
      await freeCam(null);
    }
  }

  if (SECTIONS.has('corn')) {
    // corn shocks on Eastbrook's street (CORN="x,z;x,z": shock spots off the resolved
    // layout), each from a player's eye a few yards off, with the player out of frame
    const spots = (process.env.CORN ?? '-13,-97.5;-8.3,-104.2').split(';').map((p) => {
      const [x, z] = p.split(',').map(Number);
      return { x, z };
    });
    await chat(`/dev tp ${Math.round(spots[0].x + 12)} ${Math.round(spots[0].z)}`);
    await frames(14, 350);
    await curtainDown();
    for (const [i, c] of spots.entries()) {
      await standAt(c.x + 14, c.z + 6, c.x, c.z, 4, 0.2, 0, 4);
      const g = await groundY(c.x, c.z);
      for (const [tag, ang, dist, h, lookH] of [
        ['eye', 0.6, 5.2, 2.0, 1.6],
        ['close', 2.2, 3.0, 1.9, 1.5],
        ['low', 4.0, 4.4, 1.0, 1.9],
      ]) {
        const pos = { x: c.x + Math.sin(ang) * dist, y: g + h, z: c.z + Math.cos(ang) * dist };
        await freeCam(pos, { x: c.x, y: g + lookH, z: c.z });
        await frames(4, 200);
        await shot(`corn_${i}_${tag}`, 0);
      }
      await chat('/daynight dusk');
      await frames(6, 250);
      await shot(`corn_${i}_dusk`, 0);
      await chat('/daynight noon');
      await frames(3, 200);
      await freeCam(null);
    }
  }

  if (SECTIONS.has('overview')) {
    // straight-down looks: OVERVIEW="name,x,z,height;..." (judging where a piece fits)
    for (const spec of (process.env.OVERVIEW ?? 'fenbridge,0,300,90').split(';')) {
      const [name, xs, zs, hs] = spec.split(',');
      const x = Number(xs);
      const z = Number(zs);
      await chat(`/dev tp ${Math.round(x)} ${Math.round(z) - 40}`);
      await frames(14, 350);
      await curtainDown();
      const y = (await groundY(x, z)) + Number(hs);
      await freeCam({ x, y, z: z - 0.01 }, { x, y: y - 50, z });
      await frames(10, 300);
      await shot(`overview_${name}`);
      await freeCam(null);
    }
  }

  if (SECTIONS.has('broom')) {
    // the broom on the move: a free camera that tracks the rider from the side, so the
    // spark and ember trail streams out behind it across the frame
    await chat('/dev combatreset');
    await chat('/dev mounts');
    await chat('/dev tp 96 -30');
    await frames(10, 300);
    await curtainDown();
    await ev(`window.__game.sim.useItem('reins_emberbristle_broom')`);
    await frames(10, 250);
    const track = (side, back, up) =>
      ev(
        `(()=>{const g=window.__game;const r=g.renderer;cancelAnimationFrame(window.__trackRaf||0);const v=r.camera.position;const step=()=>{const p=g.sim.player;const f=p.facing;const fx=Math.sin(f),fz=Math.cos(f);const rx=Math.cos(f),rz=-Math.sin(f);r.editorCam={pos:v.clone().set(p.pos.x+rx*${side}-fx*${back},p.pos.y+${up},p.pos.z+rz*${side}-fz*${back}),target:v.clone().set(p.pos.x-fx*1.2,p.pos.y+1.3,p.pos.z-fz*1.2)};window.__trackRaf=requestAnimationFrame(step);};step();})()`,
      );
    for (const [time, tag] of [
      ['noon', 'broom_moving'],
      ['dusk', 'broom_moving_dusk'],
    ]) {
      await chat(`/daynight ${time}`);
      await standAt(96, -30, 96, -10, 8, 0.15, 0, 6);
      await page.keyboard.down('w');
      await track(6.5, 1.5, 1.6);
      await frames(6, 120);
      await shot(`${tag}_side`, 0);
      await track(3.5, 6.5, 2.2);
      await frames(4, 120);
      await shot(`${tag}_trail`, 0);
      await page.keyboard.up('w');
      await ev(
        `(()=>{cancelAnimationFrame(window.__trackRaf||0);window.__game.renderer.editorCam=null;})()`,
      );
    }
    await chat('/daynight noon');
  }
} finally {
  await browser.close();
}
