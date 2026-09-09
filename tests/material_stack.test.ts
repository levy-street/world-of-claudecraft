// The material-stack adapter (src/sim/material_stack.ts): the slot-level half of
// the source algebra. These cases assert the SLOT decisions the algebra itself
// cannot see: what normalization projects onto a legacy stack, which two stacks
// may share one bag slot, and exactly what a take hands over versus keeps.
//
// Material membership is INJECTED here exactly as the adapter takes it, so no
// test pulls the eager `material_ids.ts` registry (and `data.ts` behind it) into
// this suite; the ids below are the only content coupling.
//
// Every composition assertion is written as literal descriptor/count pairs and
// looked up by descriptor identity (sameSource), never by the module's canonical
// key or its ordering, so a re-keying cannot make a wrong answer pass.

import { describe, expect, it } from 'vitest';
import type {
  MaterialComposition,
  MaterialGatherer,
  MaterialSource,
  MaterialSourceCount,
} from '../src/sim/material_sources';
import {
  compatibleMaterialStacks,
  type MaterialStackResult,
  type MaterialStackSlot,
  normalizeMaterialStack,
  takeMaterialStack,
} from '../src/sim/material_stack';
import type { ItemInstancePayload } from '../src/sim/types';

const COPPER = 'ore_copper';
const IRON = 'ore_iron';
const SWORD = 'sword_rusty';
const MATERIALS: ReadonlySet<string> = new Set([COPPER, IRON]);

const alice: MaterialGatherer = { kind: 'character', id: 101, name: 'Alice' };
const bram: MaterialGatherer = { kind: 'character', id: 202, name: 'Bram' };

const A: MaterialSource = { gatherer: alice };
const B: MaterialSource = { gatherer: bram };
const UNRECORDED: MaterialSource = {};
const SIGNED_BY_ALICE: MaterialSource = { signer: 'Alice' };

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

const ok = <T>(result: MaterialStackResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
};

const errorOf = (result: MaterialStackResult<unknown>): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

const normalized = (slot: MaterialStackSlot): MaterialStackSlot =>
  ok(normalizeMaterialStack(slot, MATERIALS));

/** A stack that already carries an explicit composition. */
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

/** A persisted payload carrying a NESTED property this model has never heard of:
 *  the shape item_instance_merge compares in full and refuses to drop. */
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

const entriesOf = (payload: ItemInstancePayload | undefined): Record<string, unknown>[] =>
  nestedOf(payload).entries as Record<string, unknown>[];

describe('normalizeMaterialStack: legacy projection', () => {
  it('projects a legacy SIGNED stack onto its signer descriptor and moves the signer off the payload', () => {
    const slot: MaterialStackSlot = { itemId: COPPER, count: 3, instance: { signer: 'Alice' } };

    const out = normalized(slot);

    expectExactly(out.materialSources, [[SIGNED_BY_ALICE, 3]]);
    expect(out.count).toBe(3);
    // The signer now lives in the descriptor, and the emptied payload is gone
    // rather than left as an empty object that would not merge structurally.
    expect(out.instance).toBeUndefined();
    // The input is untouched: normalization reports, it never edits in place.
    expect(slot.instance).toEqual({ signer: 'Alice' });
    expect((slot as { materialSources?: unknown }).materialSources).toBeUndefined();
  });

  it('projects a legacy UNSIGNED stack onto the unrecorded descriptor, inventing no gatherer', () => {
    const out = normalized({ itemId: COPPER, count: 5 });

    expectExactly(out.materialSources, [[UNRECORDED, 5]]);
    expect(out.materialSources?.[0]?.source.gatherer).toBeUndefined();
    expect(out.materialSources?.[0]?.source.signer).toBeUndefined();
  });

  it('keeps an empty-string signer as its own descriptor rather than folding it into unrecorded', () => {
    const out = normalized({ itemId: COPPER, count: 2, instance: { signer: '' } });

    expectExactly(out.materialSources, [[{ signer: '' }, 2]]);
    expect(out.instance).toBeUndefined();
  });

  it('retains every other payload property, craftedRecipeId, and the owner slot/separation metadata', () => {
    const slot: MaterialStackSlot = {
      itemId: COPPER,
      count: 4,
      instance: { signer: 'Alice', rolled: { stats: { sta: 2 } }, boundTo: 7 },
      craftedRecipeId: 'recipe_copper_bar',
      slot: 11,
      materialSeparated: true,
    };

    const out = normalized(slot);

    expect(out.instance).toEqual({ rolled: { stats: { sta: 2 } }, boundTo: 7 });
    expect(out.craftedRecipeId).toBe('recipe_copper_bar');
    expect(out.slot).toBe(11);
    expect(out.materialSeparated).toBe(true);
    expectExactly(out.materialSources, [[SIGNED_BY_ALICE, 4]]);
  });

  it('retains a legacy OVER-CAP quantity intact, clamping nothing', () => {
    const out = normalized({ itemId: COPPER, count: 500 });

    expect(out.count).toBe(500);
    expectExactly(out.materialSources, [[UNRECORDED, 500]]);
  });

  it('is idempotent: normalizing a normalized stack changes nothing', () => {
    const once = normalized({ itemId: COPPER, count: 3, instance: { signer: 'Alice' } });
    const twice = normalized(once);

    expect(twice).toEqual(once);
  });

  it('deep-clones: mutating the output never reaches the input', () => {
    const slot: MaterialStackSlot = {
      itemId: COPPER,
      count: 2,
      instance: { rolled: { stats: { sta: 1 } } },
    };

    const out = normalized(slot);
    (out.instance?.rolled?.stats as Record<string, number>).sta = 99;

    expect(slot.instance?.rolled?.stats?.sta).toBe(1);
  });
});

