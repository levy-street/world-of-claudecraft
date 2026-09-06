// The canonical source-count algebra (src/sim/material_sources.ts): every case
// asserts EXACT per-source quantities, never a bare sum, because a collapse
// that keeps the total right is exactly the defect this core exists to stop.
//
// Expectations are written as literal descriptor/count pairs and looked up by
// descriptor identity (sameSource below), so no test re-derives the module's
// canonical key or its coalescing order.

import { describe, expect, it } from 'vitest';
import {
  applyMaterialSourceDeltas,
  canonicalMaterialComposition,
  diffMaterialCompositions,
  isPremiumMaterialSource,
  legacyMaterialComposition,
  type MaterialComposition,
  type MaterialGatherer,
  type MaterialSource,
  type MaterialSourceCount,
  type MaterialSourceResult,
  materialSourceKey,
  mergeMaterialCompositions,
  takeMaterialCount,
  takeSelectedMaterialSources,
  totalMaterialCount,
} from '../src/sim/material_sources';

const alice: MaterialGatherer = { kind: 'character', id: 101, name: 'Alice' };
const bob: MaterialGatherer = { kind: 'character', id: 202, name: 'Bob' };
const cara: MaterialGatherer = { kind: 'character', id: 303, name: 'Cara' };

const A: MaterialSource = { gatherer: alice };
const B: MaterialSource = { gatherer: bob };
const C: MaterialSource = { gatherer: cara };
const UNRECORDED: MaterialSource = {};

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
  composition: MaterialComposition,
  expected: readonly (readonly [MaterialSource, number])[],
): void => {
  expect(composition.length).toBe(expected.length);
  for (const [source, count] of expected) expect(countOf(composition, source)).toBe(count);
};

const ok = <T>(result: MaterialSourceResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
};

