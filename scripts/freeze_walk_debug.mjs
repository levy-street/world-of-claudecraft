// Self-driving freeze debugger: boots the offline world (ultra tier so the heavy
// PBR/standard materials exist), installs a freeze logger, then WALKS the player
// north with real movement input so content streams in gradually (like real play),
// capturing every frame that compiles a new WebGL program. Each new program's
// cacheKey is classified by subsystem so we can see what the prewarm misses.
//
// The cacheKey set is GPU-independent (which programs the content needs), so even
// on swiftshader this tells us exactly what to add to the prewarm; we then verify
// the fix by re-running and confirming the program no longer compiles mid-walk.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const GFX = process.env.PERF_GFX ?? 'ultra';
const KLASS = process.env.PERF_CLASS ?? 'warrior';
const WALK_MS = Number(process.env.WALK_MS ?? 14000);
const HEADLESS = process.env.HEADED === '1' ? false : 'new';
const OUT =
  process.env.PERF_OUT ??
  path.join('tmp', `freeze-walk-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Classify a program cacheKey into the subsystem that owns it, from the shader
// type prefix + the onBeforeCompile signature.
function classify(k) {
  if (k.startsWith('depth') || k.startsWith('distanceRGBA')) return 'shadow-depth';
  if (k.startsWith('points')) return 'vfx-points';
  if (k.startsWith('sprite')) return 'vfx-sprite';
  if (/^\d+,\d+,/.test(k)) return 'custom-shader(vfx/post/sky/water)';
  if (k.includes('uRimBoost')) return 'character/unit (rim)';
  if (k.includes('windAmt')) return 'foliage (wind)';
  if (k.includes('uFadeFar')) return 'grass';
  if (k.includes('uTime')) return 'animated (water/fx/uTime)';
  if (k.startsWith('phong')) return 'water/phong';
  if (k.startsWith('basic')) return 'basic (decal/billboard/ui)';
  if (k.startsWith('physical') || k.startsWith('standard') || k.startsWith('lambert'))
    return 'world/prop (opaque)';
  return 'other';
}

async function boot(page) {
  const url = new URL(BASE_URL);
  url.searchParams.set('perf', '');
  url.searchParams.set('perfTrace', '1');
  url.searchParams.set('gfx', GFX);
  // Tiny viewport: swiftshader render cost scales with pixels, but the set of
  // shader PROGRAMS the content needs does not. A small canvas lets us step north
  // fast without every frame being a multi-second rasterisation "freeze".
  await page.setViewport({ width: 480, height: 320 });
  await page.evaluateOnNewDocument(() => {
    window.__armFreeze = () => {
      const g = window.__game,
        r = g.renderer,
        info = r.webgl.info;
      window.__freezes = [];
      const seenKeys = new Set((info.programs ?? []).map((p) => p.cacheKey ?? ''));
      window.__benchBaseKeys = [...seenKeys];
      let lastT = performance.now(),
        lastProgs = info.programs?.length ?? 0;
      const loop = () => {
        const now = performance.now(),
          dt = now - lastT;
        lastT = now;
        const progs = info.programs?.length ?? 0,
          dProg = progs - lastProgs;
        lastProgs = progs;
        if (dt >= 40 || dProg > 0) {
          const newKeys = [];
          for (const p of info.programs ?? []) {
            const k = p.cacheKey ?? '';
            if (!seenKeys.has(k)) {
              seenKeys.add(k);
              newKeys.push(k);
            }
          }
          let lf = null;
          try {
            lf = g.perf.report()?.renderer?.lastFrame ?? null;
          } catch {}
          const pp = g.sim.player.pos;
          window.__freezes.push({
            dtMs: Math.round(dt),
            dProg,
            x: Math.round(pp.x),
            z: Math.round(pp.z),
            createdViewTypes: lf?.createdViewTypes ?? null,
            newKeys,
          });
        }
        window.__freezeRAF = requestAnimationFrame(loop);
      };
      window.__freezeRAF = requestAnimationFrame(loop);
    };
  });
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.$eval('#btn-offline', (el) => el.click());
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.$eval('#char-name', (el) => {
    el.value = 'FreezeWalk';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval(`#offline-select .mini-class[data-class="${KLASS}"]`, (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  await page.waitForFunction(
    () =>
      Boolean(window.__game?.sim?.player && window.__game?.renderer && window.__game?.perf?.report),
    { timeout: 120000 },
  );
  await sleep(3500); // let prewarm finish + settle
}

