// Flicker probe for the reworked dungeons: boots an offline world on a running
// dev server, enters a dungeon, stands at a spot and, every animation frame
// for a few seconds while the camera turns slowly, records which body each
// creature view draws (hidden, articulated rig, or frozen far mesh) and why.
// Prints the views whose drawn body flipped, with their distance, so a flicker
// "when a bit far away" can be traced to its cause. Evidence tooling, not a
// repo test.
//
//   node scripts/dungeon_flicker_probe.mjs <bastion|crypt|temple> [tpArea] [seconds]
//
// Env: SHOT_URL (http://127.0.0.1:5200/), SHOT_PRESET (4), SHOT_OUT (a
// screenshot directory; when set a short frame series is saved too).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5200/';
const DUNGEON = process.argv[2] ?? 'bastion';
const AREA = process.argv[3] ?? '';
const SECONDS = Number(process.argv[4] ?? 8);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const OUT = process.env.SHOT_OUT ?? '';
const SPIN = Number(process.env.CAM_SPIN ?? 0.004);
// PRESSURE_NOISE=1 replays a machine hovering at its frame budget: the budget
// pressure the far-LOD edge eases on wanders between 0.8 and 1.0 frame to frame
// (a headless GPU sits far above it, which pins the edge and hides the bug).
const NOISE = process.env.PRESSURE_NOISE === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charName: 'Probe',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const cmds = ['/dev level 20', '/dev god', `/dev ${DUNGEON} enter`];
  if (AREA) cmds.push(`/dev ${DUNGEON} tp ${AREA}`);
  for (const c of cmds) {
    await page.evaluate((x) => window.__game.world.chat(x), c);
    await sleep(1500);
  }
  await page.evaluate(() => {
    window.__game.world.player.devNoAggro = true;
  });
  await sleep(9000);
  // Sample every frame.
  await page.evaluate(
    (seconds, spin, noise) => {
      const g = window.__game;
      const r = g.renderer;
      if (noise) {
        let k = 0;
        Object.defineProperty(r, 'lastBudgetPressure', {
          configurable: true,
          get: () => {
            k += 0.37;
            return 0.9 + 0.1 * Math.sin(k);
          },
          set: () => {},
        });
      }
      const log = new Map();
      const edge = { min: 1e9, max: 0, pmin: 1e9, pmax: 0, frames: 0 };
      window.__edge = edge;
      const start = performance.now();
      window.__probeDone = false;
      const state = (v) => {
        if (!v.group.visible) return 'H';
        const vis = v.visual;
        if (!vis) return 'N';
        if (!vis.root.visible) return 'R0';
        if (vis.displayedFarBody) return 'F';
        return 'A';
      };
      const tick = () => {
        const now = performance.now();
        const p = g.world.player;
        const plan = r.characterLodPlan;
        if (plan) {
          const st = Math.sqrt(plan.staticRangeSq);
          edge.min = Math.min(edge.min, st);
          edge.max = Math.max(edge.max, st);
        }
        edge.pmin = Math.min(edge.pmin, r.lastBudgetPressure);
        edge.pmax = Math.max(edge.pmax, r.lastBudgetPressure);
        edge.frames++;
        for (const [id, v] of r.views) {
          const e = g.world.entities.get(id);
          if (!e || e.kind !== 'mob') continue;
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          const s = state(v);
          let rec = log.get(id);
          if (!rec) {
            rec = { id, t: e.templateId, last: s, flips: 0, seq: [], dmin: d, dmax: d };
            log.set(id, rec);
          }
          rec.dmin = Math.min(rec.dmin, d);
          rec.dmax = Math.max(rec.dmax, d);
          if (s !== rec.last) {
            rec.flips++;
            if (rec.seq.length < 24)
              rec.seq.push(
                `${rec.last}>${s}@${Math.round(now - start)}ms d=${d.toFixed(1)} far=${v.isFar} vis=${v.inDrawRange}`,
              );
            rec.last = s;
          }
        }
        g.input.camYaw += spin;
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else {
          window.__probe = [...log.values()];
          window.__probeDone = true;
        }
      };
      requestAnimationFrame(tick);
    },
    SECONDS,
    SPIN,
    NOISE,
  );
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    for (let i = 0; i < 6; i++) {
      await page.screenshot({ path: path.join(OUT, `probe_${DUNGEON}_${i}.png`) });
      await sleep(300);
    }
  }
  await page.waitForFunction(() => window.__probeDone === true, {
    timeout: (SECONDS + 60) * 1000,
  });
  const res = await page.evaluate(() => window.__probe);
  console.log('edge', JSON.stringify(await page.evaluate(() => window.__edge)));
  const flipped = res.filter((r) => r.flips > 0).sort((a, b) => b.flips - a.flips);
  console.log(`views=${res.length} flipped=${flipped.length}`);
  for (const r of flipped.slice(0, 40)) {
    console.log(
      `${r.t}#${r.id} flips=${r.flips} d=${r.dmin.toFixed(0)}..${r.dmax.toFixed(0)} ${r.seq.slice(0, 6).join(' | ')}`,
    );
  }
} finally {
  await browser.close();
}
