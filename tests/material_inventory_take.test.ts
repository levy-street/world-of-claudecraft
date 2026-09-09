// The material consumption planner (src/sim/material_inventory_take.ts): which
// units a spend takes, from which stacks, and the exact edit that removes them.
//
// These cases assert what neither the source algebra nor the slot adapter can
// see on its own: the choice ACROSS stacks. Material membership is injected
// exactly as the planner takes it, so no case pulls the eager registry (or
// data.ts behind it) into this suite.
//
// Compositions are asserted as literal descriptor/count pairs looked up by
// descriptor identity (sameSource), never by the module's canonical key or its
// ordering. Every plan assertion checks CONSERVATION as well as shape: taken
// plus remaining must equal what was held, per descriptor.

import { describe, expect, it } from 'vitest';
import {
  applyMaterialInventoryTake,
  type MaterialTakePlan,
  type MaterialTakeResult,
  planMaterialInventoryTake,
  soleTakenSource,
} from '../src/sim/material_inventory_take';
import type {
  MaterialComposition,
  MaterialGatherer,
  MaterialSource,
  MaterialSourceCount,
} from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import type { ItemInstancePayload } from '../src/sim/types';

const COPPER = 'ore_copper';
const IRON = 'ore_iron';
const SWORD = 'sword_rusty';
const MATERIALS: ReadonlySet<string> = new Set([COPPER, IRON]);

const alice: MaterialGatherer = { kind: 'character', id: 101, name: 'Alice' };
const bram: MaterialGatherer = { kind: 'character', id: 202, name: 'Bram' };

/** The three tiers the automatic order ranks: unrecorded, plain recorded, and
 *  premium (a nonempty signer). An EMPTY signer is a legal legacy value that is
 *  deliberately NOT premium, and keeps its own descriptor. */
const UNRECORDED: MaterialSource = {};
const A: MaterialSource = { gatherer: alice };
const B: MaterialSource = { gatherer: bram };
const EMPTY_SIGNER: MaterialSource = { signer: '' };
const PREMIUM_A: MaterialSource = { signer: 'Alice' };
const PREMIUM_B: MaterialSource = { signer: 'Bram' };

const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

const countOf = (composition: MaterialComposition, source: MaterialSource): number =>
  composition.filter((e) => sameSource(e.source, source)).reduce((n, e) => n + e.count, 0);

/** Units of one descriptor across a whole slot list. */
const unitsOf = (slots: readonly MaterialStackSlot[], source: MaterialSource): number =>
  slots.reduce((n, slot) => n + countOf(slot.materialSources ?? [], source), 0);

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

const ok = <T>(result: MaterialTakeResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
};

const errorOf = (result: MaterialTakeResult<unknown>): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

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

interface PlanArgs {
  readonly eligibleSlot?: (slot: MaterialStackSlot, index: number) => boolean;
  readonly eligibleSource?: (
    source: MaterialSource,
    slot: MaterialStackSlot,
    index: number,
  ) => boolean;
  readonly slotIndex?: number;
  readonly selectedSources?: readonly MaterialSourceCount[];
  readonly allowPartial?: boolean;
  readonly includeLocked?: boolean;
}

const planFor = (
  inventory: readonly MaterialStackSlot[],
  count: number,
  args: PlanArgs = {},
  itemId = COPPER,
): MaterialTakeResult<MaterialTakePlan> =>
  planMaterialInventoryTake({ inventory, itemId, count, materialIds: MATERIALS, ...args });

const planOf = (
  inventory: readonly MaterialStackSlot[],
  count: number,
  args: PlanArgs = {},
): MaterialTakePlan => ok(planFor(inventory, count, args));

/** The inventory a plan leaves behind. A SHALLOW array copy is enough and is
 *  the point: applying must only replace and splice ARRAY entries, never mutate
 *  a slot object, so the caller's slots are shared here and must survive. */
const applied = (
  inventory: readonly MaterialStackSlot[],
  plan: MaterialTakePlan,
): MaterialStackSlot[] => {
  const copy = [...inventory];
  applyMaterialInventoryTake(copy, plan);
  return copy;
};

