// Same-seed determinism plus annulus-neutrality for the idle mob-AI aggro scan
// (src/sim/mob/locomotion.ts). Two proofs:
//
//  1. Same seed, same scripted camp => a byte-identical run: identical sampled wolf
//     evolution AND an identical shared rng draw stream (count + rolling FNV-1a digest
//     over every sim.rng draw in order). This is the tighter net: an extra or reordered
//     draw forks the digest even if the sampled state coincides.
//  2. Annulus neutrality: players seated in the former 25-yd window (strictly beyond
//     the 20-yd grid radius) never change how the idle wolves evolve or the shared draw
//     sequence. The scan draws no rng and a trivial player is never aggroed, so whether
//     those players fall inside or outside the scan window is invisible to the mobs.
//     The radius discrimination itself is carried by the first-tick visit-count pin
//     (15, not 35): rng/state neutrality alone would also hold at the former radius.
//
// The camp sits at FAR (outside the 360-yd world). Every player is trivial (level 30 vs
// the level-5 wolves) so no player is ever detected however far a wolf wanders, and the
// wolves wander freely across K ticks (crossing several idle wander-timer draws), so the
// sampled state and the draw stream really move.
//
// Honest isolation of the annulus delta: BOTH runs add the same player count in the same
// order (3 core plus 4 annulus warriors), so their construction- and player-tick rng
// draws are identical. The ONLY difference is the ring the 4 annulus players sit on: the
// base run parks them at 40 yd (outside 20 AND the old 25), the annulus run at 22 yd
// (inside the former 25-yd window). Teleporting draws no rng, and the observer is
// installed only after all setup, so nothing but the scan-window membership can differ.
// We therefore compare the mob-side sample plus draws/hash (the annulus players' own
// positions obviously differ and are excluded from that comparison).

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnyEntity = ReturnType<typeof createMob> & Record<string, any>;
const seedOf = (sim: Sim): number => (sim as unknown as { cfg: { seed: number } }).cfg.seed;

const SEED = 1337;
const K = 100; // ticks: enough to cross several idle wander-timer draws per wolf
const FAR = { x: 500, z: 500 };

const WOLVES = 5;
const WOLF_RING = 1; // wolves within 1 yd of the camp center
const CORE_PLAYERS = 3;
const CORE_RING = 16; // trivial players kept near the camp so the scan visits something
const ANNULUS_PLAYERS = 4;
const ANNULUS_IN = 22; // former-window band: 21 to 23 yd from every wolf (inside old 25)
const ANNULUS_OUT = 40; // baseline band: 39 to 41 yd from every wolf (outside 20 AND 25)
const TRIVIAL_LEVEL = 30; // >= wolf level (5) + 10, so isTrivialTo skips every player

