import { describe, expect, test } from 'vitest';
import {
  AURA_STATE_OMIT,
  auraStateSnapshot,
  MAX_AURA_STATE_FIELDS,
  MAX_AURA_STATE_STRING,
} from '../server/parse/aura_state';

// The snapshot's whole point is completeness, so these pin the only ways a
// field can legitimately be left out: the typed omit list, non-scalars,
// non-finite numbers, and the two defensive bounds (which must be visible
// when they bite, never silent).

describe('auraStateSnapshot', () => {
  test('ships every scalar field except the omit list, in key order', () => {
    const state = auraStateSnapshot({
      id: 'x',
      name: 'X',
      sourceId: 1,
      stacks: 2,
      remaining: 3,
      kind: 'dot',
      value: 4,
      value2: 5,
      linkedEntityId: 6,
      encounterOwned: true,
      school: 'fire',
    });
    expect(state).toEqual({
      kind: 'dot',
      value: 4,
      value2: 5,
      linkedEntityId: 6,
      encounterOwned: true,
      school: 'fire',
    });
    expect(Object.keys(state ?? {})).toEqual([
      'kind',
      'value',
      'value2',
      'linkedEntityId',
      'encounterOwned',
      'school',
    ]);
  });

  test('skips non-scalars and non-finite numbers, and answers undefined for nothing', () => {
    expect(
      auraStateSnapshot({
        empowerAbilities: ['a'],
        nested: { x: 1 },
        fn: () => 1,
        missing: undefined,
        nothing: null,
        inf: Number.POSITIVE_INFINITY,
        nan: Number.NaN,
      }),
    ).toBeUndefined();
    expect(auraStateSnapshot({ id: 'only-identity', name: 'n', sourceId: 1 })).toBeUndefined();
  });

  test('truncates a long string to the cap', () => {
    const long = 'a'.repeat(MAX_AURA_STATE_STRING + 20);
    expect(auraStateSnapshot({ label: long })).toEqual({
      label: 'a'.repeat(MAX_AURA_STATE_STRING),
    });
  });

  test('stops at the field cap and reports the truncation once', () => {
    const aura: Record<string, number> = {};
    for (let i = 0; i < MAX_AURA_STATE_FIELDS + 5; i++) aura[`f${i}`] = i;
    let truncations = 0;
    const state = auraStateSnapshot(aura, () => truncations++);
    expect(Object.keys(state ?? {})).toHaveLength(MAX_AURA_STATE_FIELDS);
    expect(state?.f0).toBe(0);
    expect(state?.[`f${MAX_AURA_STATE_FIELDS - 1}`]).toBe(MAX_AURA_STATE_FIELDS - 1);
    expect(state).not.toHaveProperty(`f${MAX_AURA_STATE_FIELDS}`);
    expect(truncations).toBe(1);
  });

  test('an aura within the cap never reports a truncation', () => {
    const aura: Record<string, number> = {};
    for (let i = 0; i < MAX_AURA_STATE_FIELDS; i++) aura[`f${i}`] = i;
    let truncations = 0;
    auraStateSnapshot(aura, () => truncations++);
    expect(truncations).toBe(0);
  });

  test('the omit list names identity, per-tick counters, and mechanic bookkeeping', () => {
    for (const key of ['id', 'name', 'sourceId', 'stacks', 'remaining', 'tickTimer'] as const) {
      expect(AURA_STATE_OMIT.has(key)).toBe(true);
    }
    // The fields a reader needs are never on it.
    for (const key of [
      'value',
      'value2',
      'linkedEntityId',
      'duration',
      'kind',
      'school',
    ] as const) {
      expect(AURA_STATE_OMIT.has(key)).toBe(false);
    }
  });
});
