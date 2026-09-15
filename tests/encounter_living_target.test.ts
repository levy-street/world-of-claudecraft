// Direct unit coverage for the shared raid-boss living-target resolver
// (src/sim/encounters/living_target.ts): the current target is kept while it
// is a living listed player, the fallback follows the boss's hate table
// instead of entity-id order, and a threat-less table keeps the callers'
// id order as a deterministic tie-break.

import { describe, expect, it } from 'vitest';
import { resolveLivingTarget } from '../src/sim/encounters/living_target';
import type { Entity } from '../src/sim/types';

function unit(id: number, dead = false, stealthed = false): Entity {
  return { id, dead, stealthed, kind: 'player' } as unknown as Entity;
}

function boss(aggroTargetId: number | null, threat: Array<[number, number]>): Entity {
  return { id: 900, aggroTargetId, threat: new Map(threat) } as unknown as Entity;
}

describe('resolveLivingTarget', () => {
  it('keeps the current target while it is a living listed player', () => {
    const b = boss(2, [
      [1, 5000],
      [2, 10],
    ]);
    expect(resolveLivingTarget(b, [unit(1), unit(2)])?.id).toBe(2);
    expect(b.aggroTargetId).toBe(2);
  });

  it('re-seats on the highest-threat living player when the target is not a listed player', () => {
    // The boss is aimed at a pet (id 77, never in the player list): the
    // lowest-id raider (1) has almost no threat, the rogue (3) has the most.
    const b = boss(77, [
      [1, 100],
      [3, 4200],
      [2, 900],
      [77, 6000],
    ]);
    expect(resolveLivingTarget(b, [unit(1), unit(2), unit(3)])?.id).toBe(3);
    expect(b.aggroTargetId).toBe(3);
  });

  it('skips the dead and ignores threat rows of players not in the room', () => {
    const b = boss(null, [
      [3, 9000],
      [2, 700],
      [1, 800],
    ]);
    expect(resolveLivingTarget(b, [unit(1, true), unit(2)])?.id).toBe(2);
  });

  it('falls back to the callers id order when nobody in the room has threat', () => {
    const b = boss(null, []);
    expect(resolveLivingTarget(b, [unit(4), unit(9)])?.id).toBe(4);
    expect(resolveLivingTarget(boss(null, []), [])).toBeNull();
    expect(b.aggroTargetId).toBe(4);
  });

  it('breaks an exact threat tie toward the lower entity id regardless of list order', () => {
    const b = boss(null, [
      [9, 300],
      [4, 300],
    ]);
    expect(resolveLivingTarget(b, [unit(9), unit(4)])?.id).toBe(4);
    expect(resolveLivingTarget(boss(null, []), [unit(9), unit(4)])?.id).toBe(4);
  });

  it('skips a stealthed top-threat player unless nobody else is alive', () => {
    // A Vanished rogue still owns the top row of the table: the generic
    // hate-table walk refuses to see it, and so must the script fallback.
    const b = boss(null, [
      [3, 9000],
      [2, 400],
    ]);
    expect(resolveLivingTarget(b, [unit(2), unit(3, false, true)])?.id).toBe(2);
    expect(resolveLivingTarget(boss(null, [[3, 9000]]), [unit(3, false, true)])?.id).toBe(3);
  });
});
