// Measure a live Legendary valley on the Low preset at a landscape-phone viewport.
// The setup searches the real deterministic generator for a seed with at least
// 25 planned enemies, then enters that valley through the normal treasure-map flow.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { Profiler } from '../../profiler/harness.mjs';

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Performance evidence output override.
const outputPath =
  process.env.PERF_OUTPUT ?? 'docs/screenshots/buried-hoard-valley/performance-low-landscape.json';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Performance CLI input is not a Turbo task dependency.
const sampleMs = Number(process.env.SAMPLE_MS ?? 10000);
const profiler = new Profiler({
  gameUrl: process.env.GAME_URL ?? 'http://localhost:5182',
  width: 844,
  height: 390,
  dpr: 1,
  targetFps: 60,
  headless: false,
});

try {
  await profiler.launch();
  await profiler.enter({
    mode: 'offline',
    tier: 'low',
    selectorTimeoutMs: 90000,
    gameBootTimeoutMs: 180000,
    extraQuery: '&governor=0',
  });
  const setup = await profiler.page.evaluate(async () => {
    const game = window.__game;
    const sim = game.sim;
    const { TREASURE_MAP_RIFT_TIER, TREASURE_SITES } = await import(
      '/src/sim/content/treasure_maps.ts'
    );
    const { RIFT_RANK_BASE_LEVEL } = await import('/src/sim/rift/ranks.ts');
    const { generateRiftFloor } = await import('/src/sim/rift/rift_gen.ts');
    const { makeVaultSeed } = await import('/src/sim/rift/vault_seed.ts');
    const { Rng } = await import('/src/sim/rng.ts');
    const baseLevel = RIFT_RANK_BASE_LEVEL[TREASURE_MAP_RIFT_TIER.legendary];
    let candidate = null;
    for (let initialSeed = 1; initialSeed <= 20000; initialSeed++) {
      const rng = new Rng(initialSeed);
      const site = TREASURE_SITES[rng.int(0, TREASURE_SITES.length - 1)];
      const seed = makeVaultSeed(3, rng.int(0, 0x007fffff), {
        open: true,
        zoneId: site.zoneId,
      });
      const floor = generateRiftFloor(seed, baseLevel, 0);
      if (floor.spawns.length >= 25) {
        candidate = { initialSeed, seed, site, floor };
        break;
      }
    }
    if (!candidate) throw new Error('No 25-enemy Legendary valley seed found');

    sim.devCommands = true;
    sim.chat('/dev level 20');
    sim.chat('/dev god');
    sim.chat('/dev noaggro');
    sim.chat('/dev map legendary');
    sim.rng.s = candidate.initialSeed;
    sim.useItem('treasure_map_legendary');
    if (sim.treasureMap?.seed !== candidate.seed) {
      throw new Error('Treasure-map seed diverged from the measured candidate');
    }
    sim.chat(`/dev tp ${candidate.site.x} ${candidate.site.z}`);
    sim.player.facing = 0;
    sim.useItem('treasure_map_legendary');
    const entrance = [...sim.entities.values()]
      .filter((entity) => entity.templateId === 'hoard_entrance')
      .sort((a, b) => b.id - a.id)[0];
    if (!entrance) throw new Error('Hoard entrance did not spawn');
    sim.player.pos.x = entrance.pos.x;
    sim.player.pos.z = entrance.pos.z;
    sim.player.prevPos.x = entrance.pos.x;
    sim.player.prevPos.z = entrance.pos.z;
    sim.player.targetId = entrance.id;
    sim.interact();
    return {
      initialSeed: candidate.initialSeed,
      vaultSeed: candidate.seed,
      zoneId: candidate.site.zoneId,
      plannedEnemies: candidate.floor.spawns.length,
    };
  });

  await profiler.page.waitForFunction(() => window.__game.sim.riftFloor !== null, {
    timeout: 30000,
  });
  await profiler.page.waitForFunction(
    () => getComputedStyle(document.querySelector('#loading-screen')).display === 'none',
    { timeout: 180000 },
  );
  await profiler.page.waitForFunction(
    (zoneId) =>
      window.__game.renderer.scene.getObjectByName(`hoard-valley:${zoneId}`) !== undefined,
    { timeout: 60000 },
    setup.zoneId,
  );
  const live = await profiler.page.evaluate(async () => {
    const game = window.__game;
    const sim = game.sim;
    const view = sim.riftFloor;
    const { generateRiftFloor } = await import('/src/sim/rift/rift_gen.ts');
    const floor = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
    const origin = view.origin;
    const playerZ = origin.z + floor.outdoor.valleyStartZ + 20;
    sim.player.pos.x = origin.x;
    sim.player.pos.z = playerZ;
    sim.player.prevPos.x = origin.x;
    sim.player.prevPos.z = playerZ;
    sim.player.facing = 0;
    game.renderer.editorCam = {
      pos: game.renderer.camera.position.clone().set(origin.x + 2, 10, playerZ - 12),
      target: game.renderer.camera.position.clone().set(origin.x, 2.4, playerZ + 35),
    };
    game.renderer.camera.position.copy(game.renderer.editorCam.pos);
    game.renderer.cameraLookAt.copy(game.renderer.editorCam.target);
    return {
      regeneratedEnemies: floor.spawns.length,
      outdoorZone: floor.outdoor.zoneId,
      worldEntities: game.world.entities.size,
    };
  });

  await new Promise((resolve) => setTimeout(resolve, 8000));
  await profiler.sample({ ms: 5000, label: 'legendary-valley-warmup' });
  const sample = await profiler.sample({ ms: sampleMs, label: 'legendary-valley-low-landscape' });
  await profiler.page.evaluate(async () => {
    const { sim, renderer, input } = window.__game;
    const view = sim.riftFloor;
    const { generateRiftFloor } = await import('/src/sim/rift/rift_gen.ts');
    const floor = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
    sim.player.pos.x = view.origin.x;
    sim.player.pos.z = view.origin.z + floor.entry.z;
    Object.assign(sim.player.prevPos, sim.player.pos);
    renderer.editorCam = null;
    input.camPitch = 0.95;
    input.camDist = 30;
    const start = performance.now();
    window.__cavernOrbit = true;
    const orbit = () => {
      if (!window.__cavernOrbit) return;
      input.camYaw = (performance.now() - start) / 2500;
      requestAnimationFrame(orbit);
    };
    orbit();
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const orbitSample = await profiler.sample({
    ms: sampleMs,
    label: 'legendary-cavern-camera-orbit',
  });
  await profiler.page.evaluate(() => {
    window.__cavernOrbit = false;
  });
  const evidence = {
    measuredAt: new Date().toISOString(),
    viewport: { width: 844, height: 390, deviceScaleFactor: 1 },
    graphicsPreset: 'low',
    adaptiveGovernor: false,
    browserMode: 'headed-real-gpu',
    warmupMs: 5000,
    sampleMs,
    machine: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    valley: { ...setup, ...live },
    sample,
    orbitSample,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify({ outputPath, valley: evidence.valley, frame: sample.frame }, null, 2),
  );
} finally {
  await profiler.close();
}
