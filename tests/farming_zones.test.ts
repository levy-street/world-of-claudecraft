// The farming tier ladder: is every farming hub on a rung somebody chose, and
// is that rung the only place a farming tier comes from?
//
// This column cannot be derived the way tests/fishing_zones.test.ts derives
// its own (from GATHER_NODES) or tests/material_grades.test.ts derives its
// own: farming's ladder deliberately disagrees with the shipped zone
// progression at evergarden, which the shipped column still holds at tier 1
// under the named progression inversion while farming locks it at tier 4 as
// the showcase garden. A derivation would either red on the row the design
// chose or quietly drag farming back onto the other axis. So the rows are
// pinned to LITERALS here, which is what a column whose authority is a design
// decision needs: renaming or reshuffling the constants cannot keep this file
// green, because nothing in it reads the value it is checking.

import { describe, expect, it } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  DEFAULT_FARMING_ZONE_TIER,
  FARMING_ZONE_TIERS,
  farmingZoneTierFor,
} from '../src/sim/professions/farming_zones';

describe('farming zone tiers', () => {
  it('every farming zone has an explicit row, so no hub rides the default', () => {
    // Object.hasOwn rather than a truthy read of the reader: the reader hands
    // back DEFAULT_FARMING_ZONE_TIER for a zone with no row at all, so a
    // reader-based check would pass a fifth hub that nobody tiered. The point
    // of this arm is that a row EXISTS, not that a number comes back.
    for (const patch of FARM_PATCHES) {
      expect(
        Object.hasOwn(FARMING_ZONE_TIERS, patch.zoneId),
        `${patch.id} farms ${patch.zoneId}, which has no row in FARMING_ZONE_TIERS`,
      ).toBe(true);
    }
    // And the table carries no rows for zones that grow nothing, which would
    // be a tier claim about a hub that does not exist.
    const farmedZones = new Set(FARM_PATCHES.map((p) => p.zoneId));
    for (const zoneId of Object.keys(FARMING_ZONE_TIERS)) {
      expect(farmedZones.has(zoneId), `${zoneId} is tiered for farming but has no patch`).toBe(
        true,
      );
    }
  });

  it('the ladder is pinned to its literals', () => {
    // Four literals and the floor, asserted against nothing derived. A
    // constant-rename or a row shuffled between zones has to red here.
    expect(FARMING_ZONE_TIERS.eastbrook_vale).toBe(1);
    expect(FARMING_ZONE_TIERS.mirefen_marsh).toBe(2);
    expect(FARMING_ZONE_TIERS.thornpeak_heights).toBe(3);
    expect(FARMING_ZONE_TIERS.evergarden).toBe(4);
    expect(DEFAULT_FARMING_ZONE_TIER).toBe(1);
    // The ladder is exactly these four rungs: an added row is a design
    // decision that must show up here rather than arrive silently.
    expect(Object.keys(FARMING_ZONE_TIERS).sort()).toEqual([
      'eastbrook_vale',
      'evergarden',
      'mirefen_marsh',
      'thornpeak_heights',
    ]);
  });

  it('the evergarden divergence from the shipped progression column is deliberate', () => {
    // The one row where farming and the shipped zone-progression column
    // disagree, pinned so the disagreement stays a decision. If a later zone
    // pass re-tiers evergarden on the shipped ladder, whoever does it has to
    // come here and say whether farming follows.
    expect(FARMING_ZONE_TIERS.evergarden).toBe(4);
    expect(FARMING_ZONE_TIERS.evergarden).toBeGreaterThan(FARMING_ZONE_TIERS.thornpeak_heights);
  });

  it('the reader falls to the floor for an unknown zone and for a prototype name', () => {
    expect(farmingZoneTierFor('no_such_zone')).toBe(DEFAULT_FARMING_ZONE_TIER);
    expect(farmingZoneTierFor('')).toBe(DEFAULT_FARMING_ZONE_TIER);
    // The prototype door: a bare index would hand back Object.prototype's own
    // members here, so the reader would return a FUNCTION where a tier
    // belongs and every comparator downstream would silently misbehave.
    expect(farmingZoneTierFor('constructor')).toBe(DEFAULT_FARMING_ZONE_TIER);
    expect(farmingZoneTierFor('toString')).toBe(DEFAULT_FARMING_ZONE_TIER);
    expect(typeof farmingZoneTierFor('constructor')).toBe('number');
    // And the reader is not a constant function: it really does report the
    // rows, or the two arms above would hold for a reader that returns the
    // floor for everything.
    expect(farmingZoneTierFor('evergarden')).toBe(4);
    expect(farmingZoneTierFor('mirefen_marsh')).toBe(2);
  });

  it('one ladder: no patch carries a farming tier of its own', () => {
    // The whole reason the reader exists. A patch row could perfectly well
    // hardcode a tier that disagrees with the column, and then two modules
    // would answer "what tier is this farm" differently. This arm is what
    // stops that, and it is the same pin the content file's header points at.
    for (const patch of FARM_PATCHES) {
      expect(patch.tier, `${patch.id} disagrees with the farming ladder`).toBe(
        farmingZoneTierFor(patch.zoneId),
      );
    }
  });

  it('the exported table is frozen', () => {
    // A shared frozen record, not a live object a consumer can retier at
    // runtime: the ladder is content, and a mutable export makes every arm
    // above a statement about start-up only.
    expect(Object.isFrozen(FARMING_ZONE_TIERS)).toBe(true);
  });
});
