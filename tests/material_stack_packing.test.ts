// The material fit/packing core (src/sim/material_stack_packing.ts): the ONE
// answer bags countFit and addStacked must eventually share for material stacks.
// These cases assert what neither the source algebra nor the slot adapter can
// see on its own: how much of an incoming stack the carried inventory really
// absorbs, and the exact atomic edit that absorbs it.
//
// Material membership, the stack cap and the fresh-slot budget are all INJECTED
// exactly as the module takes them, so no case pulls the eager `material_ids.ts`
// registry (or `data.ts`/`bags.ts` behind it) into this suite.
//
// Compositions are asserted as literal descriptor/count pairs looked up by
// descriptor identity (sameSource), never by the module's canonical key or its
// ordering, so a re-keying cannot make a wrong answer pass. Every plan assertion
// checks CONSERVATION as well as shape: the units the plan writes must be the
// units it was handed, per descriptor, with nothing invented, clipped or lost.

import { describe, expect, it } from 'vitest';
import type {
  MaterialComposition,
  MaterialGatherer,
  MaterialSource,
  MaterialSourceCount,
} from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import {
  type MaterialAddPlan,
  type MaterialPackingResult,
  type MaterialPackRequest,
  materialStackFit,
  planMaterialStackAdd,
} from '../src/sim/material_stack_packing';
import type { ItemInstancePayload } from '../src/sim/types';

const COPPER = 'ore_copper';
const IRON = 'ore_iron';
const SWORD = 'sword_rusty';
const MATERIALS: ReadonlySet<string> = new Set([COPPER, IRON]);

/** The cap every case uses unless it is testing the cap itself. */
const STACK = 20;

const alice: MaterialGatherer = { kind: 'character', id: 101, name: 'Alice' };
const bram: MaterialGatherer = { kind: 'character', id: 202, name: 'Bram' };

const A: MaterialSource = { gatherer: alice };
const B: MaterialSource = { gatherer: bram };
const UNRECORDED: MaterialSource = {};
const SIGNED_BY_ALICE: MaterialSource = { signer: 'Alice' };
const SIGNED_BY_BRAM: MaterialSource = { signer: 'Bram' };
/** Alice's descriptor with a DIFFERENT name snapshot: a distinct identity. */
const EDITED: MaterialSource = { gatherer: { kind: 'character', id: 101, name: 'Edited' } };

/** Descriptor identity by FIELD, independent of the module's key encoding. */
const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

const countOf = (composition: MaterialComposition, source: MaterialSource): number =>
  composition.filter((e) => sameSource(e.source, source)).reduce((n, e) => n + e.count, 0);

/** Exact contents: the bucket count AND every per-source quantity. */
const expectExactly = (
  composition: MaterialComposition | undefined,
  expected: readonly (readonly [MaterialSource, number])[],
): void => {
  expect(composition).toBeDefined();
  expect(composition?.length).toBe(expected.length);
  for (const [source, count] of expected) {
    expect(countOf(composition ?? [], source)).toBe(count);
  }
};

const ok = <T>(result: MaterialPackingResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
};

const errorOf = (result: MaterialPackingResult<unknown>): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

/** A stack carrying an explicit composition. */
const composed = (
  itemId: string,
  entries: readonly MaterialSourceCount[],
  extra: Partial<MaterialStackSlot> = {},
): MaterialStackSlot => ({
  itemId,
  count: entries.reduce((n, e) => n + e.count, 0),
  materialSources: entries,
  ...extra,
});

const request = (
  inventory: readonly MaterialStackSlot[],
  incoming: MaterialStackSlot,
  maxNewSlots: number,
  stackSize = STACK,
): MaterialPackRequest => ({
  inventory,
  incoming,
  materialIds: MATERIALS,
  stackSize,
  maxNewSlots,
});

const fitOf = (
  inventory: readonly MaterialStackSlot[],
  incoming: MaterialStackSlot,
  maxNewSlots: number,
  stackSize = STACK,
): number => ok(materialStackFit(request(inventory, incoming, maxNewSlots, stackSize)));

const planOf = (
  inventory: readonly MaterialStackSlot[],
  incoming: MaterialStackSlot,
  maxNewSlots: number,
  stackSize = STACK,
): MaterialAddPlan =>
  ok(planMaterialStackAdd(request(inventory, incoming, maxNewSlots, stackSize)));

