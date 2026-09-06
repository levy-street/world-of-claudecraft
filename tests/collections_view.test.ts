// The Collections window's pure view model (src/ui/collections/
// collections_view.ts). The window's whole promise is "every collectible in the
// game, including the ones you cannot get yet", so the pins here are about
// COMPLETENESS and grouping, not about any one row's copy.

import { describe, expect, it } from 'vitest';
import { BUDDIES, BUDDY_KEYS } from '../src/sim/content/buddies';
import { MOUNTS } from '../src/sim/content/mounts';
import { ITEMS } from '../src/sim/data';
import {
  buddyKindOf,
  buildCollectionsView,
  COLLECTION_ARMOR_TYPES,
  COLLECTION_PET_KINDS,
  petKindOf,
  rarityRank,
  setArmorType,
  setPrimaryStat,
} from '../src/ui/collections/collections_view';

const EMPTY = {
  buddyVisualKeys: {},
  ownedBuddyKeys: new Set<string>(),
  ownedMountKeys: new Set<string>(),
  ownedItemIds: new Set<string>(),
  mountVisualKeys: {},
};

describe('collections view model', () => {
  it('lists every catalog buddy and every catalog mount, owned or not', () => {
    const view = buildCollectionsView(EMPTY);
    // Same set, different ORDER: the tab sorts by pet kind then rarity, so
    // compare membership here and pin the ordering in its own case below.
    expect([...view.buddies.map((b) => b.key)].sort()).toEqual([...BUDDY_KEYS].sort());
    expect(view.mounts.map((m) => m.key)).toEqual(Object.keys(MOUNTS));
    expect(view.buddies.every((b) => b.owned === false)).toBe(true);
  });

  it('marks an entry with no source as unobtainable instead of dropping the row', () => {
    const view = buildCollectionsView(EMPTY);
    const rows = [...view.buddies, ...view.mounts];
    // Whatever the current content is, the flag must agree with the derivation:
    // a row is obtainable exactly when its item really has a source.
    for (const row of rows) {
      expect(row.obtainable, row.key).toBe(row.facts?.obtainable ?? false);
    }
    // And the row still carries a name and a preview key either way, so an
    // unobtainable entry renders as a real, greyed-out catalog entry.
    expect(rows.every((row) => row.name.length > 0)).toBe(true);
  });

  it('resolves the granting item from the item table, not from an id convention', () => {
    const view = buildCollectionsView(EMPTY);
    for (const row of view.buddies) {
      if (!row.itemId) continue;
      expect(ITEMS[row.itemId].kind, row.key).toBe('buddy');
      expect((ITEMS[row.itemId] as { buddy?: string }).buddy, row.key).toBe(row.key);
    }
    for (const row of view.mounts) {
      if (!row.itemId) continue;
      expect(ITEMS[row.itemId].kind, row.key).toBe('mount');
      expect((ITEMS[row.itemId] as { mount?: string }).mount, row.key).toBe(row.key);
    }
  });

  it('reflects ownership from the viewer bag/bank item ids', () => {
    const view = buildCollectionsView({
      ...EMPTY,
      ownedBuddyKeys: new Set(['penny_goldspark']),
    });
    const penny = view.buddies.find((b) => b.key === 'penny_goldspark');
    expect(penny?.owned).toBe(true);
    expect(view.buddies.filter((b) => b.owned)).toHaveLength(1);
  });

  it('groups epic-or-better sets by armor type then primary stat, and admits nothing below epic', () => {
    const view = buildCollectionsView(EMPTY);
    expect(view.setGroups.length).toBeGreaterThan(0);
    for (const group of view.setGroups) {
      expect(COLLECTION_ARMOR_TYPES).toContain(group.armorType);
      expect(group.sets.length).toBeGreaterThan(0);
      for (const set of group.sets) {
        expect(['epic', 'legendary']).toContain(set.quality);
        expect(set.armorType).toBe(group.armorType);
        expect(set.stat).toBe(group.stat);
        expect(set.pieces.length).toBeGreaterThan(0);
        // Every piece resolves to a real item and reports its own bind state.
        for (const piece of set.pieces) expect(ITEMS[piece.itemId], piece.itemId).toBeTruthy();
      }
    }
    // Armor-type groups appear in the authored order, never in table order.
    const seen = view.setGroups.map((g) => g.armorType);
    const ordered = [...seen].sort(
      (a, b) => COLLECTION_ARMOR_TYPES.indexOf(a) - COLLECTION_ARMOR_TYPES.indexOf(b),
    );
    expect(seen).toEqual(ordered);
  });

  it('groups buddies by pet kind, purple to white inside each kind', () => {
    const view = buildCollectionsView(EMPTY);
    expect(view.buddyGroups.map((g) => g.kind)).toEqual(
      COLLECTION_PET_KINDS.filter((kind) => view.buddies.some((b) => b.petKind === kind)),
    );
    for (const group of view.buddyGroups) {
      // Every row really belongs to its heading...
      expect(group.entries.every((row) => row.petKind === group.kind)).toBe(true);
      // ...and rarity never climbs back up inside one.
      const ranks = group.entries.map((row) => rarityRank(row.quality));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    // The groups partition the flat list: nothing lost, nothing counted twice.
    expect(view.buddyGroups.reduce((n, g) => n + g.entries.length, 0)).toBe(view.buddies.length);
  });

  it('reads the pet kind off the follower mob family, not off a second table', () => {
    expect(petKindOf('undead')).toBe('undead');
    expect(petKindOf('humanoid')).toBe('humanoid');
    // Everything else collects as a beast, spiders and raptors included.
    expect(petKindOf('spider')).toBe('beast');
    expect(petKindOf('reptile')).toBe('beast');
    expect(petKindOf('beast')).toBe('beast');
  });

  it('puts the guest characters and the elementals in their authored groups', () => {
    // Neither group is a creature type, so neither can come from a mob family:
    // the catalog authors them and this pins the roster the owner named.
    expect(buddyKindOf('trollface')).toBe('celebrity');
    expect(buddyKindOf('ansem')).toBe('celebrity');
    expect(buddyKindOf('triple_t')).toBe('celebrity');
    expect(buddyKindOf('kekius')).toBe('celebrity');
    expect(buddyKindOf('rocky')).toBe('elemental');
    expect(buddyKindOf('alon')).toBe('humanoid');
    expect(buddyKindOf('solbot')).toBe('humanoid');
    expect(buddyKindOf('frostfire')).toBe('elemental');
    expect(buddyKindOf('forgemaw')).toBe('elemental');
    expect(buddyKindOf('phantom')).toBe('elemental');
    // The fishing catch takes no override: it is a beast by its own family,
    // which is the default path this list exists to keep honest.
    expect(buddyKindOf('crystal_tide')).toBe('beast');
    // And nothing else drifted into them: every other companion still groups
    // by its family, so a new buddy lands in a creature group by default.
    const authored = BUDDY_KEYS.filter((key) => BUDDIES[key].kind !== undefined);
    expect(authored.sort()).toEqual(
      [
        'alon',
        'ansem',
        'forgemaw',
        'phantom',
        'frostfire',
        'kekius',
        'rocky',
        'solbot',
        'triple_t',
        'trollface',
      ].sort(),
    );
  });

  it('never infers an editorial group from a family', () => {
    // petKindOf answers creature facts only: the two editorial groups have to be
    // authored, so a family can never produce one by accident.
    for (const family of ['beast', 'humanoid', 'undead', 'spider', 'reptile', 'elemental']) {
      expect(['beast', 'humanoid', 'undead']).toContain(petKindOf(family));
    }
  });

  it('ranks an unnamed quality with white, so no grey rung can appear', () => {
    expect(rarityRank('epic')).toBeLessThan(rarityRank('rare'));
    expect(rarityRank('rare')).toBeLessThan(rarityRank('uncommon'));
    expect(rarityRank('uncommon')).toBeLessThan(rarityRank('common'));
    expect(rarityRank('poor')).toBe(rarityRank('common'));
  });

  it('orders set pieces and families by item level, and marks what is owned', () => {
    const view = buildCollectionsView(EMPTY);
    for (const group of view.setGroups) {
      const levels = group.sets.map((set) => set.itemLevel ?? 0);
      expect(levels).toEqual([...levels].sort((a, b) => b - a));
      for (const set of group.sets) {
        const pieceLevels = set.pieces.map((piece) => piece.itemLevel ?? 0);
        expect(pieceLevels).toEqual([...pieceLevels].sort((a, b) => b - a));
        // Nothing is owned in this fixture, so every bonus reads unmet.
        expect(set.ownedCount).toBe(0);
        expect(set.bonuses.every((tier) => tier.owned === false)).toBe(true);
        // Bonus tiers ascend, which is the order the pane paints them.
        const tiers = set.bonuses.map((tier) => tier.pieces);
        expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
      }
    }
  });

  it('marks the pieces the viewer carries, and lights the tiers they reach', () => {
    const anySet = buildCollectionsView(EMPTY).setGroups[0]?.sets[0];
    expect(anySet).toBeDefined();
    if (!anySet) return;
    const owned = new Set(anySet.pieces.slice(0, 2).map((piece) => piece.itemId));
    const view = buildCollectionsView({ ...EMPTY, ownedItemIds: owned });
    const set = view.setGroups.flatMap((g) => g.sets).find((s) => s.setId === anySet.setId);
    expect(set?.ownedCount).toBe(2);
    expect(
      set?.pieces
        .filter((piece) => piece.owned)
        .map((piece) => piece.itemId)
        .sort(),
    ).toEqual([...owned].sort());
    for (const tier of set?.bonuses ?? []) expect(tier.owned).toBe(tier.pieces <= 2);
  });

  it('derives a set stat from its pieces and calls an even split mixed', () => {
    expect(setPrimaryStat([{ stats: { int: 10, sta: 4 } } as never])).toBe('intellect');
    expect(setPrimaryStat([{ stats: { agi: 7 } } as never])).toBe('agility');
    expect(setPrimaryStat([{ stats: { str: 7, agi: 7 } } as never])).toBe('mixed');
    // Stamina alone is not a primary stat identity.
    expect(setPrimaryStat([{ stats: { sta: 12 } } as never])).toBe('mixed');
  });

  it('refuses to type a set whose pieces disagree on armor class', () => {
    expect(setArmorType([{ armorType: 'cloth' } as never, { armorType: 'cloth' } as never])).toBe(
      'cloth',
    );
    expect(
      setArmorType([{ armorType: 'cloth' } as never, { armorType: 'mail' } as never]),
    ).toBeNull();
    expect(setArmorType([{} as never])).toBeNull();
  });
});
