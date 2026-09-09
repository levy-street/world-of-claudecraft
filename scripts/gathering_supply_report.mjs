#!/usr/bin/env node
// Intentional Gathering PR5: the supply measurement CLI.
//
// Bundles the SAME scenario adapter (scripts/lib/gathering_supply_runner.ts,
// scripts/lib/gathering_supply_scenarios.ts) against a target repo's OWN
// `src/sim` with esbuild, once per repo (`--repo`, and optionally
// `--baseline`), runs every scenario in a real `node` subprocess, and
// aggregates the results into one report. Neither repo's source is read
// except through esbuild's own module resolution, and neither is ever
// written to: every generated file lives under a fresh `os.tmpdir()`
// directory that is removed when the run finishes.
//
// Usage:
//   node scripts/gathering_supply_report.mjs --repo <finalRepoPath> \
//     [--baseline <baselineRepoPath>] [--out <outputDir>]
//
// With --out, writes gathering-supply-report.json and .md into that
// directory. Without it, prints the JSON report to stdout.
//
// No network, no new dependencies (esbuild is already a devDependency used
// the same way by tests/headless_gathering_transport.test.ts), no services.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ENTRY = path.join(HERE, 'lib', 'gathering_supply_runner.ts');
const SCENARIOS_ENTRY = path.join(HERE, 'lib', 'gathering_supply_scenarios.ts');
// Bounds the whole run: every scenario is a bounded number of fresh Sims and
// bounded tick loops, so a subprocess that has not finished by this deadline
// is stuck (an infinite tick loop, a hung admission), not merely slow.
const CHILD_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
  const out = { repo: undefined, baseline: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') out.repo = argv[++i];
    else if (arg === '--baseline') out.baseline = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.repo) throw new Error('--repo <path> is required');
  return out;
}

function gitInfo(repoPath) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf8',
    });
    return { commit, dirty: status.trim().length > 0 };
  } catch (err) {
    return { commit: `unknown (${err instanceof Error ? err.message : String(err)})`, dirty: true };
  }
}

const GATHER_TOOL_BY_TYPE_LITERAL = `{ ore: 'copper_mining_pick', wood: 'handaxe', herb: 'gathering_sickle' }`;