/** Every slot the plan writes, replacements first, in plan order. */
const writtenSlots = (plan: MaterialAddPlan): readonly MaterialStackSlot[] => [
  ...plan.replacements.map((r) => r.slot),
  ...plan.appended,
];

/** Units the plan WRITES for one descriptor, across every changed and new slot. */
const plannedUnits = (plan: MaterialAddPlan, source: MaterialSource): number =>
  writtenSlots(plan).reduce((n, slot) => n + countOf(slot.materialSources ?? [], source), 0);

/** Every slot the plan wrote holds exactly the units its composition claims. */
const expectCountsAgree = (plan: MaterialAddPlan): void => {
  for (const slot of writtenSlots(plan)) {
    const total = (slot.materialSources ?? []).reduce((n, e) => n + e.count, 0);
    expect(total).toBe(slot.count);
  }
};

/** A persisted payload carrying a NESTED property this model has never heard of. */
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

/** The gatherer SNAPSHOT a planned slot carries, as a writable view: the
 *  independence cases edit it to prove nothing else moves with it. */
const gathererOf = (slot: MaterialStackSlot, source: MaterialSource): { name: string } => {
  const entry = (slot.materialSources ?? []).find((e) => sameSource(e.source, source));
  const found = entry?.source.gatherer;
  if (found === undefined) throw new Error('expected a gatherer descriptor');
  return found as { name: string };
};

describe('materialStackFit: shared room across differently sourced stock', () => {
  it('lets differently signed legacy stacks and unrecorded stock offer their real top-up room', () => {
    // Three legacy stacks nothing could previously merge: the signature moved
    // into the descriptors at normalization, so all three take the same units.
    const inventory: readonly MaterialStackSlot[] = [
      { itemId: COPPER, count: 15, instance: { signer: 'Alice' } },
      { itemId: COPPER, count: 18, instance: { signer: 'Bram' } },
      { itemId: COPPER, count: 19 },
    ];
    const incoming = composed(COPPER, [{ source: A, count: 8 }]);

    // 5 + 2 + 1 with no fresh slot at all.
    expect(fitOf(inventory, incoming, 0)).toBe(8);
  });

  it('answers the smaller of the requested count and the available room', () => {
    const inventory: readonly MaterialStackSlot[] = [{ itemId: COPPER, count: 18 }];

    expect(fitOf(inventory, composed(COPPER, [{ source: A, count: 1 }]), 0)).toBe(1);
    expect(fitOf(inventory, composed(COPPER, [{ source: A, count: 2 }]), 0)).toBe(2);
    expect(fitOf(inventory, composed(COPPER, [{ source: A, count: 9 }]), 0)).toBe(2);
    // One fresh slot adds a whole cap's worth.
    expect(fitOf(inventory, composed(COPPER, [{ source: A, count: 99 }]), 1)).toBe(22);
  });

  it('counts fresh-slot room against the injected cap and budget, never a global one', () => {
    expect(fitOf([], composed(COPPER, [{ source: A, count: 30 }]), 3, 5)).toBe(15);
    expect(fitOf([], composed(COPPER, [{ source: A, count: 30 }]), 3, 200)).toBe(30);
    expect(fitOf([], composed(COPPER, [{ source: A, count: 30 }]), 0, 200)).toBe(0);
  });

  it('never reads, validates or counts an unrelated or non-material slot', () => {
    const inventory: readonly MaterialStackSlot[] = [
      // A malformed IRON stack and an equipment slot: both would refuse if this
      // module looked at them, and neither is any of its business.
      composed(IRON, [{ source: A, count: 99 }], { count: 3 }),
      { itemId: SWORD, count: 1, instance: { signer: 'Alice' } },
      { itemId: COPPER, count: 17 },
    ];

    expect(fitOf(inventory, composed(COPPER, [{ source: A, count: 5 }]), 0)).toBe(3);
  });
});

