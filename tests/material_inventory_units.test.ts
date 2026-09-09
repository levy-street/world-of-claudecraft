// The per-unit views of a material spend (src/sim/material_inventory_units.ts).
//
// The load-bearing distinction these cases exist to hold apart: the TRANSFER
// carrier (materialInventoryUnits, canonical payload plus an exact one-unit
// composition) and the CONSUMED effect data (consumedMaterialInstancePayloads,
// the legacy payload with the spent descriptor's signer on it). Confusing the
// two either launders provenance or forges a signature, so several cases assert
// both shapes over the same plan.
//
// Material membership is injected exactly as the planner takes it, so no case
// pulls the eager registry (or data.ts behind it) into this suite.

import { describe, expect, it } from 'vitest';
import {
  type MaterialTakePlan,
  type MaterialTakeResult,
  planMaterialInventoryTake,
} from '../src/sim/material_inventory_take';
import {
  consumedMaterialInstancePayloads,
  materialInventoryUnits,
  materialSourceUnitPayload,
} from '../src/sim/material_inventory_units';
import type {
  MaterialComposition,
  MaterialGatherer,
  MaterialSource,
  MaterialSourceCount,
} from '../src/sim/material_sources';
import { type MaterialStackSlot, normalizeMaterialStack } from '../src/sim/material_stack';
import type { InventoryUnit, ItemInstancePayload } from '../src/sim/types';

const COPPER = 'ore_copper';
const MATERIALS: ReadonlySet<string> = new Set([COPPER]);

const alice: MaterialGatherer = { kind: 'character', id: 101, name: 'Alice' };
const bram: MaterialGatherer = { kind: 'character', id: 202, name: 'Bram' };

const A: MaterialSource = { gatherer: alice };
const B: MaterialSource = { gatherer: bram };
const UNRECORDED: MaterialSource = {};
const EMPTY_SIGNER: MaterialSource = { signer: '' };
const PREMIUM_A: MaterialSource = { signer: 'Alice' };

const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

const composed = (
  entries: readonly MaterialSourceCount[],
  extra: Partial<MaterialStackSlot> = {},
): MaterialStackSlot => ({
  itemId: COPPER,
  count: entries.reduce((n, e) => n + e.count, 0),
  materialSources: entries,
  ...extra,
});

const ok = <T>(result: MaterialTakeResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
};

const planOf = (inventory: readonly MaterialStackSlot[], count: number): MaterialTakePlan =>
  ok(planMaterialInventoryTake({ inventory, itemId: COPPER, count, materialIds: MATERIALS }));

/** The one descriptor a single-unit carrier names. */
const sourceOf = (unit: InventoryUnit): MaterialSource => {
  const composition = unit.materialSources ?? [];
  if (composition.length !== 1 || composition[0].count !== 1) {
    throw new Error('expected exactly one one-unit bucket');
  }
  return composition[0].source;
};

const unitsBySource = (units: readonly InventoryUnit[], source: MaterialSource): number =>
  units.filter((unit) => sameSource(sourceOf(unit), source)).length;

/** A unit's gatherer SNAPSHOT as a writable view: the independence cases edit
 *  it to prove nothing else moves with it. */
const gathererOf = (unit: InventoryUnit): { name: string } => {
  const found = sourceOf(unit).gatherer;
  if (found === undefined) throw new Error('expected a gatherer snapshot');
  return found as { name: string };
};

const withUnknownNested = (): ItemInstancePayload =>
  ({
    boundTo: 7,
    provenance: { entries: [{ note: 'gathered', at: 12 }], flags: { audited: false, tag: null } },
  }) as unknown as ItemInstancePayload;

const nestedOf = (payload: ItemInstancePayload | undefined): Record<string, unknown> => {
  const found = (payload as unknown as { provenance?: Record<string, unknown> } | undefined)
    ?.provenance;
  if (found === undefined) throw new Error('expected the unknown nested payload property');
  return found;
};

const flagsOf = (payload: ItemInstancePayload | undefined): Record<string, unknown> =>
  nestedOf(payload).flags as Record<string, unknown>;