function generatedEntrySource(repoRoot, runnerPath, label) {
  const src = path.join(repoRoot, 'src', 'sim');
  const toPosix = (p) => p.split(path.sep).join('/');
  return `
import { Sim } from '${toPosix(path.join(src, 'sim'))}';
import { createMob } from '${toPosix(path.join(src, 'entity'))}';
import { MOBS, GATHER_NODES, ITEMS, LAKE } from '${toPosix(path.join(src, 'data'))}';
import { terrainHeight } from '${toPosix(path.join(src, 'world'))}';
import { bagCapacity } from '${toPosix(path.join(src, 'bags'))}';
import { farmBedById } from '${toPosix(path.join(src, 'content', 'farm_patches'))}';
import { FARM_CROPS } from '${toPosix(path.join(src, 'content', 'farm_crops'))}';
import { startFishing } from '${toPosix(path.join(src, 'professions', 'fishing'))}';
import { updateCasting } from '${toPosix(path.join(src, 'combat', 'casting_lifecycle'))}';
import { ALL_RECIPES } from '${toPosix(path.join(src, 'content', 'recipes'))}';
import { gatheringSupplyByFamily } from '${toPosix(path.join(src, 'professions', 'gathering_supply'))}';
import { tryNearbyInteraction } from '${toPosix(path.join(repoRoot, 'src', 'game', 'nearby_interaction'))}';
import { runAllScenarios } from '${toPosix(runnerPath)}';

// The two trees genuinely disagree on tryNearbyInteraction's own positional
// signature (a pre-PR1 tree carries extra gather-node/text params ahead of
// the escort/nothing/reliable trio that survive on both). Detected by the
// REAL function's own arity, never by repoLabel, so this keeps working if a
// maintainer changes which tree is "baseline". Placeholder literals for the
// old-tree-only params are inert: the corpse arm this harness drives never
// reads them.
function callTryNearbyInteraction(world, hud) {
  const escortAwayText = '__escort_away__';
  const nothingToInteractText = '__nothing_to_interact__';
  if (tryNearbyInteraction.length <= 4) {
    return tryNearbyInteraction(world, hud, escortAwayText, nothingToInteractText, true);
  }
  const gatherNodes = [];
  const nodeGate = () => true;
  const tooFar = '__too_far__';
  const notReady = '__not_ready__';
  return tryNearbyInteraction(
    world,
    hud,
    gatherNodes,
    nodeGate,
    tooFar,
    notReady,
    escortAwayText,
    nothingToInteractText,
    true,
  );
}

// Shared by the harvestCorpseCommand binding and the ordinary-interact
// world adapter's own world.harvestCorpse (a pre-PR1 tree's corpse arm calls
// that directly): the two trees disagree on Sim.harvestCorpse's positional
// shape, detected by arity (see the harvestCorpseCommand binding doc).
function harvestCorpseArityAware(sim, mobId, pid, components) {
  if (sim.harvestCorpse.length <= 2) return sim.harvestCorpse(mobId, pid);
  return sim.harvestCorpse(mobId, components, pid);
}

const GATHER_TOOL_BY_TYPE = ${GATHER_TOOL_BY_TYPE_LITERAL};

let familyIndexCache = null;
function familyIndex() {
  if (!familyIndexCache) familyIndexCache = gatheringSupplyByFamily();
  return familyIndexCache;
}

let equipmentIdsCache = null;
function equipmentIds() {
  if (!equipmentIdsCache) {
    equipmentIdsCache = Object.values(ITEMS)
      .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
      .map((d) => d.id);
  }
  return equipmentIdsCache;
}

const bindings = {
  repoLabel: '${label}',
  makeSim: (opts) =>
    new Sim({
      seed: opts.seed,
      playerClass: opts.playerClass ?? 'warrior',
      autoEquip: opts.autoEquip ?? true,
      noPlayer: opts.noPlayer,
      lockoutNowMs: opts.lockoutNowMs,
    }),
  createMob: (id, template, level, pos) => createMob(id, template, level, pos),
  mobTemplate: (mobId) => MOBS[mobId],
  // The two trees genuinely disagree on Sim.harvestCorpse's positional
  // shape: final is (mobId, pid?) (the per-call components override
  // retired with PR3's remembered preference), baseline is
  // (mobId, components?, pid?). Detected once per Sim instance by arity
  // (Function.length counts only parameters before the first default/
  // destructured one, which both real declarations avoid) rather than
  // hand-pinned per repo, so this glue keeps working if a maintainer
  // changes which tree is "baseline" without touching this file.
  harvestCorpseCommand: (sim, mobId, pid, components) =>
    harvestCorpseArityAware(sim, mobId, pid, components),
  // Drives the target repo's OWN real tryNearbyInteraction (never a
  // hand-reimplementation of its corpse-arm decision) against a minimal, real
  // adapter over \`sim\`: a live entities map, a real lootCorpse/harvestCorpse
  // dispatch, and every other member as an inert no-op this harness's corpse
  // scenario never reaches (delve/dungeon/object/feast/bed arms). \`showError\`
  // is the one hud member this harness actually reads, captured verbatim for
  // honest diagnostics.
  tryNearbyOrdinaryInteract: (sim, mobId, pid) => {
    const player = sim.entities.get(pid);
    const world = {
      player,
      playerId: pid,
      partyInfo: null,
      entities: sim.entities,
      questLog: new Map(),
      targetEntity: () => {},
      interact: () => {
        sim.interact(pid);
      },
      lootCorpse: (id) => (typeof sim.lootCorpse === 'function' ? sim.lootCorpse(id, pid) : false),
      harvestCorpse: (targetMobId, components, pidArg) =>
        harvestCorpseArityAware(sim, targetMobId, pidArg ?? pid, components),
      delveInteract: () => false,
      enterDungeon: () => false,
      leaveDungeon: () => false,
      pickUpObject: () => false,
      farmPatches: [],
      myFarmPlots: [],
      consumeFeast: () => {},
    };
    const diagnostics = [];
    const hud = {
      openMailbox: () => {},
      openQuestDialog: () => {},
      openDelveBoard: () => {},
      showError: (text) => diagnostics.push(text),
      requestSpiritHealerResurrect: () => {},
      openPlantSheet: () => {},
    };
    const outcome = callTryNearbyInteraction(world, hud);
    return { looted: outcome === true, diagnostics };
  },
  // Harness setup only, never a simulated action: reaches into the real
  // Sim's own public PlayerMeta store (Sim.players) to set a gathering
  // proficiency directly, the same way sim.addItem hands over a starting
  // item. The ONE consumer is the recipe scenario's properly-equipped/
  // skilled farming retry, which needs a real tier-4 hoe to actually WIELD.
  setGatheringProficiency: (sim, professionId, value, pid) => {
    const meta = sim.players.get(pid ?? sim.playerId);
    if (meta) meta.gatheringProficiency[professionId] = value;
  },
  terrainHeight: (x, z, seed) => terrainHeight(x, z, seed),
  gatherNode: (type) => GATHER_NODES.find((n) => n.type === type),
  gatherToolItemId: (type) => GATHER_TOOL_BY_TYPE[type],
  farmBed: (bedId) => farmBedById(bedId),
  farmCrop: (cropId) => {
    const crop = FARM_CROPS[cropId];
    if (!crop) return undefined;
    return {
      seedItemId: crop.seedItemId,
      produceItemId: crop.produceItemId,
      fineProduceItemId: crop.fineProduceItemId,
      durationMs: crop.durationMs,
    };
  },
  waterShoreSpot: () => ({ x: LAKE.x, z: LAKE.z - LAKE.radius - 2, faceX: LAKE.x, faceZ: LAKE.z }),
  startFishing: (ctx, p, meta) => startFishing(ctx, p, meta),
  updateCasting: (ctx, p, meta) => updateCasting(ctx, p, meta),
  recipeById: (id) => {
    const r = ALL_RECIPES.find((recipe) => recipe.id === id);
    if (!r) return undefined;
    return {
      id: r.id,
      skillReq: r.skillReq ?? 0,
      resultItemId: r.resultItemId,
      resultCount: r.resultCount ?? 1,
      reagents: r.reagents.map((x) => ({ itemId: x.itemId, count: x.count })),
    };
  },
  gatheringFamilyOf: (itemId) => {
    for (const [family, ids] of familyIndex()) {
      if (ids.has(itemId)) return family;
    }
    return undefined;
  },
  equipmentItemIds: () => equipmentIds(),
  bagCapacityOf: (bags) => bagCapacity(bags),
};

const measurements = runAllScenarios(bindings);
process.stdout.write(JSON.stringify(measurements));
`;
}