describe('materialStackFit: the stack cap boundary', () => {
  it('offers one unit at cap minus one, nothing at the cap', () => {
    const atCap: readonly MaterialStackSlot[] = [{ itemId: COPPER, count: STACK }];
    const belowCap: readonly MaterialStackSlot[] = [{ itemId: COPPER, count: STACK - 1 }];
    const incoming = composed(COPPER, [{ source: A, count: 4 }]);

    expect(fitOf(belowCap, incoming, 0)).toBe(1);
    expect(fitOf(atCap, incoming, 0)).toBe(0);
  });

  it('treats a legacy OVER-CAP holding as full: no top-up room, and no clipping edit', () => {
    const overCap: readonly MaterialStackSlot[] = [{ itemId: COPPER, count: 500 }];
    const incoming = composed(COPPER, [{ source: A, count: 3 }]);

    expect(fitOf(overCap, incoming, 0)).toBe(0);

    // With a fresh slot the add succeeds, and the over-cap stack is simply not
    // in the plan: nothing clips it back to the cap.
    const plan = planOf(overCap, incoming, 1);
    expect(plan.replacements).toEqual([]);
    expect(plan.appended.length).toBe(1);
    expect(plan.appended[0].count).toBe(3);
    expect(overCap[0].count).toBe(500);
  });
});

describe('materialStackFit: payload, marker and separation compatibility', () => {
  const plainIncoming = composed(COPPER, [{ source: A, count: 4 }]);

  it('refuses to top up a stack whose binding differs, or that carries a binding at all', () => {
    const boundTo7: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: B, count: 10 }], { instance: { boundTo: 7 } }),
    ];

    expect(fitOf(boundTo7, plainIncoming, 0)).toBe(0);
    expect(
      fitOf(boundTo7, composed(COPPER, [{ source: A, count: 4 }], { instance: { boundTo: 8 } }), 0),
    ).toBe(0);
    expect(
      fitOf(boundTo7, composed(COPPER, [{ source: A, count: 4 }], { instance: { boundTo: 7 } }), 0),
    ).toBe(4);
  });

  it('refuses to top up a different GRADE of material', () => {
    const iron: readonly MaterialStackSlot[] = [composed(IRON, [{ source: A, count: 10 }])];

    expect(fitOf(iron, plainIncoming, 0)).toBe(0);
  });

  it('refuses to top up across a craftedRecipeId mismatch, in both directions', () => {
    const fromRecipe: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: B, count: 10 }], { craftedRecipeId: 'recipe_copper_bar' }),
    ];
    const plainStock: readonly MaterialStackSlot[] = [composed(COPPER, [{ source: B, count: 10 }])];
    const markedIncoming = composed(COPPER, [{ source: A, count: 4 }], {
      craftedRecipeId: 'recipe_copper_bar',
    });

    expect(fitOf(fromRecipe, plainIncoming, 0)).toBe(0);
    expect(fitOf(plainStock, markedIncoming, 0)).toBe(0);
    expect(fitOf(fromRecipe, markedIncoming, 0)).toBe(4);
  });

  it('keeps a CHARGED payload one per fresh slot and merges it into nothing', () => {
    const charged = composed(COPPER, [{ source: A, count: 3 }], {
      instance: { charges: { drain: 3 } },
    });
    const twin: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: B, count: 5 }], { instance: { charges: { drain: 3 } } }),
    ];

    // Even a byte-identical twin offers no room, and each fresh slot holds one.
    expect(fitOf(twin, charged, 0)).toBe(0);
    expect(fitOf(twin, charged, 2)).toBe(2);
    expect(fitOf(twin, charged, 3)).toBe(3);

    const plan = planOf(twin, charged, 3);
    expect(plan.replacements).toEqual([]);
    expect(plan.appended.map((s) => s.count)).toEqual([1, 1, 1]);
  });

  it('keeps a LOCKED payload one per fresh slot and merges it into nothing', () => {
    const locked = composed(COPPER, [{ source: A, count: 2 }], { instance: { locked: true } });
    const lockedTwin: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: B, count: 5 }], { instance: { locked: true } }),
    ];

    expect(fitOf(lockedTwin, locked, 0)).toBe(0);
    expect(fitOf(lockedTwin, locked, 1)).toBe(1);

    const plan = planOf(lockedTwin, locked, 2);
    expect(plan.replacements).toEqual([]);
    expect(plan.appended.map((s) => s.count)).toEqual([1, 1]);
    expect(plan.appended[0].instance).toEqual({ locked: true });
  });
});