async function run() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // REAL_GPU=1 (with HEADED=1) drops the swiftshader override so Chrome uses the
  // host GPU via DISPLAY/Wayland - the only way to measure real shader-link times.
  const realGpu = process.env.REAL_GPU === '1';
  const args = realGpu
    ? ['--window-size=900,600', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: HEADLESS,
    args,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  try {
    await boot(page);
    const tier = await page.evaluate(() => window.__game.perf.report().renderer?.tier);
    const glRenderer = await page.evaluate(
      () => window.__game.perf.report().renderer?.glRenderer ?? '?',
    );
    console.log(`GL renderer: ${glRenderer}`);
    const baseProgs = await page.evaluate(
      () => window.__game.renderer.webgl.info.programs?.length ?? 0,
    );

    // Arm the logger AFTER prewarm, then step the player north so content streams
    // in. Teleport-stepping (vs real walking) is reliable on slow swiftshader and
    // still triggers the same lazy material/program builds; we want the program
    // SET that compiles, not the streaming dynamics.
    await page.evaluate(() => window.__armFreeze());
    const startZ = -10;
    const endZ = 170;
    for (let z = startZ; z <= endZ; z += 8) {
      await page.evaluate((z) => {
        const p = window.__game.sim.player.pos;
        p.x = 0;
        p.z = z;
        if (window.__game.sim.player.vel) {
          window.__game.sim.player.vel.x = 0;
          window.__game.sim.player.vel.z = 0;
        }
      }, z);
      await sleep(700); // a couple of tiny-viewport frames: enough to build + compile
    }

    const freezes = await page.evaluate(() => window.__freezes ?? []);
    const baseKeys = await page.evaluate(() => window.__benchBaseKeys ?? []);

    // Classify.
    const byClass = {};
    let totalNew = 0;
    for (const f of freezes) {
      for (const k of f.newKeys) {
        totalNew++;
        const c = classify(k);
        byClass[c] = (byClass[c] ?? 0) + 1;
      }
    }
    const artifact = {
      tier,
      glRenderer,
      baseProgs,
      startZ,
      endZ,
      walkMs: WALK_MS,
      totalNewPrograms: totalNew,
      byClass,
      baseKeys,
      freezes,
      errors,
    };
    fs.writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

    console.log(
      `\n=== freeze walk debug  tier=${tier}  z ${startZ} -> ${endZ}  baseProgs=${baseProgs} ===`,
    );
    console.log(`total NEW programs compiled while walking: ${totalNew}`);
    console.log('\n-- by subsystem --');
    for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(3)}  ${c}`);
    console.log('\n-- worst frames (dtMs >= 80 or dProg >= 3) --');
    for (const f of freezes
      .filter((f) => f.dtMs >= 80 || f.dProg >= 3)
      .sort((a, b) => b.dProg - a.dProg)
      .slice(0, 12)) {
      const classes = {};
      for (const k of f.newKeys) {
        const c = classify(k);
        classes[c] = (classes[c] ?? 0) + 1;
      }
      const cs = Object.entries(classes)
        .map(([c, n]) => `${n}x ${c}`)
        .join(', ');
      console.log(
        `  ${String(f.dtMs).padStart(5)}ms @${f.x},${f.z} +${f.dProg}prog  views=${f.createdViewTypes?.join('|') ?? '-'}  ${cs}`,
      );
    }
    console.log(`\nwrote ${OUT}`);
    if (errors.length)
      console.error(`\n${errors.length} page errors:\n${errors.slice(0, 8).join('\n')}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
