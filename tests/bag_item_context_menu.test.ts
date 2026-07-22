// Pure-core tests for the bag-item context menu (Professions 2.0 Phase 13):
// action eligibility (which items get Disenchant / Salvage / Apply Enchant), the
// first-row classic-default guarantee, and the stronger-warning confirm predicate
// (which copy a destructive action would actually consume, and whether it is
// special) including the do-not-scare-a-plain-copy-holder nuance.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import {
  type BagCopy,
  bagItemContextActions,
  bagItemHasContextActions,
  bagItemNewActions,
  destroyConsumesSpecialCopy,
  isEnchantReagentItem,
  isSpecialCopy,
} from '../src/ui/bag_item_context_menu';

function def(kind: string, quality?: string): ItemDef {
  return { kind, quality } as unknown as ItemDef;
}
function copy(instance?: Partial<ItemInstancePayload>): BagCopy {
  return instance ? { count: 1, instance: instance as ItemInstancePayload } : { count: 1 };
}

describe('bag_item_context_menu: enchant reagent detection', () => {
  it('recognizes every item id that any enchant consumes', () => {
    // Every reagent id in the static table is a reagent; arcane_dust is the base.
    const reagentIds = new Set(
      Object.values(ENCHANTS).flatMap((e) => e.reagents.map((r) => r.itemId)),
    );
    expect(reagentIds.size).toBeGreaterThan(1);
    for (const id of reagentIds) expect(isEnchantReagentItem(id)).toBe(true);
    expect(isEnchantReagentItem('arcane_dust')).toBe(true);
  });
  it('rejects a non-reagent id', () => {
    expect(isEnchantReagentItem('bone_fragments')).toBe(false);
    expect(isEnchantReagentItem('not_a_real_item')).toBe(false);
  });
});

describe('bag_item_context_menu: action eligibility', () => {
  it('offers Disenchant AND Salvage on a common+ weapon or armor', () => {
    expect(bagItemNewActions(def('weapon', 'common'), 'sword')).toEqual(['disenchant', 'salvage']);
    expect(bagItemNewActions(def('armor', 'rare'), 'plate')).toEqual(['disenchant', 'salvage']);
  });
  it('offers nothing on a poor-quality or non-gear item', () => {
    expect(bagItemNewActions(def('weapon', 'poor'), 'stick')).toEqual([]);
    expect(bagItemNewActions(def('material'), 'iron_ore')).toEqual([]);
    expect(bagItemHasContextActions(def('material'), 'iron_ore')).toBe(false);
  });
  it('offers Apply Enchant on an enchant reagent material', () => {
    expect(bagItemNewActions(def('material'), 'arcane_dust')).toEqual(['applyEnchant']);
    expect(bagItemHasContextActions(def('material'), 'arcane_dust')).toBe(true);
  });
});

describe('bag_item_context_menu: menu row ordering', () => {
  it('always leads with the classic default action', () => {
    const gear = bagItemContextActions(def('weapon', 'common'), 'sword');
    expect(gear[0]).toEqual({ id: 'default', labelKey: 'hudChrome.itemMenu.equip' });
    expect(gear.map((r) => r.id)).toEqual(['default', 'disenchant', 'salvage']);

    const reagent = bagItemContextActions(def('material'), 'arcane_dust');
    expect(reagent[0]).toEqual({ id: 'default', labelKey: 'hudChrome.itemMenu.use' });
    expect(reagent.map((r) => r.id)).toEqual(['default', 'applyEnchant']);
  });
});

describe('bag_item_context_menu: special-copy classification', () => {
  it('flags signed, masterwork, and enchanted copies; not a plain one', () => {
    expect(isSpecialCopy(undefined)).toBe(false);
    expect(isSpecialCopy({ signer: 'Alice' } as ItemInstancePayload)).toBe(true);
    expect(isSpecialCopy({ rolled: { masterwork: true } } as ItemInstancePayload)).toBe(true);
    expect(isSpecialCopy({ enchant: 'enchant_weapon_might' } as ItemInstancePayload)).toBe(true);
    // Legacy enchanted marker: bare rolled.stats without masterwork.
    expect(isSpecialCopy({ rolled: { stats: { str: 5 } } } as ItemInstancePayload)).toBe(true);
    // A legacy rolled.quality-only copy is NOT special (never signed/mw/enchanted).
    expect(isSpecialCopy({ rolled: { quality: 'rare' } } as ItemInstancePayload)).toBe(false);
  });
});

describe('bag_item_context_menu: confirm escalation predicate', () => {
  it('never warns when a plain fungible copy exists (that copy is consumed)', () => {
    const held = [copy(), copy({ rolled: { masterwork: true } })];
    expect(destroyConsumesSpecialCopy('disenchant', held)).toBe(false);
    expect(destroyConsumesSpecialCopy('salvage', held)).toBe(false);
  });

  it('warns for salvage when only a special instanced copy is held', () => {
    expect(destroyConsumesSpecialCopy('salvage', [copy({ signer: 'Bob' })])).toBe(true);
    expect(destroyConsumesSpecialCopy('salvage', [copy({ rolled: { masterwork: true } })])).toBe(
      true,
    );
    // Salvage CAN consume an enchanted copy, so a lone enchanted copy warns.
    expect(destroyConsumesSpecialCopy('salvage', [copy({ enchant: 'enchant_weapon_might' })])).toBe(
      true,
    );
  });

  it('salvage takes the highest-index copy: a trailing plain-ish legacy copy is not special', () => {
    // No fungible copy; the last copy is a legacy quality-only instance, which
    // salvage (removeItem) consumes and which is NOT special.
    const held = [copy({ signer: 'Bob' }), copy({ rolled: { quality: 'rare' } })];
    expect(destroyConsumesSpecialCopy('salvage', held)).toBe(false);
  });

  it('warns for disenchant when the consumed non-enchanted copy is special', () => {
    expect(destroyConsumesSpecialCopy('disenchant', [copy({ rolled: { masterwork: true } })])).toBe(
      true,
    );
    expect(destroyConsumesSpecialCopy('disenchant', [copy({ signer: 'Bob' })])).toBe(true);
  });

  it('disenchant skips the already-enchanted copy when choosing the victim', () => {
    // The last copy is enchanted (never consumed by disenchant); the masterwork
    // copy before it is the real victim, so the stronger warning fires.
    const held = [
      copy({ rolled: { masterwork: true } }),
      copy({ enchant: 'enchant_weapon_might' }),
    ];
    expect(destroyConsumesSpecialCopy('disenchant', held)).toBe(true);
  });

  it('disenchant does not warn on a lone plain copy', () => {
    expect(destroyConsumesSpecialCopy('disenchant', [copy()])).toBe(false);
  });
});
