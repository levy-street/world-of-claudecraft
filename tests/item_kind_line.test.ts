// @vitest-environment happy-dom
//
// The fine-grade kind-line split (the UX pass): a fine-grade material's
// tooltip kind line reads "Fine Material" while its def KIND stays 'junk'
// (the downward substitution and the Sell Junk sweep both key off it).
// The unit arms drive the extracted item_kind_label module directly (the
// phase 14 QA: the logic used to be a hud.ts private only reachable
// through the whole itemTooltip HTML); one integration arm keeps the real
// Hud.prototype.itemTooltip wiring honest, base and fine side by side so a
// broken pairing cannot pass by rewording both.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
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
  it('splits the fine grade off junk and keeps every other kind on its key', () => {
    expect(itemKindLabel('junk', 'fine_iron_ore')).toBe('Fine Material');
    expect(itemKindLabel('junk', 'iron_ore')).toBe('Junk');
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
  it('a fine grade reads Fine Material, never Junk; its base still reads Junk', () => {
    // Fixture sanity: the pairing and the internal kind are what the split
    // depends on.
    expect(ITEMS.fine_iron_ore.kind).toBe('junk');
    expect(baseMaterialFor('fine_iron_ore')).toBe('iron_ore');
    const fine = tooltipHtml('fine_iron_ore');
    expect(fine).toContain('Fine Material');
    expect(fine).not.toContain('>Junk<');
    const base = tooltipHtml('iron_ore');
    expect(base).toContain('Junk');
    expect(base).not.toContain('Fine Material');
  });

  it('ordinary junk-kind items keep the Junk line (the split is fine-grades only)', () => {
    const junkId = Object.keys(ITEMS).find(
      (id) => ITEMS[id].kind === 'junk' && baseMaterialFor(id) === undefined,
    );
    if (!junkId) throw new Error('no plain junk-kind item in content');
    expect(tooltipHtml(junkId)).toContain('Junk');
  });
});