const errorOf = (result: MaterialSourceResult<unknown>): string => {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

const built = (entries: readonly MaterialSourceCount[]): MaterialComposition =>
  ok(
    canonicalMaterialComposition(
      entries,
      entries.reduce((n, e) => n + e.count, 0),
    ),
  );

describe('canonical composition validation', () => {
  it('accepts an exact total and coalesces duplicate descriptors', () => {
    const composition = ok(
      canonicalMaterialComposition(
        [
          { source: A, count: 2 },
          { source: B, count: 3 },
          { source: { gatherer: { kind: 'character', id: 101, name: 'Alice' } }, count: 4 },
        ],
        9,
      ),
    );
    expectExactly(composition, [
      [A, 6],
      [B, 3],
    ]);
  });

  it('is independent of property order in the input descriptors', () => {
    const first = built([{ source: { gatherer: alice, signer: 'Alice' }, count: 2 }]);
    const second = built([{ source: { signer: 'Alice', gatherer: alice }, count: 2 }]);
    expect(second).toEqual(first);
    expect(materialSourceKey(second[0].source)).toBe(materialSourceKey(first[0].source));
  });

  it('produces a stable canonical order regardless of input order', () => {
    const forward = built([
      { source: A, count: 1 },
      { source: B, count: 2 },
      { source: UNRECORDED, count: 3 },
    ]);
    const reversed = built([
      { source: UNRECORDED, count: 3 },
      { source: B, count: 2 },
      { source: A, count: 1 },
    ]);
    expect(reversed).toEqual(forward);
  });

  it('rejects a composition whose buckets do not sum to the stack quantity', () => {
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: 4 }], 5))).toBe(
      'sum-mismatch',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: 6 }], 5))).toBe(
      'sum-mismatch',
    );
  });

  it('accepts the empty composition only for a total of zero', () => {
    expect(ok(canonicalMaterialComposition([], 0))).toEqual([]);
    expect(errorOf(canonicalMaterialComposition([], 3))).toBe('sum-mismatch');
  });

  it('refuses malformed counts instead of clamping or relabelling them', () => {
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: 1.5 }], 1.5))).toBe(
      'invalid-count',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: Number.NaN }], 1))).toBe(
      'invalid-count',
    );
    expect(
      errorOf(canonicalMaterialComposition([{ source: A, count: Number.POSITIVE_INFINITY }], 1)),
    ).toBe('invalid-count');
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: 0 }], 0))).toBe(
      'invalid-count',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: -2 }], -2))).toBe(
      'invalid-count',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: '3' }], 3))).toBe(
      'invalid-count',
    );
  });

  it('refuses unknown entry, descriptor and gatherer fields', () => {
    expect(errorOf(canonicalMaterialComposition([{ source: A, count: 1, note: 'x' }], 1))).toBe(
      'unknown-field',
    );
    expect(
      errorOf(canonicalMaterialComposition([{ source: { ...A, version: 2 }, count: 1 }], 1)),
    ).toBe('unknown-field');
    expect(
      errorOf(
        canonicalMaterialComposition(
          [{ source: { gatherer: { ...alice, realm: 'x' } }, count: 1 }],
          1,
        ),
      ),
    ).toBe('unknown-field');
  });

  it('refuses a descriptor that is not an object at all', () => {
    expect(errorOf(canonicalMaterialComposition([{ source: null, count: 1 }], 1))).toBe(
      'invalid-source',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: 'alice', count: 1 }], 1))).toBe(
      'invalid-source',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: [], count: 1 }], 1))).toBe(
      'invalid-source',
    );
    expect(errorOf(canonicalMaterialComposition({ source: A, count: 1 }, 1))).toBe(
      'invalid-source',
    );
  });

  it('refuses an exotic prototype where an ordinary record is required', () => {
    class FakeSource {
      gatherer = alice;
    }
    class FakeGatherer {
      kind = 'character';
      id = 101;
      name = 'Alice';
    }
    expect(errorOf(canonicalMaterialComposition([new Date(0)], 1))).toBe('invalid-source');
    expect(errorOf(canonicalMaterialComposition([{ source: new Date(0), count: 1 }], 1))).toBe(
      'invalid-source',
    );
    expect(errorOf(canonicalMaterialComposition([{ source: new FakeSource(), count: 1 }], 1))).toBe(
      'invalid-source',
    );
    expect(
      errorOf(canonicalMaterialComposition([{ source: { gatherer: new Date(0) }, count: 1 }], 1)),
    ).toBe('invalid-source');
    expect(
      errorOf(
        canonicalMaterialComposition([{ source: { gatherer: new FakeGatherer() }, count: 1 }], 1),
      ),
    ).toBe('invalid-source');
    expect(errorOf(canonicalMaterialComposition([{ source: new Map(), count: 1 }], 1))).toBe(
      'invalid-source',
    );
  });

  it('accepts null-prototype records, the shape parsed data really arrives in', () => {
    const bareGatherer = Object.assign(Object.create(null), alice);
    const bareSource = Object.assign(Object.create(null), { gatherer: bareGatherer });
    const bareEntry = Object.assign(Object.create(null), { source: bareSource, count: 2 });
    expectExactly(ok(canonicalMaterialComposition([bareEntry], 2)), [[A, 2]]);
  });

  it('bounds the character gatherer id to a positive safe integer', () => {
    const withId = (id: unknown) =>
      errorOf(
        canonicalMaterialComposition(
          [{ source: { gatherer: { kind: 'character', id, name: 'Alice' } }, count: 1 }],
          1,
        ),
      );
    expect(withId(0)).toBe('invalid-source');
    expect(withId(-4)).toBe('invalid-source');
    expect(withId(7.5)).toBe('invalid-source');
    expect(withId(Number.MAX_SAFE_INTEGER + 2)).toBe('invalid-source');
    expect(withId('101')).toBe('invalid-source');
  });

  it('bounds a host-supplied offline or headless id to 64 printable ASCII bytes', () => {
    const withId = (kind: string, id: unknown) =>
      canonicalMaterialComposition(
        [{ source: { gatherer: { kind, id, name: 'Host' } }, count: 1 }],
        1,
      );
    expect(ok(withId('offline', 'x'.repeat(64)))[0].count).toBe(1);
    expect(ok(withId('headless', 'env-7'))[0].count).toBe(1);
    expect(errorOf(withId('offline', 'x'.repeat(65)))).toBe('invalid-source');
    expect(errorOf(withId('offline', ''))).toBe('invalid-source');
    expect(errorOf(withId('offline', 'tab\tid'))).toBe('invalid-source');
    expect(errorOf(withId('offline', `caf${String.fromCharCode(233)}`))).toBe('invalid-source');
    expect(errorOf(withId('offline', 12))).toBe('invalid-source');
    expect(errorOf(withId('entity', 'e1'))).toBe('invalid-source');
  });

  it('requires a nonempty legal name snapshot on every gatherer', () => {
    const withName = (name: unknown) =>
      canonicalMaterialComposition(
        [{ source: { gatherer: { kind: 'character', id: 5, name } }, count: 1 }],
        1,
      );
    expect(ok(withName('Sixteen Chars Ok'))[0].count).toBe(1);
    expect(errorOf(withName(''))).toBe('invalid-source');
    expect(errorOf(withName('Seventeen Chars!!'))).toBe('invalid-source');
    expect(errorOf(withName(`Bad${String.fromCharCode(233)}`))).toBe('invalid-source');
    expect(errorOf(withName(undefined))).toBe('invalid-source');
  });

  it('keeps a legal signer and refuses one no legal mint could have stamped', () => {
    expect(
      ok(canonicalMaterialComposition([{ source: { signer: 'Oldsmith' }, count: 1 }], 1)),
    ).toEqual([{ source: { signer: 'Oldsmith' }, count: 1 }]);
    expect(
      errorOf(canonicalMaterialComposition([{ source: { signer: 'x'.repeat(17) }, count: 1 }], 1)),
    ).toBe('invalid-source');
    expect(errorOf(canonicalMaterialComposition([{ source: { signer: 5 }, count: 1 }], 1))).toBe(
      'invalid-source',
    );
  });

  it('detects cumulative overflow rather than reporting an unsafe total', () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 4;
    expect(
      errorOf(
        canonicalMaterialComposition(
          [
            { source: A, count: half },
            { source: B, count: half },
          ],
          half * 2,
        ),
      ),
    ).toBe('count-overflow');
  });
});

