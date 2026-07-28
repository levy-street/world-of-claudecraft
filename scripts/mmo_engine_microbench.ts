import { performance } from 'node:perf_hooks';
import {
  encodeSnapshotBinary,
  encodeSnapshotBinaryEntityFragment,
  encodeSnapshotBinaryFromFragments,
} from '../server/snapshot_binary';
import { decodeSnapshotBinary } from '../src/net/snapshot_binary';
import {
  admitNameplates,
  createNameplateAdmissionScratch,
  type NameplateAdmissionCandidate,
} from '../src/render/nameplate_budget_core';
import { type RenderEntityLike, RenderWorldCore } from '../src/render/runtime/render_world_core';

const PLAYERS = 100;
const ITERATIONS = 2_000;
const BROADCAST_ITERATIONS = 250;
const SERVER_TICK_BUDGET_MS = 50;
const BINARY_BROADCAST_P95_GATE_MS = 10;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function timed(iterations: number, run: () => void): { averageMs: number; p95Ms: number } {
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return {
    averageMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95Ms: percentile(samples, 0.95),
  };
}

function snapshot() {
  return {
    t: 'snap',
    tick: 12_000,
    time: 600,
    tickHz: 20,
    self: {
      id: 1,
      target: 7,
      hp: 930,
      mhp: 1000,
      inv: Array.from({ length: 24 }, (_, index) => ({
        itemId: `item_${index}`,
        count: index + 1,
      })),
    },
    ents: Array.from({ length: PLAYERS }, (_, index) => ({
      id: index + 1,
      x: Math.round(Math.cos(index) * 3000) / 100,
      y: 0,
      z: Math.round(Math.sin(index) * 3000) / 100,
      f: Math.round(index * 13.7) / 100,
      hp: 700 + (index % 300),
      mhp: 1000,
      k: 'player',
      tid: index % 2 === 0 ? 'mage' : 'warrior',
      nm: `Player ${index}`,
      lv: 20,
      cast: index % 17 === 0 ? 'fireball' : undefined,
    })).map((entity) =>
      Object.fromEntries(Object.entries(entity).filter(([, value]) => value !== undefined)),
    ),
    keep: [],
  };
}

const snapshotValue = snapshot();
const json = JSON.stringify(snapshotValue);
const jsonBytes = new TextEncoder().encode(json).length;
const binary = encodeSnapshotBinary(snapshotValue);
const { ents: entityValues, ...snapshotRoot } = snapshotValue;
const entityFragments = entityValues.map((entity) => encodeSnapshotBinaryEntityFragment(entity));
const assembledBinary = encodeSnapshotBinaryFromFragments(snapshotRoot, entityFragments);
if (
  assembledBinary.length !== binary.length ||
  assembledBinary.some((byte, index) => byte !== binary[index])
) {
  throw new Error('shared fragment assembly differs from the canonical binary encoder');
}

for (let index = 0; index < 100; index++) {
  JSON.parse(json);
  decodeSnapshotBinary(binary);
  encodeSnapshotBinaryFromFragments(snapshotRoot, entityFragments);
}

const legacyBinaryBroadcast = timed(BROADCAST_ITERATIONS, () => {
  for (let recipient = 0; recipient < PLAYERS; recipient++) {
    encodeSnapshotBinary(JSON.parse(json));
  }
});
const sharedBinaryBroadcast = timed(BROADCAST_ITERATIONS, () => {
  for (let recipient = 0; recipient < PLAYERS; recipient++) {
    encodeSnapshotBinaryFromFragments(snapshotRoot, entityFragments);
  }
});

const roster = new Map<number, RenderEntityLike>();
for (let index = 0; index < PLAYERS; index++) {
  roster.set(index + 1, {
    id: index + 1,
    pos: { x: Math.cos(index) * 30, y: 0, z: Math.sin(index) * 30 },
    facing: index / 10,
    hostile: index % 7 === 0,
    inCombat: index % 11 === 0,
    castingAbility: index % 17 === 0 ? 'fireball' : null,
    ownerId: null,
  });
}
const renderWorld = new RenderWorldCore(PLAYERS);
const renderInput = {
  originX: 0,
  originZ: 0,
  selfId: 1,
  targetId: 7,
  createRangeSq: 80 * 80,
  destroyRangeSq: 96 * 96,
};

const plates: NameplateAdmissionCandidate[] = Array.from({ length: PLAYERS }, (_, index) => ({
  id: index + 1,
  flags: index < 8 ? 1 : 0,
  distanceSq: index * index,
  inViewport: true,
}));
const admitted: number[] = [];
const plateScratch = createNameplateAdmissionScratch();
const plateCount = admitNameplates(plates, 28, admitted, plateScratch);

const result = {
  scenario: { players: PLAYERS, iterations: ITERATIONS },
  snapshot: {
    jsonBytes,
    binaryBytes: binary.length,
    byteReductionPercent: ((jsonBytes - binary.length) / jsonBytes) * 100,
    jsonEncode: timed(ITERATIONS, () => {
      JSON.stringify(snapshotValue);
    }),
    binaryEncode: timed(ITERATIONS, () => {
      encodeSnapshotBinary(snapshotValue);
    }),
    jsonDecode: timed(ITERATIONS, () => {
      JSON.parse(json);
    }),
    binaryDecode: timed(ITERATIONS, () => {
      decodeSnapshotBinary(binary);
    }),
    recipients: PLAYERS,
    legacyBinaryBroadcast,
    sharedBinaryBroadcast,
    sharedBroadcastReductionPercent:
      ((legacyBinaryBroadcast.averageMs - sharedBinaryBroadcast.averageMs) /
        legacyBinaryBroadcast.averageMs) *
      100,
    sharedBroadcastTickBudgetPercent:
      (sharedBinaryBroadcast.averageMs / SERVER_TICK_BUDGET_MS) * 100,
    sharedBroadcastP95TickBudgetPercent:
      (sharedBinaryBroadcast.p95Ms / SERVER_TICK_BUDGET_MS) * 100,
    gate: {
      p95LimitMs: BINARY_BROADCAST_P95_GATE_MS,
      passed: sharedBinaryBroadcast.p95Ms < BINARY_BROADCAST_P95_GATE_MS,
    },
  },
  renderWorld: timed(ITERATIONS, () => {
    renderWorld.update(roster, renderInput);
  }),
  nameplates: {
    legacyCandidates: plates.length,
    admitted: plateCount,
    anchorReductionPercent: ((plates.length - plateCount) / plates.length) * 100,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.snapshot.gate.passed) {
  console.error(`shared binary broadcast p95 exceeded ${BINARY_BROADCAST_P95_GATE_MS} ms`);
  process.exitCode = 1;
}
