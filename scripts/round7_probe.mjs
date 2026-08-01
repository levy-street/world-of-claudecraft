// Round-7 diagnostic: dump the materials of meshes near a world point, with
// surface-detail markers and program cache keys, to verify the triplanar
// layer actually applied and its textures resolved.
// Usage: node scripts/round7_probe.mjs <x> <z> [radius]
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5182';
const X = Number(process.argv[2] ?? 12);
const Z = Number(process.argv[3] ?? -10);
const R = Number(process.argv[4] ?? 14);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=gl', '--enable-webgl', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
await page.goto(`${BASE_URL}?gfx=ultra`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await enterOfflineGame(page, { charName: 'Probe', settleMs: 2500, gameBootTimeoutMs: 120000 });
await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));

const out = await page.evaluate(
  (px, pz, radius) => {
    const g = window.__game;
    const seen = new Map();
    const v = new g.renderer.camera.position.constructor();
    g.renderer.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.getWorldPosition(v);
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > radius) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const key = m.uuid;
        if (seen.has(key)) continue;
        let cacheKey = '';
        try {
          cacheKey = typeof m.customProgramCacheKey === 'function' ? m.customProgramCacheKey() : '';
        } catch (e) {
          cacheKey = 'ERR ' + e.message;
        }
        seen.set(key, {
          mesh: o.name || '(unnamed)',
          mat: m.name || '(unnamed)',
          type: m.type,
          dist: Math.round(d * 10) / 10,
          surfaceDetail: m.userData?.surfaceDetail ?? null,
          eastbrookSemantic: m.userData?.eastbrookSurfaceSemantic ?? null,
          hasMap: Boolean(m.map),
          hasHook:
            typeof m.onBeforeCompile === 'function' && m.onBeforeCompile.name !== 'onBeforeCompile',
          cacheKey: cacheKey ? cacheKey.slice(0, 90) : '(default)',
        });
      }
    });
    return [...seen.values()].sort((a, b) => a.dist - b.dist);
  },
  X,
  Z,
  R,
);
for (const row of out) {
  console.log(
    `${row.dist}\t${row.mesh} | ${row.mat} | ${row.type} | detail=${row.surfaceDetail} sem=${row.eastbrookSemantic} map=${row.hasMap} key=${row.cacheKey}`,
  );
}
await browser.close();
