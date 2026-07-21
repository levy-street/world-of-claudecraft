// Unified game performance profiler CLI (headed, real GPU).
//
// Drives the real game through a named scenario and prints rich metrics: FPS +
// 1%/0.1% lows + frame percentiles + jank, renderer/main-loop phase split, draw
// calls / triangles / views, and FREEZE ATTRIBUTION (which hitches were shader
// compiles vs view builds vs long tasks). Supports A/B: save a baseline, re-run
// after a change, get the diff.
//
//   npm run dev                                 # :5173  (always)
//   ALLOW_DEV_COMMANDS=1 npm run server         # :8787  (only for the crowd scenario)
//   node scripts/profile.mjs <scenario> [opts]
//
// Scenarios:  fps | tour | combat | freeze | tiers | crowd | walk | play
//   play = walk + RMB camera look + jump + cast every ability (finds first-cast
//          ability VFX compiles and camera-reveal hitches a plain walk misses)
// Options:
//   --tier low|medium|high|ultra   force a tier (default: auto-detect)
//   --dpr 1|2                       device pixel ratio (default 1)
//   --mode offline|online          (crowd forces online; others default offline)
//   --crowd N                      crowd size for the crowd scenario (default 40)
//   --ms N                         sample window per step (default 4000)
//   --out file.json                write the full result JSON
//   --compare baseline.json        diff this run against a saved baseline
//   --label tag                    label the run
//   BROWSER_PATH=/path/to/chrome   browser binary
import fs from 'node:fs';
import path from 'node:path';
import { Profiler } from './profiler/harness.mjs';
import { diffMetrics } from './profiler/metrics.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--'))
      a[t.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const scenario = args._[0] ?? 'fps';
const TIER = args.tier || undefined;
const DPR = Number(args.dpr ?? 1);
const MS = Number(args.ms ?? 4000);
const CROWD = Number(args.crowd ?? 40);

// Open-world waypoints from the starting region outward (cross-biome traversal).
const WAYPOINTS = [
  { x: 0, z: -14, facing: 0, name: 'town' },
  { x: 0, z: 40, facing: Math.PI, name: 'town-edge' },
  { x: 30, z: 120, facing: Math.PI, name: 'open-field' },
  { x: -40, z: 200, facing: Math.PI, name: 'far-north' },
  { x: 120, z: 80, facing: Math.PI / 2, name: 'east' },
];

async function scenarioFps(p) {
  await p.enter({ mode: 'offline', tier: TIER });
  const out = [];
  await p.teleport(0, -14, 0);
  out.push(await p.sample({ ms: MS, label: 'town-idle' }));
  await p.teleport(0, 60, Math.PI);
  out.push(await p.sample({ ms: MS, label: 'open-idle' }));
  await p.teleport(0, 60, Math.PI);
  await p.setMove({ forward: true });
  out.push(await p.sample({ ms: MS, label: 'open-run' }));
  await p.stopMove();
  return out;
}

async function scenarioTour(p) {
  await p.enter({ mode: 'offline', tier: TIER });
  const out = [];
  for (const wp of WAYPOINTS) {
    await p.teleport(wp.x, wp.z, wp.facing);
    await p.setMove({ forward: true });
    out.push(await p.sample({ ms: MS, label: `tour-${wp.name}` }));
    await p.stopMove();
  }
  return out;
}

async function scenarioCombat(p) {
  await p.enter({ mode: 'offline', tier: TIER });
  const out = [];
  // a spot with hostile mobs near the start zone
  await p.teleport(30, 90, Math.PI);
  out.push(await p.sample({ ms: 2500, label: 'pre-combat' }));
  // sample WHILE cycling the action bar so VFX (and first-use shader programs) fire
  const fire = p.combat({ ms: MS });
  out.push(await p.sample({ ms: MS, label: 'combat-vfx' }));
  await fire;
  return out;
}

async function scenarioFreeze(p) {
  await p.enter({ mode: 'offline', tier: TIER });
  const out = [];
  // cold traversal into ungenerated terrain - the classic streaming/compile stalls
  await p.teleport(0, 30, Math.PI);
  await p.setMove({ forward: true });
  out.push(await p.sample({ ms: Math.max(MS, 7000), label: 'cold-run' }));
  await p.stopMove();
  return out;
}

async function scenarioTiers(p) {
  const out = [];
  for (const tier of ['low', 'medium', 'high', 'ultra']) {
    await p.enter({ mode: 'offline', tier });
    await p.teleport(0, 60, Math.PI);
    await p.setMove({ forward: true });
    out.push(await p.sample({ ms: MS, label: `tier-${tier}` }));
    await p.stopMove();
  }
  return out;
}

async function scenarioCrowd(p) {
  await p.enter({ mode: 'online', tier: TIER });
  const out = [];
  out.push(await p.sample({ ms: MS, label: 'solo' }));
  for (const target of [Math.round(CROWD / 2), CROWD]) {
    const got = await p.spawnCrowd(target, { radius: 28 });
    await sleep(3000);
    out.push(await p.sample({ ms: MS, label: `crowd-${got}` }));
  }
  await p.setMove({ forward: true });
  out.push(await p.sample({ ms: MS, label: 'crowd-run' }));
  await p.stopMove();
  return out;
}

// Walk continuously across the world on foot (no teleports), crossing zones, and
// collect every freeze with its position + cause as it happens.
async function scenarioWalk(p) {
  await p.enter({ mode: TIER && args.mode === 'online' ? 'online' : 'offline', tier: TIER });
  return [await p.walk({ ms: Number(args.ms ?? 70000), heading: Number(args.heading ?? 0) })];
}

// Realistic play session: walk + turn the camera (RMB look) + jump + cast every
// ability. Surfaces first-cast ability VFX compiles and camera-reveal hitches that
// a straight `walk` (camera fixed forward, no abilities) cannot.
async function scenarioPlay(p) {
  await p.enter({ mode: TIER && args.mode === 'online' ? 'online' : 'offline', tier: TIER });
  return [await p.play({ ms: Number(args.ms ?? 60000), keys: String(args.keys ?? '1234567890') })];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENARIOS = {
  fps: scenarioFps,
  tour: scenarioTour,
  combat: scenarioCombat,
  freeze: scenarioFreeze,
  tiers: scenarioTiers,
  crowd: scenarioCrowd,
  walk: scenarioWalk,
  play: scenarioPlay,
};

function printWalk(s) {
  const ev = s.events ?? [];
  const fz = s.freezes ?? {};
  console.log(`\n  walked ~${s.distance} units over ${s.trail?.length ?? 0} checkpoints`);
  console.log(
    `  total hitches (>=50ms): ${fz.hitchCount ?? 0}  worst ${fz.worstMs ?? 0}ms  by cause: ${JSON.stringify(fz.byCause ?? {})}`,
  );
  if (ev.length) {
    console.log('  freezes as they happened (ms / cause / where):');
    for (const e of ev)
      console.log(
        `    ${String(e.ms).padStart(6)}ms  ${e.cause.padEnd(13)} @ (${e.x}, ${e.z})${e.zone ? ` ${e.zone}` : ''}`,
      );
  } else {
    console.log('  no >=50ms freezes recorded during the walk');
  }
  const np = s.newPrograms ?? [];
  if (np.length) {
    console.log(`  NEW SHADERS that linked mid-walk (${np.length}):`);
    for (const k of np) console.log(`    - ${String(k).replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  console.log(`  trail: ${(s.trail ?? []).map((t) => `(${t.x},${t.z})`).join(' -> ')}`);
}

function fmtRow(s) {
  const f = s.frame ?? {};
  const z = s.freezes ?? {};
  const sc = s.scene ?? {};
  const causes =
    Object.entries(z.byCause ?? {})
      .map(([c, n]) => `${c}:${n}`)
      .join(',') || '-';
  const kinds =
    Object.entries(sc.entitiesByKind ?? {})
      .map(([k, n]) => `${k}:${n}`)
      .join(' ') || '-';
  const line1 = [
    s.label.padEnd(14),
    `fps ${String(f.fpsMean ?? s.fps).padStart(6)}`,
    `1%low ${String(f.fpsLow1 ?? '-').padStart(6)}`,
    `p99 ${String(f.p99Ms ?? s.frameP99).padStart(6)}ms`,
    `max ${String(f.maxMs ?? s.frameMax).padStart(6)}ms`,
    `jank ${String(f.jankPct ?? '-').padStart(5)}%`,
    `sub ${String(s.phaseSubmitMs).padStart(5)}ms`,
    `hitch[${z.worstMs ?? 0}ms ${causes}]`,
  ].join('  ');
  const tris = sc.render ? (sc.render.triangles / 1e6).toFixed(2) : '?';
  const line2 = `${' '.repeat(14)}  scene: ents ${sc.entityCount ?? s.entities ?? '?'} [${kinds}]  views ${sc.viewCount ?? s.views}  models ${sc.modelCount ?? '?'}  shaders ${sc.programs ?? s.programs}/${sc.shaderVariants ?? '?'}var  tex ${sc.textures ?? '?'}  geo ${sc.geometries ?? '?'}  draws ${sc.render?.calls ?? s.calls}  tris ${tris}M`;
  const np = s.newPrograms ?? [];
  const line3 = np.length
    ? `${' '.repeat(14)}  NEW SHADERS (${np.length}) that linked this window:\n` +
      np.map((k) => `${' '.repeat(16)}- ${String(k).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
    : '';
  return [line1, line2, line3].filter(Boolean).join('\n');
}

async function main() {
  const run = SCENARIOS[scenario];
  if (!run) {
    console.error(`unknown scenario '${scenario}'. one of: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  console.log(
    `profiler: scenario=${scenario} tier=${TIER ?? 'auto'} dpr=${DPR} ms=${MS} (HEADED, vsync OFF)`,
  );
  const p = new Profiler({
    dpr: DPR,
    shotDir: typeof args.shot === 'string' ? args.shot : args.shot ? 'tmp/profiler-shots' : null,
  });
  let results = [];
  try {
    await p.launch();
    results = await run(p);
  } finally {
    await p.close();
  }

  console.log('\n========== RESULTS ==========');
  for (const s of results) console.log(fmtRow(s));
  if (scenario === 'walk' || scenario === 'play') for (const s of results) printWalk(s);

  const payload = {
    scenario,
    tier: TIER ?? 'auto',
    dpr: DPR,
    label: args.label ?? '',
    at: new Date().toISOString(),
    results,
  };
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out) || '.', { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
    console.log(`\nwrote ${args.out}`);
  }

  if (args.compare) {
    const base = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    console.log(`\n========== A/B vs ${args.compare} ==========`);
    const byLabel = new Map(base.results.map((r) => [r.label, r]));
    for (const after of results) {
      const before = byLabel.get(after.label);
      if (!before) continue;
      const a = {
        fps: after.frame?.fpsMean ?? after.fps,
        fpsLow1: after.frame?.fpsLow1 ?? 0,
        p99Ms: after.frame?.p99Ms ?? after.frameP99,
        calls: after.calls,
        phaseSubmitMs: after.phaseSubmitMs,
      };
      const b = {
        fps: before.frame?.fpsMean ?? before.fps,
        fpsLow1: before.frame?.fpsLow1 ?? 0,
        p99Ms: before.frame?.p99Ms ?? before.frameP99,
        calls: before.calls,
        phaseSubmitMs: before.phaseSubmitMs,
      };
      const d = diffMetrics(b, a);
      const cell = (k) =>
        d[k]
          ? `${k} ${d[k].before}->${d[k].after} (${d[k].delta > 0 ? '+' : ''}${d[k].pct}% ${d[k].better})`
          : '';
      console.log(
        `${after.label.padEnd(14)} ${cell('fps')}  ${cell('fpsLow1')}  ${cell('p99Ms')}  ${cell('calls')}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
