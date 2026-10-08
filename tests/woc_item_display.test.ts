import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WOC_SHIPPED_SETS,
  wocFitCatalog,
  wocSetItems,
  wocSetNodeLabel,
  wocSetSlotAsset,
} from '../src/render/characters/woc_armor_catalog';
import { WOC_ARMOR_TIERS, wocArmorPackUrl } from '../src/render/characters/woc_armor_core';
import { WOC_WARRIOR_MANIFEST } from '../src/render/characters/woc_character_manifest';
import { WOC_ITEM_DISPLAY } from '../src/render/characters/woc_item_display';
import { WOC_ARMOR_SLOT_BY_EQUIP_SLOT } from '../src/render/characters/woc_parts_core';
import { ITEMS } from '../src/sim/data';
import type { EquipSlot } from '../src/sim/types';

// The WOC display table (the 2026-09-25 character size gameplan, step 7): a game item points at
// the armor set whose piece a body shows for it, the wearer's own class set being the default.

afterEach(() => {
  vi.doUnmock('../src/render/characters/woc_item_display');
  vi.resetModules();
});

describe('the WOC item display table', () => {
  it('points every row at a real dressable armor item and a set shipped in both fits at every tier', () => {
    for (const [itemId, row] of Object.entries(WOC_ITEM_DISPLAY)) {
      const item = ITEMS[itemId];
      expect(item?.kind, itemId).toBe('armor');
      expect(WOC_ARMOR_SLOT_BY_EQUIP_SLOT[item?.slot as EquipSlot], itemId).toBeDefined();
      for (const fit of ['male', 'female'] as const) {
        for (const tier of WOC_ARMOR_TIERS) {
          const file = path.resolve(__dirname, '..', 'public', wocArmorPackUrl(fit, row.set, tier));
          expect(existsSync(file), `${itemId}: ${file}`).toBe(true);
        }
      }
    }
  });

  it('carries every shipped set in each fit catalog, keyed by its asset ids', () => {
    for (const fit of ['male', 'female'] as const) {
      const catalog = wocFitCatalog(fit);
      for (const set of WOC_SHIPPED_SETS) {
        const items = wocSetItems(fit, set);
        expect(Object.keys(items), `${fit} ${set}`).toHaveLength(6);
        for (const [id, item] of Object.entries(items)) {
          expect(catalog.get(id), `${fit} ${set} ${id}`).toBe(item);
          expect(item.set).toBe(set);
        }
      }
    }
    expect(wocSetSlotAsset('male', 'warrior', 'head')).toBe('original_helm');
    expect(wocSetSlotAsset('female', 'mage', 'chest')).toBe('female_mage_chest');
    expect(wocSetSlotAsset('male', 'mage', 'legs')).toBeNull();
  });

  it('mints a set of its own from the naming convention: one row and one file is a new helm', () => {
    expect(wocSetNodeLabel('iron_crown')).toBe('Iron_Crown');
    const male = wocSetItems('male', 'iron_crown');
    expect(male.male_iron_crown_helm).toEqual({
      label: 'Iron Crown helm',
      slot: 'head',
      set: 'iron_crown',
      nodes: ['Armor_Iron_Crown_Helm'],
      hidesAppearance: ['hair'],
    });
    expect(wocSetItems('female', 'iron_crown').female_iron_crown_boots?.nodes).toEqual([
      'Armor_Female_Iron_Crown_Boot_L',
      'Armor_Female_Iron_Crown_Boot_R',
    ]);
  });

  it('dresses an item with a row in its set piece, on any class, and draws that set file', async () => {
    const helmet = Object.values(ITEMS).find((d) => d.kind === 'armor' && d.slot === 'helmet');
    expect(helmet).toBeDefined();
    if (!helmet) return;
    vi.resetModules();
    vi.doMock('../src/render/characters/woc_item_display', () => ({
      WOC_ITEM_DISPLAY: { [helmet.id]: { set: 'mage' } },
    }));
    const core = await import('../src/render/characters/woc_parts_core');
    const manifests = await import('../src/render/characters/woc_character_manifest');
    const M = manifests.WOC_WARRIOR_MANIFEST;
    // a warrior in that helmet wears the mage hood; the rest of the kit stays warrior
    expect(core.wocArmorAssetFor(M, 'helmet', helmet.id)).toBe('male_mage_hood');
    expect(core.wocArmorAssetFor(M, 'chest', 'worn_mail')).toBe('original_chest');
    const worn = core.wocWornFromEquipment(M, { helmet: helmet.id, chest: 'worn_mail' }, false);
    expect(worn.head).toBe('male_mage_hood');
    expect(core.wocWornSets(M, worn)).toEqual(['mage', 'warrior']);
    const shown = core.wocVisibleParts(M, core.wocDefaultAppearance(M), worn);
    expect(shown.has('Armor_Mage_Hood')).toBe(true);
    expect(shown.has('Armor_Original_Helm')).toBe(false);
    // the hood hides the hair like the helm (the modular head's hairstyle follows this rule)
    const { wocWornHidesHair } = await import('../src/render/characters/woc_head_look_core');
    expect(wocWornHidesHair(M, worn)).toBe(true);
    expect(wocWornHidesHair(M, { ...worn, head: null })).toBe(false);
    expect(core.wocAllPartNames(M)).toContain('Armor_Mage_Hood');
    // the female fit shows the female hood of the same set
    const F = manifests.WOC_WARRIOR_FEMALE_MANIFEST;
    expect(core.wocArmorAssetFor(F, 'helmet', helmet.id)).toBe('female_mage_hood');
  });

  it('keeps the default rule without a row: the wearer class piece for the slot', () => {
    expect(Object.keys(WOC_ITEM_DISPLAY)).toEqual([]);
    const [helmId] = Object.entries(WOC_WARRIOR_MANIFEST.items).find(
      ([, item]) => item.slot === 'head',
    ) ?? [null];
    expect(helmId).toBe('original_helm');
  });
});