/** Taken plus remaining equals what was held, for every descriptor named. */
const expectConserved = (
  before: readonly MaterialStackSlot[],
  plan: MaterialTakePlan,
  after: readonly MaterialStackSlot[],
  descriptors: readonly MaterialSource[],
): void => {
  for (const source of descriptors) {
    expect(unitsOf(after, source) + unitsOf(plan.taken, source)).toBe(unitsOf(before, source));
  }
  const held = before.reduce((n, s) => n + s.count, 0);
  const left = after.reduce((n, s) => n + s.count, 0);
  expect(left + plan.takenCount).toBe(held);
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

describe('automatic selection: premium is spent last, across every stack', () => {
  it('spends unrecorded, then plain recorded, then premium', () => {
    const inventory = [
      composed(COPPER, [
        { source: PREMIUM_A, count: 4 },
        { source: A, count: 3 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    // Five units: the two unrecorded and three plain recorded, no premium.
    const plan = planOf(inventory, 5);

    expect(plan.takenCount).toBe(5);
    expectExactly(plan.taken[0].materialSources, [
      [UNRECORDED, 2],
      [A, 3],
    ]);
    const after = applied(inventory, plan);
    expectExactly(after[0].materialSources, [[PREMIUM_A, 4]]);
    expectConserved(inventory, plan, after, [UNRECORDED, A, PREMIUM_A]);
  });

  it('preserves premium held in an EARLIER stack while spending a later plain one', () => {
    const inventory = [
      composed(COPPER, [{ source: PREMIUM_A, count: 5 }]),
      composed(COPPER, [{ source: UNRECORDED, count: 6 }]),
    ];

    const plan = planOf(inventory, 6);

    // The premium stack is not in the plan at all.
    expect(plan.replacements).toEqual([]);
    expect(plan.removals).toEqual([1]);
    expect(plan.taken).toHaveLength(1);
    expectExactly(plan.taken[0].materialSources, [[UNRECORDED, 6]]);

    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expectExactly(after[0].materialSources, [[PREMIUM_A, 5]]);
    expectConserved(inventory, plan, after, [PREMIUM_A, UNRECORDED]);
  });

  it('preserves premium held in a LATER stack while spending an earlier plain one', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 6 }]),
      composed(COPPER, [{ source: PREMIUM_A, count: 5 }]),
    ];

    const plan = planOf(inventory, 6);

    expect(plan.removals).toEqual([0]);
    expectExactly(plan.taken[0].materialSources, [[UNRECORDED, 6]]);
    const after = applied(inventory, plan);
    expectExactly(after[0].materialSources, [[PREMIUM_A, 5]]);
    expectConserved(inventory, plan, after, [PREMIUM_A, UNRECORDED]);
  });

  it('reaches premium only once nothing else is left, and takes the last unit last', () => {
    const inventory = [
      composed(COPPER, [{ source: PREMIUM_A, count: 2 }]),
      composed(COPPER, [{ source: UNRECORDED, count: 1 }]),
    ];

    // Two units: the one unrecorded and exactly one premium.
    const partial = planOf(inventory, 2);
    expect(unitsOf(partial.taken, UNRECORDED)).toBe(1);
    expect(unitsOf(partial.taken, PREMIUM_A)).toBe(1);
    expect(unitsOf(applied(inventory, partial), PREMIUM_A)).toBe(1);

    // The whole holding: the final premium unit goes only when it must.
    const all = planOf(inventory, 3);
    expect(unitsOf(all.taken, PREMIUM_A)).toBe(2);
    expect(applied(inventory, all)).toEqual([]);
  });

  it('treats an EMPTY-string signer as plain, spending it before real premium', () => {
    const inventory = [
      composed(COPPER, [
        { source: PREMIUM_A, count: 3 },
        { source: EMPTY_SIGNER, count: 3 },
      ]),
    ];

    const plan = planOf(inventory, 3);

    // The empty signer keeps its own descriptor and conveys nothing, so it is
    // ordinary plain material for the spend order.
    expectExactly(plan.taken[0].materialSources, [[EMPTY_SIGNER, 3]]);
    expectExactly(applied(inventory, plan)[0].materialSources, [[PREMIUM_A, 3]]);
  });

  it('orders two premium descriptors by their canonical key, deterministically', () => {
    const inventory = [
      composed(COPPER, [
        { source: PREMIUM_B, count: 2 },
        { source: PREMIUM_A, count: 2 },
      ]),
    ];

    const first = planOf(inventory, 2);
    const second = planOf(inventory, 2);

    expect(second).toEqual(first);
    // Whichever key sorts first, the take is ONE descriptor and never a blend.
    expect(first.taken[0].materialSources).toHaveLength(1);
    expect(first.takenCount).toBe(2);
  });

  it('takes the same descriptor from the HIGHEST index first', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 4 }]),
      composed(COPPER, [{ source: A, count: 4 }]),
    ];

    const plan = planOf(inventory, 4);

    expect(plan.removals).toEqual([1]);
    expect(plan.replacements).toEqual([]);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(4);
  });

  it('spans stacks when one cannot cover the request, and reports each take', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 3 }]),
      composed(COPPER, [{ source: A, count: 3 }]),
    ];

    const plan = planOf(inventory, 5);

    // Highest index emptied first, then the remainder off index 0.
    expect(plan.removals).toEqual([1]);
    expect(plan.replacements.map((r) => r.index)).toEqual([0]);
    expect(plan.replacements[0].slot.count).toBe(1);
    // One taken copy per SOURCE stack, ascending by that stack's index.
    expect(plan.taken.map((t) => t.count)).toEqual([2, 3]);
    expect(plan.takenCount).toBe(5);
    expectConserved(inventory, plan, applied(inventory, plan), [A]);
  });
});

