// Idle-mob distance culling wiring (issue #2703, "Unexpected server-side CPU
// usage after v0.30.0"): idle CPU with zero players online rose sharply
// between v0.30.0 and v0.32.1+. The world grew from 3 zones to 11 over that
// span (see vite.config.ts's testTimeout comment), so a realm's total mob
// count grew with it, and every one of those mobs paid full per-tick AI cost
// (an aggro-detection grid scan plus, while wandering, real terrain-height
// movement) on every single 50 ms tick regardless of whether any player was
// anywhere near it, or connected at all. src/sim/sim.ts already carries a
// tested distance-culling knob for exactly this (shouldSkipIdleMobTick /
// idleMobTickRadius, see tests/mob_update_perf.test.ts), but the production
// GameServer never opted into it, so the knob existed on paper without
// actually bounding the live server's idle cost.
//
// Two arms:
//  - WIRING: GameServer's Sim is actually constructed with idleMobTickRadius
//    set, and it is set no smaller than the distance a mob stays rendered to
//    a viewer (INTEREST_DROP_RADIUS) and no smaller than the farthest a mob
//    could ever detect a player (MAX_AGGRO_RADIUS), so culling can never
//    freeze a mob a player can actually see, and never skips a scan that
//    could have pulled someone.
//  - BUDGET: a fresh, zero-player Sim built with GameServer's own radius pays
//    only a small fraction of the per-tick mob.update cost an unthrottled Sim
//    pays over the same real, full-sized world, proving the wiring actually
//    cuts idle CPU rather than merely existing.

import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; GameServer's constructor never
// queries it, but the module import chain resolves it eagerly.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer, INTEREST_DROP_RADIUS } from '../server/game';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/aggro_ranges';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

describe('idle-mob distance culling is wired into the production server (#2703)', () => {
  it('constructs its Sim with idleMobTickRadius pinned to the render drop radius', () => {
    const server = new GameServer();
    expect(server.sim.cfg.idleMobTickRadius).toBe(INTEREST_DROP_RADIUS);
  });

  it('the render drop radius sits well past the farthest a mob can ever detect a player, so culling never skips a scan that could pull', () => {
    expect(INTEREST_DROP_RADIUS).toBeGreaterThan(MAX_AGGRO_RADIUS);
  });

  it('pays only a small fraction of the unthrottled mob.update cost on a fresh, zero-player world', () => {
    const phaseTotalsWith = new Map<string, number>();
    const phaseTotalsWithout = new Map<string, number>();
    let mark = 0;
    const lapInto =
      (totals: Map<string, number>) =>
      (phase: string, _entity?: Entity): void => {
        const t = performance.now();
        totals.set(phase, (totals.get(phase) ?? 0) + (t - mark));
        mark = t;
      };

    // Same seed, same fresh world, same shape GameServer boots: the only
    // difference is whether idleMobTickRadius is set.
    const withRadius = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      noPlayer: true,
      idleMobTickRadius: INTEREST_DROP_RADIUS,
      perfLap: lapInto(phaseTotalsWith),
    });
    const withoutRadius = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      noPlayer: true,
      perfLap: lapInto(phaseTotalsWithout),
    });

    // Warm both worlds identically (settle spawns, bucket the spatial grid).
    for (let i = 0; i < 20; i++) {
      mark = performance.now();
      withRadius.tick();
      mark = performance.now();
      withoutRadius.tick();
    }
    phaseTotalsWith.clear();
    phaseTotalsWithout.clear();

    // Deliberately slow (two full 11-zone `Sim` builds plus the unthrottled arm's real
    // per-tick terrain-height wander), so it carries its own explicit budget below
    // rather than relying on the global testTimeout (vite.config.ts), matching the
    // sibling budget test at tests/mob_update_perf.test.ts. 60 ticks is enough to keep
    // the 5x ratio assertion decisive while keeping the slow arm's cost down.
    const TICKS = 60;
    for (let i = 0; i < TICKS; i++) {
      mark = performance.now();
      withRadius.tick();
    }
    for (let i = 0; i < TICKS; i++) {
      mark = performance.now();
      withoutRadius.tick();
    }

    const mobUpdateWith = phaseTotalsWith.get('mob.update') ?? 0;
    const mobUpdateWithout = phaseTotalsWithout.get('mob.update') ?? 0;
    console.log(
      `[idle mob budget #2703] mob.update over ${TICKS} zero-player ticks: ` +
        `with radius=${mobUpdateWith.toFixed(2)}ms without=${mobUpdateWithout.toFixed(2)}ms`,
    );

    // Sanity: the unthrottled arm actually did real, measurable mob AI work
    // (the world's real content, not a stub), or the ratio assertion below
    // would be vacuously true.
    expect(mobUpdateWithout).toBeGreaterThan(5);

    // The whole point of the knob: with zero players connected, EVERY wild,
    // unbuffed, out-of-combat mob in the world is farther than
    // idleMobTickRadius from every player (there are none), so
    // shouldSkipIdleMobTick skips all of them. A generous 5x margin catches
    // "the wiring silently stopped culling" without pinning a hardware-speed
    // sensitive absolute millisecond budget.
    expect(mobUpdateWith).toBeLessThan(mobUpdateWithout / 5);
  }, 60_000);
});
