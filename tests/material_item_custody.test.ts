// Material item custody (src/sim/material_item_custody.ts): the per-copy and
// per-unit takes the item/vendor surfaces run, plus the buyback composition.
//
// The rule every case here defends: a material unit never leaves through a raw
// `count -= 1`. It leaves through the shared take planner, so the unit carries
// its exact one-unit source, the stack keeps the canonical remainder, and locks
// and skip/deprioritize predicates are judged on the EFFECTIVE payload rather
// than on whether a stack happens to still hold an `instance`.
//
// Real registry ids (nothing injected here, unlike the core suites), so the
// membership pin below is load-bearing.

import { describe, expect, it } from 'vitest';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import { materialItemIds } from '../src/sim/material_ids';
import {
  buybackCompositionAfter,
  commitMaterialUnitWithdrawal,
  consumeMaterialUnitPayloads,
  planMaterialUnitWithdrawal,
  takeMaterialUnit,
  takeMaterialUnitFromSlot,
  takeMaterialUnits,
} from '../src/sim/material_item_custody';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import type { InventoryUnit, InvSlot, ItemInstancePayload } from '../src/sim/types';

const ORE = 'copper_ore';
const IRON = 'iron_ore';
const GEAR = 'worn_sword';

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };
const UNRECORDED: MaterialSource = {};
const SIGNED_ANA: MaterialSource = { signer: 'Ana' };
const SIGNED_BRU: MaterialSource = { signer: 'Bru' };

const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

const countOf = (composition: MaterialComposition | undefined, source: MaterialSource): number =>
  (composition ?? [])
    .filter((entry) => sameSource(entry.source, source))
    .reduce((n, entry) => n + entry.count, 0);

const unitsOf = (
  slots: readonly { materialSources?: MaterialComposition }[],
  source: MaterialSource,
): number => slots.reduce((n, slot) => n + countOf(slot.materialSources, source), 0);

/** The one descriptor a one-unit carrier names. */
const sourceOf = (unit: InventoryUnit): MaterialSource => {
  const composition = unit.materialSources ?? [];
  if (composition.length !== 1 || composition[0].count !== 1) {
    throw new Error('expected exactly one one-unit bucket');
  }
  return composition[0].source;
};

const stack = (
  entries: readonly { source: MaterialSource; count: number }[],
  extra: Partial<InvSlot> = {},
  itemId = ORE,
): InvSlot => ({
  itemId,
  count: entries.reduce((n, e) => n + e.count, 0),
  materialSources: entries,
  ...extra,
});

/** Every slot's composition still sums to the units it claims. */
const expectSourcesAgree = (inventory: readonly InvSlot[]): void => {
  for (const slot of inventory) {
    if (slot.materialSources === undefined) continue;
    const total = slot.materialSources.reduce((n, entry) => n + entry.count, 0);
    expect(total, slot.itemId).toBe(slot.count);
  }
};

const heldUnits = (inventory: readonly InvSlot[], itemId: string): number =>
  inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);

describe('the fixture ids, classified from the real registry', () => {
  it('the ore ids ARE materials and the weapon is not', () => {
    expect(materialItemIds().has(ORE)).toBe(true);
    expect(materialItemIds().has(IRON)).toBe(true);
    expect(materialItemIds().has(GEAR)).toBe(false);
  });
});

