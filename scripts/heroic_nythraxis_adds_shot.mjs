// Visual proof of the three heroic Nythraxis adds and their models. Boots the
// offline game and stages each add close to the camera so its model is clear:
// Aldren the warrior (skel_warrior), Malric the priest (skel_necromancer, with
// his heal-channel beam onto a wounded boss), and Voss the stalker (skel_rogue).
//   PORT=5174 node scripts/heroic_nythraxis_adds_shot.mjs   (needs npm run dev)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const PORT = process.env.PORT ?? '5174';
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
await page.type('#char-name', 'Scout');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 45000 });
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 350));
}
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Stage one add (plus, for Malric, a wounded boss to receive the heal beam) a
// short distance in front of the camera, and target it so its frame shows.
async function stageAndShot(tid, file, withBoss) {
  const ok = await page.evaluate(
    ({ tid, withBoss }) => {
      const sim = window.__game.sim;
      const ctx = sim.ctx;
      const p = sim.player;
      // clear any previously staged mobs
      for (const e of [...ctx.entities.values()]) {
        if (e.kind === 'mob' && String(e.templateId).startsWith('nythraxis_heroic_')) {
          ctx.entities.delete(e.id);
        }
      }
      const base = [...ctx.entities.values()].find((e) => e.kind === 'mob');
      if (!base) return false;
      // Pin the player to a fixed origin each stage so all three add shots frame
      // identically (the warrior otherwise chases the targeted add between shots).
      window.__addShotOrigin = window.__addShotOrigin || { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      p.pos = { ...window.__addShotOrigin };
      p.prevPos = { ...p.pos };
      p.inCombat = false;
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
      const spawn = (templateId, dx, dz, scale, hp) => {
        const m = structuredClone(base);
        m.id = ctx.nextId++;
        m.templateId = templateId;
        m.name = templateId;
        m.scale = scale;
        m.level = 22;
        m.maxHp = hp;
        m.hp = hp;
        m.dead = false;
        m.hostile = true;
        m.auras = [];
        m.nythraxis = undefined;
        m.summonedIds = [];
        m.threat = new Map();
        const bx = p.pos.x + fx * 11 + dx;
        const bz = p.pos.z + fz * 11 + dz;
        m.pos = { x: bx, y: p.pos.y, z: bz };
        m.prevPos = { ...m.pos };
        m.spawnPos = { ...m.pos };
        m.facing = Math.atan2(p.pos.x - bx, p.pos.z - bz);
        m.prevFacing = m.facing;
        ctx.addEntity(m);
        return m.id;
      };
      const addId = spawn(tid, 0, 0, 1.7, 6000);
      if (withBoss) {
        const bossId = spawn('nythraxis_scourge_of_thornpeak', -10, 12, 2.4, 300000);
        const boss = ctx.entities.get(bossId);
        if (boss) boss.hp = Math.floor(boss.maxHp * 0.4); // wounded, so Malric heals it
      }
      p.targetId = addId;
      if (sim.setTarget) {
        try {
          sim.setTarget(p.id, addId);
        } catch {}
      }
      return true;
    },
    { tid, withBoss },
  );
  if (!ok) {
    console.log('stage failed for', tid);
    return;
  }
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log('shot', file);
}

await stageAndShot('nythraxis_heroic_warrior_add', 'heroic_add_aldren_warrior.png', false);
await stageAndShot('nythraxis_heroic_priest_add', 'heroic_add_malric_priest.png', true);
await stageAndShot('nythraxis_heroic_rogue_add', 'heroic_add_voss_stalker.png', false);

await browser.close();
console.log('done');
