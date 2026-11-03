// Screenshot rig for Gourdlight Eve's phase 3 (the owner's playtest notes, 2026-10-17):
// Old Thatchgrin's Gourdfall rain, his Swelling Gourd alive and bursting, his reel when it
// breaks, his two new swings and his scythe grip; Hester's stall in each city; the costume
// draughts; and the Emberbristle Broom ridden by every body the character builder makes.
//
//   GAME_URL=http://127.0.0.1:5193 OUT=tmp/fase3 [SECTIONS=broom,stalls,...] [SHOTS=a,b]
//     [PRESET=4] [MOBILE=1] node scripts/gourdlight_fase3_shot.mjs
//
// GPU only (the system ANGLE backend, never SwiftShader). One browser, closed at the end.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5193';
const OUT = process.env.OUT ?? 'tmp/fase3';
const PRESET = Number(process.env.PRESET ?? 4);
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const SECTIONS = new Set(
  (process.env.SECTIONS ?? 'broom,stalls,potions,scarecrow').split(',').filter(Boolean),
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
  async function camera(dist, pitch, turn) {
    await ev(
      `(()=>{const g=window.__game;const p=g.sim.player;const i=g.input;i.camDist=${dist};i.camPitch=${pitch};i.camYaw=p.facing+${turn};})()`,
    );
  }

  await ev(`window.__game.sim.setPlayerLevel(20)`);
  await ev(
    `(()=>{for(const b of document.querySelectorAll('button')){if(/skip tutorial/i.test(b.textContent||''))b.click();}})()`,
  );
  await chat('/dev kit');
  await chat('/dev immortal');
  await chat('/dev season on');
  await frames(4, 250);

  if (SECTIONS.has('broom')) {
    await chat('/dev mounts');
    await chat('/daynight noon');
    await frames(4, 250);
    // the open road west of Eastbrook, flat and clear
    const BODIES = {
      male: "{gender:'male'}",
      female: "{gender:'female'}",
      male_tall_bearded:
        "{gender:'male',bodyScale:1.05,headBeard:'long',skinHue:20,skinLight:0.62}",
      female_slight: "{gender:'female',bodyScale:0.95,skinHue:24,skinLight:0.28}",
    };
    await chat('/dev tp 96 -30');
    await frames(10, 300);
    await curtainDown();
    await standAt(96, -30, 96, -10, 9, 0.18, 0, 8);
    await ev(`window.__game.sim.useItem('reins_emberbristle_broom')`);
    await frames(10, 250);
    for (const [body, look] of Object.entries(BODIES)) {
      await ev(`(()=>{window.__game.sim.player.modularAppearance=${look};})()`);
      await frames(8, 250);
      await camera(5.2, 0.1, Math.PI * 0.5);
      await shot(`broom_${body}_side`);
      await camera(5.5, 0.16, Math.PI * 0.78);
      await shot(`broom_${body}_front`);
    }
    await camera(9, 0.2, Math.PI * 0.62);
    await chat('/daynight midnight');
    await frames(10, 250);
    await shot('broom_night');
    await chat('/daynight noon');
    await frames(6, 250);
    // on the move: hold forward for a moment, the trail streaming behind
    await standAt(96, -30, 96, -10, 9, 0.18, 0, 4);
    await page.keyboard.down('w');
    await frames(4, 150);
    await camera(8, 0.15, Math.PI * 0.42);
    await frames(3, 120);
    await shot('broom_moving', 0);
    await page.keyboard.up('w');
  }

  if (SECTIONS.has('scarecrow')) {
    const boss = () =>
      ev(
        `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_thatchgrin');return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing,dead:e.dead}:null;})()`,
      );
    await chat('/dev scarecrow');
    await chat('/dev noaggro');
    await frames(16, 400);
    await curtainDown();
    for (let i = 0; i < 40; i++) {
      const ready = await ev(
        `(()=>{const r=window.__game.renderer;const s=r.scene.getObjectByName('seasonal-decor');return !!(s&&s.visible&&s.children.length);})()`,
      );
      if (ready) break;
      await frames(1, 300);
    }
    let b = await boss();
    if (!b) throw new Error('no Thatchgrin');
    const front = (d, side = 0) => ({
      x: b.x + Math.sin(b.f) * d + Math.cos(b.f) * side,
      z: b.z + Math.cos(b.f) * d - Math.sin(b.f) * side,
    });
    await chat('/daynight noon');
    // the scythe in his palm, up close, before the fight
    {
      const hx = b.x - Math.cos(b.f) * 3;
      const hz = b.z + Math.sin(b.f) * 3;
      const p = { x: hx + Math.sin(b.f) * 5.5, z: hz + Math.cos(b.f) * 5.5 };
      await standAt(p.x, p.z, hx, hz, 3.2, -0.12, 0.35, 8);
      await shot('scythe_grip');
    }
    // the fight (noaggro toggles back off: he answers the pull)
    await chat('/dev noaggro');
    await chat('/dev scarecrow reset');
    await frames(6, 300);
    b = await boss();
    const engage = async () => {
      await ev(
        `(()=>{const g=window.__game;const s=g.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
      );
      await frames(4, 200);
    };
    // the two swings, from the side so the arc reads: catch each as it plays
    {
      const p = front(4.5, 3.5);
      await standAt(p.x, p.z, b.x, b.z, 13, 0.18, 0.95, 4);
      await engage();
      for (const clip of ['Swipe', 'Chop']) {
        for (let i = 0; i < 120; i++) {
          const playing = await ev(
            `(()=>{const r=window.__game.renderer;const v=r.views.get(${b.id});const c=v&&v.visual&&v.visual.current;return c&&c.getClip?c.getClip().name:'';})()`,
          );
          if (String(playing).includes(clip)) {
            const tag = clip === 'Swipe' ? 'attack_reap' : 'attack_slam';
            await sleep(clip === 'Swipe' ? 330 : 400);
            await shot(`${tag}_windup`, 0);
            await sleep(clip === 'Swipe' ? 200 : 230);
            await shot(`${tag}_impact`, 0);
            break;
          }
          await sleep(50);
        }
      }
    }
    // Gourdfall: rings, the pumpkins dropping out of the sky, the bursts, the chaff
    await chat('/daynight noon');
    {
      const p = front(15, 5);
      await standAt(p.x, p.z, b.x, b.z, 22, 0.55, 0.3, 3);
      await chat('/dev scarecrow rain');
      await sleep(300);
      await shot('rain_telegraph', 0);
      await sleep(900);
      await shot('rain_falling', 0);
      await sleep(200);
      await shot('rain_falling_late', 0);
      await sleep(250);
      await shot('rain_burst', 0);
      await sleep(1200);
      await shot('rain_chaff', 0);
    }
    await chat('/daynight midnight');
    await chat('/dev scarecrow rain');
    await sleep(2000);
    await shot('rain_night', 0);
    // the Swelling Gourd: risen, ripening, swollen, then burst; a second one broken (his reel)
    await chat('/daynight noon');
    {
      const p = front(-14, -9);
      await standAt(p.x, p.z, b.x, b.z, 16, 0.32, Math.PI, 3);
      await chat('/dev scarecrow swell');
      await sleep(700);
      await shot('gourd_rise', 0);
      await frames(6, 250);
      const g = await ev(
        `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_swelling_gourd'&&!e.dead);return e?{id:e.id,x:e.pos.x,z:e.pos.z}:null;})()`,
      );
      if (g) {
        // stand beyond the gourd, away from him: the gourd up front, the boss behind it
        const ux = g.x - b.x;
        const uz = g.z - b.z;
        const ul = Math.hypot(ux, uz) || 1;
        const q = {
          x: g.x + (ux / ul) * 9 + (uz / ul) * 3,
          z: g.z + (uz / ul) * 9 - (ux / ul) * 3,
        };
        await standAt(q.x, q.z, g.x, g.z, 9, 0.16, 0, 4);
        await ev(`window.__game.sim.targetEntity(${g.id})`);
        await shot('gourd_alive');
        // ripen it most of the way, so it reads swollen and throbbing
        await ev(`(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;k.swellFuse=4;})()`);
        await frames(3, 250);
        await shot('gourd_swollen', 0);
        await chat('/daynight midnight');
        await frames(4, 200);
        await shot('gourd_swollen_night', 0);
        await chat('/daynight noon');
        await ev(
          `(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;k.swellFuse=0.35;})()`,
        );
        await standAt(q.x + (ux / ul) * 6, q.z + (uz / ul) * 6, g.x, g.z, 14, 0.3, 0, 1);
        await sleep(330);
        await shot('gourd_burst', 0);
        await sleep(160);
        await shot('gourd_burst_b', 0);
        await sleep(220);
        await shot('gourd_burst_wave', 0);
        await sleep(1200);
      }
      await chat('/dev scarecrow swell');
      await frames(8, 250);
      b = await boss();
      const g2 = await ev(
        `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='gourdlight_swelling_gourd'&&!e.dead);return e?{id:e.id,x:e.pos.x,z:e.pos.z}:null;})()`,
      );
      // between the gourd and him, a little to the side: both in frame
      const mid = g2 ? { x: (g2.x + b.x) / 2, z: (g2.z + b.z) / 2 } : { x: b.x, z: b.z };
      const sx = g2 ? -(g2.z - b.z) : 1;
      const sz = g2 ? g2.x - b.x : 0;
      const sl = Math.hypot(sx, sz) || 1;
      await standAt(mid.x + (sx / sl) * 13, mid.z + (sz / sl) * 13, mid.x, mid.z, 13, 0.24, 0, 3);
      await chat('/dev scarecrow break');
      await sleep(250);
      await shot('gourd_break', 0);
      await sleep(700);
      await shot('boss_stunned', 0);
      const near = { x: b.x + (sx / sl) * 9, z: b.z + (sz / sl) * 9 };
      await standAt(near.x, near.z, b.x, b.z, 10, 0.05, 0, 1);
      await sleep(600);
      await shot('boss_stunned_close', 0);
      await sleep(1600);
      await shot('boss_stunned_late', 0);
    }
  }

  if (SECTIONS.has('stalls')) {
    await chat('/daynight noon');
    const posts = await ev(
      `(()=>{const g=window.__game;return [...g.sim.entities.values()].filter(e=>e.templateId==='gourdlight_keeper').map(e=>({id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}));})()`,
    );
    console.log('KEEPERS', JSON.stringify(posts));
    const names = ['eastbrook', 'fenbridge', 'highwatch'];
    const sorted = posts.sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i++) {
      const k = sorted[i];
      const name = names[i] ?? String(i);
      await chat(
        `/dev tp ${Math.round(k.x + Math.sin(k.f) * 9)} ${Math.round(k.z + Math.cos(k.f) * 9)}`,
      );
      await frames(14, 350);
      await curtainDown();
      const p = { x: k.x + Math.sin(k.f + 0.45) * 6.5, z: k.z + Math.cos(k.f + 0.45) * 6.5 };
      await standAt(p.x, p.z, k.x, k.z, 6.5, 0.2, 0, 10);
      await shot(`stall_${name}`);
      const w = { x: k.x + Math.sin(k.f) * 14, z: k.z + Math.cos(k.f) * 14 };
      await standAt(w.x, w.z, k.x, k.z, 14, 0.4, 0, 6);
      await shot(`stall_${name}_wide`);
      await chat('/daynight midnight');
      await frames(8, 250);
      await shot(`stall_${name}_night`);
      await chat('/daynight noon');
      await frames(4, 250);
    }
  }

  if (SECTIONS.has('potions')) {
    await chat('/daynight noon');
    await chat('/dev tp 80 -40');
    await frames(10, 300);
    await curtainDown();
    await standAt(80, -40, 80, -30, 7, 0.14, Math.PI, 8);
    for (const [item, tag] of [
      ['rattlebone_draught', 'skeleton'],
      ['haunting_draught', 'ghost'],
      ['batwing_draught', 'bat'],
    ]) {
      await chat(`/dev give ${item}`);
      await ev(`window.__game.sim.useItem('${item}')`);
      await frames(16, 250);
      await camera(tag === 'bat' ? 5 : 6.5, 0.12, Math.PI * 0.8);
      await shot(`potion_${tag}`);
    }
  }

  if (SECTIONS.has('gourd')) {
    // The Swelling Gourd, framed: him pulled, then frozen in place, the gourd up front.
    const find = (tpl) =>
      ev(
        `(()=>{const e=[...window.__game.sim.entities.values()].find(e=>e.templateId==='${tpl}'&&!e.dead);return e?{id:e.id,x:e.pos.x,z:e.pos.z,f:e.facing}:null;})()`,
      );
    await chat('/daynight noon');
    await chat('/dev scarecrow');
    await frames(16, 400);
    await curtainDown();
    let b = await find('gourdlight_thatchgrin');
    await ev(
      `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.targetEntity(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
    );
    await frames(10, 250);
    await chat('/dev scarecrow swell');
    await frames(2, 200);
    await chat('/dev freezemobs on');
    b = await find('gourdlight_thatchgrin');
    const g = await find('gourdlight_swelling_gourd');
    if (g && b) {
      const ux = g.x - b.x;
      const uz = g.z - b.z;
      const ul = Math.hypot(ux, uz) || 1;
      // three quarters round from him: the gourd near, him beyond and to the side
      const ang = Math.atan2(ux, uz) + 0.9;
      const at = { x: g.x + Math.sin(ang) * 9, z: g.z + Math.cos(ang) * 9 };
      await standAt(at.x, at.z, (g.x * 2 + b.x) / 3, (g.z * 2 + b.z) / 3, 10, 0.18, 0, 6);
      await ev(`window.__game.sim.targetEntity(${g.id})`);
      await shot('gourd_alive');
      await ev(`(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;k.swellFuse=8;})()`);
      await frames(3, 250);
      await shot('gourd_swollen', 0);
      await chat('/daynight midnight');
      await ev(`(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;k.swellFuse=6;})()`);
      await frames(3, 200);
      await shot('gourd_swollen_night', 0);
      await chat('/daynight noon');
      await frames(2, 200);
      const far = { x: g.x + Math.sin(ang) * 15, z: g.z + Math.cos(ang) * 15 };
      await chat('/dev freezemobs off');
      await ev(
        `(()=>{const s=window.__game.sim;const b=s.entities.get(${b.id});s.dealDamage(s.player,b,5,false,'physical','Poke','hit',true);})()`,
      );
      await frames(2, 150);
      await chat('/dev scarecrow swell');
      const g3 = (await find('gourdlight_swelling_gourd')) ?? g;
      await standAt(
        g3.x + Math.sin(ang) * 15,
        g3.z + Math.cos(ang) * 15,
        g3.x,
        g3.z,
        16,
        0.3,
        0,
        2,
      );
      await ev(
        `(()=>{const fx=window.__game.renderer.scarecrowFx;window.__burstCalls=0;const o=fx.gourdBursts.bind(fx);fx.gourdBursts=(...a)=>{window.__burstCalls++;window.__burstArgs=a;return o(...a);};})()`,
      );
      console.log(
        'KIT BEFORE',
        await ev(
          `JSON.stringify((()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;return k&&{swellId:k.swellId,fuse:k.swellFuse};})())`,
        ),
      );
      await ev(`(()=>{const k=window.__game.sim.ctx.seasonal.scarecrow.kit;k.swellFuse=0.06;})()`);
      await sleep(20);
      for (const [i, wait] of [
        [0, 0],
        [1, 120],
        [2, 160],
        [3, 250],
      ]) {
        await sleep(wait);
        await shot(`gourd_burst_${i}`, 0);
      }
      const gone = await find('gourdlight_swelling_gourd');
      console.log(
        'GOURD AFTER BURST',
        JSON.stringify(gone),
        await ev(`JSON.stringify([window.__burstCalls, window.__burstArgs])`),
      );
    }
    // a second gourd, broken: his reel
    await chat('/dev freezemobs off');
    await chat('/dev scarecrow swell');
    await frames(4, 200);
    await chat('/dev freezemobs on');
    b = await find('gourdlight_thatchgrin');
    const g2 = await find('gourdlight_swelling_gourd');
    if (g2 && b) {
      const sx = -(g2.z - b.z);
      const sz = g2.x - b.x;
      const sl = Math.hypot(sx, sz) || 1;
      const mid = { x: (g2.x + b.x) / 2, z: (g2.z + b.z) / 2 };
      await standAt(mid.x + (sx / sl) * 14, mid.z + (sz / sl) * 14, mid.x, mid.z, 12, 0.22, 0, 4);
      await chat('/dev scarecrow break');
      await sleep(120);
      await shot('gourd_break', 0);
      await sleep(500);
      await shot('boss_stunned', 0);
      const near = { x: b.x + (sx / sl) * 10, z: b.z + (sz / sl) * 10 };
      await standAt(near.x, near.z, b.x, b.z, 8, 0.02, 0, 1);
      await sleep(500);
      await shot('boss_stunned_close', 0);
    }
    await chat('/dev freezemobs off');
  }

  if (SECTIONS.has('overview')) {
    // top-down looks over each city square, to judge where a stall reads best
    await chat('/daynight noon');
    for (const [name, x, z] of [
      ['fenbridge', 0, 296],
      ['highwatch', -2, 660],
    ]) {
      await chat(`/dev tp ${x} ${z}`);
      await frames(14, 350);
      await curtainDown();
      await standAt(x, z, x, z + 1, 34, 1.25, 0, 8);
      await shot(`overview_${name}`);
    }
  }
} finally {
  await browser.close();
}