describe('taking one named copy: no raw count decrement', () => {
  it('takes the canonical unit and leaves the stack a canonical remainder', () => {
    const inventory = [
      stack([
        { source: SIGNED_ANA, count: 2 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    const unit = takeMaterialUnitFromSlot(inventory, ORE, 0);

    // Unrecorded before premium, even inside one named stack.
    expect(unit).not.toBeNull();
    expect(sameSource(sourceOf(unit as InventoryUnit), UNRECORDED)).toBe(true);
    expect(inventory[0].count).toBe(3);
    expect(countOf(inventory[0].materialSources, UNRECORDED)).toBe(1);
    expect(countOf(inventory[0].materialSources, SIGNED_ANA)).toBe(2);
    expectSourcesAgree(inventory);
  });

  it('carries the signer in the DESCRIPTOR and never on the carrier payload', () => {
    const inventory = [stack([{ source: SIGNED_ANA, count: 2 }], { instance: { boundTo: 7 } })];

    const unit = takeMaterialUnitFromSlot(inventory, ORE, 0) as InventoryUnit;

    expect(unit.instance).toEqual({ boundTo: 7 });
    expect(unit.instance?.signer).toBeUndefined();
    expect(sourceOf(unit).signer).toBe('Ana');
  });

  it('retains the craftedRecipeId marker on the carrier', () => {
    const inventory = [
      stack([{ source: ANA, count: 2 }], { craftedRecipeId: 'recipe_copper_bar' }),
    ];

    const unit = takeMaterialUnitFromSlot(inventory, ORE, 0) as InventoryUnit;

    expect(unit.craftedRecipeId).toBe('recipe_copper_bar');
    expect(inventory[0].craftedRecipeId).toBe('recipe_copper_bar');
  });

  it('removes an emptied stack rather than leaving a zero-count row', () => {
    const inventory = [stack([{ source: ANA, count: 1 }]), stack([{ source: BRU, count: 1 }])];

    takeMaterialUnitFromSlot(inventory, ORE, 0);

    expect(inventory).toHaveLength(1);
    expect(unitsOf(inventory, BRU)).toBe(1);
  });

  it('refuses a locked stack, an out-of-range index and a wrong-item index', () => {
    const inventory = [
      stack([{ source: ANA, count: 2 }], { instance: { locked: true } }),
      stack([{ source: BRU, count: 2 }], {}, IRON),
    ];
    const before = structuredClone(inventory);

    expect(takeMaterialUnitFromSlot(inventory, ORE, 0)).toBeNull();
    expect(takeMaterialUnitFromSlot(inventory, ORE, 1)).toBeNull();
    expect(takeMaterialUnitFromSlot(inventory, ORE, 5)).toBeNull();
    expect(inventory).toEqual(before);
  });

  it('refuses malformed provenance without writing', () => {
    const malformed = stack([{ source: ANA, count: 9 }]);
    malformed.count = 2;
    const inventory = [malformed];
    const before = structuredClone(inventory);

    expect(() => takeMaterialUnitFromSlot(inventory, ORE, 0)).toThrow();
    expect(inventory).toEqual(before);
  });
});

describe('the id-only take is ONE global request, not a newest-stack walk', () => {
  it('spends a plain unit from an EARLIER stack over a premium one in the newest', () => {
    const inventory = [
      stack([{ source: ANA, count: 2 }]),
      stack([{ source: SIGNED_BRU, count: 2 }]),
    ];

    const unit = takeMaterialUnit(inventory, ORE) as InventoryUnit;

    // The decisive case: a newest-stack-first walk would have burned a premium
    // unit while plain material sat one stack earlier.
    expect(sameSource(sourceOf(unit), ANA)).toBe(true);
    expect(unitsOf(inventory, SIGNED_BRU)).toBe(2);
    expect(unitsOf(inventory, ANA)).toBe(1);
  });

  it('reaches premium only once every plain unit anywhere is gone', () => {
    const inventory = [
      stack([{ source: SIGNED_ANA, count: 1 }]),
      stack([{ source: UNRECORDED, count: 1 }]),
    ];

    expect(
      sameSource(sourceOf(takeMaterialUnit(inventory, ORE) as InventoryUnit), UNRECORDED),
    ).toBe(true);
    expect(
      sameSource(sourceOf(takeMaterialUnit(inventory, ORE) as InventoryUnit), SIGNED_ANA),
    ).toBe(true);
    expect(inventory).toEqual([]);
  });

  it('keeps the newest bias only where the canonical order is indifferent', () => {
    // Same descriptor in both stacks: nothing separates them but the tie-break,
    // and that still takes the highest index, as the legacy walk did.
    const inventory = [stack([{ source: ANA, count: 2 }]), stack([{ source: ANA, count: 2 }])];

    takeMaterialUnit(inventory, ORE);

    expect(inventory[0].count).toBe(2);
    expect(inventory[1].count).toBe(1);
  });

  it('steps past a locked stack instead of stopping at it', () => {
    const inventory = [
      stack([{ source: ANA, count: 2 }]),
      stack([{ source: BRU, count: 2 }], { instance: { locked: true } }),
    ];

    const unit = takeMaterialUnit(inventory, ORE) as InventoryUnit;

    expect(sameSource(sourceOf(unit), ANA)).toBe(true);
    expect(unitsOf(inventory, BRU)).toBe(2);
    expect(inventory[1].instance).toEqual({ locked: true });
  });

  it('answers null when nothing of the item is spendable', () => {
    const inventory = [stack([{ source: ANA, count: 1 }], {}, IRON)];

    expect(takeMaterialUnit(inventory, ORE)).toBeNull();
    expect(inventory).toHaveLength(1);
  });
});

describe('itemCopyPin sees a source change at the same count and payload', () => {
  it('changes when only the composition changed', () => {
    const before: InvSlot = {
      itemId: ORE,
      count: 2,
      instance: { boundTo: 7 },
      materialSources: [
        { source: ANA, count: 1 },
        { source: UNRECORDED, count: 1 },
      ],
    };
    const after: InvSlot = {
      ...before,
      materialSources: [
        { source: BRU, count: 1 },
        { source: UNRECORDED, count: 1 },
      ],
    };
    const shifted: InvSlot = {
      ...before,
      materialSources: [
        { source: ANA, count: 2 },
        { source: UNRECORDED, count: 0 },
      ],
    };

    // Same item, same count, same payload: only the descriptors moved, and a
    // mid-action re-check has to notice.
    expect(itemCopyPin(after)).not.toBe(itemCopyPin(before));
    expect(itemCopyPin(shifted)).not.toBe(itemCopyPin(before));
    // The same copy still pins equal to itself.
    expect(itemCopyPin({ ...before })).toBe(itemCopyPin(before));
  });

  it('leaves every source-free copy pinning EXACTLY as it always did', () => {
    const plain: InvSlot = { itemId: ORE, count: 2 };
    const sourced: InvSlot = {
      itemId: ORE,
      count: 2,
      materialSources: [{ source: UNRECORDED, count: 2 }],
    };
    const gear: InvSlot = { itemId: GEAR, count: 1, instance: { boundTo: 7 } };

    // The composition key is only present when a composition is: a non-material
    // (and a legacy material that never carried one) pins the old bytes, with
    // no "s" key at all rather than an "s":null every copy would now carry.
    expect(itemCopyPin(gear)).toBe(`{"c":null,"i":"${GEAR}","p":{"boundTo":7}}`);
    expect(itemCopyPin(gear)).not.toContain('"s"');
    expect(itemCopyPin(plain)).not.toContain('"s"');
    expect(itemCopyPin(sourced)).toContain('"s"');
    expect(itemCopyPin(sourced)).not.toBe(itemCopyPin(plain));
    expect(itemCopyPin(undefined)).toBe('');
  });
});

describe('the sell/trade unit walk preserves the canonical source priority', () => {
  const mixed = (): InvSlot[] => [
    stack([{ source: SIGNED_ANA, count: 2 }]),
    stack([
      { source: ANA, count: 2 },
      { source: UNRECORDED, count: 2 },
    ]),
  ];

  it('spends unrecorded, then plain, then premium, and conserves the count', () => {
    const inventory = mixed();

    const units = takeMaterialUnits(inventory, ORE, 5);

    expect(units).toHaveLength(5);
    expect(units.filter((u) => sameSource(sourceOf(u), UNRECORDED))).toHaveLength(2);
    expect(units.filter((u) => sameSource(sourceOf(u), ANA))).toHaveLength(2);
    expect(units.filter((u) => sameSource(sourceOf(u), SIGNED_ANA))).toHaveLength(1);
    expect(heldUnits(inventory, ORE)).toBe(1);
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(1);
    expectSourcesAgree(inventory);
  });

  it('takes only what is there and never more than asked', () => {
    const inventory = mixed();

    expect(takeMaterialUnits(inventory, ORE, 99)).toHaveLength(6);
    expect(inventory).toEqual([]);
    expect(takeMaterialUnits([], ORE, 3)).toEqual([]);
    expect(takeMaterialUnits(mixed(), ORE, 0)).toEqual([]);
  });

  it('skips a unit by its EFFECTIVE payload, signer included', () => {
    const inventory = mixed();

    // The legacy walk could never see this: the signer lives in the descriptor.
    const units = takeMaterialUnits(inventory, ORE, 99, {
      skip: (payload) => payload.signer !== undefined,
    });

    expect(units).toHaveLength(4);
    expect(units.every((u) => sourceOf(u).signer === undefined)).toBe(true);
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(2);
  });

  it('deprioritizes a unit by its effective payload and reaches it only last', () => {
    const inventory = [
      stack([{ source: UNRECORDED, count: 2 }], { instance: { enchant: 'e1' } }),
      stack([{ source: SIGNED_ANA, count: 2 }]),
    ];

    // The enchanted units are source-PREFERRED yet deprioritized, so the
    // premium units ship first and the enchanted ones only when short.
    const two = takeMaterialUnits(inventory, ORE, 2, {
      deprioritize: (payload) => payload.enchant !== undefined,
    });
    expect(two.every((u) => sourceOf(u).signer === 'Ana')).toBe(true);
    expect(unitsOf(inventory, UNRECORDED)).toBe(2);

    const rest = takeMaterialUnits(inventory, ORE, 2, {
      deprioritize: (payload) => payload.enchant !== undefined,
    });
    expect(rest).toHaveLength(2);
    expect(rest.every((u) => u.instance?.enchant === 'e1')).toBe(true);
    expect(inventory).toEqual([]);
  });

  it('honours payloadOnly: only units with an effective payload may ship', () => {
    const inventory = [
      stack([{ source: UNRECORDED, count: 2 }]),
      stack([{ source: SIGNED_ANA, count: 2 }]),
    ];

    const units = takeMaterialUnits(inventory, ORE, 99, { payloadOnly: true });

    // The signer IS an effective payload; bare unrecorded stock is not.
    expect(units).toHaveLength(2);
    expect(units.every((u) => sourceOf(u).signer === 'Ana')).toBe(true);
    expect(unitsOf(inventory, UNRECORDED)).toBe(2);
  });

  it('never spends a locked stack through the walk', () => {
    const inventory = [
      stack([{ source: ANA, count: 2 }], { instance: { locked: true } }),
      stack([{ source: BRU, count: 2 }]),
    ];

    const units = takeMaterialUnits(inventory, ORE, 99);

    expect(units).toHaveLength(2);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].instance).toEqual({ locked: true });
  });
});

describe('the effective-payload consumption list', () => {
  it('reports only units that really have a payload, and spends the rest anyway', () => {
    const inventory = [
      stack([
        { source: SIGNED_ANA, count: 1 },
        { source: UNRECORDED, count: 3 },
      ]),
    ];

    const payloads = consumeMaterialUnitPayloads(inventory, ORE, 4);

    expect(payloads).toEqual([{ signer: 'Ana' }]);
    expect(inventory).toEqual([]);
  });

  it('conserves the inventory count whatever the payload mix', () => {
    const inventory = [
      stack([
        { source: SIGNED_ANA, count: 2 },
        { source: ANA, count: 2 },
      ]),
    ];

    consumeMaterialUnitPayloads(inventory, ORE, 3);

    expect(heldUnits(inventory, ORE)).toBe(1);
    expectSourcesAgree(inventory);
  });
});

describe('vendor buyback keeps the exact composition', () => {
  it('starts a row composition and merges a later unit into it', () => {
    const first = buybackCompositionAfter(undefined, [{ source: ANA, count: 1 }]);
    const second = buybackCompositionAfter(first, [{ source: UNRECORDED, count: 1 }]);
    const third = buybackCompositionAfter(second, [{ source: ANA, count: 1 }]);

    expect(countOf(first, ANA)).toBe(1);
    expect(countOf(third, ANA)).toBe(2);
    expect(countOf(third, UNRECORDED)).toBe(1);
    // A one-unit top-up adds one unit, never a rewritten whole-row list.
    expect((third ?? []).reduce((n, e) => n + e.count, 0)).toBe(3);
  });

  it('leaves a non-material row alone and never invents a composition', () => {
    expect(buybackCompositionAfter(undefined, undefined)).toBeUndefined();
    const held: MaterialComposition = [{ source: ANA, count: 1 }];
    expect(buybackCompositionAfter(held, undefined)).toBe(held);
  });

  it('does not alias the caller composition into the row', () => {
    const addition: MaterialComposition = [{ source: ANA, count: 1 }];
    const row = buybackCompositionAfter(undefined, addition);

    expect(row).not.toBe(addition);
    (row?.[0].source.gatherer as { name: string }).name = 'Edited';
    expect((addition[0].source.gatherer as { name: string }).name).toBe('Ana');
  });

  it('plans a row withdrawal without mutating, then commits exactly one unit', () => {
    const rows = [
      stack([
        { source: SIGNED_ANA, count: 1 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];
    const before = structuredClone(rows);

    const withdrawal = planMaterialUnitWithdrawal(rows, ORE, 0);
    if (withdrawal === null) throw new Error('expected a withdrawal');

    // Planning alone writes nothing, so a caller may still refuse on capacity.
    expect(rows).toEqual(before);
    expect(sameSource(sourceOf(withdrawal.unit), UNRECORDED)).toBe(true);

    commitMaterialUnitWithdrawal(rows, withdrawal);

    expect(rows[0].count).toBe(2);
    expect(countOf(rows[0].materialSources, UNRECORDED)).toBe(1);
    expect(countOf(rows[0].materialSources, SIGNED_ANA)).toBe(1);
    expectSourcesAgree(rows);
  });

  it('removes the row when its last unit is bought back', () => {
    const rows = [stack([{ source: ANA, count: 1 }]), stack([{ source: BRU, count: 1 }], {}, IRON)];

    const withdrawal = planMaterialUnitWithdrawal(rows, ORE, 0);
    if (withdrawal === null) throw new Error('expected a withdrawal');
    commitMaterialUnitWithdrawal(rows, withdrawal);

    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe(IRON);
  });

  it('answers null for a row that cannot give a unit, leaving it untouched', () => {
    const rows = [stack([{ source: ANA, count: 1 }], { instance: { locked: true } })];
    const before = structuredClone(rows);

    expect(planMaterialUnitWithdrawal(rows, ORE, 0)).toBeNull();
    expect(planMaterialUnitWithdrawal(rows, ORE, 4)).toBeNull();
    expect(rows).toEqual(before);
  });

  it('hands the caller a unit whose composition is what countFit must preflight', () => {
    const rows = [
      stack([
        { source: SIGNED_ANA, count: 2 },
        { source: ANA, count: 1 },
      ]),
    ];

    const withdrawal = planMaterialUnitWithdrawal(rows, ORE, 0);
    if (withdrawal === null) throw new Error('expected a withdrawal');

    // Exactly one unit's worth: preflighting with the ROW's whole composition
    // would refuse a sum that never matches the single unit being granted.
    const composition = withdrawal.unit.materialSources ?? [];
    expect(composition).toHaveLength(1);
    expect(composition[0].count).toBe(1);
    expect(sameSource(composition[0].source, ANA)).toBe(true);
  });
});

describe('non-material ids are never routed through the material arm', () => {
  it('answers null so the caller keeps its legacy walk', () => {
    const inventory: InvSlot[] = [{ itemId: GEAR, count: 1, instance: { boundTo: 7 } }];
    const before = structuredClone(inventory);

    expect(takeMaterialUnit(inventory, GEAR)).toBeNull();
    expect(takeMaterialUnitFromSlot(inventory, GEAR, 0)).toBeNull();
    expect(takeMaterialUnits(inventory, GEAR, 1)).toEqual([]);
    expect(consumeMaterialUnitPayloads(inventory, GEAR, 1)).toEqual([]);
    expect(inventory).toEqual(before);
  });
});

describe('unit payload independence', () => {
  it('gives every returned unit its own payload and descriptor', () => {
    const nested = (): ItemInstancePayload =>
      ({ boundTo: 7, provenance: { flags: { audited: false } } }) as unknown as ItemInstancePayload;
    const inventory = [stack([{ source: ANA, count: 3 }], { instance: nested() })];

    const units = takeMaterialUnits(inventory, ORE, 3);

    expect(units[0].instance).not.toBe(units[1].instance);
    const flags = (
      units[0].instance as unknown as { provenance: { flags: Record<string, unknown> } }
    ).provenance.flags;
    flags.audited = true;
    const other = (
      units[1].instance as unknown as { provenance: { flags: Record<string, unknown> } }
    ).provenance.flags;
    expect(other.audited).toBe(false);
    (sourceOf(units[0]).gatherer as { name: string }).name = 'Edited';
    expect((sourceOf(units[2]).gatherer as { name: string }).name).toBe('Ana');
  });
});