describe('materialSourceUnitPayload: the effective legacy per-unit payload', () => {
  it('stamps the descriptor signer onto the canonical payload', () => {
    const slot = composed([{ source: PREMIUM_A, count: 2 }], { instance: { boundTo: 7 } });

    expect(materialSourceUnitPayload(slot, PREMIUM_A)).toEqual({ boundTo: 7, signer: 'Alice' });
  });

  it('answers a bare signer payload when the stack carries none', () => {
    const slot = composed([{ source: PREMIUM_A, count: 2 }]);

    expect(materialSourceUnitPayload(slot, PREMIUM_A)).toEqual({ signer: 'Alice' });
  });

  it('preserves an EMPTY-string signer verbatim, which stays non-premium', () => {
    const slot = composed([{ source: EMPTY_SIGNER, count: 2 }]);
    const payload = materialSourceUnitPayload(slot, EMPTY_SIGNER);

    // The legacy truthiness test still reads it as unsigned, and the key is
    // present rather than dropped, exactly as the old payload spelled it.
    expect(payload).toEqual({ signer: '' });
    expect(Boolean(payload?.signer)).toBe(false);
  });

  it('never turns a gatherer alone into a signature', () => {
    const slot = composed([{ source: A, count: 2 }]);

    expect(materialSourceUnitPayload(slot, A)).toBeUndefined();
    expect(
      materialSourceUnitPayload(composed([{ source: UNRECORDED, count: 2 }]), UNRECORDED),
    ).toBe(undefined);
  });

  it('drops a payload-side legacy signer, so only the descriptor decides', () => {
    // A RAW legacy stack whose signer has not moved into the descriptor yet:
    // the answer must not depend on which form the caller happened to hold.
    const raw: MaterialStackSlot = { itemId: COPPER, count: 2, instance: { signer: 'Alice' } };
    const normalized = ok(normalizeMaterialStack(raw, MATERIALS));

    expect(materialSourceUnitPayload(raw, UNRECORDED)).toBeUndefined();
    expect(materialSourceUnitPayload(raw, PREMIUM_A)).toEqual({ signer: 'Alice' });
    expect(materialSourceUnitPayload(raw, B)).toBeUndefined();
    // And the normalized twin answers identically.
    expect(materialSourceUnitPayload(normalized, PREMIUM_A)).toEqual({ signer: 'Alice' });
  });

  it('returns an independent copy and mutates neither input', () => {
    const slot = composed([{ source: PREMIUM_A, count: 2 }], { instance: withUnknownNested() });
    const first = materialSourceUnitPayload(slot, PREMIUM_A);
    const second = materialSourceUnitPayload(slot, PREMIUM_A);

    expect(first).not.toBe(second);
    flagsOf(first).audited = true;

    expect(flagsOf(second).audited).toBe(false);
    expect(flagsOf(slot.instance).audited).toBe(false);
    expect(slot.instance?.signer).toBeUndefined();
  });
});

