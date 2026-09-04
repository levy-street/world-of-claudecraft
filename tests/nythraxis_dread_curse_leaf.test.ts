// Pure-leaf pins for the Dread Curse tank swap (src/sim/nythraxis_dread_curse.ts):
// the tuning literals the Raid Boss Guide quotes and the stack reader. The
// live application (hit, stack, refresh, swap persistence, the swap callout)
// is exercised against a real Sim in tests/nythraxis_encounter.test.ts.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_DREAD_CURSE_AURA_ID,
  NYTHRAXIS_DREAD_CURSE_DURATION,
  NYTHRAXIS_DREAD_CURSE_EVERY,
  NYTHRAXIS_DREAD_CURSE_MAX_STACKS,
  NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS,
  nythraxisDreadCurseHitMaxHp,
  nythraxisDreadCursePerStack,
  nythraxisDreadCurseStacks,
} from '../src/sim/nythraxis_dread_curse';
import type { Entity } from '../src/sim/types';

describe('Nythraxis Dread Curse leaf', () => {
  it('pins the swap tuning literally', () => {
    expect(NYTHRAXIS_DREAD_CURSE_EVERY).toBe(12);
    expect([nythraxisDreadCurseHitMaxHp('normal'), nythraxisDreadCurseHitMaxHp('heroic')]).toEqual([
      0.25, 0.3,
    ]);
    expect(NYTHRAXIS_DREAD_CURSE_DURATION).toBe(20);
    // A tank swapped out at the swap stack (its last stack landing at
    // swapStacks x every) is clean before the swap comes back to them one
    // swap cycle later, so a taunt never lands on live stacks.
    const swapCycle = NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS * NYTHRAXIS_DREAD_CURSE_EVERY;
    expect(swapCycle + NYTHRAXIS_DREAD_CURSE_DURATION).toBeLessThan(2 * swapCycle);
    expect(NYTHRAXIS_DREAD_CURSE_MAX_STACKS).toBe(3);
    expect(NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS).toBe(2);
    expect([nythraxisDreadCursePerStack('normal'), nythraxisDreadCursePerStack('heroic')]).toEqual([
      0.35, 0.45,
    ]);
    // The swap point sits strictly inside the cap: a third stack is the punishment.
    expect(NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS).toBeLessThan(NYTHRAXIS_DREAD_CURSE_MAX_STACKS);
  });

  it('reads this boss stacks only, never another source or another aura', () => {
    const target = {
      auras: [
        { id: NYTHRAXIS_DREAD_CURSE_AURA_ID, sourceId: 5, stacks: 2 },
        { id: NYTHRAXIS_DREAD_CURSE_AURA_ID, sourceId: 6, stacks: 3 },
        { id: 'nythraxis_soul_rend', sourceId: 5, stacks: 9 },
      ],
    } as unknown as Entity;
    expect(nythraxisDreadCurseStacks(target, 5)).toBe(2);
    expect(nythraxisDreadCurseStacks(target, 6)).toBe(3);
    expect(nythraxisDreadCurseStacks(target, 7)).toBe(0);
    const stackless = {
      auras: [{ id: NYTHRAXIS_DREAD_CURSE_AURA_ID, sourceId: 5 }],
    } as unknown as Entity;
    expect(nythraxisDreadCurseStacks(stackless, 5)).toBe(1);
  });
});