describe('legacy projection', () => {
  it('projects a legacy signed stack onto a signer descriptor, never a fabricated gatherer', () => {
    const composition = ok(legacyMaterialComposition(4, 'Oldsmith'));
    expect(composition).toEqual([{ source: { signer: 'Oldsmith' }, count: 4 }]);
    expect(composition[0].source.gatherer).toBeUndefined();
    expect(isPremiumMaterialSource(composition[0].source)).toBe(true);
  });

  it('projects unsigned legacy stock onto the empty descriptor', () => {
    const composition = ok(legacyMaterialComposition(3));
    expect(composition).toEqual([{ source: {}, count: 3 }]);
    expect(isPremiumMaterialSource(composition[0].source)).toBe(false);
  });

  it('keeps an empty-string signer as its own descriptor that is not premium', () => {
    const empty = ok(legacyMaterialComposition(2, ''));
    expect(empty[0].source.signer).toBe('');
    expect(isPremiumMaterialSource(empty[0].source)).toBe(false);
    const merged = ok(mergeMaterialCompositions(empty, ok(legacyMaterialComposition(1))));
    expectExactly(merged, [
      [{ signer: '' }, 2],
      [UNRECORDED, 1],
    ]);
  });

  it('projects a zero-count legacy stack onto the empty composition', () => {
    expect(ok(legacyMaterialComposition(0, 'Oldsmith'))).toEqual([]);
  });

  it('refuses a legacy count or signer no legal stack could carry', () => {
    expect(errorOf(legacyMaterialComposition(-1))).toBe('invalid-count');
    expect(errorOf(legacyMaterialComposition(2.5))).toBe('invalid-count');
    expect(errorOf(legacyMaterialComposition(1, 'x'.repeat(17)))).toBe('invalid-source');
  });
});

