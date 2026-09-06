// The pure corpse-state leaf behind every ordinary-loot vs harvest indicator
// (nameplate satchel or blade, minimap loot square or pelt triangle) and both
// availability adapters (src/sim/corpse_interaction.ts, the sim's command
// gate; src/game/corpse_loot_availability.ts, the popup). Driven directly:
// entity plus primitives in, booleans out, no SimContext, no clock, no rng.

import { describe, expect, it } from 'vitest';
import {
  corpseHarvestClaimOpen,
  corpseHasOrdinaryLootFor,
  corpseIndicatorFor,
  corpseSharedLootRightsFor,
  tapperPartyFromViewerParty,
} from '../src/sim/corpse_loot_state';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import type { Entity } from '../src/sim/types';

const ME = 1;
const STRANGER = 9;
const MATE = 7;

function corpse(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    kind: 'mob',
    // forest_wolf carries mapped componentTags: harvestable while unclaimed.
    templateId: 'forest_wolf',
    ownerId: null,
    dead: true,
    lootable: true,
    corpseTimer: 60,
    loot: null,
    tappedById: null,
    lootFfaTimer: Number.POSITIVE_INFINITY,
    harvestClaimedBy: null,
    ...overrides,
  } as Entity;
}

const plainLoot = () => ({ copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] });

describe('tapperPartyFromViewerParty', () => {
  it('hands the viewer roster over only when the tapper is on it', () => {
    expect(tapperPartyFromViewerParty(STRANGER, [ME, STRANGER])).toEqual([ME, STRANGER]);
    expect(tapperPartyFromViewerParty(STRANGER, [ME, MATE])).toBeNull();
    expect(tapperPartyFromViewerParty(null, [ME, MATE])).toBeNull();
    expect(tapperPartyFromViewerParty(STRANGER, null)).toBeNull();
  });
});

describe('corpseSharedLootRightsFor', () => {
  it('grants an untapped corpse, my own tap, and a tap by my party mate', () => {
    expect(corpseSharedLootRightsFor(ME, null, null, LOOT_FFA_DELAY, true)).toBe(true);
    expect(corpseSharedLootRightsFor(ME, ME, null, LOOT_FFA_DELAY, true)).toBe(true);
    expect(corpseSharedLootRightsFor(ME, MATE, [ME, MATE], LOOT_FFA_DELAY, true)).toBe(true);
  });

  it("refuses a stranger's fresh tap and a stranger party that lacks the viewer", () => {
    expect(corpseSharedLootRightsFor(ME, STRANGER, null, LOOT_FFA_DELAY, true)).toBe(false);
    expect(corpseSharedLootRightsFor(ME, STRANGER, [STRANGER, MATE], LOOT_FFA_DELAY, true)).toBe(
      false,
    );
  });

  it('opens a lapsed stranger tap only while the FFA rule is honored', () => {
    expect(corpseSharedLootRightsFor(ME, STRANGER, null, 0, true)).toBe(true);
    expect(corpseSharedLootRightsFor(ME, STRANGER, null, 0, false)).toBe(false);
  });

  it('treats a missing timer as owner-locked, never as lapsed', () => {
    expect(corpseSharedLootRightsFor(ME, STRANGER, null, undefined, true)).toBe(false);
  });
});

describe('corpseHasOrdinaryLootFor', () => {
  it('is false with no loot table', () => {
    expect(corpseHasOrdinaryLootFor(null, ME, true)).toBe(false);
  });

  it('counts copper and plain slots only with shared rights', () => {
    expect(corpseHasOrdinaryLootFor({ copper: 5, items: [] }, ME, true)).toBe(true);
    expect(corpseHasOrdinaryLootFor({ copper: 5, items: [] }, ME, false)).toBe(false);
    expect(corpseHasOrdinaryLootFor(plainLoot(), ME, true)).toBe(true);
    expect(corpseHasOrdinaryLootFor(plainLoot(), ME, false)).toBe(false);
  });

  it('counts personal and open-to-all slots regardless of rights, but never an empty one', () => {
    const personal = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [ME] }] };
    const foreign = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] };
    const spent = { copper: 0, items: [{ itemId: 'wolf_fang', count: 0, personalFor: [ME] }] };
    const open = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, openToAll: true }] };
    const openSpent = { copper: 0, items: [{ itemId: 'wolf_fang', count: 0, openToAll: true }] };
    expect(corpseHasOrdinaryLootFor(personal, ME, false)).toBe(true);
    expect(corpseHasOrdinaryLootFor(foreign, ME, false)).toBe(false);
    expect(corpseHasOrdinaryLootFor(spent, ME, false)).toBe(false);
    expect(corpseHasOrdinaryLootFor(open, ME, false)).toBe(true);
    expect(corpseHasOrdinaryLootFor(openSpent, ME, false)).toBe(false);
  });
});