describe('normalizeMaterialStack: canonicalizing an explicit composition', () => {
  it('validates the exact sum and canonicalizes duplicate descriptors', () => {
    const out = normalized(
      composed(COPPER, [
        { source: A, count: 2 },
        { source: B, count: 3 },
        { source: { gatherer: { kind: 'character', id: 101, name: 'Alice' } }, count: 4 },
      ]),
    );

    expect(out.count).toBe(9);
    expectExactly(out.materialSources, [
      [A, 6],
      [B, 3],
    ]);
  });

  it('canonicalizes an EMPTY payload to no payload, exactly as the legacy arm does', () => {
    const spelledOut = normalized(composed(COPPER, [{ source: A, count: 2 }], { instance: {} }));
    const explicitUndefined = normalized(
      composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: undefined } }),
    );

    expect(spelledOut.instance).toBeUndefined();
    expect('instance' in spelledOut).toBe(false);
    expect(explicitUndefined.instance).toBeUndefined();
    expect('instance' in explicitUndefined).toBe(false);
  });

  it('refuses a composition whose sum does not equal the held count, leaving the input unchanged', () => {
    const slot = composed(COPPER, [{ source: A, count: 2 }]);
    slot.count = 5;
    const before = structuredClone(slot);

    expect(errorOf(normalizeMaterialStack(slot, MATERIALS))).toBe('sum-mismatch');
    expect(slot).toEqual(before);
  });

  it('refuses a malformed descriptor rather than recording the units as unrecorded', () => {
    const slot = {
      itemId: COPPER,
      count: 2,
      materialSources: [{ source: { gatherer: { kind: 'sky', id: 1, name: 'Nobody' } }, count: 2 }],
    } as unknown as MaterialStackSlot;
    const before = structuredClone(slot);

    expect(errorOf(normalizeMaterialStack(slot, MATERIALS))).toBe('invalid-source');
    expect(slot).toEqual(before);
  });

  it('refuses an unknown bucket field rather than dropping it', () => {
    const slot = {
      itemId: COPPER,
      count: 2,
      materialSources: [{ source: A, count: 2, note: 'hand edited' }],
    } as unknown as MaterialStackSlot;

    expect(errorOf(normalizeMaterialStack(slot, MATERIALS))).toBe('unknown-field');
  });

  it('refuses a non-positive or non-integer held count', () => {
    expect(errorOf(normalizeMaterialStack({ itemId: COPPER, count: 0 }, MATERIALS))).toBe(
      'invalid-count',
    );
    expect(errorOf(normalizeMaterialStack({ itemId: COPPER, count: 2.5 }, MATERIALS))).toBe(
      'invalid-count',
    );
  });

  it('refuses an AMBIGUOUS stack carrying both a slot-level signer and an explicit composition, overwriting neither', () => {
    const slot = composed(COPPER, [{ source: B, count: 2 }], { instance: { signer: 'Alice' } });
    const before = structuredClone(slot);

    expect(errorOf(normalizeMaterialStack(slot, MATERIALS))).toBe('ambiguous-signer');
    expect(slot).toEqual(before);
  });

  it('refuses a NON-MATERIAL slot rather than modifying equipment', () => {
    const sword: MaterialStackSlot = { itemId: SWORD, count: 1, instance: { signer: 'Alice' } };
    const before = structuredClone(sword);

    expect(errorOf(normalizeMaterialStack(sword, MATERIALS))).toBe('not-material');
    expect(sword).toEqual(before);
  });
});

