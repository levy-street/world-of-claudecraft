import { describe, expect, it } from 'vitest';
import { abilityNeedsLineOfSight } from '../src/sim/ability_line_of_sight';
import { ABILITIES, isArenaPos } from '../src/sim/data';
import type { AbilityDef, Entity } from '../src/sim/types';
import { MELEE_RANGE } from '../src/sim/types';

// The line-of-sight rule extracted from the Sim coordinator: ranged and every
// non-physical school need a clear line; melee skips it everywhere except
// inside the arena pit, whose thin walls sit within MELEE_RANGE.

function ability(over: Partial<AbilityDef>): AbilityDef {
  const base = Object.values(ABILITIES)[0];
  return { ...base, requiresTarget: true, school: 'physical', range: MELEE_RANGE, ...over };
}

function at(x: number): Entity {
  return { pos: { x, y: 0, z: 0 } } as Entity;
}

describe('abilityNeedsLineOfSight', () => {
  it('never for a targetless ability', () => {
    expect(abilityNeedsLineOfSight(ability({ requiresTarget: false, school: 'fire' }))).toBe(false);
  });
  it('always for a non-physical school or a ranged physical ability', () => {
    expect(abilityNeedsLineOfSight(ability({ school: 'fire' }))).toBe(true);
    expect(abilityNeedsLineOfSight(ability({ range: MELEE_RANGE + 1 }))).toBe(true);
  });
  it('melee: only inside the arena pit', () => {
    const melee = ability({});
    expect(abilityNeedsLineOfSight(melee)).toBe(false);
    expect(abilityNeedsLineOfSight(melee, at(0))).toBe(isArenaPos(0));
    expect(isArenaPos(0)).toBe(false);
    // find an arena x from the sim's own placement rule
    let arenaX = 0;
    for (let x = 0; x < 200000 && !isArenaPos(x); x += 100) arenaX = x + 100;
    expect(isArenaPos(arenaX)).toBe(true);
    expect(abilityNeedsLineOfSight(melee, at(arenaX))).toBe(true);
  });
});
