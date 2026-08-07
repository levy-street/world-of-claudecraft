// Captures the interact prompt + the hover highlight offline, and reports any
// shader-compile failure from the outline's ShaderMaterial.
//
// The renderer ships with checkShaderErrors OFF (a synchronous GPU roundtrip per
// link), so a broken outline shader would link, draw NOTHING, and say nothing:
// every structural check would still pass. The real guard here is therefore a
// PIXEL diff (hovered frame minus unhovered frame, counting gold), not a shell
// count. SHADER_DEBUG=1 additionally turns the compile checks back on, but it
// serializes ~80 program links under SwiftShader and can blow the entry guard's
// prewarm budget, so it is opt-in rather than the default.
//
// Needs the dev client running:  npm run dev -- --port 5249
//   GAME_URL=http://localhost:5249 node scripts/interact_prompt_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5249';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERR ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' || /shader|GLSL|compile|program/i.test(text)) {
    errors.push(`CONSOLE[${m.type()}] ${text}`);
  }
});

// SHADER_DEBUG=1 turns the synchronous compile checks back on. Off by default:
// under SwiftShader they serialize ~80 program links and blow the entry guard's
// prewarm budget, so the run is done in two passes when both are wanted.
const shaderDebug = process.env.SHADER_DEBUG === '1';
await page.goto(shaderDebug ? `${URL}/?shaderdebug=1` : URL, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Thorgar',
  settleMs: 5000,
  gameBootTimeoutMs: 120000,
});
console.log('offline boot:', booted);
if (!booted) {
  console.log('boot diagnostics:', errors.slice(0, 20).join('\n') || '(no errors captured)');
  await page.screenshot({ path: 'tmp/interact-boot-failed.png' });
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(1200);

// Walk the player onto the nearest NPC so the interact scan has a target, and
// pull the camera in so the NPC fills enough pixels to read a 1.6px rim.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.entities.get(sim.playerId);
  let best = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'npc') continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) return null;
  // Stand in interact range but OFF the camera axis, so the player model does
  // not sit in front of the NPC and hide the rim being verified.
  const angle = Math.atan2(p.pos.x - best.pos.x, p.pos.z - best.pos.z) + 0.55;
  p.pos = {
    x: best.pos.x + Math.sin(angle) * 3,
    y: best.pos.y,
    z: best.pos.z + Math.cos(angle) * 3,
  };
  p.facing = angle + Math.PI;
  window.__npcId = best.id;
  const i = window.__game.input;
  if (i) i.camDist = 6;
  return { id: best.id, templateId: best.templateId, dist: bestD };
});
console.log('staged NPC:', staged);
await sleep(1500);

// 1) The prompt: it repaints on its own 100ms scan cadence once in range.
await page.waitForFunction(
  () => {
    const el = document.querySelector('#interact-prompt');
    return !!el && getComputedStyle(el).display !== 'none';
  },
  { timeout: 10000, polling: 200 },
);
const promptText = await page.evaluate(() => {
  const el = document.querySelector('#interact-prompt');
  const rect = el.getBoundingClientRect();
  return {
    name: el.querySelector('.ip-name')?.textContent,
    verb: el.querySelector('.ip-verb')?.textContent,
    cap: el.querySelector('.ip-cap')?.textContent,
    glyphSvg: !!el.querySelector('.ip-glyph svg'),
    // The slot itself must stay zero-height so showing it moves no other row.
    slotHeight: rect.height,
    boxTop: el.querySelector('.ip-box')?.getBoundingClientRect().top,
  };
});
console.log('prompt:', promptText);

// The zero-layout-shift claim, measured: the player frame must not move when the
// prompt appears and disappears.
const shift = await page.evaluate(async () => {
  const frame = () => document.querySelector('#player-frame').getBoundingClientRect().top;
  const withPrompt = frame();
  const el = document.querySelector('#interact-prompt');
  const saved = el.style.display;
  el.style.display = 'none';
  await new Promise((r) => requestAnimationFrame(r));
  const withoutPrompt = frame();
  el.style.display = saved;
  return { withPrompt, withoutPrompt };
});
console.log('player-frame top with/without prompt:', shift);