/** Bundle the generated entry against `repoRoot`'s own src, run it in a real
 *  node subprocess, and return the parsed measurement array. Any failure
 *  (a signature the target repo's tree does not have, a bundling error)
 *  is reported as one error measurement rather than aborting the whole run. */
function bundleOrRunErrorMeasurement(label, absRepoRoot, err) {
  return {
    scenarioId: 'harness_bundle_or_run',
    family: 'harness',
    repoLabel: label,
    seed: 0,
    attempts: 0,
    successfulHarvests: 0,
    deniedAttempts: 0,
    harvestedUnits: [],
    distinctUnwantedItemIds: [],
    slotsBefore: 0,
    slotsAfter: 0,
    elapsedSimSeconds: 0,
    travelSimSeconds: 0,
    castSimSeconds: 0,
    notes: [`failed to bundle or run against ${absRepoRoot}`],
    error: err instanceof Error ? err.message : String(err),
  };
}

async function runAgainstRepo(repoRoot, label, tempDir) {
  const absRepoRoot = path.resolve(repoRoot);
  const entryPath = path.join(tempDir, `entry-${label}.ts`);
  const bundlePath = path.join(tempDir, `bundle-${label}.cjs`);
  fs.writeFileSync(entryPath, generatedEntrySource(absRepoRoot, RUNNER_ENTRY, label), 'utf8');
  try {
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundlePath,
      logLevel: 'silent',
    });
    const result = spawnSync(process.execPath, [bundlePath], {
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(
        `subprocess killed by signal ${result.signal} (timeout ${CHILD_TIMEOUT_MS}ms?)`,
      );
    }
    if (result.status !== 0) {
      throw new Error(`subprocess exited ${result.status}: ${result.stderr.slice(0, 2000)}`);
    }
    return JSON.parse(result.stdout);
  } catch (err) {
    return [bundleOrRunErrorMeasurement(label, absRepoRoot, err)];
  }
}

