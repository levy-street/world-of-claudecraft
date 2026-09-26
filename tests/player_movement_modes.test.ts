import { describe, expect, it, vi } from 'vitest';
import type { PlayerMotionDeps } from '../src/sim/player_motion';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

const calls = vi.hoisted(() => ({
  rift: vi.fn(() => 2),
  afk: vi.fn(),
  valkyr: vi.fn(() => false),
  leap: vi.fn(() => false),
  climb: vi.fn(() => false),
  grab: vi.fn(() => false),
  ferry: vi.fn(() => false),
}));
vi.mock('../src/sim/rift/runs', () => ({ riftPlayerLift: calls.rift }));
vi.mock('../src/sim/social/away', () => ({ clearAfkOnMove: calls.afk }));
vi.mock('../src/sim/combat/paladin_valkyrs_calling', () => ({
  advanceValkyrsCalling: calls.valkyr,
}));
vi.mock('../src/sim/combat/heroic_leap', () => ({ advanceHeroicLeap: calls.leap }));
vi.mock('../src/sim/climb', () => ({ advanceClimb: calls.climb, tryStartClimb: calls.grab }));
vi.mock('../src/sim/transport_ferry', () => ({ stepPassenger: calls.ferry }));

import { advanceExclusiveMovement } from '../src/sim/player_movement_modes';

describe('exclusive player movement ordering', () => {
  it('freezes vehicle before terrain lift and activity mutation, then preserves ordinary mode order', () => {
    const player = { pos: { y: 10 } } as Entity;
    const meta = {
      vehicle: {},
      moveInput: { forward: true },
      worldQuestLog: new Map(),
    } as PlayerMeta;
    const ctx = { tickCount: 30, cfg: { seed: 42 } } as SimContext;
    const deps = { seed: 42 } as PlayerMotionDeps;
    expect(advanceExclusiveMovement(ctx, player, meta, deps)).toBe(true);
    expect(calls.rift).not.toHaveBeenCalled();
    expect(player.pos.y).toBe(10);
    meta.vehicle = null;
    expect(advanceExclusiveMovement(ctx, player, meta, deps)).toBe(false);
    expect(player.pos.y).toBe(8);
    expect(meta.lastActiveTick).toBe(30);
    const order = [calls.rift, calls.afk, calls.valkyr, calls.leap, calls.climb, calls.grab].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    calls.leap.mockClear();
    meta.mountRace = { phase: 'countdown' } as PlayerMeta['mountRace'];
    expect(advanceExclusiveMovement(ctx, player, meta, deps)).toBe(true);
    expect(calls.leap).not.toHaveBeenCalled();
    // A ferry passenger's deck step sits after Valkyr's Calling and before the
    // race lock: it owns the step, so the leap never runs.
    meta.mountRace = null;
    player.ferryRide = { routeId: 'eastbrook_nightbloom' } as unknown as Entity['ferryRide'];
    calls.ferry.mockReturnValueOnce(true);
    expect(advanceExclusiveMovement(ctx, player, meta, deps)).toBe(true);
    expect(calls.ferry).toHaveBeenCalledWith(deps, player, meta.moveInput);
    expect(calls.leap).not.toHaveBeenCalled();
  });
});