// A local FNV-1a fold over each draw's 32-bit mulberry output, in draw order (kept local
// on purpose; not the parity harness internals). next() returns int/2^32, so this
// reconstructs the exact 32-bit int losslessly before folding its four bytes.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
function drawToU32(value: number): number {
  return Math.round(value * 4294967296) >>> 0;
}
function foldU32(hash: number, u: number): number {
  let h = hash;
  for (let b = 0; b < 4; b++) {
    h ^= (u >>> (b * 8)) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

function ringOffset(i: number, count: number, radius: number): { dx: number; dz: number } {
  const theta = (2 * Math.PI * i) / count;
  return { dx: radius * Math.cos(theta), dz: radius * Math.sin(theta) };
}

function entityOf(sim: Sim, id: number): AnyEntity {
  return (sim as unknown as { entities: Map<number, Entity> }).entities.get(id) as AnyEntity;
}

function idleWolfAt(sim: Sim, id: number, dx: number, dz: number): void {
  const x = FAR.x + dx;
  const z = FAR.z + dz;
  const mob = createMob(id, MOBS.forest_wolf, 5, {
    x,
    y: terrainHeight(x, z, seedOf(sim)),
    z,
  }) as AnyEntity;
  mob.aiState = 'idle';
  (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(mob);
}

// Add a warrior, teleport it onto the given ring, and raise it above the wolves so
// isTrivialTo skips it: never detected however far a wolf wanders toward it. Returns pid.
function addTrivialPlayerAt(sim: Sim, name: string, dx: number, dz: number): number {
  const pid = sim.addPlayer('warrior', name);
  const e = entityOf(sim, pid);
  e.pos.x = FAR.x + dx;
  e.pos.z = FAR.z + dz;
  e.pos.y = terrainHeight(e.pos.x, e.pos.z, seedOf(sim));
  e.prevPos = { ...e.pos };
  sim.setPlayerLevel(TRIVIAL_LEVEL, pid);
  return pid;
}

function refreshPlayerGrid(sim: Sim): void {
  const s = sim as unknown as {
    playerGrid: { refresh: (it: Iterable<Entity>) => void };
    playerEntities: () => Iterable<Entity>;
  };
  s.playerGrid.refresh(s.playerEntities());
}

interface WolfSample {
  x: number;
  y: number;
  z: number;
  aiState: string;
  facing: number;
  wanderTimer: number;
  wanderX: number | null;
  wanderZ: number | null;
  aggroTargetId: number | null;
}

function sampleWolf(sim: Sim, id: number): WolfSample {
  const e = entityOf(sim, id);
  return {
    x: e.pos.x,
    y: e.pos.y,
    z: e.pos.z,
    aiState: e.aiState,
    facing: e.facing,
    wanderTimer: e.wanderTimer,
    wanderX: e.wanderTarget ? e.wanderTarget.x : null,
    wanderZ: e.wanderTarget ? e.wanderTarget.z : null,
    aggroTargetId: e.aggroTargetId,
  };
}

function samplePlayerPos(sim: Sim, id: number): { x: number; z: number } {
  const e = entityOf(sim, id);
  return { x: e.pos.x, z: e.pos.z };
}

interface RunResult {
  draws: number;
  hash: number;
  firstTickVisits: number;
  wolves: WolfSample[];
  cores: { x: number; z: number }[];
}

// Build an identical idle camp for both runs; the sole parameter is the ring the annulus
// players ride. Ambient world mobs (the same for any seed) and the trivial players draw
// the same rng in both runs, so the observed stream differs only if the annulus band
// perturbs the mobs, which it must not.
function runScenario(annulusRadius: number): RunResult {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });

  const wolfIds: number[] = [];
  for (let i = 0; i < WOLVES; i++) {
    const id = 960001 + i;
    wolfIds.push(id);
    const { dx, dz } = ringOffset(i, WOLVES, WOLF_RING);
    idleWolfAt(sim, id, dx, dz);
  }

  const coreIds: number[] = [];
  for (let j = 0; j < CORE_PLAYERS; j++) {
    const { dx, dz } = ringOffset(j, CORE_PLAYERS, CORE_RING);
    coreIds.push(addTrivialPlayerAt(sim, `Core${j}`, dx, dz));
  }
  for (let k = 0; k < ANNULUS_PLAYERS; k++) {
    const { dx, dz } = ringOffset(k, ANNULUS_PLAYERS, annulusRadius);
    addTrivialPlayerAt(sim, `Ann${k}`, dx, dz);
  }
  refreshPlayerGrid(sim);

  // Observe only the shared sim.rng, and only from here: construction and player-setup
  // draws happen before this (identical across runs) and are excluded, so the digest
  // pins solely the tick loop's draw count and order.
  let draws = 0;
  let hash = FNV_OFFSET;
  sim.rng.setObserver((v) => {
    draws++;
    hash = foldU32(hash, drawToU32(v));
  });
  sim.tick();
  // Sampled after the FIRST tick, before wander drift can carry a wolf toward the
  // annulus ring: 5 wolves x 3 core players = 15 visits. This literal is what makes the
  // annulus arm discriminate the narrowed grid query: at the former 25-yd query the
  // annulus run's first tick would read 5 x 7 = 35 (the 22-yd ring is inside 25 of every
  // spawn-adjacent wolf), while at 20 both runs read 15.
  const firstTickVisits = sim.mobScanCounters.aggroScanPlayerVisits;
  for (let t = 1; t < K; t++) sim.tick();
  sim.rng.setObserver(null);

  return {
    draws,
    hash,
    firstTickVisits,
    wolves: wolfIds.map((id) => sampleWolf(sim, id)),
    cores: coreIds.map((id) => samplePlayerPos(sim, id)),
  };
}

describe('mob idle scan determinism: the FAR camp is clear of world spawns at this seed', () => {
  it('has no world entity within 60 yd of the camp at seed 1337, so the visit literals are exact', () => {
    // The crowd-cost suite guards this precondition at seed 42; this suite pins exact
    // visit literals (15, and the wolf evolution) at its own seed, so it carries its
    // own clearance guard rather than borrowing one proven for a different world.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    let near = 0;
    for (const e of (sim as unknown as { entities: Map<number, Entity> }).entities.values()) {
      const dx = e.pos.x - FAR.x;
      const dz = e.pos.z - FAR.z;
      if (dx * dx + dz * dz <= 60 * 60) near++;
    }
    expect(near).toBe(0);
  });
});

describe('mob idle scan determinism: same seed, byte-identical run', () => {
  it('two fresh sims with the same seed agree on wolf state and the whole draw stream', () => {
    const a = runScenario(ANNULUS_OUT);
    const b = runScenario(ANNULUS_OUT);
    expect(a).toEqual(b);
    // The run actually exercised the shared stream (idle wander draws + ambient mobs),
    // so the agreement is meaningful rather than two empty tallies matching.
    expect(a.draws).toBeGreaterThan(0);
  });
});

describe('mob idle scan determinism: former-window players never perturb the idle camp', () => {
  it('the wolves and the shared draw stream are identical whether the annulus sits inside or outside the former window', () => {
    const base = runScenario(ANNULUS_OUT); // annulus at 40 yd: outside 20 AND the old 25
    const annulus = runScenario(ANNULUS_IN); // annulus at 22 yd: inside the former 25-yd window

    // The only delta between the runs is the band the (trivial, never-detected) annulus
    // players sit on. A trivial player is skipped before any detection or rng, so the
    // wolves evolve identically and the shared draw stream is byte-identical.
    expect(annulus.wolves).toEqual(base.wolves);
    expect(annulus.draws).toBe(base.draws);
    expect(annulus.hash).toBe(base.hash);
    // The visit-count pins carry the grid-radius discrimination: at the former 25-yd
    // query the annulus run would read 35 on its first tick, not 15 (see runScenario).
    expect(base.firstTickVisits).toBe(15);
    expect(annulus.firstTickVisits).toBe(15);
    // The core players sit on the same ring in both runs, so they too must match; only
    // the annulus players (excluded here) moved.
    expect(annulus.cores).toEqual(base.cores);
    // The stream is non-trivial, so an identical draws/hash is a real match.
    expect(base.draws).toBeGreaterThan(0);
  });
});