describe('descriptor distinctness', () => {
  it('never collapses two stable ids sharing a display name', () => {
    const twin: MaterialGatherer = { kind: 'character', id: 999, name: 'Alice' };
    const composition = built([
      { source: A, count: 2 },
      { source: { gatherer: twin }, count: 3 },
    ]);
    expectExactly(composition, [
      [A, 2],
      [{ gatherer: twin }, 3],
    ]);
  });

  it('never collapses two historic name snapshots of one stable id', () => {
    const renamed: MaterialGatherer = { kind: 'character', id: 101, name: 'Alicia' };
    const composition = built([
      { source: A, count: 2 },
      { source: { gatherer: renamed }, count: 5 },
    ]);
    expectExactly(composition, [
      [A, 2],
      [{ gatherer: renamed }, 5],
    ]);
  });

  it('never collapses premium and plain material from the same gatherer', () => {
    const signed: MaterialSource = { gatherer: alice, signer: 'Alice' };
    const composition = built([
      { source: A, count: 4 },
      { source: signed, count: 1 },
    ]);
    expectExactly(composition, [
      [A, 4],
      [signed, 1],
    ]);
    expect(isPremiumMaterialSource(signed)).toBe(true);
    expect(isPremiumMaterialSource(A)).toBe(false);
  });

  it('encodes descriptor fields unambiguously in the canonical key', () => {
    const split = materialSourceKey({ gatherer: { kind: 'offline', id: 'a', name: 'bc' } });
    const shifted = materialSourceKey({ gatherer: { kind: 'offline', id: 'ab', name: 'c' } });
    expect(split).not.toBe(shifted);
    const signerOnly = materialSourceKey({ signer: 'Ann' });
    const nameOnly = materialSourceKey({ gatherer: { kind: 'offline', id: 'Ann', name: 'Ann' } });
    expect(signerOnly).not.toBe(nameOnly);
  });
});