describe('cap crossings, tails and partial takes', () => {
  it('empties a stack exactly and removes it, leaving the rest untouched', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 20 }]),
      composed(IRON, [{ source: A, count: 5 }]),
    ];

    const plan = planOf(inventory, 20);

    expect(plan.removals).toEqual([0]);
    expect(plan.replacements).toEqual([]);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].itemId).toBe(IRON);
  });

  it('leaves a one-unit tail rather than rounding it away', () => {
    const inventory = [composed(COPPER, [{ source: A, count: 20 }])];

    const plan = planOf(inventory, 19);

    expect(plan.removals).toEqual([]);
    expect(plan.replacements[0].slot.count).toBe(1);
    expectExactly(plan.replacements[0].slot.materialSources, [[A, 1]]);
  });

  it('crosses several full stacks and a partial one in a single plan', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 20 }]),
      composed(COPPER, [{ source: UNRECORDED, count: 20 }]),
      composed(COPPER, [{ source: UNRECORDED, count: 20 }]),
    ];

    const plan = planOf(inventory, 45);

    // Highest index first: 20 + 20 emptied, 5 off the lowest.
    expect(plan.removals).toEqual([1, 2]);
    expect(plan.replacements.map((r) => r.index)).toEqual([0]);
    expect(plan.replacements[0].slot.count).toBe(15);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(15);
    expectConserved(inventory, plan, after, [UNRECORDED]);
  });

  it('refuses an exact take the inventory cannot cover, planning nothing', () => {
    const inventory = [composed(COPPER, [{ source: A, count: 4 }])];
    const before = structuredClone(inventory);

    expect(errorOf(planFor(inventory, 5))).toBe('insufficient');
    expect(inventory).toEqual(before);
  });

  it('takes what is there under allowPartial, exactly as the legacy walk did', () => {
    const inventory = [
      composed(COPPER, [{ source: PREMIUM_A, count: 2 }]),
      composed(COPPER, [{ source: UNRECORDED, count: 3 }]),
    ];

    const plan = planOf(inventory, 99, { allowPartial: true });

    expect(plan.takenCount).toBe(5);
    expect(applied(inventory, plan)).toEqual([]);
    expectConserved(inventory, plan, [], [PREMIUM_A, UNRECORDED]);
  });

  it('plans an empty take under allowPartial when nothing is held', () => {
    const plan = planOf([composed(IRON, [{ source: A, count: 3 }])], 4, { allowPartial: true });

    expect(plan.takenCount).toBe(0);
    expect(plan.taken).toEqual([]);
    expect(plan.replacements).toEqual([]);
    expect(plan.removals).toEqual([]);
  });
});