describe('separation: the owner grouping this module never overrides', () => {
  it('never tops up a separated block, which still occupies its slot', () => {
    const separated: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: A, count: 5 }], { materialSeparated: true }),
    ];
    const incoming = composed(COPPER, [{ source: A, count: 3 }]);

    expect(fitOf(separated, incoming, 0)).toBe(0);
    // The identical block without the grouping takes all three.
    expect(fitOf([composed(COPPER, [{ source: A, count: 5 }])], incoming, 0)).toBe(3);
  });

  it('keeps an explicitly separated INCOMING stack out of every held block and stays separated', () => {
    const inventory: readonly MaterialStackSlot[] = [composed(COPPER, [{ source: B, count: 5 }])];
    const incoming = composed(COPPER, [{ source: A, count: 25 }], {
      materialSeparated: true,
      slot: 7,
    });

    // No top-up into the ordinary stack: the grouping is the owner's choice.
    expect(fitOf(inventory, incoming, 1)).toBe(20);
    expect(fitOf(inventory, incoming, 2)).toBe(25);

    const plan = planOf(inventory, incoming, 2);
    expect(plan.replacements).toEqual([]);
    expect(plan.appended.map((s) => s.count)).toEqual([20, 5]);
    // The grouping rides onto every locally repacked block; the owner's bag
    // CELL does not (a fresh stack was never placed by hand).
    for (const slot of plan.appended) {
      expect(slot.materialSeparated).toBe(true);
      expect(slot.slot).toBeUndefined();
      expect('slot' in slot).toBe(false);
    }
    expect(plannedUnits(plan, A)).toBe(25);
  });

  it('leaves an ordinary incoming stack ungrouped and cell-free in its fresh slots', () => {
    const incoming = composed(COPPER, [{ source: A, count: 5 }], { slot: 3 });

    const plan = planOf([], incoming, 1);

    expect(plan.appended.length).toBe(1);
    expect(plan.appended[0].materialSeparated).toBeUndefined();
    expect('materialSeparated' in plan.appended[0]).toBe(false);
    expect('slot' in plan.appended[0]).toBe(false);
  });
});

