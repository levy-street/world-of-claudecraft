import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { ITEMS } from '../src/sim/data';
import type { ArmorItemDef } from '../src/sim/types';
import {
  buildDungeonFinderView,
  type FinderEncounterViewModel,
} from '../src/ui/dungeon_finder_view';
import {
  filterEncounterLoot,
  lootPreviewFits,
  validLootPreviewSpec,
} from '../src/ui/dungeon_loot_preview_view';

const armor = (stats: { str?: number; int?: number; sta?: number }): ArmorItemDef => ({
  id: 'fixture',
  name: 'Fixture',
  kind: 'armor',
  slot: 'chest',
  armorType: 'cloth',
  sellValue: 0,
  stats,
});
describe('adventure loot preview', () => {
  it('uses actual class legality and authored stat affinity, retaining neutral rewards', () => {
    expect(
      lootPreviewFits(
        { ...armor({ str: 4 }), armorType: 'mail' as const },
        { cls: 'mage', spec: 'fire' },
      ),
    ).toBe(false);
    expect(lootPreviewFits(armor({ int: 4 }), { cls: 'paladin', spec: 'holy' })).toBe(true);
    expect(lootPreviewFits(armor({ int: 4 }), { cls: 'paladin', spec: 'retribution' })).toBe(false);
    expect(lootPreviewFits(armor({ str: 4 }), { cls: 'paladin', spec: 'holy' })).toBe(false);
    expect(lootPreviewFits(armor({ sta: 4 }), { cls: 'paladin', spec: 'holy' })).toBe(true);
    expect(lootPreviewFits(ITEMS.baked_bread, { cls: 'mage', spec: 'fire' })).toBe(true);
    expect(lootPreviewFits(ITEMS.copper_ore, { cls: 'mage', spec: 'fire' })).toBe(true);
    expect(
      lootPreviewFits(
        { ...armor({ int: 4 }), requiredClass: ['priest'] },
        { cls: 'mage', spec: 'fire' },
      ),
    ).toBe(false);
  });
  it('rejects invalid cross-class specializations without interpreting them as another class', () => {
    expect(validLootPreviewSpec('warrior', 'holy')).toBeNull();
    expect(validLootPreviewSpec('paladin', 'holy')).toBe('holy');
    expect(lootPreviewFits(armor({ int: 4 }), { cls: 'paladin', spec: null })).toBe(true);
  });
  it('preserves original chances and group meaning without changing bosses or money', () => {
    const usable = Object.values(ITEMS).find(
      (item) => item.slot && lootPreviewFits(item, { cls: 'mage', spec: 'fire' }),
    );
    const blocked = Object.values(ITEMS).find(
      (item) => item.slot && !lootPreviewFits(item, { cls: 'mage', spec: 'fire' }),
    );
    expect(usable).toBeDefined();
    expect(blocked).toBeDefined();
    if (!usable || !blocked) throw new Error('missing real loot fixture');
    const encounter: FinderEncounterViewModel = {
      mobId: 'fixture',
      final: true,
      summoned: false,
      mechanics: ['enrage'],
      portraitUrl: '',
      copper: 123,
      groups: [
        {
          guaranteed: true,
          items: [
            { itemId: usable.id, quality: 'rare', chance: 0.25 },
            { itemId: blocked.id, quality: 'rare', chance: 0.75 },
          ],
        },
      ],
      singles: [{ itemId: blocked.id, quality: 'rare', chance: 0.3 }],
      heroicGroups: [],
      heroicSingles: [],
    };
    const before = structuredClone(encounter);
    const filtered = filterEncounterLoot(encounter, { cls: 'mage', spec: 'fire' });
    expect(filtered.groups[0]).toMatchObject({
      guaranteed: true,
      previewFiltered: true,
      items: [{ itemId: usable.id, chance: 0.25 }],
    });
    expect(filtered.singles).toEqual([]);
    expect(filtered).toMatchObject({
      mobId: 'fixture',
      final: true,
      copper: 123,
      mechanics: ['enrage'],
    });
    expect(encounter).toEqual(before);
  });
  it('projects all real catalogue encounters without changing finder eligibility', () => {
    for (const activity of FINDER_ACTIVITIES) {
      const view = buildDungeonFinderView({
        info: {
          roles: [],
          eligibleRoles: [],
          queue: null,
          cooldown: 0,
          proposal: null,
          myListing: null,
          myApplication: null,
        },
        board: [],
        playerLevel: 20,
        playerClass: 'warrior',
        playerId: 1,
        specRole: 'tank',
        party: null,
        partyLeaderName: null,
        lockouts: [],
        tab: 'catalogue',
        selectedActivityId: activity.id,
        stagedActivityIds: [],
      });
      if (view.kind !== 'live') throw new Error('expected live');
      const before = structuredClone(view);
      for (const encounter of view.detail?.encounters ?? []) {
        for (const cls of ['mage', 'warrior', 'priest'] as const) {
          const filtered = filterEncounterLoot(encounter, { cls, spec: null });
          const actual = [
            ...filtered.groups.flatMap((g) => g.items),
            ...filtered.singles,
            ...filtered.heroicGroups.flatMap((g) => g.items),
            ...filtered.heroicSingles,
          ];
          expect(actual.every((i) => lootPreviewFits(ITEMS[i.itemId], { cls, spec: null }))).toBe(
            true,
          );
        }
      }
      expect(view).toEqual(before);
    }
  });
});