await page.screenshot({ path: 'tmp/interact-prompt.png' });

// 2) The hover outline: move the real mouse onto the NPC's screen position.
const hover = await page.evaluate(() => {
  const g = window.__game;
  const npc = g.sim.entities.get(window.__npcId);
  const p = g.renderer.worldToScreen(npc.pos.x, npc.pos.y + 1.1, npc.pos.z);
  return { x: Math.round(p.x), y: Math.round(p.y), behind: p.behind };
});
console.log('npc screen point:', hover);
await page.mouse.move(hover.x, hover.y);
await sleep(400);
await page.mouse.move(hover.x + 1, hover.y);
await sleep(900);

// PIXEL PROOF, not just an object-graph count. The renderer ships with
// checkShaderErrors off, so a broken outline shader would link, draw nothing,
// and report nothing: the shells would still be in the scene and every
// structural assertion would pass. Diff a hovered frame against an unhovered one
// over the NPC and count pixels that turned gold.
const goldPixelDiff = async () => {
  const box = { x: hover.x - 90, y: hover.y - 110, width: 180, height: 220 };
  await page.mouse.move(5, 750); // off the NPC, still on the canvas
  await sleep(900);
  const before = (await page.screenshot({ clip: box, encoding: 'base64' })).toString();
  await page.screenshot({ clip: box, path: 'tmp/interact-highlight-off.png' });
  await page.mouse.move(hover.x, hover.y);
  await sleep(400);
  await page.mouse.move(hover.x + 1, hover.y);
  await sleep(900);
  const after = (await page.screenshot({ clip: box, encoding: 'base64' })).toString();
  await page.screenshot({ clip: box, path: 'tmp/interact-highlight-on.png' });
  return page.evaluate(
    async (a, b, w, h) => {
      const read = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const [d0, d1] = [await read(a), await read(b)];
      let gained = 0;
      let sample = null;
      for (let i = 0; i < d0.length; i += 4) {
        const [r, g, bl] = [d1[i], d1[i + 1], d1[i + 2]];
        // Gold rim: warm, bright, and clearly not what was there before.
        const gold = r > 140 && g > 110 && bl < g - 30 && r - bl > 55;
        const changed = Math.abs(r - d0[i]) + Math.abs(g - d0[i + 1]) + Math.abs(bl - d0[i + 2]);
        if (gold && changed > 40) {
          gained++;
          if (!sample) sample = { r, g, b: bl, was: [d0[i], d0[i + 1], d0[i + 2]] };
        }
      }
      return { gained, sample };
    },
    before,
    after,
    box.width,
    box.height,
  );
};
const gold = await goldPixelDiff();
console.log('gold pixels gained on hover:', gold);

const outline = await page.evaluate(() => {
  const g = window.__game;
  let shells = 0;
  let visible = 0;
  g.renderer.scene.traverse((o) => {
    if (o.name !== 'interactOutline') return;
    shells++;
    let vis = o.visible;
    for (let n = o.parent; n && vis; n = n.parent) vis = n.visible;
    if (vis) visible++;
  });
  return { shells, visible, cursor: document.body.style.cursor || null };
});
console.log('outline shells in scene:', outline);
await page.screenshot({ path: 'tmp/interact-highlight.png' });