describe('locked copies and the separated grouping', () => {
  it('never spends a locked stack, even when it is the only stock', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 5 }], { instance: { locked: true } }),
    ];

    expect(errorOf(planFor(inventory, 1))).toBe('insufficient');
    // And under allowPartial it simply takes nothing rather than breaking the lock.
    const plan = planOf(inventory, 1, { allowPartial: true });
    expect(plan.takenCount).toBe(0);
    expect(applied(inventory, plan)).toEqual(inventory);
  });

  it('spends around a locked stack and leaves it whole', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 4 }], { instance: { locked: true } }),
      composed(COPPER, [{ source: UNRECORDED, count: 4 }]),
    ];

    const plan = planOf(inventory, 4);

    expect(plan.removals).toEqual([1]);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].instance).toEqual({ locked: true });
    expect(after[0].count).toBe(4);
  });

  it('admits a locked stack ONLY when the caller explicitly opts in', () => {
    const locked = () => [
      composed(COPPER, [{ source: A, count: 5 }], { instance: { locked: true } }),
    ];

    // The DEFAULT is unchanged and is what makes the owner's lock mean
    // anything: no flag, no argument, still refused.
    expect(errorOf(planFor(locked(), 2))).toBe('insufficient');
    expect(errorOf(planFor(locked(), 2, { includeLocked: false }))).toBe('insufficient');

    // The opt-in exists for ONE caller shape: replaying a move a lock-blind
    // pipe (the guild book) already made, which must land the same units the
    // live move did or the durable book drifts from the live one.
    const inventory = locked();
    const plan = planOf(inventory, 2, { includeLocked: true });
    expect(plan.takenCount).toBe(2);
    expectExactly(plan.taken[0]?.materialSources, [[A, 2]]);

    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(3);
    // The lock is never stripped off what stays behind.
    expect(after[0].instance).toEqual({ locked: true });
    expectConserved(inventory, plan, after, [A]);
  });

  it('leaves every OTHER eligibility rule in force while includeLocked is set', () => {
    const inventory = [
      composed(COPPER, [{ source: PREMIUM_A, count: 4 }], { instance: { locked: true } }),
    ];

    // Opting past the lock is not a licence to ignore a source filter: the
    // narrowing a caller asked for still decides which buckets are reachable.
    expect(
      errorOf(
        planFor(inventory, 1, {
          includeLocked: true,
          eligibleSource: (source) => source.signer !== 'Alice',
        }),
      ),
    ).toBe('insufficient');
  });

  it('DOES spend a separated block: separation is grouping, not a lock', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 5 }], { materialSeparated: true, slot: 3 }),
    ];

    const plan = planOf(inventory, 2);

    expect(plan.takenCount).toBe(2);
    // The remainder stays separated and keeps its cell; what left is
    // transfer-ready, carrying neither.
    const after = applied(inventory, plan);
    expect(after[0].materialSeparated).toBe(true);
    expect(after[0].slot).toBe(3);
    expect(after[0].count).toBe(3);
    expect(plan.taken[0].materialSeparated).toBeUndefined();
    expect('materialSeparated' in plan.taken[0]).toBe(false);
    expect('slot' in plan.taken[0]).toBe(false);
  });

  it('spends a separated block WITHOUT mixing it into another stack', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 3 }], { materialSeparated: true }),
      composed(COPPER, [{ source: A, count: 3 }]),
    ];

    const plan = planOf(inventory, 5);

    // Two separate takes, one per stack: nothing was merged to satisfy this.
    expect(plan.taken).toHaveLength(2);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].materialSeparated).toBe(true);
    expect(after[0].count).toBe(1);
    expectConserved(inventory, plan, after, [A]);
  });

  it('lets a caller predicate narrow the eligible stacks without changing the rest', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 4 }], { materialSeparated: true }),
      composed(COPPER, [{ source: UNRECORDED, count: 4 }]),
    ];

    // A caller that wants to leave separated blocks alone says so itself.
    const combinedOnly = (slot: MaterialStackSlot): boolean => slot.materialSeparated !== true;

    const plan = planOf(inventory, 4, { eligibleSlot: combinedOnly });

    expect(plan.removals).toEqual([1]);
    // And the narrowed pool really is smaller: the separated four are unreachable.
    expect(errorOf(planFor(inventory, 5, { eligibleSlot: combinedOnly }))).toBe('insufficient');
  });
});

