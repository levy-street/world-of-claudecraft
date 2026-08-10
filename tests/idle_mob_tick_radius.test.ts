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
// Three arms:
//  - WIRING: GameServer's Sim is actually constructed with idleMobTickRadius
//    set, and it is set no smaller than the distance a mob stays rendered to
//    a viewer (INTEREST_DROP_RADIUS) and no smaller than the farthest a mob
//    could ever detect a player (MAX_AGGRO_RADIUS), so culling can never
//    freeze a mob a player can actually see, and never skips a scan that
//    could have pulled someone.
//  - RNG: passive wander rolls use deterministic per-mob streams whenever
//    distance culling is active, so an invisible skip cannot move a visible
//    mob's draw position.
//  - BUDGET: a player-bearing full offline world pays less than 60 percent of
//    the unthrottled end-to-end tick cost, including the culling checks and all
//    non-mob phases.

import { readFileSync } from 'node:fs';
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
import { ENTITY_VIEW_DESTROY_RANGE } from '../src/render/renderer';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/aggro_ranges';
import { Sim } from '../src/sim/sim';
import { type Entity, PLAYER_INTEREST_DROP_RADIUS } from '../src/sim/types';

function sharedCullEligibleIdleMob(e: Entity): boolean {
  return (
    e.kind === 'mob' &&
    !e.dead &&
    e.ownerId === null &&
    e.aiState === 'idle' &&
    e.auras.length === 0 &&
    !e.offStreamRng
  );
}

