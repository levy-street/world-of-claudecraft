import { describe, expect, it } from 'vitest';
import {
  DEAD_ZONE_MARGIN,
  engagementDistance,
  MELEE_REACH,
} from '../scripts/lib/sweep_engagement.mjs';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { CLASSES } from '../src/sim/data';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';

// The row sweep used to walk every class to melee reach, which put the hunter inside
// the 8 yard dead zone its whole ranged kit refuses to fire from, so the sweep
// measured a hunter as a bad melee class. These pin the standoff rule that replaced
// it, including the deliberate no-op for every class that has no dead zone.

const DAMAGE_EFFECTS = new Set([
  'aoeDamage',
  'aoeRoot',
  'directDamage',
  'dot',
  'drainTick',
  'finisherDamage',
  'groundAoE',
  'weaponDamage',
  'weaponStrike',
]);

function damagingDefsAtCap(cls: PlayerClass): Array<{ minRange?: number; range?: number }> {
  return abilitiesKnownAt(cls, MAX_LEVEL)
    .filter((a) => a.def.effects.some((e) => DAMAGE_EFFECTS.has(e.type)))
    .map((a) => a.def);
}

describe('engagementDistance', () => {
  it('holds melee reach when nothing in the kit has a minimum range', () => {
    expect(engagementDistance([{ range: 30 }, { range: 0 }], { maxRange: 30 })).toBe(MELEE_REACH);
  });

  it('handles an empty or missing kit', () => {
    expect(engagementDistance([], null)).toBe(MELEE_REACH);
    expect(engagementDistance(undefined, undefined)).toBe(MELEE_REACH);
  });

  it('clears the largest minimum range by the margin', () => {
    expect(engagementDistance([{ minRange: 8, range: 35 }], { maxRange: 35 })).toBe(
      8 + DEAD_ZONE_MARGIN,
    );
    expect(
      engagementDistance(
        [
          { minRange: 8, range: 35 },
          { minRange: 12, range: 35 },
        ],
        null,
      ),
    ).toBe(12 + DEAD_ZONE_MARGIN);
  });

  it('never steps past the shortest reachable ceiling', () => {
    // A 25 yd ability with an 8 yd floor caps the standoff at 25, not 10 -> fine, but
    // a class capped at 9 must not be stationed at 10.
    expect(engagementDistance([{ minRange: 8, range: 9 }], { maxRange: 35 })).toBe(9);
    expect(engagementDistance([{ minRange: 8, range: 35 }], { maxRange: 9 })).toBe(9);
  });

  it('falls back to the floor when the ceiling is inside the dead zone', () => {
    expect(engagementDistance([{ minRange: 8, range: 6 }], { maxRange: 6 })).toBe(
      8 + DEAD_ZONE_MARGIN,
    );
  });
});

describe('engagementDistance against the real class kits', () => {
  it('stations the hunter outside its dead zone', () => {
    const stand = engagementDistance(damagingDefsAtCap('hunter'), CLASSES.hunter.ranged);
    expect(stand).toBeGreaterThan(8);
    expect(stand).toBeLessThanOrEqual(CLASSES.hunter.ranged?.maxRange ?? 35);
  });

  it('is the hunter alone: every other class keeps standing at melee reach', () => {
    // The narrow scope is the point. Fixing the sweep must not silently move the
    // eight classes whose numbers were already measured correctly.
    const moved = (Object.keys(CLASSES) as PlayerClass[]).filter(
      (cls) => engagementDistance(damagingDefsAtCap(cls), CLASSES[cls].ranged) !== MELEE_REACH,
    );
    expect(moved).toEqual(['hunter']);
  });
});