describe('compatibleMaterialStacks', () => {
  const compatible = (a: MaterialStackSlot, b: MaterialStackSlot): boolean =>
    ok(compatibleMaterialStacks(a, b, MATERIALS));

  it('stacks a legacy SIGNED stack of 3 with a legacy UNSIGNED stack of 5', () => {
    const signedA3: MaterialStackSlot = { itemId: COPPER, count: 3, instance: { signer: 'Alice' } };
    const unsignedB5: MaterialStackSlot = { itemId: COPPER, count: 5 };

    // Both normalize first, so the signature difference has already moved off
    // the payload and into the descriptors by the time identity is compared.
    expectExactly(normalized(signedA3).materialSources, [[SIGNED_BY_ALICE, 3]]);
    expectExactly(normalized(unsignedB5).materialSources, [[UNRECORDED, 5]]);
    expect(compatible(signedA3, unsignedB5)).toBe(true);
    expect(compatible(unsignedB5, signedA3)).toBe(true);
  });

  it('stacks gathered, other-gatherer and no-recorded-gatherer material together', () => {
    const gathered = composed(COPPER, [{ source: A, count: 4 }]);
    const otherGatherer = composed(COPPER, [{ source: B, count: 2 }]);
    const noGatherer = composed(COPPER, [{ source: UNRECORDED, count: 6 }]);

    expect(compatible(gathered, otherGatherer)).toBe(true);
    expect(compatible(gathered, noGatherer)).toBe(true);
    expect(compatible(otherGatherer, noGatherer)).toBe(true);
  });

  it('stacks equivalent stock whose EMPTY payload is spelled out on one side only', () => {
    // An empty payload and no payload are the same state, so the spelling must
    // not decide whether two otherwise identical stacks may share a slot.
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }], { instance: {} }),
        composed(COPPER, [{ source: B, count: 3 }]),
      ),
    ).toBe(true);
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: undefined } }),
        { itemId: COPPER, count: 4 },
      ),
    ).toBe(true);
  });

  it('does not treat counts or per-source quantities as identity', () => {
    const one = composed(COPPER, [{ source: A, count: 1 }]);
    const many = composed(COPPER, [
      { source: A, count: 40 },
      { source: B, count: 2 },
    ]);

    expect(compatible(one, many)).toBe(true);
  });

  it('refuses a different GRADE (a different material item id)', () => {
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }]),
        composed(IRON, [{ source: A, count: 2 }]),
      ),
    ).toBe(false);
  });

  it('refuses a BINDING mismatch', () => {
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: 7 } }),
        composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: 8 } }),
      ),
    ).toBe(false);
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: 7 } }),
        composed(COPPER, [{ source: A, count: 2 }]),
      ),
    ).toBe(false);
  });

  it('refuses a craftedRecipeId mismatch, in both directions', () => {
    const fromRecipe = composed(COPPER, [{ source: A, count: 2 }], {
      craftedRecipeId: 'recipe_copper_bar',
    });
    const fromOtherRecipe = composed(COPPER, [{ source: A, count: 2 }], {
      craftedRecipeId: 'recipe_copper_ingot',
    });
    const plain = composed(COPPER, [{ source: A, count: 2 }]);

    expect(compatible(fromRecipe, fromOtherRecipe)).toBe(false);
    expect(compatible(fromRecipe, plain)).toBe(false);
    expect(compatible(plain, fromRecipe)).toBe(false);
  });

  it('refuses an UNKNOWN persisted payload property present on only one side', () => {
    const withUnknown = composed(COPPER, [{ source: A, count: 2 }], {
      instance: { futureField: 3 } as unknown as ItemInstancePayload,
    });
    const without = composed(COPPER, [{ source: A, count: 2 }], { instance: { boundTo: 7 } });

    expect(compatible(withUnknown, without)).toBe(false);
  });

  it('refuses a CHARGE-bearing stack, which stays one per slot', () => {
    const charged = composed(COPPER, [{ source: A, count: 2 }], {
      instance: { charges: { drain: 3 } },
    });
    const twin = composed(COPPER, [{ source: A, count: 2 }], {
      instance: { charges: { drain: 3 } },
    });

    // Even a byte-identical twin refuses: charges are per-unit state a shared
    // payload cannot represent.
    expect(compatible(charged, twin)).toBe(false);
    expect(compatible(charged, composed(COPPER, [{ source: A, count: 2 }]))).toBe(false);
  });

  it('refuses a LOCKED stack, which stays one per slot', () => {
    const locked = composed(COPPER, [{ source: A, count: 2 }], { instance: { locked: true } });
    const lockedTwin = composed(COPPER, [{ source: A, count: 2 }], { instance: { locked: true } });

    expect(compatible(locked, lockedTwin)).toBe(false);
    expect(compatible(locked, composed(COPPER, [{ source: A, count: 2 }]))).toBe(false);
  });

  it('refuses an automatic merge when EITHER side is manually separated', () => {
    const separated = composed(COPPER, [{ source: A, count: 2 }], { materialSeparated: true });
    const ordinary = composed(COPPER, [{ source: A, count: 2 }]);

    expect(compatible(separated, ordinary)).toBe(false);
    expect(compatible(ordinary, separated)).toBe(false);
    expect(compatible(separated, separated)).toBe(false);
    // The grouping is the ONLY difference: without it these two stack.
    expect(compatible(ordinary, ordinary)).toBe(true);
  });

  it('ignores the owner bag CELL, which is arrangement rather than identity', () => {
    expect(
      compatible(
        composed(COPPER, [{ source: A, count: 2 }], { slot: 3 }),
        composed(COPPER, [{ source: A, count: 2 }], { slot: 9 }),
      ),
    ).toBe(true);
  });

  it('propagates a normalization refusal instead of answering "incompatible"', () => {
    const sword: MaterialStackSlot = { itemId: SWORD, count: 1 };
    const copper = composed(COPPER, [{ source: A, count: 2 }]);

    expect(errorOf(compatibleMaterialStacks(sword, copper, MATERIALS))).toBe('not-material');
    expect(errorOf(compatibleMaterialStacks(copper, sword, MATERIALS))).toBe('not-material');
  });
});