describe('corpseHarvestClaimOpen', () => {
  it('is open on a mapped template with no claim, spent once anyone claims it', () => {
    expect(corpseHarvestClaimOpen('forest_wolf', null)).toBe(true);
    expect(corpseHarvestClaimOpen('forest_wolf', ME)).toBe(false);
    expect(corpseHarvestClaimOpen('forest_wolf', STRANGER)).toBe(false);
  });

  it('is closed on a template with nothing to harvest and when claims cannot be mirrored', () => {
    expect(corpseHarvestClaimOpen('test', null)).toBe(false);
    expect(corpseHarvestClaimOpen('forest_wolf', null, false)).toBe(false);
  });
});

describe('corpseIndicatorFor', () => {
  it('shows the ordinary loot glyph while this viewer has loot to take', () => {
    expect(corpseIndicatorFor(corpse({ loot: plainLoot() }), ME, null)).toBe('loot');
    expect(corpseIndicatorFor(corpse({ loot: { copper: 3, items: [] } }), ME, null)).toBe('loot');
  });

  it('ordinary loot wins over an open harvest', () => {
    expect(
      corpseIndicatorFor(corpse({ loot: plainLoot(), harvestClaimedBy: null }), ME, null),
    ).toBe('loot');
  });

  it('shows the harvest glyph on a harvest-only body and none once the claim is spent', () => {
    const body = corpse({ loot: null, harvestClaimedBy: null });
    expect(corpseIndicatorFor(body, ME, null)).toBe('harvest');
    body.harvestClaimedBy = STRANGER;
    expect(corpseIndicatorFor(body, ME, null)).toBe('none');
  });

  it('shows the harvest glyph, not the satchel, on a stranger-locked body I may still harvest', () => {
    const body = corpse({
      loot: plainLoot(),
      tappedById: STRANGER,
      lootFfaTimer: LOOT_FFA_DELAY,
      harvestClaimedBy: null,
    });
    expect(corpseIndicatorFor(body, ME, null)).toBe('harvest');
  });

  it('shows nothing on a stranger-locked body with its harvest spent, and loot after the lapse', () => {
    const body = corpse({
      loot: plainLoot(),
      tappedById: STRANGER,
      lootFfaTimer: LOOT_FFA_DELAY,
      harvestClaimedBy: STRANGER,
    });
    expect(corpseIndicatorFor(body, ME, null)).toBe('none');
    body.lootFfaTimer = 0;
    expect(corpseIndicatorFor(body, ME, null)).toBe('loot');
  });

  it("a party mate's tap reads as loot through the viewer roster, a stranger party does not", () => {
    const body = corpse({
      loot: plainLoot(),
      tappedById: MATE,
      lootFfaTimer: LOOT_FFA_DELAY,
      harvestClaimedBy: STRANGER,
    });
    expect(corpseIndicatorFor(body, ME, [ME, MATE])).toBe('loot');
    expect(corpseIndicatorFor(body, ME, [ME, STRANGER])).toBe('none');
    expect(corpseIndicatorFor(body, ME, null)).toBe('none');
  });

  it('a personal drop naming me reads as loot even under a stranger lock', () => {
    const body = corpse({
      loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [ME] }] },
      tappedById: STRANGER,
      lootFfaTimer: LOOT_FFA_DELAY,
      harvestClaimedBy: STRANGER,
    });
    expect(corpseIndicatorFor(body, ME, null)).toBe('loot');
    expect(corpseIndicatorFor(body, MATE, null)).toBe('none');
  });

  it('shows nothing for an owned pet body, a living mob, an unlootable body, or an object', () => {
    expect(corpseIndicatorFor(corpse({ ownerId: ME, loot: plainLoot() }), ME, null)).toBe('none');
    expect(corpseIndicatorFor(corpse({ dead: false, loot: plainLoot() }), ME, null)).toBe('none');
    expect(corpseIndicatorFor(corpse({ lootable: false, loot: plainLoot() }), ME, null)).toBe(
      'none',
    );
    expect(corpseIndicatorFor(corpse({ kind: 'object', loot: plainLoot() }), ME, null)).toBe(
      'none',
    );
  });

  it('shows nothing once the corpse has expired, whatever stale fields remain', () => {
    expect(
      corpseIndicatorFor(
        corpse({ corpseTimer: 0, loot: plainLoot(), harvestClaimedBy: null }),
        ME,
        null,
      ),
    ).toBe('none');
  });

  it('falls back from harvest to none when the host cannot mirror claim state', () => {
    expect(corpseIndicatorFor(corpse({ loot: null }), ME, null, false)).toBe('none');
    expect(corpseIndicatorFor(corpse({ loot: plainLoot() }), ME, null, false)).toBe('loot');
  });
});