describe('materialInventoryUnits: the transfer carrier', () => {
  it('emits one unit per taken unit, each with its own one-unit composition', () => {
    const inventory = [
      composed([
        { source: UNRECORDED, count: 2 },
        { source: A, count: 3 },
      ]),
    ];

    const units = materialInventoryUnits(planOf(inventory, 5));

    expect(units).toHaveLength(5);
    expect(unitsBySource(units, UNRECORDED)).toBe(2);
    expect(unitsBySource(units, A)).toBe(3);
    for (const unit of units) expect(unit.materialSources).toHaveLength(1);
  });

  it('never forges a legacy signer onto the canonical payload', () => {
    const inventory = [composed([{ source: PREMIUM_A, count: 2 }], { instance: { boundTo: 7 } })];

    const units = materialInventoryUnits(planOf(inventory, 2));

    // The signature rides in the descriptor ONLY. A unit carrying both would
    // read as ambiguous-signer the moment a grant normalized it.
    for (const unit of units) {
      expect(unit.instance).toEqual({ boundTo: 7 });
      expect(unit.instance?.signer).toBeUndefined();
      expect(sourceOf(unit).signer).toBe('Alice');
    }
  });

  it('answers no payload at all for a plain unit rather than an empty object', () => {
    const inventory = [composed([{ source: PREMIUM_A, count: 1 }])];

    const [unit] = materialInventoryUnits(planOf(inventory, 1));

    // The stack's whole payload was the signer, which the descriptor now owns.
    expect(unit.instance).toBeUndefined();
    expect(sourceOf(unit).signer).toBe('Alice');
  });

  it('retains the plain-stack craftedRecipeId marker on every unit', () => {
    const inventory = [
      composed([{ source: A, count: 2 }], { craftedRecipeId: 'recipe_copper_bar' }),
    ];

    const units = materialInventoryUnits(planOf(inventory, 2));

    for (const unit of units) expect(unit.craftedRecipeId).toBe('recipe_copper_bar');
  });

  it('follows the plan output order, not the order the units were chosen', () => {
    const inventory = [
      composed([{ source: PREMIUM_A, count: 2 }]),
      composed([{ source: UNRECORDED, count: 2 }]),
    ];

    const plan = planOf(inventory, 4);
    const units = materialInventoryUnits(plan);

    // The SPEND order took the unrecorded units first, but the plan groups its
    // output by source stack, so the carrier lists the premium row first. The
    // helper reports the plan's order and claims nothing about priority.
    expect(plan.taken[0].materialSources?.[0].source.signer).toBe('Alice');
    expect(units.map((unit) => sourceOf(unit).signer)).toEqual([
      'Alice',
      'Alice',
      undefined,
      undefined,
    ]);
  });

  it('is deterministic over the same plan', () => {
    const inventory = [
      composed([
        { source: B, count: 2 },
        { source: A, count: 2 },
      ]),
    ];
    const plan = planOf(inventory, 4);

    expect(materialInventoryUnits(plan)).toEqual(materialInventoryUnits(plan));
  });

  it('conserves the count: one unit out per unit taken, whatever the mix', () => {
    const inventory = [
      composed([
        { source: PREMIUM_A, count: 3 },
        { source: A, count: 2 },
      ]),
      composed([{ source: UNRECORDED, count: 4 }]),
    ];

    for (const count of [1, 4, 6, 9]) {
      const plan = planOf(inventory, count);
      const units = materialInventoryUnits(plan);
      expect(units).toHaveLength(count);
      expect(plan.takenCount).toBe(count);
      const summed = units.reduce((n, unit) => n + (unit.materialSources?.[0].count ?? 0), 0);
      expect(summed).toBe(count);
    }
  });

  it('gives every unit its own payload and its own gatherer snapshot', () => {
    const inventory = [composed([{ source: A, count: 3 }], { instance: withUnknownNested() })];

    const units = materialInventoryUnits(planOf(inventory, 3));

    expect(units[0].instance).not.toBe(units[1].instance);
    expect(units[0].materialSources).not.toBe(units[1].materialSources);

    flagsOf(units[0].instance).audited = true;
    gathererOf(units[1]).name = 'Edited';

    expect(flagsOf(units[1].instance).audited).toBe(false);
    expect(flagsOf(units[2].instance).audited).toBe(false);
    expect(flagsOf(inventory[0].instance).audited).toBe(false);
    expect(gathererOf(units[2]).name).toBe('Alice');
    expect(alice.name).toBe('Alice');
  });

  it('keeps an own "__proto__" payload key as an own data property on every unit', () => {
    // Ordinary JSON data (JSON.parse mints one, an object literal cannot): a
    // copy built by assignment would hand it to Object.prototype's setter.
    const raw = '{"boundTo":7,"__proto__":{"polluted":true}}';
    const inventory = [
      composed([{ source: A, count: 2 }], { instance: JSON.parse(raw) as ItemInstancePayload }),
    ];

    const units = materialInventoryUnits(planOf(inventory, 2));

    for (const unit of units) {
      const record = unit.instance as unknown as Record<string, unknown>;
      const descriptor = Object.getOwnPropertyDescriptor(record, '__proto__');
      expect(descriptor?.value).toEqual(JSON.parse('{"polluted":true}'));
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect(record.polluted).toBeUndefined();
    }
    const first = Object.getOwnPropertyDescriptor(
      units[0].instance as unknown as object,
      '__proto__',
    )?.value as Record<string, unknown>;
    first.polluted = 'edited';
    const second = Object.getOwnPropertyDescriptor(
      units[1].instance as unknown as object,
      '__proto__',
    )?.value as Record<string, unknown>;
    expect(second.polluted).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('consumedMaterialInstancePayloads: the consumed effect data', () => {
  it('reports the legacy signer of every signed unit consumed', () => {
    const inventory = [
      composed([
        { source: PREMIUM_A, count: 2 },
        { source: UNRECORDED, count: 1 },
      ]),
    ];

    const payloads = consumedMaterialInstancePayloads(planOf(inventory, 3));

    // Two signed units answer as signed; the unrecorded one has no payload at
    // all, so the list is effect data and NOT a count of units consumed.
    expect(payloads).toHaveLength(2);
    expect(payloads).toEqual([{ signer: 'Alice' }, { signer: 'Alice' }]);
  });

  it('lists nothing for units with no effective payload', () => {
    const inventory = [
      composed([
        { source: A, count: 2 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    expect(consumedMaterialInstancePayloads(planOf(inventory, 4))).toEqual([]);
  });

  it('skips a payloadless bucket whole, whatever quantity it holds', () => {
    // A tolerated legacy stack can hold an enormous unrecorded count. Whether a
    // unit has an effective payload is a property of its BUCKET, so the answer
    // is resolved once and the count is never walked: the legacy remover skipped
    // an uninstanced count in O(1) and this must keep that cost shape.
    //
    // Only consumedMaterialInstancePayloads is exercised here. The transfer
    // carrier's contract IS one unit per unit, so asking it for this plan would
    // legitimately build a trillion units; that is the caller's quantity, not a
    // defect, and no cap is imposed on it.
    const HUGE = 1e12;
    const inventory = [
      composed([
        { source: UNRECORDED, count: HUGE },
        { source: PREMIUM_A, count: 1 },
      ]),
    ];

    const plan = planOf(inventory, HUGE + 1);
    expect(plan.takenCount).toBe(HUGE + 1);

    const payloads = consumedMaterialInstancePayloads(plan);

    // One entry, for the single unit that actually has an effective payload.
    expect(payloads).toEqual([{ signer: 'Alice' }]);
  });

  it('keeps an empty-string signer in the effect data', () => {
    const inventory = [composed([{ source: EMPTY_SIGNER, count: 2 }])];

    expect(consumedMaterialInstancePayloads(planOf(inventory, 2))).toEqual([
      { signer: '' },
      { signer: '' },
    ]);
  });

  it('carries the stack payload beside the signer, one entry per unit', () => {
    const inventory = [
      composed([{ source: PREMIUM_A, count: 3 }], { instance: { boundTo: 7, enchant: 'e1' } }),
    ];

    const payloads = consumedMaterialInstancePayloads(planOf(inventory, 3));

    expect(payloads).toHaveLength(3);
    for (const payload of payloads) {
      expect(payload).toEqual({ boundTo: 7, enchant: 'e1', signer: 'Alice' });
    }
    // Nothing is capped or folded: three units, three entries.
    expect(payloads[0]).not.toBe(payloads[1]);
  });

  it('hands every entry its own object', () => {
    const inventory = [
      composed([{ source: PREMIUM_A, count: 2 }], { instance: withUnknownNested() }),
    ];

    const payloads = consumedMaterialInstancePayloads(planOf(inventory, 2));

    flagsOf(payloads[0]).audited = true;

    expect(flagsOf(payloads[1]).audited).toBe(false);
    expect(flagsOf(inventory[0].instance).audited).toBe(false);
  });
});

describe('the transfer carrier and the consumed effect data are never confused', () => {
  const inventory = (): MaterialStackSlot[] => [
    composed([{ source: PREMIUM_A, count: 2 }], { instance: { boundTo: 7 } }),
  ];

  it('disagree exactly on the signer, over the same plan', () => {
    const plan = planOf(inventory(), 2);

    const carriers = materialInventoryUnits(plan);
    const consumed = consumedMaterialInstancePayloads(plan);

    // The carrier keeps the signature in the descriptor so a re-grant stays
    // legal; the effect data spells it on the payload so the old premium
    // checks still see it. Same units, two deliberately different shapes.
    expect(carriers.map((unit) => unit.instance)).toEqual([{ boundTo: 7 }, { boundTo: 7 }]);
    expect(consumed).toEqual([
      { boundTo: 7, signer: 'Alice' },
      { boundTo: 7, signer: 'Alice' },
    ]);
    expect(carriers.map((unit) => sourceOf(unit).signer)).toEqual(['Alice', 'Alice']);
  });

  it('a carrier unit normalizes cleanly, which a forged one would not', () => {
    const [unit] = materialInventoryUnits(planOf(inventory(), 1));

    const asStack: MaterialStackSlot = {
      itemId: COPPER,
      count: 1,
      materialSources: unit.materialSources as MaterialComposition,
    };
    if (unit.instance !== undefined) asStack.instance = unit.instance;

    // The round trip a grant really performs: a unit carrying BOTH a payload
    // signer and a composition is refused as ambiguous-signer, so this passing
    // is what proves the carrier is not forging one.
    expect(ok(normalizeMaterialStack(asStack, MATERIALS)).count).toBe(1);

    const forged: MaterialStackSlot = {
      ...asStack,
      instance: { ...(unit.instance ?? {}), signer: 'Alice' },
    };
    const refused = normalizeMaterialStack(forged, MATERIALS);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toBe('ambiguous-signer');
  });
});