describe('planMaterialStackAdd: exact composition across top-ups and fresh stacks', () => {
  // Two partly filled stacks, then a fresh one: every unit the plan writes has
  // to be a unit it was handed, per descriptor.
  const inventory = (): readonly MaterialStackSlot[] => [
    composed(COPPER, [{ source: A, count: 18 }], { slot: 4 }),
    composed(COPPER, [{ source: UNRECORDED, count: 19 }]),
  ];
  const incoming = (): MaterialStackSlot =>
    composed(COPPER, [
      { source: A, count: 4 },
      { source: B, count: 6 },
      { source: UNRECORDED, count: 5 },
    ]);

  it('fills both stacks to the cap and appends the rest, conserving every source total', () => {
    const plan = planOf(inventory(), incoming(), 2);

    expect(plan.replacements.map((r) => r.index)).toEqual([0, 1]);
    expect(plan.replacements[0].slot.count).toBe(STACK);
    expect(plan.replacements[1].slot.count).toBe(STACK);
    expect(plan.appended.map((s) => s.count)).toEqual([12]);
    expectCountsAgree(plan);

    // Held 18 A + 19 unrecorded, incoming 4 A + 6 B + 5 unrecorded.
    expect(plannedUnits(plan, A)).toBe(22);
    expect(plannedUnits(plan, B)).toBe(6);
    expect(plannedUnits(plan, UNRECORDED)).toBe(24);
    // Nothing else was invented along the way.
    const written = writtenSlots(plan).reduce((n, s) => n + s.count, 0);
    expect(written).toBe(18 + 19 + 15);
  });

  it('splits an over-cap remainder into capped fresh stacks, largest first', () => {
    const plan = planOf([], composed(COPPER, [{ source: A, count: 45 }]), 3);

    expect(plan.replacements).toEqual([]);
    expect(plan.appended.map((s) => s.count)).toEqual([20, 20, 5]);
    expect(plannedUnits(plan, A)).toBe(45);
    expectCountsAgree(plan);
  });

  it('keeps the existing owner metadata and bag cell on every replacement', () => {
    const held = composed(COPPER, [{ source: B, count: 15 }], {
      slot: 9,
      craftedRecipeId: 'recipe_copper_bar',
      instance: { boundTo: 7 },
    });
    const arriving = composed(COPPER, [{ source: A, count: 3 }], {
      slot: 1,
      craftedRecipeId: 'recipe_copper_bar',
      instance: { boundTo: 7 },
    });

    const plan = planOf([held], arriving, 0);

    expect(plan.replacements.length).toBe(1);
    const next = plan.replacements[0].slot;
    expect(next.slot).toBe(9);
    expect(next.craftedRecipeId).toBe('recipe_copper_bar');
    expect(next.instance).toEqual({ boundTo: 7 });
    expect(next.count).toBe(18);
    expectExactly(next.materialSources, [
      [B, 15],
      [A, 3],
    ]);
  });

  it('moves a legacy signer into the descriptors rather than onto the merged payload', () => {
    const held: readonly MaterialStackSlot[] = [
      { itemId: COPPER, count: 17, instance: { signer: 'Alice' } },
    ];
    const arriving: MaterialStackSlot = {
      itemId: COPPER,
      count: 5,
      instance: { signer: 'Bram' },
    };

    const plan = planOf(held, arriving, 1);

    expect(plan.replacements.length).toBe(1);
    const merged = plan.replacements[0].slot;
    expect(merged.count).toBe(STACK);
    expect(merged.instance).toBeUndefined();
    expectExactly(merged.materialSources, [
      [SIGNED_BY_ALICE, 17],
      [SIGNED_BY_BRAM, 3],
    ]);
    expectExactly(plan.appended[0].materialSources, [[SIGNED_BY_BRAM, 2]]);
    expect(plannedUnits(plan, SIGNED_BY_BRAM)).toBe(5);
  });

  it('fills stacks in ORIGINAL inventory order, skipping the slots it does not own', () => {
    const mixed: readonly MaterialStackSlot[] = [
      composed(IRON, [{ source: A, count: 4 }]),
      composed(COPPER, [{ source: A, count: 19 }]),
      { itemId: SWORD, count: 1 },
      composed(COPPER, [{ source: B, count: 18 }], { materialSeparated: true }),
      composed(COPPER, [{ source: B, count: 17 }]),
    ];

    const plan = planOf(mixed, composed(COPPER, [{ source: UNRECORDED, count: 4 }]), 0);

    // Index 3 is separated, so it is never a target; the rest run in order.
    expect(plan.replacements.map((r) => r.index)).toEqual([1, 4]);
    expect(plan.replacements.map((r) => r.slot.count)).toEqual([20, 20]);
    expect(plan.appended).toEqual([]);
    expect(plannedUnits(plan, UNRECORDED)).toBe(4);
  });

  it('is deterministic: the same request plans the same edit every time', () => {
    const first = planOf(inventory(), incoming(), 2);
    const second = planOf(inventory(), incoming(), 2);

    expect(second).toEqual(first);
  });

  it('appends exactly the fresh slots the room accounting charged for', () => {
    const held: readonly MaterialStackSlot[] = [composed(COPPER, [{ source: A, count: 19 }])];
    const arriving = composed(COPPER, [{ source: B, count: 41 }]);

    // 1 top-up unit plus 2 capped fresh slots is exactly 41.
    expect(fitOf(held, arriving, 2)).toBe(41);
    const plan = planOf(held, arriving, 2);
    expect(plan.appended.length).toBe(2);

    // One fewer fresh slot and the same request no longer fits.
    expect(fitOf(held, arriving, 1)).toBe(21);
    expect(errorOf(planMaterialStackAdd(request(held, arriving, 1)))).toBe('insufficient-space');
  });
});

