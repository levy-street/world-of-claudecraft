// @vitest-environment happy-dom
//
// The material kind-line split: fine grades read "Fine Material", honest
// materials (ores, raw cooking catches, game_meat, ...) read "Material", and
// grey non-material junk keeps "Junk". Kind stays 'junk' internally for sell
// and taxonomy rules. Unit arms drive item_kind_label directly; one integration
// arm keeps Hud.prototype.itemTooltip honest.

import { describe, expect, it } from 'vitest';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { baseMaterialFor } from '../src/sim/professions/material_grades';
import { Hud } from '../src/ui/hud';
import { itemKindLabel, itemQualityLabel } from '../src/ui/item_kind_label';

function tooltipHtml(itemId: string): string {
  const h = Object.create(Hud.prototype) as unknown as {
    itemTooltip(item: unknown, compare?: boolean): string;
  };
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing item ${itemId}`);
  return h.itemTooltip(item, false);
}

describe('itemKindLabel and itemQualityLabel, driven directly', () => {
  it('splits fine grade, honest material, and grey junk off kind junk', () => {
    expect(itemKindLabel('junk', 'fine_iron_ore')).toBe('Fine Material');
    expect(itemKindLabel('junk', 'iron_ore')).toBe('Material');
    expect(itemKindLabel('junk', 'game_meat')).toBe('Material');
    expect(itemKindLabel('junk', 'raw_river_perch')).toBe('Material');
    // No item id at all (callers without one): plain junk.
    expect(itemKindLabel('junk')).toBe('Junk');
    expect(itemKindLabel('weapon', 'fine_iron_ore')).toBe('Weapon');
  });

  it('quality defaults to common when the def carries none', () => {
    expect(itemQualityLabel(undefined)).toBe(itemQualityLabel('common'));
    expect(itemQualityLabel('epic')).not.toBe(itemQualityLabel('common'));
  });
});

describe('the tooltip kind line for material grades', () => {
  it('a fine grade reads Fine Material, never Junk; its base reads Material', () => {
    expect(ITEMS.fine_iron_ore.kind).toBe('junk');
    expect(baseMaterialFor('fine_iron_ore')).toBe('iron_ore');
    const fine = tooltipHtml('fine_iron_ore');
    expect(fine).toContain('Fine Material');
    // qualityKind is "{quality} {kind}"; reject bare Junk word after Fine Material.
    expect(fine).not.toMatch(/(?<!Fine )\bJunk\b/);
    const base = tooltipHtml('iron_ore');
    expect(base).toContain('Material');
    expect(base).not.toContain('Fine Material');
    expect(base).not.toMatch(/\bJunk\b/);
  });

  it('raw cooking catches and game_meat read Material, not Junk', () => {
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
      expect(itemKindLabel('junk', id), id).toBe('Material');
      const html = tooltipHtml(id);
      expect(html, id).toContain('Material');
      expect(html, id).not.toMatch(/\bJunk\b/);
      expect(html, id).not.toContain('Fine Material');
    }
    expect(itemKindLabel('junk', 'game_meat')).toBe('Material');
    expect(tooltipHtml('game_meat')).toContain('Material');
    expect(tooltipHtml('game_meat')).not.toMatch(/\bJunk\b/);
  });

  it('ordinary junk-kind items keep the Junk line when not honest materials', () => {
    const junkId = Object.keys(ITEMS).find(
      (id) =>
        ITEMS[id].kind === 'junk' &&
        baseMaterialFor(id) === undefined &&
        !MATERIAL_ITEM_IDS.has(id),
    );
    if (!junkId) throw new Error('no plain junk-kind item in content');
    expect(tooltipHtml(junkId)).toContain('Junk');
    expect(itemKindLabel('junk', junkId)).toBe('Junk');
  });

  it('cooked meals still read Food', () => {
    expect(itemKindLabel('food', 'pan_seared_perch')).toBe('Food');
    expect(tooltipHtml('pan_seared_perch')).toContain('Food');
  });
});
