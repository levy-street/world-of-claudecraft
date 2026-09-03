// Pure-leaf pins for the Dread Curse tank swap (src/sim/nythraxis_dread_curse.ts):
// the tuning literals the Raid Boss Guide quotes and the stack reader. The
// live application (hit, stack, refresh, swap persistence, the swap callout)
// is exercised against a real Sim in tests/nythraxis_encounter.test.ts.

import { describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_DREAD_CURSE_AURA_ID,
  NYTHRAXIS_DREAD_CURSE_DURATION,
  NYTHRAXIS_DREAD_CURSE_EVERY,
  NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP,
  NYTHRAXIS_DREAD_CURSE_MAX_STACKS,
  NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS,
  nythraxisDreadCursePerStack,
  nythraxisDreadCurseStacks,
} from '../src/sim/nythraxis_dread_curse';
import type { Entity } from '../src/sim/types';

describe('Nythraxis Dread Curse leaf', () => {
  it('pins the swap tuning literally', () => {
    expect(NYTHRAXIS_DREAD_CURSE_EVERY).toBe(10);
    expect(NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP).toBe(0.25);
    expect(NYTHRAXIS_DREAD_CURSE_DURATION).toBe(30);
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
