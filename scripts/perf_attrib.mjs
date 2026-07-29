// Graphics-setting GPU cost attribution for the insane preset.
//
// Each row starts from a fresh page load, parks the camera at the frozen
// town-idle waypoint, and changes one GfxSettings field to its low-preset
// value through the dev-only gfxo query parameter. The adaptive governor stays
// off so it cannot change visual density during a sample.
//
//   node scripts/perf_attrib.mjs
//   node scripts/perf_attrib.mjs --url http://localhost:5176
//   node scripts/perf_attrib.mjs --url http://localhost:5176 --ms 4000
//   node scripts/perf_attrib.mjs --url http://localhost:5176 --dpr 2.5
import { formatAttributionTable } from './lib/perf_attrib_math.mjs';
import { PERF_ATTRIB_CASES } from './lib/perf_attrib_plan.mjs';
import { Profiler } from './profiler/harness.mjs';

const DEFAULT_URL = 'http://localhost:5173';
const DEFAULT_SAMPLE_MS = 4000;
const INSANE_PRESET = 6;
const TOWN = { x: 0, z: -14, facing: 0 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'headless') {
      args.headless = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
  }
  return args;
}

function sampleFps(sample) {
  const fps = sample.frame?.fpsMean ?? sample.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`sample ${sample.label} did not produce a positive finite FPS value`);
  }
  return fps;
}

async function seedInsaneSettings(profiler) {
  await profiler.page.evaluateOnNewDocument((preset) => {
    try {
      const key = 'woc_settings';
      const current = JSON.parse(localStorage.getItem(key) ?? '{}');
      current.fullscreen = 0;
      current.graphicsPreset = preset;
      localStorage.setItem(key, JSON.stringify(current));
    } catch {
      // Storage can be unavailable in a locked-down browser profile.
    }
  }, INSANE_PRESET);
}

async function armVisibilityCheck(profiler, knob) {
  await profiler.page.bringToFront();
  const visible = await profiler.page.evaluate(() => {
    window.__perfAttribWasHidden = document.visibilityState !== 'visible';
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') window.__perfAttribWasHidden = true;
    });
    return document.visibilityState === 'visible';
  });
  if (!visible) {
    throw new Error(`${knob}: browser page is hidden; keep the profiler window visible`);
  }
}

async function assertStayedVisible(profiler, knob) {
  const stayedVisible = await profiler.page.evaluate(
    () => !window.__perfAttribWasHidden && document.visibilityState === 'visible',
  );
  if (!stayedVisible) {
    throw new Error(`${knob}: browser page was hidden during sampling; discard this run`);
  }
}

async function measure(profiler, testCase, sampleMs) {
  const gfxoQuery = testCase.gfxo ? `&gfxo=${encodeURIComponent(testCase.gfxo)}` : '';
  await profiler.enter({
    mode: 'offline',
    tier: 'insane',
    selectorTimeoutMs: 60000,
    gameBootTimeoutMs: 60000,
    extraQuery: `&governor=0${gfxoQuery}`,
  });
  await armVisibilityCheck(profiler, testCase.knob);
  await profiler.stopMove();
  await profiler.teleport(TOWN.x, TOWN.z, TOWN.facing);
  const sample = await profiler.sample({ ms: sampleMs, label: testCase.knob });
  await assertStayedVisible(profiler, testCase.knob);
  if (sample.tier !== 'insane') {
    throw new Error(`${testCase.knob}: expected insane tier, got ${sample.tier || 'unknown'}`);
  }
  if (sample.autoGovernor) {
    throw new Error(`${testCase.knob}: adaptive governor was enabled`);
  }
  const contextLost = await profiler.page.evaluate(
    () => window.__game?.perf?.report()?.renderer?.contextLost ?? 0,
  );
  if (contextLost) {
    throw new Error(`${testCase.knob}: WebGL context was lost ${contextLost} time(s)`);
  }
  return sampleFps(sample);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gameUrl = String(args.url ?? DEFAULT_URL).replace(/\/+$/, '');
  const sampleMs = Number(args.ms ?? DEFAULT_SAMPLE_MS);
  const dpr = Number(args.dpr ?? 1);
  if (!Number.isFinite(sampleMs) || sampleMs <= 0) {
    throw new Error('--ms must be a positive finite number');
  }
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new Error('--dpr must be a positive finite number');
  }

  const profiler = new Profiler({
    gameUrl,
    width: 1280,
    height: 720,
    dpr,
    headless: args.headless === true,
    extraArgs: [
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--mute-audio',
    ],
  });
  const results = [];

  console.log(
    `perf attribution: url=${gameUrl} tier=insane dpr=${dpr} sample=${sampleMs}ms ` +
      `mode=${args.headless ? 'headless SwiftShader smoke' : 'headed real GPU'}`,
  );
  try {
    await profiler.launch();
    await seedInsaneSettings(profiler);
    for (const testCase of PERF_ATTRIB_CASES) {
      process.stdout.write(`  measuring ${testCase.knob}... `);
      const fps = await measure(profiler, testCase, sampleMs);
      console.log(`${fps.toFixed(1)} fps`);
      results.push({ knob: testCase.knob, fps });
    }
  } finally {
    await profiler.close();
  }

  const control = results[0];
  if (control?.knob !== 'control') throw new Error('control sample is missing');
  console.log(`\n${formatAttributionTable(control.fps, results.slice(1))}`);
  console.log('\nGPU milliseconds saved are implied from 1000/FPS and assume a GPU-bound run.');
  if (args.headless) {
    console.log('Headless SwiftShader is for functional smoke testing only, not attribution data.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