describe('planMaterialStackAdd: refusals are whole and leave nothing behind', () => {
  it('refuses the WHOLE add when one unit is short, planning no partial edit', () => {
    const inventory: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: A, count: 18 }]),
      composed(COPPER, [{ source: B, count: 19 }]),
    ];
    const incoming = composed(COPPER, [{ source: UNRECORDED, count: 4 }]);
    const beforeInventory = structuredClone(inventory);
    const beforeIncoming = structuredClone(incoming);

    // Room for 3 of the 4.
    expect(fitOf(inventory, incoming, 0)).toBe(3);
    expect(errorOf(planMaterialStackAdd(request(inventory, incoming, 0)))).toBe(
      'insufficient-space',
    );
    expect(inventory).toEqual(beforeInventory);
    expect(incoming).toEqual(beforeIncoming);
  });

  it('mutates no caller data on a SUCCESSFUL plan either', () => {
    const inventory: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: A, count: 15 }], { slot: 2, instance: { boundTo: 7 } }),
    ];
    const incoming = composed(COPPER, [{ source: B, count: 9 }], { instance: { boundTo: 7 } });
    const beforeInventory = structuredClone(inventory);
    const beforeIncoming = structuredClone(incoming);

    const plan = planOf(inventory, incoming, 1);

    expect(plan.replacements.length).toBe(1);
    expect(plan.appended.length).toBe(1);
    expect(inventory).toEqual(beforeInventory);
    expect(incoming).toEqual(beforeIncoming);
  });

  it('refuses an invalid capacity rather than clamping it', () => {
    const incoming = composed(COPPER, [{ source: A, count: 2 }]);

    expect(errorOf(materialStackFit(request([], incoming, 1, 0)))).toBe('invalid-capacity');
    expect(errorOf(materialStackFit(request([], incoming, 1, -5)))).toBe('invalid-capacity');
    expect(errorOf(materialStackFit(request([], incoming, 1, 2.5)))).toBe('invalid-capacity');
    expect(errorOf(materialStackFit(request([], incoming, -1)))).toBe('invalid-capacity');
    expect(errorOf(materialStackFit(request([], incoming, 1.5)))).toBe('invalid-capacity');
    expect(errorOf(materialStackFit(request([], incoming, Number.NaN)))).toBe('invalid-capacity');
    expect(errorOf(planMaterialStackAdd(request([], incoming, 0, 0)))).toBe('invalid-capacity');
    // A budget of zero is legal: it simply offers no fresh slot.
    expect(fitOf([], incoming, 0)).toBe(0);
  });

  it('propagates the shared MaterialStack refusals for the incoming stack', () => {
    expect(errorOf(materialStackFit(request([], { itemId: SWORD, count: 2 }, 4)))).toBe(
      'not-material',
    );
    expect(errorOf(materialStackFit(request([], { itemId: COPPER, count: 0 }, 4)))).toBe(
      'invalid-count',
    );
    expect(errorOf(materialStackFit(request([], { itemId: COPPER, count: 2.5 }, 4)))).toBe(
      'invalid-count',
    );
    expect(
      errorOf(
        materialStackFit(
          request(
            [],
            composed(COPPER, [{ source: B, count: 2 }], { instance: { signer: 'A' } }),
            4,
          ),
        ),
      ),
    ).toBe('ambiguous-signer');
  });

  it('refuses the whole request when a same-item held stack is malformed', () => {
    const mismatched = composed(COPPER, [{ source: A, count: 2 }]);
    mismatched.count = 5;
    const unknownField = {
      itemId: COPPER,
      count: 2,
      materialSources: [{ source: A, count: 2, note: 'hand edited' }],
    } as unknown as MaterialStackSlot;
    const incoming = composed(COPPER, [{ source: B, count: 1 }]);

    expect(errorOf(materialStackFit(request([mismatched], incoming, 4)))).toBe('sum-mismatch');
    expect(errorOf(planMaterialStackAdd(request([mismatched], incoming, 4)))).toBe('sum-mismatch');
    expect(errorOf(materialStackFit(request([unknownField], incoming, 4)))).toBe('unknown-field');
    // Refused even when the malformed stack sits AFTER enough room to satisfy
    // the request: a bag holding data this model cannot read is not packed.
    const roomy = composed(COPPER, [{ source: A, count: 1 }]);
    expect(errorOf(materialStackFit(request([roomy, mismatched], incoming, 4)))).toBe(
      'sum-mismatch',
    );
  });
});

describe('safe arithmetic at the extremes', () => {
  const huge = Number.MAX_SAFE_INTEGER;

  it('refuses a huge count against a tiny capacity without building the stacks', () => {
    const inventory: readonly MaterialStackSlot[] = [{ itemId: COPPER, count: 19 }];
    const incoming: MaterialStackSlot = { itemId: COPPER, count: huge };

    // 1 top-up unit plus two capped fresh slots.
    expect(fitOf(inventory, incoming, 2)).toBe(41);
    expect(errorOf(planMaterialStackAdd(request(inventory, incoming, 2)))).toBe(
      'insufficient-space',
    );
  });

  it('saturates the room at the requested count instead of overflowing', () => {
    const incoming: MaterialStackSlot = { itemId: COPPER, count: huge };

    // A budget whose product with the cap is far outside the safe range still
    // answers a safe integer, and never more than was asked for.
    const fit = fitOf([], incoming, huge);
    expect(fit).toBe(huge);
    expect(Number.isSafeInteger(fit)).toBe(true);

    const halfway = fitOf([], { itemId: COPPER, count: 30 }, huge);
    expect(halfway).toBe(30);
  });

  it('keeps a one-per-slot payload budget exact at the extremes', () => {
    const charged = composed(COPPER, [{ source: A, count: huge }], {
      instance: { charges: { drain: 1 } },
    });

    // One unit per fresh slot: a budget of 3 answers 3, not 3 caps.
    expect(fitOf([], charged, 3)).toBe(3);
    expect(fitOf([], charged, huge)).toBe(huge);
  });
});

