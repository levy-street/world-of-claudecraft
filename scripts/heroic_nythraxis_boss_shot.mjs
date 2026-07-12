// Visual proof of the Heroic Nythraxis encounter. Boots the offline game and
// stages the heroic Nythraxis boss (skel_golem) with the three heroic adds
// (Aldren skel_warrior / Malric skel_necromancer / Voss skel_rogue) and the
// stacking Dread Curse on the player, so the encounter's models and target ring
// render together for a visual proof. A solo offline client cannot claim the
// 10-player arena, so the group is staged in the open world by templateId.
//   PORT=5173 node scripts/heroic_nythraxis_boss_shot.mjs   (needs npm run dev)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const PORT = process.env.PORT ?? '5173';
const URL = process.env.GAME_URL ?? `http://localhost:${PORT}`;
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 40000 });
const jsClick = (s) => page.evaluate((x) => document.querySelector(x)?.click(), s);
await new Promise((r) => setTimeout(r, 500));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Champion');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 45000 });
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 350));
}
// Dismiss the new-adventurer tutorial overlay (it covers the target frame).
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Stage the heroic Nythraxis boss and the three adds in the overworld by cloning
// an existing mob onto each template (the renderer picks each model by templateId
// from the manifest map), then the stacking Dread Curse on the player.
const staged = await page.evaluate(() => {
  const sim = window.__game.sim;
  const ctx = sim.ctx;
  const pid = sim.player.id;
  const p = sim.player;
  const ents = [...ctx.entities.values()];
  const base = ents.find((e) => e.kind === 'mob');
  if (!base) return { ok: false, reason: 'no base mob to clone' };
  // Read the camera forward direction so the group lands in view, wherever the
  // follow-cam is pointing.
  const cam = window.__game.camera || window.__game.renderer?.camera;
  let fx = 0;
  let fz = 1;
  if (cam) {
    fx = -Math.sin(cam.rotation?.y ?? 0);
    fz = -Math.cos(cam.rotation?.y ?? 0);
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
  }
  const dist = 17;
  const cx = p.pos.x + fx * dist;
  const cz = p.pos.z + fz * dist;
  const spawn = (tid, dx, dz, scale, hp) => {
    const m = structuredClone(base);
    m.id = ctx.nextId++;
    m.templateId = tid;
    m.name = tid;
    m.scale = scale;
    m.level = 22;
    m.maxHp = hp;
    m.hp = hp;
    m.dead = false;
    m.hostile = true;
    m.pos = { x: cx + dx, y: p.pos.y, z: cz + dz };
    m.prevPos = { ...m.pos };
    m.spawnPos = { ...m.pos };
    m.facing = Math.PI;
    m.prevFacing = Math.PI;
    m.auras = [];
    m.nythraxis = undefined;
    m.summonedIds = [];
    m.threat = new Map();
    ctx.addEntity(m);
    return m.id;
  };
  const bossId = spawn('nythraxis_scourge_of_thornpeak', 0, 3, 2.6, 300000);
  spawn('nythraxis_heroic_warrior_add', -13, -6, 1.25, 4000);
  spawn('nythraxis_heroic_priest_add', 0, -9, 1.1, 3600);
  spawn('nythraxis_heroic_rogue_add', 13, -6, 1.2, 3800);
  sim.applyAura(p, {
    id: 'nythraxis_dread_curse',
    name: 'Dread Curse',
    kind: 'vulnerability',
    remaining: 45,
    duration: 45,
    value: 0.8,
    stacks: 8,
    sourceId: bossId,
    school: 'shadow',
  });
  p.targetId = bossId;
  if (sim.setTarget) {
    try {
      sim.setTarget(pid, bossId);
    } catch {}
  }
  // Face the group.
  p.facing = 0;
  p.prevFacing = 0;
  return { ok: true, bossId };
});
console.log('staged:', JSON.stringify(staged));
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/heroic_boss_encounter.png` });

// Also grab the target frame + player debuffs region (top-center HUD).
await page.screenshot({
  path: `${OUT}/heroic_boss_frames.png`,
  clip: { x: 500, y: 0, width: 600, height: 220 },
});
console.log('done');
await browser.close();
