// Screenshot rig for Gourdlight Eve's round 10: the Murmurwick Candle's dancing shadows (by
// night and by day), the Gurglegreen Cauldron and a green drinker, Old Thatchgrin hanging on
// his pole by day and his violet Gourdfall by night, and a rider's hands on the Emberbristle
// Broom's handle (male and female bodies).
//
//   GAME_URL=http://127.0.0.1:5214 OUT=tmp/round10 [SECTIONS=candle,cauldron,scarecrow,broom]
//     [SHOTS=a,b] [PRESET=4] node scripts/gourdlight_round10_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5214';
const OUT = process.env.OUT ?? 'tmp/round10';
const PRESET = Number(process.env.PRESET ?? 4);
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'candle,cauldron,scarecrow,broom').split(',').filter(Boolean),
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

  const keeper = await ev(
    `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_keeper'&&Math.abs(e.pos.z+110)<20);return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
  );
  if (!keeper) throw new Error('no keeper');
  // the toys play on the open road west of Eastbrook, clear of the stalls
  const SX = 66;
  const SZ = -18;
  if (SECTIONS.has('candle') || SECTIONS.has('cauldron')) {
    await chat(`/dev tp ${SX} ${SZ}`);
    await frames(10, 300);
    await curtainDown();
  }

  if (SECTIONS.has('candle')) {
    await ev(`window.__game.sim.addItem('murmurwick_candle',1)`);
    for (const [when, tag] of [
      ['midnight', 'night'],
      ['noon', 'day'],
    ]) {
      await chat(`/daynight ${when}`);
      await ev(
        `(()=>{const s=window.__game.sim;s.player.auras=s.player.auras.filter(a=>!a.id.startsWith('gourdlight_toy_'));s.player.cooldowns.delete('murmurwick_candle');})()`,
      );
      await clearMobs(SX, SZ);
      await stand(SX, SZ, 0, 9.5, 0.78, 2.4);
      await frames(6, 250);
      await use('murmurwick_candle');
      await frames(14, 250);
      await shot(`round10-candle-${tag}`);
    }
  }

  if (SECTIONS.has('cauldron')) {
    await chat('/daynight dusk');
    await ev(`window.__game.sim.addItem('gurglegreen_cauldron',1)`);
    await clearMobs(SX, SZ);
    await stand(SX, SZ - 4, 0, 6, 0.3, 0.6);
    await frames(6, 250);
    await use('gurglegreen_cauldron');
    await frames(10, 250);
    await shot('round10-cauldron');
    // drink: the player steps up to it and takes a sip
    await ev(
      `(()=>{const s=window.__game.sim;const pot=[...s.entities.values()].find(e=>e.objectItemId==='gurglegreen_cauldron');if(!pot)return;s.pickUpObject(pot.id);})()`,
    );
    await frames(8, 250);
    await shot('round10-cauldron-drink');
  }

  if (SECTIONS.has('scarecrow')) {
    // day on both clocks: the sim's (he keeps it) and the sky's
    await chat('/daynight noon');
    // let him climb back onto his pole before anyone walks up
    await frames(30, 300);
    await chat('/dev scarecrow');
    await frames(12, 300);
    const b = await ev(
      `(()=>{const s=window.__game.sim;const e=[...s.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return e?{x:e.pos.x,z:e.pos.z,f:e.facing,asleep:!!e.asleep,phase:s.dayNightPhase?.(),ai:e.aiState,combat:e.inCombat,threat:e.threat?.size,hold:e.slumberDevHold,d:Math.hypot(e.pos.x-e.spawnPos.x,e.pos.z-e.spawnPos.z)}:null;})()`,
    );
    console.log('THATCHGRIN', JSON.stringify(b));
    if (b) {
      await clearMobs(b.x, b.z, 120);
      const at = (d, side = 0) => {
        const x = b.x + Math.sin(b.f + side) * d;
        const z = b.z + Math.cos(b.f + side) * d;
        return { x, z, face: Math.atan2(b.x - x, b.z - z) };
      };
      const front = at(17, 0.35);
      await stand(front.x, front.z, front.face, 9, 0.05, 0.2);
      await frames(10, 300);
      await shot('round10-scarecrow-pole-day');
      const close = at(11, 0.7);
      await stand(close.x, close.z, close.face, 4, 0.12, -0.45);
      await frames(6, 300);
      await shot('round10-scarecrow-pole-day-close');
      // nightfall: he wakes on his own (his clock is the sky's offline)
      await stand(front.x, front.z, front.face, 9, 0.05, 0.2);
      await frames(4, 250);
      await chat('/daynight midnight');
      await sleep(900);
      await shot('round10-scarecrow-awaken-1');
      await sleep(800);
      await shot('round10-scarecrow-awaken-2');
      await sleep(900);
      await shot('round10-scarecrow-awaken-3');
      await frames(6, 300);
      // pull him and call his rain: the violet pumpkins and the scorched ground
      await ev(
        `(()=>{const s=window.__game.sim;const e=[...s.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');s.player.targetId=e.id;s.dealDamage?.(s.player,e,5,false,'physical',null,'hit',true);})()`,
      );
      await frames(4, 250);
      const high = at(15, 0.9);
      await stand(high.x, high.z, high.face, 16, 0.62, 0.15);
      await chat('/dev scarecrow rain');
      // wait for a pumpkin to be in the air (his own cadence may have started one already)
      for (let i = 0; i < 120; i++) {
        const falling = await ev(
          `(()=>{const f=window.__game.renderer.scarecrowFx;return f.falls.some(s=>s.active&&!s.up&&f.time>=s.start+0.25);})()`,
        );
        if (falling) break;
        await sleep(100);
      }
      await shot('round10-scarecrow-rain-fall');
      await sleep(1600);
      await shot('round10-scarecrow-rain-ground');
      await chat('/daynight noon');
      await frames(2, 200);
      await shot('round10-scarecrow-rain-ground-day');
    }
  }

  if (SECTIONS.has('broom')) {
    await chat('/dev combatreset');
    await frames(8, 250);
    await chat('/dev mounts');
    await chat('/daynight noon');
    // the open road west of Eastbrook, flat and clear (round 3's broom spot)
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
      return JSON.stringify({mount:g.sim.player.mountKey,chain:vis.rideArmChain===undefined?'unresolved':vis.rideArmChain===null?'null':'ok',blend:vis.rideBlend});
    })()`);
    console.log('BROOM', info);
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
      await shot(`round10-broom-${body}-side`);
      await stand(96, -30, 0, 4.4, 0.16, Math.PI * 0.78);
      await frames(3, 200);
      await shot(`round10-broom-${body}-front`);
    }
  }
} finally {
  await browser.close();
}
