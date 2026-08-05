import { describe, expect, it } from 'vitest';
import { LEVEL_CAP, ZONE_TEASERS } from '../src/guide/data';
import { ZONES } from '../src/sim/data';
import { MAX_LEVEL } from '../src/sim/types';

// LEVEL_CAP and ZONE_TEASERS in src/guide/data.ts are hand-duplicated literals,
// not derived from the sim (see the comment atop that file): LEVEL_CAP mirrors
// MAX_LEVEL and each ZONE_TEASERS entry mirrors a ZoneDef.levelRange, matched by
// biome id ('vale'/'marsh'/'peaks'). Five guide surfaces (home, progression, faq,
// combat, and the SEO JSON-LD in head.ts) render the hand copy directly, so a sim
// level or zone band change would silently strand the guide showing a stale cap
// or band until a human noticed, the same way CLASS_CHIPS drifted before
// class_colors.test.ts pinned it. This suite is that same guard for LEVEL_CAP and
// ZONE_TEASERS: any future drift between the two copies fails CI immediately.

// ZONE_TEASERS ids ('vale'/'marsh'/'peaks') are guide-side biome labels, not sim
// ZoneDef ids, and ZoneDef.biome is NOT unique: both eastbrook_vale (levelRange
// [1, 7]) and farshore_isle (levelRange [3, 7]) declare biome 'vale'. Resolving a
// teaser by ZONES.find(z => z.biome === id) would silently pick whichever zone
// happens to come first in the ZONES array, so this map pins each teaser to the
// explicit ZoneDef.id it is documenting instead of leaning on array order.
const TEASER_ZONE_ID: Record<string, string> = {
  vale: 'eastbrook_vale',
  marsh: 'mirefen_marsh',
  peaks: 'thornpeak_heights',
  dusk: 'veiled_hollow',
  ember: 'drakelands',
  frost: 'frostveil',
  amber: 'amberfall',
  fen: 'willowfen',
};

describe('guide level cap and zone band freshness', () => {
  it('LEVEL_CAP matches the sim MAX_LEVEL', () => {
    expect(LEVEL_CAP).toBe(MAX_LEVEL);
  });

  it('every ZONE_TEASERS entry maps to a real sim zone id, with no duplicate ids', () => {
    // ZONE_TEASERS is a curated subset for the landing page (see the comment atop
    // src/guide/data.ts), not a full roster, so this checks each teaser resolves to a
    // real ZoneDef rather than requiring the reverse (every sim zone has a teaser).
    const zoneIds = new Set<string>(ZONES.map((z) => z.id));
    const ids = ZONE_TEASERS.map((z) => z.id);
    expect(new Set(ids).size, 'ZONE_TEASERS ids must be unique').toBe(ids.length);
    for (const id of ids) {
      const zoneId = TEASER_ZONE_ID[id];
      expect(zoneId, `ZONE_TEASERS id "${id}" has no entry in TEASER_ZONE_ID`).toBeDefined();
      expect(
        zoneIds.has(zoneId),
        `TEASER_ZONE_ID["${id}"] = "${zoneId}" has no matching sim ZoneDef.id`,
      ).toBe(true);
    }
  });

  it('ZONE_TEASERS level bands match each ZoneDef.levelRange', () => {
    for (const teaser of ZONE_TEASERS) {
      const zoneId = TEASER_ZONE_ID[teaser.id];
      const zone = ZONES.find((z) => z.id === zoneId);
      expect(zone, `no sim zone found for guide teaser "${teaser.id}" (${zoneId})`).toBeDefined();
      expect([teaser.min, teaser.max], `level band for "${teaser.id}"`).toEqual(zone?.levelRange);
    }
  });
});