describe('explicit slot and source selection never fall back', () => {
  const inventory = (): MaterialStackSlot[] => [
    composed(COPPER, [{ source: UNRECORDED, count: 5 }]),
    composed(COPPER, [
      { source: PREMIUM_A, count: 3 },
      { source: B, count: 3 },
    ]),
  ];

  it('spends exactly the named descriptors, in exactly those counts', () => {
    const held = inventory();
    const plan = planOf(held, 4, {
      selectedSources: [
        { source: PREMIUM_A, count: 2 },
        { source: B, count: 2 },
      ],
    });

    expect(plan.takenCount).toBe(4);
    expectExactly(plan.taken[0].materialSources, [
      [PREMIUM_A, 2],
      [B, 2],
    ]);
    const after = applied(held, plan);
    // The unrecorded stack was never touched, even though it is cheaper.
    expect(after[0].count).toBe(5);
    expectExactly(after[1].materialSources, [
      [PREMIUM_A, 1],
      [B, 1],
    ]);
    expectConserved(held, plan, after, [UNRECORDED, PREMIUM_A, B]);
  });

  it('refuses a selection the inventory cannot cover, substituting nothing', () => {
    const held = inventory();
    const before = structuredClone(held);

    expect(errorOf(planFor(held, 4, { selectedSources: [{ source: PREMIUM_A, count: 4 }] }))).toBe(
      'insufficient',
    );
    // A descriptor that is not held at all refuses just the same.
    expect(errorOf(planFor(held, 1, { selectedSources: [{ source: A, count: 1 }] }))).toBe(
      'insufficient',
    );
    expect(held).toEqual(before);
  });

  it('refuses a selection that does not total the requested quantity', () => {
    expect(errorOf(planFor(inventory(), 4, { selectedSources: [{ source: B, count: 3 }] }))).toBe(
      'sum-mismatch',
    );
  });

  it('never spends more of a selected descriptor than was asked for', () => {
    const held = inventory();
    const plan = planOf(held, 1, { selectedSources: [{ source: B, count: 1 }] });

    expect(plan.takenCount).toBe(1);
    expectExactly(plan.taken[0].materialSources, [[B, 1]]);
    expect(unitsOf(applied(held, plan), B)).toBe(2);
  });

  it('satisfies a selected descriptor from the highest index down', () => {
    const held = [
      composed(COPPER, [{ source: A, count: 3 }]),
      composed(COPPER, [{ source: A, count: 3 }]),
    ];

    const plan = planOf(held, 3, { selectedSources: [{ source: A, count: 3 }] });

    expect(plan.removals).toEqual([1]);
    expect(plan.replacements).toEqual([]);
  });

  it('spends only the named slot, refusing rather than reaching another', () => {
    const held = inventory();
    const plan = planOf(held, 3, { slotIndex: 1 });

    // Index 1's own cheapest units, never index 0's unrecorded stock.
    expectExactly(plan.taken[0].materialSources, [[B, 3]]);
    expect(applied(held, plan)[0].count).toBe(5);

    expect(errorOf(planFor(held, 7, { slotIndex: 1 }))).toBe('insufficient');
  });

  it('refuses a slot index that names no stack of this item', () => {
    const held = [
      composed(COPPER, [{ source: A, count: 3 }]),
      composed(IRON, [{ source: A, count: 3 }]),
    ];

    expect(errorOf(planFor(held, 1, { slotIndex: 1 }))).toBe('invalid-index');
    expect(errorOf(planFor(held, 1, { slotIndex: 2 }))).toBe('invalid-index');
    expect(errorOf(planFor(held, 1, { slotIndex: -1 }))).toBe('invalid-index');
    expect(errorOf(planFor(held, 1, { slotIndex: 1.5 }))).toBe('invalid-index');
  });

  it('combines an explicit slot with an explicit selection', () => {
    const held = inventory();
    const plan = planOf(held, 2, {
      slotIndex: 1,
      selectedSources: [{ source: PREMIUM_A, count: 2 }],
    });

    expectExactly(plan.taken[0].materialSources, [[PREMIUM_A, 2]]);
    expect(applied(held, plan)[1].count).toBe(4);
  });
});

