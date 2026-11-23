// Evidence shots of Morthen's weapon IN THE GAME (the real renderer, the shipped
// GLB after optimize.mjs, the phaseClips stance swap): bursts of frames while he
// strikes with the bell staff, while the crest unfolds into the scythe (his Last
// Rites, forced by dropping his health), and while he reaps with it. The staff is
// modelled in his right fist and must stay there through every swing. Evidence
// tooling, not a repo test.
//
//   node scripts/morthen_staff_shot.mjs <outDir> [staff|scythe|all]
//
// Env: SHOT_URL (http://127.0.0.1:5198/), SHOT_W / SHOT_H (1280x800), SHOT_PRESET (4),
// SHOT_BURST (frames per burst, 24), SHOT_GAP_MS (between frames, 90).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5198/';
const OUT = process.argv[2] ?? path.join('tmp', 'morthen_staff');
const MODE = process.argv[3] ?? 'all';
const W = Number(process.env.SHOT_W ?? 1280);
const H = Number(process.env.SHOT_H ?? 800);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const BURST = Number(process.env.SHOT_BURST ?? 24);
const GAP = Number(process.env.SHOT_GAP_MS ?? 90);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACKS = ['c1', 'c2', 'c3', 'c4', 'p1', 'drake', 'p2', 'w1', 'w2', 'w3', 'w4', 'e1', 'e2'];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Staffwatch',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev crypt enter', '/dev crypt gates']) await chat(c, 1300);
  for (const p of PACKS) await chat(`/dev crypt kill ${p}`, 150);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'hollowCryptField') found = true;
      });
      return found;
    },
    { timeout: 120000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  await chat('/dev crypt tp ring', 2500);
  await chat('/dev crypt rise skip', 1500);
  /** Stand `dist` yards from Morthen, off his right side by `side` radians, facing
   *  him, the camera orbiting at yaw/pitch/dist around the player. */
  const stand = async (dist, side, yaw, pitch, camDist) =>
    page.evaluate(
      ([dist, side, yaw, pitch, camDist]) => {
        const w = window.__game.world;
        let m = null;
        for (const e of w.entities.values()) if (e.templateId === 'morthen' && !e.dead) m = e;
        if (!m) return false;
        const p = w.player;
        const a = m.facing + side;
        const g = w.ctx.groundPos(m.pos.x + Math.sin(a) * dist, m.pos.z + Math.cos(a) * dist);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
        p.prevFacing = p.facing;
        const input = window.__game.input;
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = camDist;
        return {
          dist: Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z),
          target: m.targetId ?? null,
          combat: !!m.inCombat,
          hp: m.hp / m.maxHp,
        };
      },
      [dist, side, yaw, pitch, camDist],
    );
  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
  };
  const report = async (tag) =>
    console.log(
      tag,
      JSON.stringify(
        await page.evaluate(() => {
          const w = window.__game.world;
          for (const e of w.entities.values())
            if (e.templateId === 'morthen')
              return {
                d: Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z),
                t: e.aggroTargetId,
                ai: e.aiState,
                dead: e.dead,
                hp: e.hp / e.maxHp,
              };
          return null;
        }),
      ),
    );
  const burst = async (tag) => {
    await report(tag);
    for (let i = 0; i < BURST; i++) {
      // keep the watcher standing through his blows
      await page.evaluate(() => {
        const p = window.__game.world.player;
        p.hp = p.maxHp;
      });
      await shot(`${tag}_${String(i).padStart(2, '0')}`);
      await sleep(GAP);
    }
    console.log('BURST', tag);
  };
  const setHp = async (frac) =>
    page.evaluate((f) => {
      for (const e of window.__game.world.entities.values())
        if (e.templateId === 'morthen' && !e.dead) e.hp = Math.max(1, Math.round(e.maxHp * f));
    }, frac);
  // Pull him: target him and swing, so he turns on us and strikes back.
  const pull = async () =>
    page.evaluate(() => {
      const w = window.__game.world;
      for (const e of w.entities.values())
        if (e.templateId === 'morthen' && !e.dead) {
          // pulled the way social aggro pulls a mob (no swing of ours)
          e.aiState = 'chase';
          e.aggroTargetId = w.player.id;
          e.inCombat = true;
          e.leashAnchor = { ...e.pos };
          e.threat?.set(w.player.id, 1000);
        }
    });
  if (MODE === 'staff' || MODE === 'all') {
    await stand(4, 0.2, 1.35, 0.12, 11);
    await pull();
    await sleep(2500);
    await stand(4, 0.2, 1.35, 0.12, 11);
    await burst('staff_side');
    await stand(4, 0.2, 0.55, 0.1, 10);
    await burst('staff_three_quarter');
  }
  if (MODE === 'scythe' || MODE === 'all') {
    await stand(6, 0.2, 0.9, 0.1, 12);
    await setHp(0.3);
    await sleep(150);
    await burst('transform');
    await sleep(1500);
    await stand(4, 0.2, 1.35, 0.12, 11);
    await burst('scythe_side');
    await stand(4, 0.2, 0.55, 0.1, 10);
    await burst('scythe_three_quarter');
  }
} finally {
  await browser.close();
}