describe('takeMaterialStack', () => {
  const stock = (extra: Partial<MaterialStackSlot> = {}): MaterialStackSlot =>
    composed(
      COPPER,
      [
        { source: A, count: 5 },
        { source: B, count: 3 },
        { source: UNRECORDED, count: 2 },
      ],
      extra,
    );

  it('takes EXACTLY the selected B2, leaving A5/B1/unrecorded2 behind', () => {
    const take = ok(takeMaterialStack(stock(), 2, MATERIALS, [{ source: B, count: 2 }]));

    expect(take.taken.count).toBe(2);
    expectExactly(take.taken.materialSources, [[B, 2]]);
    expect(take.remaining?.count).toBe(8);
    expectExactly(take.remaining?.materialSources, [
      [A, 5],
      [B, 1],
      [UNRECORDED, 2],
    ]);
  });

  it('spends unrecorded material first on a DEFAULT take, never the premium units', () => {
    const signed: MaterialSource = { signer: 'Alice' };
    const slot = composed(COPPER, [
      { source: signed, count: 3 },
      { source: A, count: 2 },
      { source: UNRECORDED, count: 4 },
    ]);

    const take = ok(takeMaterialStack(slot, 5, MATERIALS));

    expectExactly(take.taken.materialSources, [
      [UNRECORDED, 4],
      [A, 1],
    ]);
    expectExactly(take.remaining?.materialSources, [
      [signed, 3],
      [A, 1],
    ]);
  });

  it('strips the owner grouping from the transfer while the remainder keeps it', () => {
    const owned = stock({ slot: 4, materialSeparated: true, craftedRecipeId: 'recipe_x' });
    const take = ok(takeMaterialStack(owned, 3, MATERIALS));

    expect(take.taken.slot).toBeUndefined();
    expect(take.taken.materialSeparated).toBeUndefined();
    expect('slot' in take.taken).toBe(false);
    expect('materialSeparated' in take.taken).toBe(false);
    // The identity the copy carries with it is untouched.
    expect(take.taken.craftedRecipeId).toBe('recipe_x');

    expect(take.remaining?.slot).toBe(4);
    expect(take.remaining?.materialSeparated).toBe(true);
    expect(take.remaining?.craftedRecipeId).toBe('recipe_x');
  });

  it('carries the exact payload onto the transfer and keeps a copy on the remainder', () => {
    const take = ok(
      takeMaterialStack(stock({ instance: { rolled: { stats: { sta: 2 } } } }), 4, MATERIALS),
    );

    expect(take.taken.instance).toEqual({ rolled: { stats: { sta: 2 } } });
    expect(take.remaining?.instance).toEqual({ rolled: { stats: { sta: 2 } } });
  });

  it('returns a null remainder when the whole stack is taken', () => {
    const take = ok(takeMaterialStack(stock(), 10, MATERIALS));

    expect(take.remaining).toBeNull();
    expect(take.taken.count).toBe(10);
    expectExactly(take.taken.materialSources, [
      [A, 5],
      [B, 3],
      [UNRECORDED, 2],
    ]);
  });

  it('normalizes a legacy stack first, so a legacy take is recorded rather than lost', () => {
    const take = ok(
      takeMaterialStack({ itemId: COPPER, count: 6, instance: { signer: 'Alice' } }, 2, MATERIALS),
    );

    expectExactly(take.taken.materialSources, [[SIGNED_BY_ALICE, 2]]);
    expectExactly(take.remaining?.materialSources, [[SIGNED_BY_ALICE, 4]]);
    expect(take.taken.instance).toBeUndefined();
    expect(take.remaining?.instance).toBeUndefined();
  });

  it('refuses a selection whose total does not equal the requested quantity, atomically', () => {
    const slot = stock();
    const before = structuredClone(slot);

    expect(errorOf(takeMaterialStack(slot, 3, MATERIALS, [{ source: B, count: 2 }]))).toBe(
      'sum-mismatch',
    );
    expect(slot).toEqual(before);
  });

  it('refuses a selection asking for more of a descriptor than the stack holds', () => {
    expect(errorOf(takeMaterialStack(stock(), 5, MATERIALS, [{ source: B, count: 5 }]))).toBe(
      'insufficient',
    );
  });

  it('refuses a quantity that is not a positive safe integer, or exceeds what is held', () => {
    expect(errorOf(takeMaterialStack(stock(), 0, MATERIALS))).toBe('invalid-quantity');
    expect(errorOf(takeMaterialStack(stock(), -1, MATERIALS))).toBe('invalid-quantity');
    expect(errorOf(takeMaterialStack(stock(), 1.5, MATERIALS))).toBe('invalid-quantity');
    expect(errorOf(takeMaterialStack(stock(), Number.MAX_SAFE_INTEGER + 2, MATERIALS))).toBe(
      'invalid-quantity',
    );
    expect(errorOf(takeMaterialStack(stock(), 11, MATERIALS))).toBe('insufficient');
  });

  it('refuses a non-material slot and an unnormalizable one', () => {
    expect(errorOf(takeMaterialStack({ itemId: SWORD, count: 4 }, 1, MATERIALS))).toBe(
      'not-material',
    );
    const ambiguous = composed(COPPER, [{ source: B, count: 2 }], {
      instance: { signer: 'Alice' },
    });
    expect(errorOf(takeMaterialStack(ambiguous, 1, MATERIALS))).toBe('ambiguous-signer');
  });

  it('returns deep-independent halves: neither output aliases the input or each other', () => {
    const slot = stock({ instance: { rolled: { stats: { sta: 2 } } } });
    const take = ok(takeMaterialStack(slot, 4, MATERIALS));
    const taken = take.taken;
    const remaining = take.remaining;
    if (remaining === null) throw new Error('expected a remainder');

    (taken.instance?.rolled?.stats as Record<string, number>).sta = 99;
    (taken.materialSources as unknown as { count: number }[])[0].count = 999;

    expect(slot.instance?.rolled?.stats?.sta).toBe(2);
    expect(remaining.instance?.rolled?.stats?.sta).toBe(2);
    expect(slot.count).toBe(10);
    expectExactly(slot.materialSources, [
      [A, 5],
      [B, 3],
      [UNRECORDED, 2],
    ]);
    expect(remaining.materialSources?.some((e) => e.count === 999)).toBe(false);
  });
});