// 3) The gather-node leg. Nodes are a DIFFERENT scene path from entity views:
// string-keyed, not numeric, and their group is matrix-frozen
// (freezeStaticMatrices), which is exactly the case where a shell child could
// end up with a world matrix nobody ever updates. Verify the prompt names it and
// the rim actually lands.
const node = await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.entities.get(g.sim.playerId);
  const mesh = g.renderer.gatherNodeMeshes.find((o) => typeof o.userData.gatherNodeId === 'string');
  if (!mesh) return null;
  const w = new mesh.position.constructor();
  mesh.getWorldPosition(w);
  // Stand inside INTERACT_RANGE (5yd) so the prompt has the node to name.
  p.pos = { x: w.x + 2.2, y: w.y, z: w.z + 2.2 };
  p.facing = Math.atan2(w.x - p.pos.x, w.z - p.pos.z);
  // A node sits ON the ground, so the chase camera projects it below the
  // viewport, behind the HUD, where a pointermove never reaches the canvas.
  // editorCam is the renderer's own free-cam override (updateCamera honors it
  // and returns early), so frame the node directly instead of fighting the
  // chase rig's pitch clamp. The pick raycast and worldToScreen both read the
  // same this.camera, so the hover is genuine.
  const V = w.constructor;
  g.renderer.editorCam = {
    pos: new V(w.x + 3.4, w.y + 2.4, w.z + 3.4),
    target: new V(w.x, w.y + 0.35, w.z),
  };
  return { id: mesh.userData.gatherNodeId };
});
if (node) {
  // Let the camera settle at the new position before projecting the node again.
  await sleep(1500);
  const point = await page.evaluate((id) => {
    const g = window.__game;
    const mesh = g.renderer.gatherNodeMeshes.find((o) => o.userData.gatherNodeId === id);
    const w = new mesh.position.constructor();
    mesh.getWorldPosition(w);
    const s = g.renderer.worldToScreen(w.x, w.y + 0.4, w.z);
    // Report what the point actually lands on: an HTML element other than the
    // game canvas means the canvas pointermove never fires and a "no rim" result
    // would be a staging artifact, not a defect.
    const over = document.elementFromPoint(s.x, s.y);
    return {
      x: Math.round(s.x),
      y: Math.round(s.y),
      behind: s.behind,
      over: over ? `${over.tagName.toLowerCase()}#${over.id || '-'}` : null,
    };
  }, node.id);
  const onScreen =
    !point.behind && point.x > 0 && point.y > 0 && point.x < 1280 && point.y < 700 && !!point.over;
  if (!onScreen) console.log('gather node did not project into the canvas:', point);
  await page.mouse.move(point.x, point.y);
  await sleep(400);
  await page.mouse.move(point.x + 1, point.y);
  await sleep(1000);
  const nodeState = await page.evaluate(() => {
    let shells = 0;
    window.__game.renderer.scene.traverse((o) => {
      if (o.name === 'interactOutline') shells++;
    });
    const el = document.querySelector('#interact-prompt');
    return {
      shells,
      promptName: el.querySelector('.ip-name')?.textContent,
      promptVerb: el.querySelector('.ip-verb')?.textContent,
      promptShown: getComputedStyle(el).display !== 'none',
    };
  });
  console.log('gather node:', node.id, point, nodeState);
  if (onScreen) {
    // Clamp the crop into the viewport: an off-viewport clip makes
    // Page.captureScreenshot hang until protocolTimeout rather than error.
    const x = Math.min(Math.max(0, point.x - 110), 1280 - 220);
    const y = Math.min(Math.max(0, point.y - 110), 760 - 220);
    await page.screenshot({
      path: 'tmp/interact-node.png',
      clip: { x, y, width: 220, height: 220 },
    });
  }
} else {
  console.log('gather node: none in the scene, skipped');
}

// 4) Walking out of range must drop the prompt, and pointing at empty world must
// drop the rim. (The settings toggles themselves are pinned by the unit tests;
// what needs a real frame is that both affordances actually let go.)
await page.evaluate(() => {
  const g = window.__game;
  g.renderer.editorCam = null; // hand the camera back to the chase rig
  const p = g.sim.entities.get(g.sim.playerId);
  p.pos = { x: p.pos.x + 60, y: p.pos.y, z: p.pos.z + 60 };
});
await page.mouse.move(20, 20);
await sleep(900);
const cleared = await page.evaluate(() => {
  let shells = 0;
  window.__game.renderer.scene.traverse((o) => {
    if (o.name === 'interactOutline') shells++;
  });
  return {
    promptDisplay: getComputedStyle(document.querySelector('#interact-prompt')).display,
    shells,
  };
});
console.log('after walking away + pointing at empty world:', cleared);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page/shader errors');
await browser.close();
