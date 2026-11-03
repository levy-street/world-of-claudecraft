// Screenshot and check rig for Gourdlight Eve's round 11: the bigger Gurglegreen Cauldron
// clicked through the REAL picking path (a mouse click on the canvas) and the drinker's
// goblin body; Old Thatchgrin waking to the offline night commands (/dev servertime night
// then /daynight night, the sequence that used to leave him on his pole); and a rider's
// hands round the Emberbristle Broom's handle on four bodies, idle and flying through a
// turn, from several angles, with a measured hand-drift readout.
//
//   GAME_URL=http://127.0.0.1:5214 OUT=tmp/round11 [SECTIONS=cauldron,scarecrow,broom]
//     [SHOTS=a,b] [PRESET=4] node scripts/gourdlight_round11_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5214';
const OUT = process.env.OUT ?? 'tmp/round11';
const PRESET = Number(process.env.PRESET ?? 4);
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'cauldron,scarecrow,broom').split(',').filter(Boolean),
);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const CLASS = process.env.CLASS ?? 'warrior';
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
    if (m.type() === 'error') console.log('CONSOLE:', m.text());
  });
  await page.evaluateOnNewDocument(`(() => {
    try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} })); } catch {}
  })()`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: CLASS,
    charName: 'Hollowmere',
    settleMs: 4000,
    gameBootTimeoutMs: 240000,
    selectorTimeoutMs: 120000,
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
    if (!want(name)) return;
    await curtainDown();
    if (settle) await frames(settle, 120);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('SHOT', name);
  }
  async function clearMobs(x, z, r = 90) {
    await ev(
      `(()=>{for(const e of window.__game.sim.entities.values()){if(e.kind==='mob'&&e.templateId!=='gourdlight_thatchgrin'&&Math.hypot(e.pos.x-(${x}),e.pos.z-(${z}))<${r}){e.pos.x+=9000;e.prevPos={...e.pos};}}})()`,
    );
  }
  /** Stand at (x, z) facing `yaw`; the camera `dist` behind at `pitch`, turned by `turn`. */
  async function stand(x, z, yaw, dist = 6, pitch = 0.25, turn = 0) {
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;p.pos.x=${x};p.pos.z=${z};p.pos.y=g.sim.groundPos(${x},${z}).y;p.prevPos={...p.pos};p.facing=${yaw};p.prevFacing=${yaw};const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=${yaw + turn};})()`,
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

  // the toys play on the open road west of Eastbrook, clear of the stalls
  const SX = 66;
  const SZ = -18;

  if (SECTIONS.has('cauldron')) {
    await chat(`/dev tp ${SX} ${SZ}`);
    await frames(10, 300);
    await curtainDown();
    await chat('/daynight dusk');
    await ev(`window.__game.sim.addItem('gurglegreen_cauldron',1)`);
    await clearMobs(SX, SZ);
    await stand(SX, SZ - 4, 0, 7, 0.32, 0.6);
    await frames(6, 250);
    await use('gurglegreen_cauldron');
    await frames(10, 250);
    await shot('round11-cauldron-big');
    // The real click: project the pot's brew onto the screen and click the canvas there,
    // from the usual over-the-shoulder camera, ten times from ten spots on the pot.
    let landed = 0;
    let tries = 0;
    for (const [dx, dy, dz] of [
      [0, 1.0, 0],
      [0.3, 1.05, 0.1],
      [-0.3, 0.95, -0.2],
      [0, 0.6, -0.6],
      [0.5, 0.5, -0.5],
      [-0.5, 0.7, -0.4],
      [0, 0.3, -0.8],
      [0.2, 1.1, 0.3],
      [-0.2, 1.0, 0.25],
      [0, 0.9, -0.3],
    ]) {
      await ev(
        `(()=>{const s=window.__game.sim;s.player.auras=s.player.auras.filter(a=>a.id!=='gourdlight_toy_gurglegreen');})()`,
      );
      await frames(2, 150);
      const at = await ev(`(()=>{
        const g=window.__game;const s=g.sim;const pot=[...s.entities.values()].find(e=>e.objectItemId==='gurglegreen_cauldron');
        if(!pot)return null;const cam=g.renderer.camera;
        const v=cam.position.clone().set(pot.pos.x+${dx},pot.pos.y+${dy},pot.pos.z+${dz}).project(cam);
        const c=g.renderer.renderer?.domElement??document.querySelector('canvas');const r=c.getBoundingClientRect();
        return {x:r.left+(v.x*0.5+0.5)*r.width,y:r.top+(-v.y*0.5+0.5)*r.height};
      })()`);
      if (!at) break;
      tries++;
      await page.mouse.move(at.x, at.y);
      await sleep(60);
      await page.mouse.down({ button: 'left' });
      await sleep(50);
      await page.mouse.up({ button: 'left' });
      await frames(2, 120);
      const drank = await ev(
        `window.__game.sim.player.auras.some(a=>a.id==='gourdlight_toy_gurglegreen')`,
      );
      if (drank) landed++;
    }
    console.log(`CAULDRON CLICKS ${landed}/${tries} landed`);
    // the drink itself, captured at the gulp and as a goblin
    await ev(
      `(()=>{const s=window.__game.sim;s.player.auras=s.player.auras.filter(a=>a.id!=='gourdlight_toy_gurglegreen');})()`,
    );
    await frames(4, 200);
    await ev(
      `(()=>{const s=window.__game.sim;const pot=[...s.entities.values()].find(e=>e.objectItemId==='gurglegreen_cauldron');if(pot)s.pickUpObject(pot.id);})()`,
    );
    await sleep(350);
    await shot('round11-cauldron-gulp');
    await frames(10, 300);
    await stand(SX + 1.5, SZ - 3, 0.4, 5.5, 0.22, Math.PI * 0.85);
    await frames(6, 250);
    await shot('round11-cauldron-goblin');
  }

  if (SECTIONS.has('scarecrow')) {
    await chat('/daynight auto');
    await chat('/dev servertime day');
    await frames(30, 300);
    await chat('/dev scarecrow');
    await frames(12, 300);
    const read = () =>
      ev(
        `(()=>{const s=window.__game.sim;const e=[...s.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return e?{x:e.pos.x,z:e.pos.z,f:e.facing,asleep:!!e.asleep,phase:s.dayNightPhase?.()}:null;})()`,
      );
    const b = await read();
    console.log('THATCHGRIN day', JSON.stringify(b));
    if (b) {
      await clearMobs(b.x, b.z, 120);
      const x = b.x + Math.sin(b.f + 0.35) * 17;
      const z = b.z + Math.cos(b.f + 0.35) * 17;
      await stand(x, z, Math.atan2(b.x - x, b.z - z), 9, 0.05, 0.2);
      await frames(6, 300);
      await shot('round11-scarecrow-pole-day');
      // the playtest's sequence: the server clock to night, then the sky to match
      await chat('/dev servertime night');
      await chat('/daynight night');
      await sleep(1100);
      await shot('round11-scarecrow-awaken');
      await frames(10, 300);
      console.log('THATCHGRIN night', JSON.stringify(await read()));
      await shot('round11-scarecrow-awake-night');
      // step well out of his reach so the fight ends, then bring the day back
      const far = { x: b.x + Math.sin(b.f) * 60, z: b.z + Math.cos(b.f) * 60 };
      await stand(far.x, far.z, Math.atan2(b.x - far.x, b.z - far.z), 9, 0.05, 0.2);
      await chat('/dev combatreset');
      await frames(30, 300);
      await chat('/daynight day');
      await frames(20, 300);
      await stand(x, z, Math.atan2(b.x - x, b.z - z), 9, 0.05, 0.2);
      await frames(8, 300);
      console.log('THATCHGRIN day again', JSON.stringify(await read()));
      await shot('round11-scarecrow-back-on-pole');
    }
  }

  if (SECTIONS.has('broom')) {
    await chat('/dev combatreset');
    await frames(8, 250);
    await chat('/dev mounts');
    await chat('/daynight noon');
    await chat('/dev tp 96 -30');
    await frames(10, 300);
    await curtainDown();
    await clearMobs(96, -30);
    await stand(96, -30, 0, 4.2, 0.1, Math.PI / 2);
    await ev(`window.__game.sim.useItem('reins_emberbristle_broom')`);
    await frames(20, 300);
    const info = await ev(`(()=>{
      const g=window.__game;const v=g.renderer.views?.get(g.sim.player.id);const vis=v?.visual;
      if(!vis)return 'no visual';
      return JSON.stringify({mount:g.sim.player.mountKey,chain:vis.rideArmChain===undefined?'unresolved':vis.rideArmChain===null?'null':'ok',blend:vis.rideBlend,slots:vis.rideArmChain?[!!vis.rideArmChain.left.slot,!!vis.rideArmChain.right.slot]:null});
    })()`);
    console.log('BROOM', info);
    // Hand drift: each fist's grip point in the rider's own frame, sampled over two seconds.
    const drift = (label) =>
      ev(`(async()=>{
        const g=window.__game;const vis=g.renderer.views?.get(g.sim.player.id)?.visual;const c=vis?.rideArmChain;
        if(!c||!c.left.slot)return '${label}: no chain';
        const root=vis.root;const samples=[];
        for(let i=0;i<40;i++){
          await new Promise(r=>requestAnimationFrame(()=>r()));
          const row=[];
          for(const arm of [c.left,c.right]){const p=arm.slot.getWorldPosition(root.position.clone());root.worldToLocal(p);row.push(p);}
          samples.push(row);
        }
        let maxStep=0,span=0;
        for(let h=0;h<2;h++){let lo=1e9,hi=-1e9;
          for(let i=1;i<samples.length;i++){maxStep=Math.max(maxStep,samples[i][h].distanceTo(samples[i-1][h]));}
          for(const s of samples){lo=Math.min(lo,s[h].z);hi=Math.max(hi,s[h].z);} span=Math.max(span,hi-lo);}
        return '${label}: max frame step '+(maxStep*100).toFixed(2)+' cm, along-handle span '+(span*100).toFixed(2)+' cm';
      })()`);
    const BODIES = {
      male: "{gender:'male'}",
      female: "{gender:'female'}",
      male_tall: "{gender:'male',bodyScale:1.05,headBeard:'long'}",
      female_slight: "{gender:'female',bodyScale:0.95}",
    };
    for (const [body, look] of Object.entries(BODIES)) {
      await ev(`(()=>{window.__game.sim.player.modularAppearance=${look};})()`);
      await frames(10, 250);
      await stand(96, -30, 0, 4.2, 0.1, Math.PI / 2);
      await frames(3, 200);
      console.log('DRIFT', await drift(`${body} idle`));
      await shot(`round11-broom-${body}-side`);
      await stand(96, -30, 0, 4.4, 0.16, Math.PI * 0.78);
      await frames(3, 200);
      await shot(`round11-broom-${body}-front`);
      await stand(96, -30, 0, 3.6, 0.55, Math.PI * 1.15);
      await frames(3, 200);
      await shot(`round11-broom-${body}-above-left`);
      // close on the hands: the left fist from the rider's left, the right from the right
      await stand(96, -30, 0, 1.9, 0.3, Math.PI * 0.62);
      await frames(3, 200);
      await shot(`round11-broom-${body}-hands-left`);
      await stand(96, -30, 0, 1.9, 0.3, -Math.PI * 0.62);
      await frames(3, 200);
      await shot(`round11-broom-${body}-hands-right`);
    }
    // flying and turning: hold forward and sweep the facing, then read the drift again
    await ev(`(()=>{window.__game.sim.player.modularAppearance={gender:'male'};})()`);
    await frames(8, 250);
    // the open road west of Eastbrook, clear of the field's sheaves
    await chat(`/dev tp ${SX} ${SZ}`);
    await frames(8, 250);
    await clearMobs(SX, SZ);
    await stand(SX, SZ, Math.PI, 4.5, 0.18, 0.55);
    await frames(4, 250);
    await page.keyboard.down('w');
    await frames(3, 250);
    console.log('DRIFT', await drift('male flying straight'));
    await shot('round11-broom-male-flying');
    await page.keyboard.down('a');
    await frames(2, 250);
    console.log('DRIFT', await drift('male flying, turning'));
    await shot('round11-broom-male-flying-turn');
    await page.keyboard.up('a');
    await page.keyboard.up('w');
    await frames(4, 250);
    console.log('DRIFT', await drift('male stopping'));
  }
} finally {
  await browser.close();
}
