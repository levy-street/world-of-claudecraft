// The bounded source-ledger core: project a container's material slots into
// canonical per-payload entries, diff two projections into movement rows, and
// replay a whole batch of rows atomically. No storage, no schema, no runtime
// wiring: every case here is pure data in, explicit result out.

import { describe, expect, it } from 'vitest';
import {
  applyMaterialContainerDeltas,
  diffMaterialContainers,
  type MaterialContainerProjection,
  type MaterialLedgerResult,
  type MaterialMovementRow,
  projectMaterialContainer,
} from '../server/material_source_ledger';
import { materialPayloadKey } from '../src/sim/material_payload_identity';
import type {
  MaterialComposition,
  MaterialGatherer,
  MaterialSource,
  MaterialSourceDelta,
} from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import type { ItemInstancePayload } from '../src/sim/types';

const MATERIALS: ReadonlySet<string> = new Set(['ore', 'herb']);

const character = (id: number, name: string): MaterialGatherer => ({
  kind: 'character',
  id,
  name,
});

const A: MaterialSource = { gatherer: character(1, 'Ayla') };
const B: MaterialSource = { gatherer: character(2, 'Bran') };
const C: MaterialSource = { gatherer: character(3, 'Cass') };
const UNRECORDED: MaterialSource = {};

const held = (source: MaterialSource, count: number) => ({ source, count });

const slot = (
  itemId: string,
  count: number,
  sources: MaterialComposition,
  extra: Partial<MaterialStackSlot> = {},
): MaterialStackSlot => ({ itemId, count, materialSources: sources, ...extra });

const payload = (raw: Record<string, unknown>): ItemInstancePayload => raw as ItemInstancePayload;

