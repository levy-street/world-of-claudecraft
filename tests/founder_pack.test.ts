import { describe, expect, it } from 'vitest';
import {
  FOUNDER_PACK_MOUNT_PICKS,
  FOUNDER_PACK_TIERS,
  FOUNDER_SKIN_CATALOG,
  founderPackMountReinsItemId,
  founderPackTierDef,
  founderSkinDef,
} from '../src/sim/content/founder_pack';
import { FOUNDER_PACK_MOUNTS, MOUNTS } from '../src/sim/content/mounts';
import { ITEMS } from '../src/sim/data';
import { mountItemId } from '../src/sim/mounts';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES } from '../src/sim/types';
import { buildFounderPackView } from '../src/ui/founder_pack_window';
import { EMPTY_TEST_WORLD } from './sim_shared';

describe('founder_pack content (The Founder Salesman)', () => {
  it('pins the three tiers in ascending threshold/allowance order', () => {
    expect(FOUNDER_PACK_TIERS.map((d) => d.tier)).toEqual(['uncommon', 'rare', 'epic']);
    for (let i = 1; i < FOUNDER_PACK_TIERS.length; i++) {
      expect(FOUNDER_PACK_TIERS[i].wocThreshold).toBeGreaterThan(
        FOUNDER_PACK_TIERS[i - 1].wocThreshold,
      );
      expect(FOUNDER_PACK_TIERS[i].mountPicks).toBeGreaterThan(
        FOUNDER_PACK_TIERS[i - 1].mountPicks,
      );
      expect(FOUNDER_PACK_TIERS[i].skinPicks).toBeGreaterThan(FOUNDER_PACK_TIERS[i - 1].skinPicks);
      expect(FOUNDER_PACK_TIERS[i].claudium).toBeGreaterThan(FOUNDER_PACK_TIERS[i - 1].claudium);
    }
    expect(FOUNDER_PACK_TIERS[2].goldenAura).toBe(true);
    expect(FOUNDER_PACK_TIERS[0].goldenAura).toBe(false);
    expect(FOUNDER_PACK_TIERS[1].goldenAura).toBe(false);
    // Only the epic tier grants all 3 mount picks and all 9 skin picks.
    expect(FOUNDER_PACK_TIERS[2].mountPicks).toBe(FOUNDER_PACK_MOUNT_PICKS.length);
    expect(FOUNDER_PACK_TIERS[2].skinPicks).toBe(FOUNDER_SKIN_CATALOG.length);
  });

  it('founderPackTierDef resolves a known tier and refuses an unknown one', () => {
    expect(founderPackTierDef('rare')?.title).toBe('Starforged');
    expect(founderPackTierDef('nonexistent')).toBeNull();
  });

  it('every Founder Pack mount pick resolves a real reins item that grants that exact mount', () => {
    expect(FOUNDER_PACK_MOUNT_PICKS).toEqual(FOUNDER_PACK_MOUNTS);
    for (const key of FOUNDER_PACK_MOUNT_PICKS) {
      const itemId = founderPackMountReinsItemId(key);
      expect(itemId, key).not.toBeNull();
      expect(mountItemId(key)).toBe(itemId);
      const item = ITEMS[itemId as string];
      expect(item?.kind).toBe('mount');
      expect((item as { mount?: string }).mount).toBe(key);
      expect(MOUNTS[key].rarity).toBe('epic');
    }
    expect(founderPackMountReinsItemId('valorsteed')).toBeNull();
  });

  it('covers every player class exactly once, and only the 9 skin ids the request names', () => {
    expect(FOUNDER_SKIN_CATALOG).toHaveLength(9);
    expect(FOUNDER_SKIN_CATALOG.map((d) => d.requiredClass).sort()).toEqual(
      [...ALL_CLASSES].sort(),
    );
    expect(new Set(FOUNDER_SKIN_CATALOG.map((d) => d.catalog)).size).toBe(9);
    expect(founderSkinDef('altherion')?.requiredClass).toBe('priest');
    expect(founderSkinDef('dawnbreaker')?.requiredClass).toBe('paladin');
    expect(founderSkinDef('spiritwolf')?.requiredClass).toBe('shaman');
    expect(founderSkinDef('not_a_skin')).toBeNull();
  });

  it('every bag-pet item id a tier names is a real, distinct, non-tradeable Bag item', () => {
    const bagIds = FOUNDER_PACK_TIERS.map((d) => d.bagItemId);
    expect(new Set(bagIds).size).toBe(3);
    for (const id of bagIds) {
      const item = ITEMS[id];
      expect(item?.kind, id).toBe('bag');
      expect(item?.soulbound, id).toBe(true);
    }
  });
});

describe('Sim.claimFounderPack / claimFounderSkin (offline: always refused)', () => {
  it('refuses claimFounderPack offline and changes no account state', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    const before = { ...sim.accountCosmetics };
    sim.claimFounderPack('uncommon', ['cinderjaw_rex']);
    expect(sim.accountCosmetics).toEqual(before);
    expect(sim.drainEvents().some((e) => e.type === 'error' && /online account/.test(e.text))).toBe(
      true,
    );
  });

  it('refuses claimFounderSkin offline and grants nothing', () => {
    const sim = new Sim({ seed: 1, playerClass: 'priest', world: EMPTY_TEST_WORLD });
    sim.claimFounderSkin('altherion');
    expect(sim.accountCosmetics.founderSkinIds ?? []).toEqual([]);
    expect(sim.drainEvents().some((e) => e.type === 'error' && /online account/.test(e.text))).toBe(
      true,
    );
  });
});

describe('buildFounderPackView (pure core)', () => {
  const emptyCosmetics = {
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
    mountSkinIds: [],
    founderSkinIds: [],
    founderPackTier: null,
    founderPackClaudium: 0,
  };

  it('with no claim: every tier unlocked, no skin list shown', () => {
    const view = buildFounderPackView(emptyCosmetics, 'priest', FOUNDER_PACK_MOUNT_PICKS);
    expect(view.tiers.every((row) => !row.locked && !row.claimed)).toBe(true);
    expect(view.claimedTierDef).toBeNull();
    expect(view.skinsAllowed).toBe(0);
    expect(view.skinsOwned).toBe(0);
  });

  it('after claiming a tier: that tier reads claimed, the others read locked', () => {
    const view = buildFounderPackView(
      { ...emptyCosmetics, founderPackTier: 'rare' },
      'priest',
      FOUNDER_PACK_MOUNT_PICKS,
    );
    const rare = view.tiers.find((row) => row.tier === 'rare');
    const uncommon = view.tiers.find((row) => row.tier === 'uncommon');
    expect(rare?.claimed).toBe(true);
    expect(uncommon?.claimed).toBe(false);
    expect(uncommon?.locked).toBe(true);
    expect(view.claimedTierDef?.tier).toBe('rare');
    expect(view.skinsAllowed).toBe(6);
  });

  it('skin rows report class match and ownership independently', () => {
    const view = buildFounderPackView(
      { ...emptyCosmetics, founderPackTier: 'epic', founderSkinIds: ['altherion'] },
      'priest',
      FOUNDER_PACK_MOUNT_PICKS,
    );
    const altherion = view.skins.find((row) => row.catalog === 'altherion');
    const boneforged = view.skins.find((row) => row.catalog === 'boneforged');
    expect(altherion?.owned).toBe(true);
    expect(altherion?.classMatches).toBe(true);
    expect(boneforged?.owned).toBe(false);
    expect(boneforged?.classMatches).toBe(false); // warrior-restricted, viewer is priest
    expect(view.skinsOwned).toBe(1);
  });
});