async function loadScenariosModule(tempDir) {
  const outfile = path.join(tempDir, 'scenarios.mjs');
  await esbuild.build({
    entryPoints: [SCENARIOS_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gathering-supply-report-'));
  try {
    const scenarios = await loadScenariosModule(tempDir);
    const repos = [{ label: 'final', path: args.repo }];
    if (args.baseline) repos.unshift({ label: 'baseline', path: args.baseline });

    const measurements = [];
    const provenanceRepos = [];
    for (const repo of repos) {
      const info = gitInfo(repo.path);
      provenanceRepos.push({ label: repo.label, path: path.resolve(repo.path), ...info });
      const repoMeasurements = await runAgainstRepo(repo.path, repo.label, tempDir);
      measurements.push(...repoMeasurements);
    }

    // annotateUnmetExpectations is what turns a scenario that ran to
    // completion but measured the WRONG real outcome (final ordinary
    // interact granting materials, a full-bag attempt that actually changed
    // slots, a shared corpse paying two party members, ...) into the same
    // kind of `error` field a harness exception produces: without it, the
    // exit-code check below would only ever catch a crash, never a wrong
    // answer. The report itself is unaffected in shape; only measurements
    // that fail an expectation gain an `error`.
    const report = scenarios.annotateUnmetExpectations({
      harnessVersion: scenarios.HARNESS_VERSION,
      generatedAt: new Date().toISOString(),
      seed: scenarios.HARNESS_SEED,
      repos: provenanceRepos,
      measurements,
    });

    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      fs.writeFileSync(
        path.join(args.out, 'gathering-supply-report.json'),
        scenarios.renderJsonReport(report),
      );
      fs.writeFileSync(
        path.join(args.out, 'gathering-supply-report.md'),
        scenarios.renderMarkdownReport(report),
      );
      process.stdout.write(`wrote report to ${args.out}\n`);
    } else {
      process.stdout.write(scenarios.renderJsonReport(report));
      process.stdout.write('\n');
    }

    // The report is written/printed above REGARDLESS of errors (a run with
    // partial failures is still evidence worth keeping); the exit code is
    // the separate signal that something needs a human look. Read from
    // `report.measurements` (the ANNOTATED set), never the pre-annotation
    // `measurements` array, so a wrong real outcome
    // (`annotateUnmetExpectations`) exits nonzero exactly like a harness
    // exception does; a green exit with an error row silently present would
    // be a false success.
    const erroredScenarios = report.measurements.filter((m) => m.error !== undefined);
    if (erroredScenarios.length > 0) {
      process.stderr.write(
        `${erroredScenarios.length} scenario measurement(s) carried an error (see the report's "error" fields):\n`,
      );
      for (const m of erroredScenarios) {
        process.stderr.write(`  - [${m.repoLabel}] ${m.scenarioId}: ${m.error}\n`);
      }
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