function expectOk<T>(result: MaterialLedgerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function expectErr<T>(result: MaterialLedgerResult<T>): string {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

const entryFor = (projection: MaterialContainerProjection, key: string) =>
  projection.entries.find((entry) => materialPayloadKey(entry) === key);

const invert = (rows: readonly MaterialMovementRow[]): MaterialMovementRow[] =>
  rows.map((row) => ({
    ...row,
    count: -row.count,
    sourceDeltas: row.sourceDeltas.map((leg) => ({ source: leg.source, count: -leg.count })),
  }));

const legOf = (rows: readonly MaterialMovementRow[], name: string) =>
  rows[0].sourceDeltas.find((leg) => leg.source.gatherer?.name === name);

describe('projectMaterialContainer', () => {
  it('skips non-material slots and keeps material ones', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [{ itemId: 'sword', count: 1 }, slot('ore', 2, [held(A, 2)])],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0].itemId).toBe('ore');
    expect(projection.entries[0].count).toBe(2);
  });

  it('normalizes legacy stock so the signer lands in the descriptor, not the payload', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [
          { itemId: 'ore', count: 2, instance: payload({ signer: 'Ayla' }) },
          slot('ore', 3, [held({ signer: 'Ayla' }, 3)]),
        ],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0].instance).toBeUndefined();
    expect(projection.entries[0].count).toBe(5);
    expect(projection.entries[0].sources).toEqual([{ source: { signer: 'Ayla' }, count: 5 }]);
  });

  it('groups by payload identity and sums the exact composition', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [slot('ore', 5, [held(A, 5)]), slot('ore', 3, [held(B, 3)]), slot('herb', 2, [held(A, 2)])],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(2);
    const ore = entryFor(projection, materialPayloadKey({ itemId: 'ore' }));
    expect(ore?.count).toBe(8);
    expect(ore?.sources).toEqual([
      { source: A, count: 5 },
      { source: B, count: 3 },
    ]);
  });

  it('keeps payload and craftedRecipeId separate identities', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [
          slot('ore', 1, [held(A, 1)], { craftedRecipeId: 'r1' }),
          slot('ore', 1, [held(A, 1)], { instance: payload({ craftedRecipeId: 'r1' }) }),
          slot('ore', 1, [held(A, 1)]),
        ],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(3);
    expect(projection.entries.every((entry) => entry.count === 1)).toBe(true);
  });

  it('keeps a JSON-parsed own __proto__ payload key its own identity', () => {
    const tainted = JSON.parse('{"__proto__":{"a":1}}') as ItemInstancePayload;
    const ordinary = JSON.parse('{"unrelated":{"a":1}}') as ItemInstancePayload;

    const projection = expectOk(
      projectMaterialContainer(
        [
          slot('ore', 1, [held(A, 1)], { instance: tainted }),
          slot('ore', 2, [held(A, 2)], { instance: ordinary }),
        ],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(2);
  });

  it('groups payloads that differ only in key order', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [
          slot('ore', 1, [held(A, 1)], { instance: payload({ x: 1, y: { p: 1, q: 2 } }) }),
          slot('ore', 2, [held(B, 2)], { instance: payload({ y: { q: 2, p: 1 }, x: 1 }) }),
        ],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0].count).toBe(3);
  });

  it('ignores manual separation when aggregating', () => {
    const projection = expectOk(
      projectMaterialContainer(
        [slot('ore', 4, [held(A, 4)], { materialSeparated: true }), slot('ore', 6, [held(A, 6)])],
        MATERIALS,
      ),
    );

    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0].count).toBe(10);
    const grouped = projection.entries[0] as { materialSeparated?: true };
    expect(grouped.materialSeparated).toBeUndefined();
  });

  it('orders entries stably regardless of slot order', () => {
    const slots = [
      slot('ore', 1, [held(A, 1)]),
      slot('herb', 1, [held(B, 1)]),
      slot('ore', 1, [held(A, 1)], { craftedRecipeId: 'r1' }),
    ];
    const forward = expectOk(projectMaterialContainer(slots, MATERIALS));
    const reversed = expectOk(projectMaterialContainer([...slots].reverse(), MATERIALS));

    expect(reversed.entries.map((entry) => materialPayloadKey(entry))).toEqual(
      forward.entries.map((entry) => materialPayloadKey(entry)),
    );
  });

  it('refuses the whole container on a malformed composition', () => {
    const slots = [slot('ore', 5, [held(A, 5)]), slot('ore', 3, [held(B, 2)])];

    expect(expectErr(projectMaterialContainer(slots, MATERIALS))).toBe('sum-mismatch');
  });

  it('refuses a slot-level signer beside an explicit composition', () => {
    const slots = [slot('ore', 1, [held(A, 1)], { instance: payload({ signer: 'Ayla' }) })];

    expect(expectErr(projectMaterialContainer(slots, MATERIALS))).toBe('ambiguous-signer');
  });

  it('detects aggregate overflow through the source algebra, never clipping', () => {
    const slots = [
      slot('ore', Number.MAX_SAFE_INTEGER, [held(A, Number.MAX_SAFE_INTEGER)]),
      slot('ore', 2, [held(B, 2)]),
    ];

    expect(expectErr(projectMaterialContainer(slots, MATERIALS))).toBe('count-overflow');
  });

  it('returns data that shares nothing with the input slots', () => {
    const instance = payload({ note: { deep: [1] } });
    const sources = [held(A, 2)];
    const slots = [slot('ore', 2, sources, { instance })];

    const projection = expectOk(projectMaterialContainer(slots, MATERIALS));
    const entry = projection.entries[0] as unknown as {
      instance?: Record<string, unknown>;
      sources: { count: number }[];
    };
    if (!entry.instance) throw new Error('Expected projected payload');
    (entry.instance.note as { deep: number[] }).deep.push(2);
    entry.sources[0].count = 99;

    expect(instance).toEqual(payload({ note: { deep: [1] } }));
    expect(sources).toEqual([held(A, 2)]);
    expect(expectOk(projectMaterialContainer(slots, MATERIALS)).entries[0].count).toBe(2);
  });
});