describe('eligibleSource narrows the pool one bucket at a time', () => {
  /** The fungible-only custody rule: a unit may move only when it carries no
   *  effective payload and no signature. Provenance alone is fine. */
  const fungibleOnly = (source: MaterialSource, slot: MaterialStackSlot): boolean =>
    slot.instance === undefined && source.signer === undefined;

  /** One mixed row: signed units beside provenance-only and unrecorded ones. */
  const mixedRow = (): MaterialStackSlot[] => [
    composed(COPPER, [
      { source: PREMIUM_A, count: 4 },
      { source: A, count: 3 },
      { source: UNRECORDED, count: 2 },
    ]),
  ];

  it('spends the eligible portion of a mixed row and leaves the rest in place', () => {
    const inventory = mixedRow();

    const plan = planOf(inventory, 5, { eligibleSource: fungibleOnly });

    // The provenance-only and unrecorded units move; the signed four do not,
    // and they stay in the SAME row rather than blocking or being laundered.
    expect(plan.takenCount).toBe(5);
    expectExactly(plan.taken[0].materialSources, [
      [UNRECORDED, 2],
      [A, 3],
    ]);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expectExactly(after[0].materialSources, [[PREMIUM_A, 4]]);
    expectConserved(inventory, plan, after, [UNRECORDED, A, PREMIUM_A]);
  });

  it('refuses past the eligible portion instead of reaching a filtered bucket', () => {
    const inventory = mixedRow();
    const before = structuredClone(inventory);

    // Five are eligible; the sixth would have to be signed.
    expect(errorOf(planFor(inventory, 6, { eligibleSource: fungibleOnly }))).toBe('insufficient');
    expect(inventory).toEqual(before);
    // Under allowPartial the same request simply stops at the eligible five.
    const partial = planOf(inventory, 6, { eligibleSource: fungibleOnly, allowPartial: true });
    expect(partial.takenCount).toBe(5);
    expect(unitsOf(partial.taken, PREMIUM_A)).toBe(0);
  });

  it('admits provenance-only units: a gatherer is not a signature', () => {
    const inventory = [
      composed(COPPER, [
        { source: A, count: 2 },
        { source: B, count: 2 },
      ]),
    ];

    const plan = planOf(inventory, 4, { eligibleSource: fungibleOnly });

    expect(plan.takenCount).toBe(4);
    expect(unitsOf(plan.taken, A)).toBe(2);
    expect(unitsOf(plan.taken, B)).toBe(2);
  });

  it('treats an EMPTY-string signer as a signature for a predicate that says so', () => {
    const inventory = [
      composed(COPPER, [
        { source: EMPTY_SIGNER, count: 2 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    // fungibleOnly keys on `signer === undefined`, so the empty string is
    // filtered: the planner reports the predicate's answer, never its own.
    const plan = planOf(inventory, 2, { eligibleSource: fungibleOnly });

    expectExactly(plan.taken[0].materialSources, [[UNRECORDED, 2]]);
    expect(errorOf(planFor(inventory, 3, { eligibleSource: fungibleOnly }))).toBe('insufficient');
  });

  it('filters per bucket, not per row: a payload-bearing row drops out whole', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 5 }], { instance: { boundTo: 7 } }),
      composed(COPPER, [{ source: UNRECORDED, count: 5 }]),
    ];

    // The predicate reads the SLOT too, so it can still refuse a whole row.
    const plan = planOf(inventory, 5, { eligibleSource: fungibleOnly });

    expect(plan.removals).toEqual([1]);
    expect(applied(inventory, plan)).toHaveLength(1);
    expect(errorOf(planFor(inventory, 6, { eligibleSource: fungibleOnly }))).toBe('insufficient');
  });

  it('refuses a SELECTED descriptor the predicate filtered, substituting nothing', () => {
    const inventory = mixedRow();
    const before = structuredClone(inventory);

    expect(
      errorOf(
        planFor(inventory, 2, {
          eligibleSource: fungibleOnly,
          selectedSources: [{ source: PREMIUM_A, count: 2 }],
        }),
      ),
    ).toBe('insufficient');
    expect(inventory).toEqual(before);

    // The eligible descriptors are still selectable by name.
    const plan = planOf(inventory, 2, {
      eligibleSource: fungibleOnly,
      selectedSources: [{ source: A, count: 2 }],
    });
    expectExactly(plan.taken[0].materialSources, [[A, 2]]);
  });

  it('is handed the shared normalized slot and its index', () => {
    const inventory: MaterialStackSlot[] = [
      { itemId: COPPER, count: 3, instance: { signer: 'Alice' } },
      composed(COPPER, [{ source: UNRECORDED, count: 3 }]),
    ];
    const seen: { index: number; count: number; hasPayload: boolean; source: MaterialSource }[] =
      [];

    planOf(inventory, 3, {
      eligibleSource: (source, slot, index) => {
        seen.push({ index, count: slot.count, hasPayload: slot.instance !== undefined, source });
        return true;
      },
    });

    // The legacy signer has already moved into the descriptor by the time the
    // predicate runs, so it reads canonical data and re-normalizes nothing.
    expect(seen).toHaveLength(2);
    const legacy = seen.find((entry) => entry.index === 0);
    expect(legacy?.hasPayload).toBe(false);
    expect(legacy?.source.signer).toBe('Alice');
    expect(legacy?.count).toBe(3);
    expect(seen.find((entry) => entry.index === 1)?.source.signer).toBeUndefined();
  });

  it('narrows the pool without reordering it', () => {
    const inventory = [
      composed(COPPER, [
        { source: PREMIUM_A, count: 2 },
        { source: B, count: 2 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    // Dropping the unrecorded bucket does not promote premium over plain.
    const plan = planOf(inventory, 2, {
      eligibleSource: (source) => source.gatherer !== undefined || source.signer !== undefined,
    });

    expectExactly(plan.taken[0].materialSources, [[B, 2]]);
  });

  it('composes with eligibleSlot, both narrowing and neither reordering', () => {
    const inventory = [
      composed(COPPER, [{ source: UNRECORDED, count: 3 }], { materialSeparated: true }),
      composed(COPPER, [
        { source: PREMIUM_A, count: 3 },
        { source: UNRECORDED, count: 3 },
      ]),
    ];

    const plan = planOf(inventory, 3, {
      eligibleSlot: (slot) => slot.materialSeparated !== true,
      eligibleSource: fungibleOnly,
    });

    // Row 0 is out by slot, the signed bucket of row 1 is out by source.
    expect(plan.replacements.map((r) => r.index)).toEqual([1]);
    expectExactly(plan.taken[0].materialSources, [[UNRECORDED, 3]]);
    expectExactly(plan.replacements[0].slot.materialSources, [[PREMIUM_A, 3]]);
  });
});

describe('validation happens before any choice is made', () => {
  it('refuses a non-material, a bad quantity and an unreadable held stack', () => {
    const sound = [composed(COPPER, [{ source: A, count: 3 }])];

    expect(errorOf(planFor(sound, 1, {}, SWORD))).toBe('not-material');
    expect(errorOf(planFor(sound, 0))).toBe('invalid-quantity');
    expect(errorOf(planFor(sound, -2))).toBe('invalid-quantity');
    expect(errorOf(planFor(sound, 1.5))).toBe('invalid-quantity');
    expect(errorOf(planFor(sound, Number.MAX_SAFE_INTEGER + 2))).toBe('invalid-quantity');
  });

  it('a malformed stack prevents any write, even when another stack could cover it', () => {
    const malformed = composed(COPPER, [{ source: A, count: 2 }]);
    malformed.count = 5;
    const inventory = [composed(COPPER, [{ source: UNRECORDED, count: 9 }]), malformed];
    const before = structuredClone(inventory);

    expect(errorOf(planFor(inventory, 1))).toBe('sum-mismatch');
    // allowPartial is about a SHORTFALL, never about reading past bad data.
    expect(errorOf(planFor(inventory, 1, { allowPartial: true }))).toBe('sum-mismatch');
    // An explicit index narrows what is in scope, so a request that never looks
    // at the malformed stack still succeeds.
    expect(ok(planFor(inventory, 1, { slotIndex: 0 })).takenCount).toBe(1);
    expect(inventory).toEqual(before);
  });

  it('a malformed LOCKED stack still refuses, rather than being spent around', () => {
    const malformed = composed(COPPER, [{ source: A, count: 2 }], { instance: { locked: true } });
    malformed.count = 5;

    expect(errorOf(planFor([malformed], 1, { allowPartial: true }))).toBe('sum-mismatch');
  });

  it('never reads a slot of another item, malformed or not', () => {
    const otherItem = composed(IRON, [{ source: A, count: 2 }]);
    otherItem.count = 99;
    const inventory = [otherItem, composed(COPPER, [{ source: A, count: 3 }])];

    expect(ok(planFor(inventory, 3)).takenCount).toBe(3);
  });

  it('refuses a malformed SELECTION without touching the inventory', () => {
    const inventory = [composed(COPPER, [{ source: A, count: 3 }])];
    const before = structuredClone(inventory);
    const bad = [
      { source: { gatherer: { kind: 'sky', id: 1, name: 'Nobody' } }, count: 1 },
    ] as unknown as MaterialSourceCount[];

    expect(errorOf(planFor(inventory, 1, { selectedSources: bad }))).toBe('invalid-source');
    expect(inventory).toEqual(before);
  });
});

describe('the plan is inert and independent', () => {
  it('planning alone changes nothing, and the plan can be discarded', () => {
    const inventory = [composed(COPPER, [{ source: A, count: 5 }])];
    const before = structuredClone(inventory);

    planOf(inventory, 3);

    expect(inventory).toEqual(before);
  });

  it('hands the taken copy and the remainder independent payloads', () => {
    const inventory = [
      composed(
        COPPER,
        [
          { source: UNRECORDED, count: 2 },
          { source: A, count: 6 },
        ],
        { instance: withUnknownNested() },
      ),
    ];

    const plan = planOf(inventory, 2);
    const after = applied(inventory, plan);
    const taken = plan.taken[0];

    expect(nestedOf(taken.instance)).toEqual(nestedOf(after[0].instance));

    flagsOf(taken.instance).audited = true;
    expect(flagsOf(after[0].instance).audited).toBe(false);
    expect(flagsOf(inventory[0].instance).audited).toBe(false);

    // And the caller cannot reach into the plan afterwards either.
    flagsOf(inventory[0].instance).tag = 'moved';
    expect(flagsOf(taken.instance).tag).toBeNull();
  });

  it('keeps an own "__proto__" payload key as an own data property on both halves', () => {
    // Ordinary JSON data (JSON.parse mints one, an object literal cannot): a
    // copy built by assignment would hand it to Object.prototype's setter.
    const raw = '{"boundTo":7,"__proto__":{"polluted":true}}';
    const inventory = [
      composed(
        COPPER,
        [
          { source: UNRECORDED, count: 1 },
          { source: A, count: 3 },
        ],
        { instance: JSON.parse(raw) as ItemInstancePayload },
      ),
    ];

    const plan = planOf(inventory, 1);
    const after = applied(inventory, plan);

    for (const payload of [plan.taken[0].instance, after[0].instance]) {
      const record = payload as unknown as Record<string, unknown>;
      const descriptor = Object.getOwnPropertyDescriptor(record, '__proto__');
      expect(descriptor?.value).toEqual(JSON.parse('{"polluted":true}'));
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect(record.polluted).toBeUndefined();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('gives each taken copy its own composition and gatherer snapshot', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 3 }]),
      composed(COPPER, [{ source: A, count: 3 }]),
    ];

    const plan = planOf(inventory, 6);
    expect(plan.taken).toHaveLength(2);

    const snapshot = plan.taken[0].materialSources?.[0]?.source.gatherer as
      | { name: string }
      | undefined;
    if (snapshot === undefined) throw new Error('expected a gatherer snapshot');
    snapshot.name = 'Edited';

    // Identity includes the name snapshot, so only the edited copy moved.
    expect(unitsOf([plan.taken[1]], A)).toBe(3);
    expect(alice.name).toBe('Alice');
    expect(unitsOf(inventory, A)).toBe(6);
  });

  it('applies removals back to front, so no surviving index shifts', () => {
    const inventory = [
      composed(COPPER, [{ source: A, count: 2 }]),
      composed(IRON, [{ source: A, count: 9 }]),
      composed(COPPER, [{ source: A, count: 2 }]),
    ];

    const plan = planOf(inventory, 4);

    expect(plan.removals).toEqual([0, 2]);
    const after = applied(inventory, plan);
    expect(after).toHaveLength(1);
    expect(after[0].itemId).toBe(IRON);
    expect(after[0].count).toBe(9);
  });
});

describe('soleTakenSource', () => {
  it('names the descriptor a one-unit take spent', () => {
    const inventory = [
      composed(COPPER, [
        { source: PREMIUM_A, count: 2 },
        { source: UNRECORDED, count: 2 },
      ]),
    ];

    const source = soleTakenSource(planOf(inventory, 1));

    expect(source).toBeDefined();
    expect(sameSource(source ?? {}, UNRECORDED)).toBe(true);
  });

  it('reports the legacy signer of the unit actually spent, empty string included', () => {
    const emptySigner = [composed(COPPER, [{ source: EMPTY_SIGNER, count: 2 }])];
    const premium = [composed(COPPER, [{ source: PREMIUM_A, count: 2 }])];

    expect(soleTakenSource(planOf(emptySigner, 1))?.signer).toBe('');
    expect(soleTakenSource(planOf(premium, 1))?.signer).toBe('Alice');
    // A gatherer alone carries no signer, so nothing is invented from it.
    expect(soleTakenSource(planOf([composed(COPPER, [{ source: A, count: 2 }])], 1))?.signer).toBe(
      undefined,
    );
  });

  it('answers undefined for any take that is not exactly one unit', () => {
    const inventory = [composed(COPPER, [{ source: A, count: 4 }])];

    expect(soleTakenSource(planOf(inventory, 2))).toBeUndefined();
    // An empty partial take names no descriptor either.
    const nothing = planOf([composed(IRON, [{ source: A, count: 1 }])], 1, { allowPartial: true });
    expect(soleTakenSource(nothing)).toBeUndefined();
  });
});