describe('merging and taking', () => {
  it('keeps exact source quantities through an add and a selected take', () => {
    const start = built([
      { source: A, count: 5 },
      { source: B, count: 3 },
      { source: UNRECORDED, count: 2 },
    ]);
    const added = ok(mergeMaterialCompositions(start, built([{ source: C, count: 1 }])));
    expect(totalMaterialCount(added)).toBe(11);

    const take = ok(takeSelectedMaterialSources(added, [{ source: B, count: 2 }]));
    expectExactly(take.taken, [[B, 2]]);
    expectExactly(take.remaining, [
      [A, 5],
      [B, 1],
      [C, 1],
      [UNRECORDED, 2],
    ]);
    expect(totalMaterialCount(take.remaining)).toBe(9);
  });

  it('spends unrecorded material first, then other plain material, then premium', () => {
    const signed: MaterialSource = { gatherer: alice, signer: 'Alice' };
    const composition = built([
      { source: signed, count: 2 },
      { source: B, count: 2 },
      { source: UNRECORDED, count: 2 },
    ]);
    const first = ok(takeMaterialCount(composition, 3));
    expectExactly(first.taken, [
      [UNRECORDED, 2],
      [B, 1],
    ]);
    const second = ok(takeMaterialCount(first.remaining, 3));
    expectExactly(second.taken, [
      [B, 1],
      [signed, 2],
    ]);
    expectExactly(second.remaining, []);
  });

  it('breaks a default-take tie the same way whatever order the buckets arrived in', () => {
    const forward = built([
      { source: A, count: 1 },
      { source: B, count: 1 },
    ]);
    const reversed = built([
      { source: B, count: 1 },
      { source: A, count: 1 },
    ]);
    expect(ok(takeMaterialCount(reversed, 1))).toEqual(ok(takeMaterialCount(forward, 1)));
  });

  it('takes nothing for a zero request and leaves the composition whole', () => {
    const composition = built([{ source: A, count: 3 }]);
    const take = ok(takeMaterialCount(composition, 0));
    expect(take.taken).toEqual([]);
    expect(take.remaining).toEqual(composition);
  });

  it('never substitutes another source for a selected one that is short', () => {
    const composition = built([
      { source: A, count: 5 },
      { source: B, count: 1 },
    ]);
    expect(errorOf(takeSelectedMaterialSources(composition, [{ source: B, count: 2 }]))).toBe(
      'insufficient',
    );
    expect(errorOf(takeSelectedMaterialSources(composition, [{ source: C, count: 1 }]))).toBe(
      'insufficient',
    );
  });

  it('combines duplicate selections of one descriptor into a single demand', () => {
    const composition = built([{ source: A, count: 3 }]);
    const take = ok(
      takeSelectedMaterialSources(composition, [
        { source: A, count: 1 },
        { source: { gatherer: { kind: 'character', id: 101, name: 'Alice' } }, count: 1 },
      ]),
    );
    expectExactly(take.taken, [[A, 2]]);
    expectExactly(take.remaining, [[A, 1]]);
  });

  it('refuses a default take larger than the stack without touching it', () => {
    const composition = built([{ source: A, count: 2 }]);
    expect(errorOf(takeMaterialCount(composition, 3))).toBe('insufficient');
    expectExactly(composition, [[A, 2]]);
  });

  it('refuses a merge whose combined bucket would leave the safe integer range', () => {
    const near = Number.MAX_SAFE_INTEGER - 1;
    const left = built([{ source: A, count: near }]);
    const right = built([{ source: A, count: 4 }]);
    expect(errorOf(mergeMaterialCompositions(left, right))).toBe('count-overflow');
    expectExactly(left, [[A, near]]);
    expectExactly(right, [[A, 4]]);
  });

  it('refuses a merge whose TOTAL overflows across distinct sources', () => {
    // Every bucket stays inside the safe range; only the sum leaves it, which
    // a per-bucket check alone cannot see.
    const left = built([{ source: UNRECORDED, count: Number.MAX_SAFE_INTEGER }]);
    const right = built([{ source: { signer: 'A' }, count: 1 }]);
    const leftSnapshot = structuredClone(left);
    const rightSnapshot = structuredClone(right);
    expect(errorOf(mergeMaterialCompositions(left, right))).toBe('count-overflow');
    expect(left).toEqual(leftSnapshot);
    expect(right).toEqual(rightSnapshot);
  });

  it('still merges up to the safe ceiling exactly', () => {
    const left = built([{ source: UNRECORDED, count: Number.MAX_SAFE_INTEGER - 1 }]);
    const right = built([{ source: { signer: 'A' }, count: 1 }]);
    const merged = ok(mergeMaterialCompositions(left, right));
    expectExactly(merged, [
      [UNRECORDED, Number.MAX_SAFE_INTEGER - 1],
      [{ signer: 'A' }, 1],
    ]);
    expect(totalMaterialCount(merged)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('signed deltas', () => {
  it('survives a mixed net-zero move and restores exact state through the inverse', () => {
    const before = built([
      { source: A, count: 3 },
      { source: B, count: 2 },
    ]);
    const after = built([
      { source: A, count: 4 },
      { source: B, count: 1 },
    ]);
    const deltas = ok(diffMaterialCompositions(before, after));
    expect(deltas.length).toBe(2);
    expect(deltas.every((d) => d.count !== 0)).toBe(true);
    expect(countOf(deltas, A)).toBe(1);
    expect(countOf(deltas, B)).toBe(-1);
    expect(totalMaterialCount(before)).toBe(totalMaterialCount(after));

    expect(ok(applyMaterialSourceDeltas(before, deltas))).toEqual(after);
    const inverse = deltas.map((d) => ({ source: d.source, count: -d.count }));
    expect(ok(applyMaterialSourceDeltas(after, inverse))).toEqual(before);
  });

  it('reports a one-unit top-up as a one-unit delta, not a whole-stack rewrite', () => {
    const before = built([
      { source: A, count: 20 },
      { source: B, count: 20 },
    ]);
    const after = ok(mergeMaterialCompositions(before, built([{ source: C, count: 1 }])));
    expect(ok(diffMaterialCompositions(before, after))).toEqual([{ source: C, count: 1 }]);
  });

  it('reports no delta between equal compositions', () => {
    const before = built([{ source: A, count: 2 }]);
    const after = built([{ source: A, count: 2 }]);
    expect(ok(diffMaterialCompositions(before, after))).toEqual([]);
  });

  it('refuses a delta that would drive a bucket negative and leaves the input intact', () => {
    const composition = built([
      { source: A, count: 2 },
      { source: B, count: 1 },
    ]);
    const snapshot = structuredClone(composition);
    expect(errorOf(applyMaterialSourceDeltas(composition, [{ source: A, count: -3 }]))).toBe(
      'negative-result',
    );
    expect(errorOf(applyMaterialSourceDeltas(composition, [{ source: C, count: -1 }]))).toBe(
      'negative-result',
    );
    expect(composition).toEqual(snapshot);
  });

  it('applies a multi-bucket delta atomically, so one bad leg voids the whole move', () => {
    const composition = built([
      { source: A, count: 2 },
      { source: B, count: 2 },
    ]);
    const snapshot = structuredClone(composition);
    expect(
      errorOf(
        applyMaterialSourceDeltas(composition, [
          { source: A, count: 3 },
          { source: B, count: -5 },
        ]),
      ),
    ).toBe('negative-result');
    expect(composition).toEqual(snapshot);
  });

  it('refuses a delta whose resulting TOTAL overflows across distinct keys', () => {
    const composition = built([{ source: UNRECORDED, count: Number.MAX_SAFE_INTEGER }]);
    const snapshot = structuredClone(composition);
    expect(
      errorOf(applyMaterialSourceDeltas(composition, [{ source: { signer: 'A' }, count: 1 }])),
    ).toBe('count-overflow');
    expect(composition).toEqual(snapshot);
  });

  it('accepts a balanced move at the safe ceiling, in either leg order', () => {
    // The result total is unchanged, so nothing here overflows: a check that
    // accumulated the signed legs in the wrong order would reject it.
    const composition = built([{ source: UNRECORDED, count: Number.MAX_SAFE_INTEGER }]);
    const legs = [
      { source: UNRECORDED, count: -1 },
      { source: { signer: 'A' }, count: 1 },
    ];
    const expected: readonly (readonly [MaterialSource, number])[] = [
      [UNRECORDED, Number.MAX_SAFE_INTEGER - 1],
      [{ signer: 'A' }, 1],
    ];
    expectExactly(ok(applyMaterialSourceDeltas(composition, legs)), expected);
    expectExactly(ok(applyMaterialSourceDeltas(composition, [...legs].reverse())), expected);
  });

  it('drops a bucket the delta empties and refuses a zero-count delta entry', () => {
    const composition = built([
      { source: A, count: 2 },
      { source: B, count: 1 },
    ]);
    expectExactly(ok(applyMaterialSourceDeltas(composition, [{ source: B, count: -1 }])), [[A, 2]]);
    expect(errorOf(applyMaterialSourceDeltas(composition, [{ source: A, count: 0 }]))).toBe(
      'invalid-count',
    );
    expect(errorOf(applyMaterialSourceDeltas(composition, [{ source: A, count: 1.5 }]))).toBe(
      'invalid-count',
    );
  });
});

describe('ownership of returned values', () => {
  it('returns compositions that share no object with their inputs', () => {
    const mutableGatherer = { kind: 'character' as const, id: 101, name: 'Alice' };
    const inputSource: MaterialSource = { gatherer: mutableGatherer };
    const input: MaterialSourceCount[] = [{ source: inputSource, count: 4 }];
    const composition = ok(canonicalMaterialComposition(input, 4));

    expect(composition[0]).not.toBe(input[0]);
    expect(composition[0].source).not.toBe(inputSource);
    expect(composition[0].source.gatherer).not.toBe(mutableGatherer);

    input[0] = { source: B, count: 99 };
    mutableGatherer.name = 'Tampered';
    expectExactly(composition, [[A, 4]]);
  });

  it('keeps the taken and remaining halves of a take independent of each other', () => {
    const composition = built([
      { source: A, count: 2 },
      { source: B, count: 2 },
    ]);
    const take = ok(takeMaterialCount(composition, 1));
    expect(take.taken.length).toBe(1);
    expect(take.taken[0].source).not.toBe(composition[0].source);
    expect(take.taken[0].source.gatherer).toBeDefined();
    for (const other of take.remaining) {
      expect(take.taken[0].source).not.toBe(other.source);
      expect(take.taken[0].source.gatherer).not.toBe(other.source.gatherer);
    }
    expect(totalMaterialCount(take.taken) + totalMaterialCount(take.remaining)).toBe(4);
  });

  it('leaves the caller composition untouched through a whole operation sequence', () => {
    const composition = built([
      { source: A, count: 3 },
      { source: UNRECORDED, count: 1 },
    ]);
    const snapshot = structuredClone(composition);
    ok(takeMaterialCount(composition, 2));
    ok(mergeMaterialCompositions(composition, built([{ source: C, count: 1 }])));
    ok(applyMaterialSourceDeltas(composition, [{ source: B, count: 2 }]));
    expect(composition).toEqual(snapshot);
  });
});

describe('randomized conservation', () => {
  // Local fixed-seed generator: the sequence is the same on every run and on
  // every host, so a failure is reproducible from the seed alone.
  const makeRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const pool: readonly MaterialSource[] = [
    UNRECORDED,
    A,
    B,
    C,
    { signer: 'Oldsmith' },
    { signer: '' },
    { gatherer: alice, signer: 'Alice' },
    { gatherer: { kind: 'offline', id: 'local-1', name: 'Wanderer' } },
  ];

  const runSequence = (seed: number, steps: number): MaterialComposition => {
    const random = makeRandom(seed);
    const pick = (n: number) => Math.floor(random() * n);
    let composition = built([{ source: pool[0], count: 12 }]);

    for (let step = 0; step < steps; step++) {
      const before = composition;
      const total = totalMaterialCount(before);
      const roll = pick(3);

      if (roll === 0 || total === 0) {
        const added = built([{ source: pool[pick(pool.length)], count: 1 + pick(4) }]);
        composition = ok(mergeMaterialCompositions(before, added));
        expect(totalMaterialCount(composition)).toBe(total + totalMaterialCount(added));
        const deltas = ok(diffMaterialCompositions(before, composition));
        expect(ok(applyMaterialSourceDeltas(before, deltas))).toEqual(composition);
        continue;
      }

      if (roll === 1) {
        const take = ok(takeMaterialCount(before, 1 + pick(Math.min(total, 5))));
        // Conservation: the two halves recombine into exactly the input.
        expect(ok(mergeMaterialCompositions(take.taken, take.remaining))).toEqual(before);
        composition = take.remaining;
        continue;
      }

      const target = before[pick(before.length)];
      const take = ok(
        takeSelectedMaterialSources(before, [
          { source: target.source, count: 1 + pick(target.count) },
        ]),
      );
      expect(take.taken.length).toBe(1);
      expect(ok(mergeMaterialCompositions(take.taken, take.remaining))).toEqual(before);
      composition = take.remaining;
    }

    for (const entry of composition) expect(entry.count).toBeGreaterThan(0);
    return composition;
  };

  it('conserves every source count across a long randomized sequence', () => {
    const result = runSequence(20260906, 300);
    expect(totalMaterialCount(result)).toBe(result.reduce((n, entry) => n + entry.count, 0));
  });

  it('replays a randomized sequence identically from the same seed', () => {
    expect(runSequence(7, 120)).toEqual(runSequence(7, 120));
    expect(runSequence(8, 120)).not.toEqual(runSequence(7, 120));
  });
});