describe('diffMaterialContainers', () => {
  const mixed = () => [slot('ore', 10, [held(A, 5), held(B, 3), held(UNRECORDED, 2)])];

  it('journals only the added unit, never the whole stack', () => {
    const after = [slot('ore', 11, [held(A, 5), held(B, 3), held(UNRECORDED, 2), held(C, 1)])];

    const rows = expectOk(diffMaterialContainers(mixed(), after, MATERIALS));

    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe('ore');
    expect(rows[0].count).toBe(1);
    expect(rows[0].sourceDeltas).toEqual([{ source: C, count: 1 }]);
  });

  it('journals exactly the descriptors a selected take spent', () => {
    const after = [slot('ore', 8, [held(A, 5), held(B, 1), held(UNRECORDED, 2)])];

    const rows = expectOk(diffMaterialContainers(mixed(), after, MATERIALS));

    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(-2);
    expect(rows[0].sourceDeltas).toEqual([{ source: B, count: -2 }]);
  });

  it('keeps a count-zero row when the composition moved', () => {
    const after = [slot('ore', 10, [held(A, 6), held(B, 2), held(UNRECORDED, 2)])];

    const rows = expectOk(diffMaterialContainers(mixed(), after, MATERIALS));

    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(0);
    expect(legOf(rows, 'Ayla')?.count).toBe(1);
    expect(legOf(rows, 'Bran')?.count).toBe(-1);
  });

  it('emits nothing when a manual grouping choice changes', () => {
    const before = [slot('ore', 10, [held(A, 10)])];
    const after = [slot('ore', 10, [held(A, 10)], { materialSeparated: true })];

    expect(expectOk(diffMaterialContainers(before, after, MATERIALS))).toEqual([]);
  });

  it('emits nothing when one stack splits into two of the same composition', () => {
    const before = [slot('ore', 8, [held(A, 5), held(B, 3)])];
    const after = [slot('ore', 5, [held(A, 5)]), slot('ore', 3, [held(B, 3)])];

    expect(expectOk(diffMaterialContainers(before, after, MATERIALS))).toEqual([]);
    expect(expectOk(diffMaterialContainers(after, before, MATERIALS))).toEqual([]);
  });

  it('emits nothing when a bag cell changes', () => {
    const before = [slot('ore', 2, [held(A, 2)], { slot: 3 })];
    const after = [slot('ore', 2, [held(A, 2)], { slot: 9 })];

    expect(expectOk(diffMaterialContainers(before, after, MATERIALS))).toEqual([]);
  });

  it('orders rows by the stable payload key', () => {
    const before: MaterialStackSlot[] = [];
    const after = [
      slot('ore', 1, [held(A, 1)], { craftedRecipeId: 'r2' }),
      slot('herb', 1, [held(A, 1)]),
      slot('ore', 1, [held(A, 1)]),
    ];

    const rows = expectOk(diffMaterialContainers(before, after, MATERIALS));
    const keys = rows.map((row) => materialPayloadKey(row));

    expect(keys).toEqual([...keys].sort());
    expect(rows).toHaveLength(3);
  });

  it('propagates a malformed side without emitting a partial journal', () => {
    const bad = [slot('ore', 3, [held(A, 1)])];

    expect(expectErr(diffMaterialContainers(mixed(), bad, MATERIALS))).toBe('sum-mismatch');
    expect(expectErr(diffMaterialContainers(bad, mixed(), MATERIALS))).toBe('sum-mismatch');
  });
});