describe('independence: no plan output aliases an input or another output', () => {
  it('hands each replacement its own payload, composition and gatherer snapshot', () => {
    const heldPayload = withUnknownNested();
    const inventory: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: A, count: 18 }], { instance: heldPayload, slot: 1 }),
      composed(COPPER, [{ source: A, count: 19 }], { instance: withUnknownNested(), slot: 2 }),
    ];
    const incoming = composed(COPPER, [{ source: A, count: 3 }], {
      instance: withUnknownNested(),
    });

    const plan = planOf(inventory, incoming, 0);
    const [first, second] = plan.replacements.map((r) => r.slot);

    flagsOf(first.instance).audited = true;
    (first.materialSources as unknown as { count: number }[])[0].count = 999;
    gathererOf(second, A).name = 'Renamed';

    // Neither the caller's slots nor the other replacement moved.
    expect(flagsOf(inventory[0].instance).audited).toBe(false);
    expect(flagsOf(inventory[1].instance).audited).toBe(false);
    expect(flagsOf(second.instance).audited).toBe(false);
    expect(inventory[0].count).toBe(18);
    expect(countOf(inventory[0].materialSources ?? [], A)).toBe(18);
    expect(alice.name).toBe('Alice');
    expect(gathererOf(first, A).name).toBe('Alice');
    // And a later caller edit cannot reach the plan.
    flagsOf(heldPayload).tag = 'moved';
    expect(flagsOf(first.instance).tag).toBeNull();
  });

  it('hands each appended stack its own payload copy', () => {
    const incoming = composed(COPPER, [{ source: A, count: 30 }], {
      instance: withUnknownNested(),
    });

    const plan = planOf([], incoming, 2);
    const [first, second] = plan.appended;

    expect(first.instance).toEqual(second.instance);
    flagsOf(first.instance).audited = true;

    expect(flagsOf(second.instance).audited).toBe(false);
    expect(flagsOf(incoming.instance).audited).toBe(false);
    expect(first.count).toBe(20);
    expect(second.count).toBe(10);
  });

  it('keeps an own "__proto__" payload key as an own data property on every planned slot', () => {
    // An own '__proto__' key is ordinary JSON data (JSON.parse mints one, an
    // object literal cannot), and a copy built by assignment would hand it to
    // Object.prototype's setter instead.
    const raw = '{"boundTo":7,"__proto__":{"polluted":true}}';
    const inventory: readonly MaterialStackSlot[] = [
      composed(COPPER, [{ source: A, count: 18 }], {
        instance: JSON.parse(raw) as ItemInstancePayload,
      }),
    ];
    const incoming = composed(COPPER, [{ source: B, count: 10 }], {
      instance: JSON.parse(raw) as ItemInstancePayload,
    });

    const plan = planOf(inventory, incoming, 1);
    const planned = writtenSlots(plan);
    expect(planned.length).toBe(2);

    for (const slot of planned) {
      const record = slot.instance as unknown as Record<string, unknown>;
      const descriptor = Object.getOwnPropertyDescriptor(record, '__proto__');
      expect(descriptor?.value).toEqual(JSON.parse('{"polluted":true}'));
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect(record.polluted).toBeUndefined();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('hands back compositions the caller cannot reach through, in both directions', () => {
    const sources: MaterialSourceCount[] = [
      { source: { gatherer: { kind: 'character', id: 101, name: 'Alice' } }, count: 6 },
    ];
    const incoming = composed(COPPER, sources);

    const plan = planOf([], incoming, 1);
    const appended = plan.appended[0];

    // Descriptor identity INCLUDES the historic name snapshot, so renaming the
    // plan's copy makes it a different descriptor; the caller's own is untouched.
    gathererOf(appended, A).name = 'Edited';
    expect((sources[0].source.gatherer as MaterialGatherer).name).toBe('Alice');

    (sources[0] as { count: number }).count = 99;
    expect(appended.count).toBe(6);
    // The six units are still all there, now under the edited descriptor alone.
    expect(countOf(appended.materialSources ?? [], EDITED)).toBe(6);
    expect(countOf(appended.materialSources ?? [], A)).toBe(0);
  });
});