describe('unknown NESTED payload properties', () => {
  // The shared cloneItemInstancePayload deep-copies only the payload fields it
  // knows, so a persisted field this model has never heard of would otherwise
  // stay aliased between the caller's slot and every slot returned here.
  const compatible = (a: MaterialStackSlot, b: MaterialStackSlot): boolean =>
    ok(compatibleMaterialStacks(a, b, MATERIALS));

  const legacyStock = (): MaterialStackSlot => ({
    itemId: COPPER,
    count: 3,
    instance: withUnknownNested(),
  });

  it('preserves the whole nested value verbatim: no dropped key, no coerced type', () => {
    const out = normalized(legacyStock());

    expect(out.instance).toEqual({
      boundTo: 7,
      provenance: { entries: [{ note: 'gathered', at: 12 }], flags: { audited: false, tag: null } },
    });
    expect(typeof entriesOf(out.instance)[0].at).toBe('number');
    expect(typeof entriesOf(out.instance)[0].note).toBe('string');
    expect(flagsOf(out.instance).audited).toBe(false);
    expect(flagsOf(out.instance).tag).toBeNull();
  });

  it('normalize returns a nested copy neither side can reach through', () => {
    const slot = legacyStock();
    const out = normalized(slot);

    flagsOf(out.instance).audited = true;
    entriesOf(out.instance)[0].note = 'edited';

    expect(flagsOf(slot.instance).audited).toBe(false);
    expect(entriesOf(slot.instance)[0].note).toBe('gathered');

    // And the other direction: a later caller edit cannot reach the output.
    flagsOf(slot.instance).tag = 'moved';
    expect(flagsOf(out.instance).tag).toBeNull();
  });

  it('hands the transfer and the remainder independent nested copies', () => {
    const slot = composed(
      COPPER,
      [
        { source: UNRECORDED, count: 2 },
        { source: A, count: 6 },
      ],
      { instance: withUnknownNested() },
    );

    const take = ok(takeMaterialStack(slot, 2, MATERIALS));
    const remaining = take.remaining;
    if (remaining === null) throw new Error('expected a remainder');
    expect(nestedOf(take.taken.instance)).toEqual(nestedOf(remaining.instance));

    entriesOf(take.taken.instance)[0].note = 'taken edit';
    flagsOf(remaining.instance).audited = true;

    expect(entriesOf(remaining.instance)[0].note).toBe('gathered');
    expect(flagsOf(take.taken.instance).audited).toBe(false);
    expect(entriesOf(slot.instance)[0].note).toBe('gathered');
    expect(flagsOf(slot.instance).audited).toBe(false);

    // The counts and the composition stay authoritative through all of it:
    // the default take spends the unrecorded units first.
    expect(take.taken.count).toBe(2);
    expect(remaining.count).toBe(6);
    expectExactly(take.taken.materialSources, [[UNRECORDED, 2]]);
    expectExactly(remaining.materialSources, [[A, 6]]);
  });

  // An own '__proto__' key is ordinary JSON data (JSON.parse mints one; an
  // object literal cannot, which is why every fixture below is parsed). A copy
  // built by assignment would hand it to Object.prototype's setter instead: the
  // key disappears from the copy and the copy's prototype changes with it.
  const ownProto = (payload: ItemInstancePayload | undefined): Record<string, unknown> => {
    const descriptor = Object.getOwnPropertyDescriptor(payload as unknown as object, '__proto__');
    if (descriptor === undefined) throw new Error('expected an own "__proto__" key');
    return descriptor.value as Record<string, unknown>;
  };

  it('keeps an own "__proto__" key as an own data property, at every record level', () => {
    const raw =
      '{"boundTo":7,"__proto__":{"polluted":true},"provenance":{"note":"keep","__proto__":{"deep":1}}}';
    const slot: MaterialStackSlot = {
      itemId: COPPER,
      count: 4,
      instance: JSON.parse(raw) as ItemInstancePayload,
    };

    const out = normalized(slot);
    const instance = out.instance as unknown as Record<string, unknown>;
    const provenance = nestedOf(out.instance);

    // Top level: still an own key, in place, with an ordinary prototype and
    // nothing from the JSON value showing through as an inherited field.
    expect(Object.keys(instance)).toEqual(['boundTo', '__proto__', 'provenance']);
    expect(Object.getPrototypeOf(instance)).toBe(Object.prototype);
    expect(ownProto(out.instance)).toEqual(JSON.parse('{"polluted":true}'));
    expect(instance.polluted).toBeUndefined();

    // Nested record level: the same, one walk deeper.
    expect(Object.keys(provenance)).toEqual(['note', '__proto__']);
    expect(Object.getPrototypeOf(provenance)).toBe(Object.prototype);
    expect(
      Object.getOwnPropertyDescriptor(provenance, '__proto__')?.value as Record<string, unknown>,
    ).toEqual(JSON.parse('{"deep":1}'));
    expect(provenance.deep).toBeUndefined();

    // And nothing leaked onto every other object in the process.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('hands a take independent copies of an own "__proto__" payload key', () => {
    const raw = '{"boundTo":7,"__proto__":{"polluted":true}}';
    const slot = composed(
      COPPER,
      [
        { source: UNRECORDED, count: 1 },
        { source: A, count: 3 },
      ],
      { instance: JSON.parse(raw) as ItemInstancePayload },
    );

    const take = ok(takeMaterialStack(slot, 1, MATERIALS));
    const remaining = take.remaining;
    if (remaining === null) throw new Error('expected a remainder');

    expect(ownProto(take.taken.instance)).toEqual(ownProto(remaining.instance));
    expect(Object.getPrototypeOf(take.taken.instance as unknown as object)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(remaining.instance as unknown as object)).toBe(Object.prototype);

    ownProto(take.taken.instance).polluted = 'edited';

    expect(ownProto(remaining.instance).polluted).toBe(true);
    expect(ownProto(slot.instance).polluted).toBe(true);
    expect(take.taken.count).toBe(1);
    expect(remaining.count).toBe(3);
    expectExactly(take.taken.materialSources, [[UNRECORDED, 1]]);
    expectExactly(remaining.materialSources, [[A, 3]]);
  });

  it('compares an own "__proto__" key structurally, like any other unknown key', () => {
    const carrying = (): MaterialStackSlot =>
      composed(COPPER, [{ source: A, count: 2 }], {
        instance: JSON.parse('{"__proto__":{"polluted":true}}') as ItemInstancePayload,
      });
    const differing = composed(COPPER, [{ source: B, count: 3 }], {
      instance: JSON.parse('{"__proto__":{"polluted":false}}') as ItemInstancePayload,
    });
    const without = composed(COPPER, [{ source: B, count: 3 }]);

    expect(compatible(carrying(), carrying())).toBe(true);
    expect(compatible(carrying(), differing)).toBe(false);
    expect(compatible(carrying(), without)).toBe(false);
  });

  it('compares nested unknown data structurally when deciding a merge', () => {
    const a = composed(COPPER, [{ source: A, count: 2 }], { instance: withUnknownNested() });
    const twin = composed(COPPER, [{ source: B, count: 3 }], { instance: withUnknownNested() });
    const deepDifference = composed(COPPER, [{ source: B, count: 3 }], {
      instance: withUnknownNested(),
    });
    flagsOf(deepDifference.instance).audited = true;

    expect(compatible(a, twin)).toBe(true);
    expect(compatible(a, deepDifference)).toBe(false);
  });
});