describe('applyMaterialContainerDeltas', () => {
  const opening = (slots: MaterialStackSlot[]) =>
    expectOk(projectMaterialContainer(slots, MATERIALS));

  const row = (
    count: number,
    sourceDeltas: MaterialSourceDelta[],
    extra: Partial<MaterialMovementRow> = {},
  ): MaterialMovementRow => ({ itemId: 'ore', count, sourceDeltas, ...extra });

  it('replays a diff onto the opening projection', () => {
    const before = [slot('ore', 10, [held(A, 5), held(B, 3), held(UNRECORDED, 2)])];
    const after = [slot('ore', 11, [held(A, 5), held(B, 3), held(UNRECORDED, 2), held(C, 1)])];
    const rows = expectOk(diffMaterialContainers(before, after, MATERIALS));

    const replayed = expectOk(applyMaterialContainerDeltas(opening(before), rows));

    expect(replayed).toEqual(opening(after));
  });

  it('replays and inverts a signer rename without rewriting the opening', () => {
    const before = [slot('ore', 4, [held({ gatherer: character(7, 'Olde') }, 4)])];
    const after = [slot('ore', 4, [held({ gatherer: character(7, 'Newe') }, 4)])];
    const rows = expectOk(diffMaterialContainers(before, after, MATERIALS));

    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(0);
    expect(legOf(rows, 'Olde')?.count).toBe(-4);
    expect(legOf(rows, 'Newe')?.count).toBe(4);

    const start = opening(before);
    const snapshot = structuredClone(start);
    const renamed = expectOk(applyMaterialContainerDeltas(start, rows));

    expect(renamed).toEqual(opening(after));
    expect(start).toEqual(snapshot);
    expect(expectOk(applyMaterialContainerDeltas(renamed, invert(rows)))).toEqual(snapshot);
  });

  it('cancels a deposit against a withdraw in the same batch, in either order', () => {
    const start = opening([slot('ore', 1, [held(A, 1)])]);
    const deposit = row(3, [{ source: A, count: 3 }]);
    const withdraw = row(-3, [{ source: A, count: -3 }]);

    const forward = expectOk(applyMaterialContainerDeltas(start, [deposit, withdraw]));
    const reversed = expectOk(applyMaterialContainerDeltas(start, [withdraw, deposit]));

    expect(forward).toEqual(start);
    expect(reversed).toEqual(start);
  });

  it('cancels a batch that touches a payload the opening does not hold', () => {
    const start = opening([slot('ore', 1, [held(A, 1)])]);
    const legs = [
      row(2, [{ source: C, count: 2 }], { craftedRecipeId: 'r1' }),
      row(-2, [{ source: C, count: -2 }], { craftedRecipeId: 'r1' }),
    ];

    expect(expectOk(applyMaterialContainerDeltas(start, legs))).toEqual(start);
    expect(expectOk(applyMaterialContainerDeltas(start, [legs[1], legs[0]]))).toEqual(start);
  });

  it('coalesces rows for one payload before judging the batch', () => {
    const start = opening([slot('ore', 1, [held(A, 1)])]);
    const rows = [
      row(-1, [{ source: A, count: -1 }]),
      row(2, [{ source: B, count: 2 }]),
      row(-1, [{ source: B, count: -1 }]),
    ];

    const applied = expectOk(applyMaterialContainerDeltas(start, rows));

    expect(applied.entries).toHaveLength(1);
    expect(applied.entries[0].count).toBe(1);
    expect(applied.entries[0].sources).toEqual([{ source: B, count: 1 }]);
  });

  it('drops an entry the batch empties', () => {
    const start = opening([slot('ore', 2, [held(A, 2)])]);

    const applied = expectOk(
      applyMaterialContainerDeltas(start, [row(-2, [{ source: A, count: -2 }])]),
    );

    expect(applied.entries).toEqual([]);
  });

  it('refuses an overdraw whole, leaving the opening untouched', () => {
    const start = opening([slot('ore', 1, [held(A, 1)])]);
    const snapshot = structuredClone(start);

    const failed = applyMaterialContainerDeltas(start, [row(-2, [{ source: A, count: -2 }])]);

    expect(expectErr(failed)).toBe('negative-result');
    expect(start).toEqual(snapshot);
  });

  it('refuses a withdraw of a descriptor the opening does not hold', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const failed = applyMaterialContainerDeltas(start, [row(-1, [{ source: B, count: -1 }])]);

    expect(expectErr(failed)).toBe('negative-result');
  });

  it('refuses a row whose legs do not sum to its own count', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const failed = applyMaterialContainerDeltas(start, [row(2, [{ source: A, count: 1 }])]);

    expect(expectErr(failed)).toBe('count-mismatch');
  });

  it('refuses two inconsistent rows whose discrepancies would cancel', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);
    // Counts sum to 2 and legs sum to 2, so a batch-only check would pass both.
    const rows = [row(2, [{ source: A, count: 1 }]), row(0, [{ source: A, count: 1 }])];

    expect(expectErr(applyMaterialContainerDeltas(start, rows))).toBe('count-mismatch');
    expect(expectErr(applyMaterialContainerDeltas(start, [rows[1], rows[0]]))).toBe(
      'count-mismatch',
    );
  });

  it('refuses a count-zero row that moves the total', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const failed = applyMaterialContainerDeltas(start, [row(0, [{ source: B, count: 1 }])]);

    expect(expectErr(failed)).toBe('count-mismatch');
  });

  it('accepts a count-zero row that only moves descriptors', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const applied = expectOk(
      applyMaterialContainerDeltas(start, [
        row(0, [
          { source: A, count: -1 },
          { source: B, count: 1 },
        ]),
      ]),
    );

    expect(applied.entries[0].sources).toEqual([
      { source: A, count: 4 },
      { source: B, count: 1 },
    ]);
  });

  it('refuses a malformed descriptor even when its legs cancel', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);
    const bogus = {
      gatherer: { kind: 'character', id: 1, name: 'Ayla', extra: 1 },
    } as MaterialSource;

    const failed = applyMaterialContainerDeltas(start, [
      row(0, [
        { source: bogus, count: 1 },
        { source: bogus, count: -1 },
      ]),
    ]);

    expect(expectErr(failed)).toBe('unknown-field');
  });

  it('refuses a zero-count leg', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const failed = applyMaterialContainerDeltas(start, [row(0, [{ source: A, count: 0 }])]);

    expect(expectErr(failed)).toBe('invalid-count');
  });

  it('refuses a non-integer row count', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);

    const failed = applyMaterialContainerDeltas(start, [row(1.5, [{ source: A, count: 1 }])]);

    expect(expectErr(failed)).toBe('invalid-count');
  });

  it('refuses an opening carrying two entries for one payload', () => {
    const duplicated: MaterialContainerProjection = {
      entries: [
        { itemId: 'ore', count: 1, sources: [held(A, 1)] },
        { itemId: 'ore', count: 2, sources: [held(B, 2)] },
      ],
    };

    expect(expectErr(applyMaterialContainerDeltas(duplicated, []))).toBe('duplicate-entry');
  });

  it('refuses an opening entry whose count disagrees with its sources', () => {
    const broken: MaterialContainerProjection = {
      entries: [{ itemId: 'ore', count: 4, sources: [held(A, 1)] }],
    };

    expect(expectErr(applyMaterialContainerDeltas(broken, []))).toBe('sum-mismatch');
  });

  it('refuses an overflowing result whole', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const start = opening([slot('ore', huge, [held(A, huge)])]);

    const failed = applyMaterialContainerDeltas(start, [row(2, [{ source: B, count: 2 }])]);

    expect(expectErr(failed)).toBe('count-overflow');
  });

  it('cancels legs that pass the safe-integer ceiling, in every row order', () => {
    // Exact internally: the batch nets to +1, so no intermediate sum of the
    // positive legs can refuse it, whichever order the rows arrive in.
    const start = opening([]);
    const big = row(Number.MAX_SAFE_INTEGER, [{ source: A, count: Number.MAX_SAFE_INTEGER }]);
    const one = row(1, [{ source: A, count: 1 }]);
    const back = row(-Number.MAX_SAFE_INTEGER, [{ source: A, count: -Number.MAX_SAFE_INTEGER }]);

    for (const order of [
      [big, one, back],
      [back, one, big],
      [one, big, back],
      [big, back, one],
    ]) {
      const applied = expectOk(applyMaterialContainerDeltas(start, order));
      expect(applied.entries).toHaveLength(1);
      expect(applied.entries[0].count).toBe(1);
      expect(applied.entries[0].sources).toEqual([{ source: A, count: 1 }]);
    }
  });

  it('still refuses an unsafe final holding the cancellation does not undo', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const start = opening([slot('ore', huge, [held(A, huge)])]);
    const rows = [
      row(huge, [{ source: B, count: huge }]),
      row(-huge, [{ source: B, count: -huge }]),
      row(2, [{ source: B, count: 2 }]),
    ];

    expect(expectErr(applyMaterialContainerDeltas(start, rows))).toBe('count-overflow');
  });

  it('accepts a balanced pair at the safe-integer edge', () => {
    const start = opening([slot('ore', 5, [held(A, 5)])]);
    const big = row(Number.MAX_SAFE_INTEGER - 5, [
      { source: A, count: Number.MAX_SAFE_INTEGER - 5 },
    ]);
    const back = row(-(Number.MAX_SAFE_INTEGER - 5), [
      { source: A, count: -(Number.MAX_SAFE_INTEGER - 5) },
    ]);

    expect(expectOk(applyMaterialContainerDeltas(start, [big, back]))).toEqual(start);
    expect(expectOk(applyMaterialContainerDeltas(start, [back, big]))).toEqual(start);
  });

  it('carries an own __proto__ payload key through projection and replay', () => {
    const tainted = JSON.parse('{"__proto__":{"a":1}}') as ItemInstancePayload;
    const start = opening([slot('ore', 2, [held(A, 2)], { instance: tainted })]);

    const openingInstance = start.entries[0].instance ?? {};
    expect(Object.hasOwn(openingInstance, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(openingInstance)).toBe(Object.prototype);

    const applied = expectOk(
      applyMaterialContainerDeltas(start, [
        row(1, [{ source: A, count: 1 }], { instance: tainted }),
      ]),
    );

    expect(applied.entries).toHaveLength(1);
    expect(applied.entries[0].count).toBe(3);
    const replayedInstance = applied.entries[0].instance ?? {};
    expect(Object.hasOwn(replayedInstance, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(replayedInstance, '__proto__')?.value).toEqual({ a: 1 });
  });

  it('returns a projection independent of the opening and of the rows', () => {
    const start = opening([slot('ore', 2, [held(A, 2)], { instance: payload({ note: [1] }) })]);
    const rows = [row(1, [{ source: A, count: 1 }], { instance: payload({ note: [1] }) })];

    const applied = expectOk(applyMaterialContainerDeltas(start, rows));
    const entry = applied.entries[0] as unknown as {
      instance?: Record<string, unknown>;
      sources: { count: number }[];
    };
    if (!entry.instance) throw new Error('Expected replayed payload');
    (entry.instance.note as number[]).push(2);
    entry.sources[0].count = 99;

    expect(start.entries[0].count).toBe(2);
    expect(start.entries[0].sources).toEqual([held(A, 2)]);
    expect(start.entries[0].instance).toEqual(payload({ note: [1] }));
    expect(rows[0].sourceDeltas).toEqual([{ source: A, count: 1 }]);
  });
});