function measureTicks(sim: Sim, ticks: number): number {
  const started = performance.now();
  for (let i = 0; i < ticks; i++) sim.tick();
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('idle-mob distance culling is wired into the production server (#2703)', () => {
  it('constructs its Sim with idleMobTickRadius pinned to the render drop radius', () => {
    const server = new GameServer();
    expect(server.sim.cfg.idleMobTickRadius).toBe(INTEREST_DROP_RADIUS);
    expect(INTEREST_DROP_RADIUS).toBe(PLAYER_INTEREST_DROP_RADIUS);
    expect(PLAYER_INTEREST_DROP_RADIUS).toBe(100);
    expect(ENTITY_VIEW_DESTROY_RANGE).toBe(96);
    expect(PLAYER_INTEREST_DROP_RADIUS).toBeGreaterThan(ENTITY_VIEW_DESTROY_RANGE);
  });

  it('uses the same invisible-idle-mob throttle in the offline browser game', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS');
  });

  it('the render drop radius sits well past the farthest a mob can ever detect a player, so culling never skips a scan that could pull', () => {
    expect(INTEREST_DROP_RADIUS).toBeGreaterThan(MAX_AGGRO_RADIUS);
  });

  it('skips the spatial lookup when no players are connected', () => {
    const sim = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      noPlayer: true,
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    });
    const idleMob = [...sim.entities.values()].find(sharedCullEligibleIdleMob);
    if (!idleMob) throw new Error('expected a cull-eligible idle mob');

    const gridQuery = vi.spyOn(sim.playerGrid, 'hasInRadius');
    const culling = sim as unknown as { shouldSkipIdleMobTick(entity: Entity): boolean };

    expect(culling.shouldSkipIdleMobTick(idleMob)).toBe(true);
    expect(gridQuery).not.toHaveBeenCalled();
  });

  it('uses the player spatial grid instead of scanning a 60-player roster per idle mob', () => {
    const sim = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      noPlayer: true,
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    });
    for (let i = 0; i < 60; i++) sim.addPlayer('warrior', `Load${i}`);

    const firstPlayerId = sim.players.keys().next().value;
    if (firstPlayerId === undefined) throw new Error('expected a load-test player id');
    const firstPlayer = sim.entities.get(firstPlayerId);
    if (!firstPlayer) throw new Error('expected a load-test player');
    const firstPosition = { ...firstPlayer.pos };
    const farMob = [...sim.entities.values()].find((entity) => {
      if (!sharedCullEligibleIdleMob(entity)) return false;
      const dx = entity.pos.x - firstPlayer.pos.x;
      const dz = entity.pos.z - firstPlayer.pos.z;
      return dx * dx + dz * dz > PLAYER_INTEREST_DROP_RADIUS ** 2;
    });
    if (!farMob) throw new Error('expected an idle mob outside the player cluster');

    const gridQuery = vi.spyOn(sim.playerGrid, 'hasInRadius');
    const valuesScan = vi.spyOn(sim.players, 'values');
    const keysScan = vi.spyOn(sim.players, 'keys');
    const entriesScan = vi.spyOn(sim.players, 'entries');
    const iteratorScan = vi.spyOn(sim.players, Symbol.iterator);
    const forEachScan = vi.spyOn(sim.players, 'forEach');
    const rosterIterations = [valuesScan, keysScan, entriesScan, iteratorScan, forEachScan];
    const culling = sim as unknown as { shouldSkipIdleMobTick(entity: Entity): boolean };

    expect(culling.shouldSkipIdleMobTick(farMob)).toBe(true);
    expect(gridQuery).toHaveBeenCalledTimes(1);
    expect(gridQuery).toHaveBeenLastCalledWith(
      farMob.pos.x,
      farMob.pos.z,
      PLAYER_INTEREST_DROP_RADIUS,
    );
    for (const rosterIteration of rosterIterations) {
      expect(rosterIteration).not.toHaveBeenCalled();
    }

    firstPlayer.pos = { ...farMob.pos };
    firstPlayer.prevPos = { ...farMob.pos };
    sim.grid.update(firstPlayer);
    sim.playerGrid.update(firstPlayer);
    expect(culling.shouldSkipIdleMobTick(farMob)).toBe(false);
    expect(gridQuery).toHaveBeenCalledTimes(2);
    expect(gridQuery).toHaveBeenLastCalledWith(
      farMob.pos.x,
      farMob.pos.z,
      PLAYER_INTEREST_DROP_RADIUS,
    );
    for (const rosterIteration of rosterIterations) {
      expect(rosterIteration).not.toHaveBeenCalled();
    }

    firstPlayer.pos = { ...firstPosition };
    firstPlayer.prevPos = { ...firstPosition };
    sim.grid.update(firstPlayer);
    sim.playerGrid.update(firstPlayer);
    for (const meta of sim.players.values()) meta.moveInput.forward = true;
    gridQuery.mockClear();
    const beforeTick = { ...firstPlayer.pos };
    sim.tick();

    expect(gridQuery).toHaveBeenCalled();
    expect(
      gridQuery.mock.calls.every(([, , radius]) => radius === PLAYER_INTEREST_DROP_RADIUS),
    ).toBe(true);
    expect(firstPlayer.pos).not.toEqual(beforeTick);
  });

  it('isolates nearby passive RNG behavior from a culled distant mob', () => {
    const culled = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    });
    const unthrottled = new Sim({
      seed: 20061,
      playerClass: 'warrior',
    });

    const candidates = [...culled.entities.values()].filter(sharedCullEligibleIdleMob);
    let pair: [Entity, Entity] | null = null;

    outer: for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const dx = candidates[i].pos.x - candidates[j].pos.x;
        const dz = candidates[i].pos.z - candidates[j].pos.z;
        if (dx * dx + dz * dz > (PLAYER_INTEREST_DROP_RADIUS * 2) ** 2) {
          pair = [candidates[i], candidates[j]];
          break outer;
        }
      }
    }

    if (!pair) throw new Error('expected two distant shared-stream idle mobs');
    const [farCulled, nearCulled] = pair;
    const farUnthrottled = unthrottled.entities.get(farCulled.id);
    const nearUnthrottled = unthrottled.entities.get(nearCulled.id);
    if (!farUnthrottled || !nearUnthrottled) {
      throw new Error('same-seed Sims must contain matching entity ids');
    }

    for (const sim of [culled, unthrottled]) {
      for (const e of sim.entities.values()) {
        if (!sharedCullEligibleIdleMob(e)) continue;
        e.wanderTimer = 30;
        e.wanderTarget = null;
      }
    }

    // The unthrottled reference opts into the same private passive lane that
    // idleMobTickRadius activates for the production arm.
    for (const e of unthrottled.entities.values()) {
      if (sharedCullEligibleIdleMob(e)) e.offStreamRng = true;
    }

    for (const [sim, near] of [
      [culled, nearCulled],
      [unthrottled, nearUnthrottled],
    ] as const) {
      sim.player.pos = { ...near.pos };
      sim.player.prevPos = { ...near.pos };
      sim.player.dead = true;
    }

    farCulled.wanderTimer = 0.01;
    farUnthrottled.wanderTimer = 0.01;
    nearCulled.wanderTimer = 0.01;
    nearUnthrottled.wanderTimer = 0.01;

    culled.tick();
    unthrottled.tick();

    expect(farCulled.wanderTarget).toBeNull();
    expect(farUnthrottled.wanderTarget).not.toBeNull();
    expect(nearCulled.wanderTarget).toEqual(nearUnthrottled.wanderTarget);

    for (let i = 0; i < 180; i++) {
      culled.tick();
      unthrottled.tick();
    }

    expect({
      pos: nearCulled.pos,
      facing: nearCulled.facing,
      wanderTarget: nearCulled.wanderTarget,
      wanderTimer: nearCulled.wanderTimer,
    }).toEqual({
      pos: nearUnthrottled.pos,
      facing: nearUnthrottled.facing,
      wanderTarget: nearUnthrottled.wanderTarget,
      wanderTimer: nearUnthrottled.wanderTimer,
    });
  }, 60_000);

  it('reduces end-to-end tick cost in the full offline world', () => {
    const withRadius = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    });
    const withoutRadius = new Sim({
      seed: 20061,
      playerClass: 'warrior',
    });

    withRadius.player.dead = true;
    withoutRadius.player.dead = true;

    expect(withRadius.entities.size).toBe(withoutRadius.entities.size);
    expect(withRadius.entities.size).toBeGreaterThanOrEqual(950);

    for (let i = 0; i < 40; i++) {
      withRadius.tick();
      withoutRadius.tick();
    }

    const withSamples: number[] = [];
    const withoutSamples: number[] = [];
    const BATCH_TICKS = 30;
    const SAMPLES = 7;

    for (let sample = 0; sample < SAMPLES; sample++) {
      if (sample % 2 === 0) {
        withSamples.push(measureTicks(withRadius, BATCH_TICKS));
        withoutSamples.push(measureTicks(withoutRadius, BATCH_TICKS));
      } else {
        withoutSamples.push(measureTicks(withoutRadius, BATCH_TICKS));
        withSamples.push(measureTicks(withRadius, BATCH_TICKS));
      }
    }

    const withMedian = median(withSamples);
    const withoutMedian = median(withoutSamples);

    console.log(
      '[idle mob end-to-end] entities=' +
        withRadius.entities.size +
        ' with=' +
        withMedian.toFixed(2) +
        'ms without=' +
        withoutMedian.toFixed(2) +
        'ms',
    );

    expect(withMedian).toBeLessThan(withoutMedian * 0.6);
  }, 60_000);
});
