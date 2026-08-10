// The pure interpolation-plan module behind the t() resolved-string memo
// (hitch-elimination B3). Pins three things:
//   1. compileInterpolationPlan decomposes a template exactly (statics, slot
//      names, raw tokens) and returns null for a slotless template.
//   2. interpolateWithMemo is BYTE-IDENTICAL to the legacy single-pass regex
//      replace across a template x values matrix, including undefined slots,
//      numbers, duplicates, and values containing brace text.
//   3. The memo really is a memo: a repeat with the same slot values performs
//      zero string composition over the values (composition-probe idiom from
//      tests/painter_host.test.ts), any changed slot rebuilds correctly, and
//      the snapshot array is reused rather than reallocated.

import { describe, expect, it } from 'vitest';
import type { InterpolationValues } from '../src/ui/i18n.catalog';
import {
  compileInterpolationPlan,
  type InterpolationMemoEntry,
  interpolateWithMemo,
} from '../src/ui/i18n_interpolation';

// The legacy interpolate() shape (the pre-B3 t() hot path), kept here as the
// byte-identity reference. If the plan/concat pipeline ever diverges from this
// on any input, the matrix below goes red.
function legacyInterpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

function compositionProbe(text: string): { value: string; compositions: () => number } {
  let count = 0;
  const probe = {
    [Symbol.toPrimitive](): string {
      count++;
      return text;
    },
    toString(): string {
      count++;
      return text;
    },
    valueOf(): string {
      count++;
      return text;
    },
  };
  return { value: probe as unknown as string, compositions: () => count };
}

describe('compileInterpolationPlan', () => {
  it('returns null for a template with no slots', () => {
    expect(compileInterpolationPlan('plain text, no slots')).toBeNull();
    expect(compileInterpolationPlan('')).toBeNull();
  });

  it('does not treat malformed braces as slots (same grammar as the legacy regex)', () => {
    expect(compileInterpolationPlan('{not-a-slot} and {} and {unclosed')).toBeNull();
  });

  it('decomposes statics, names, and raw tokens in template order', () => {
    const plan = compileInterpolationPlan('{a}b{c_2}');
    expect(plan).toEqual({
      statics: ['', 'b', ''],
      names: ['a', 'c_2'],
      tokens: ['{a}', '{c_2}'],
    });
  });

  it('keeps duplicate slot names as separate slots', () => {
    const plan = compileInterpolationPlan('x {name} y {name} z');
    expect(plan).toEqual({
      statics: ['x ', ' y ', ' z'],
      names: ['name', 'name'],
      tokens: ['{name}', '{name}'],
    });
  });
});

describe('interpolateWithMemo is byte-identical to the legacy regex replace', () => {
  const templates = [
    'no slots at all',
    '{a}',
    'x{a}',
    '{a}y',
    '{a}{b}',
    'a {name} b {name} c',
    'start {a} mid {b_2} end',
    'brace but not a slot {not-a-slot} and {} then {a}',
    '{a} tail with {unclosed',
    'unicode: {name} cadáver ({rank})',
  ];
  const valuesMatrix: InterpolationValues[] = [
    {},
    { a: 'x' },
    { a: 0 },
    { a: '', b: 'y' },
    { a: '{b}', b: 'B' },
    { a: 1.5, b_2: 'two', name: 'Web Weaver', rank: 'S' },
    { c: 'extra param, never referenced' },
  ];

  it('matches on every template x values pair, and repeats match too', () => {
    for (const template of templates) {
      for (const values of valuesMatrix) {
        const entry: InterpolationMemoEntry = { template };
        const expected = legacyInterpolate(template, values);
        expect(interpolateWithMemo(entry, values), `${template} :: ${JSON.stringify(values)}`).toBe(
          expected,
        );
        // The memo-hit repeat must serve the same bytes.
        expect(interpolateWithMemo(entry, values)).toBe(expected);
      }
    }
  });

  it('leaves an undefined slot as its literal {name} token', () => {
    const entry: InterpolationMemoEntry = { template: 'hi {known} and {unknown}' };
    expect(interpolateWithMemo(entry, { known: 'yes' })).toBe('hi yes and {unknown}');
  });
});

describe('the last-call memo (the B3 allocation guarantee)', () => {
  it('a repeat with the same slot values composes nothing over them (probe)', () => {
    const entry: InterpolationMemoEntry = { template: 'corpse of {name}' };
    const probe = compositionProbe('Web Weaver');
    expect(interpolateWithMemo(entry, { name: probe.value })).toBe('corpse of Web Weaver');
    const afterBuild = probe.compositions();
    expect(afterBuild).toBeGreaterThan(0); // the establishing build converts the value
    for (let i = 0; i < 50; i++) {
      interpolateWithMemo(entry, { name: probe.value });
    }
    expect(probe.compositions()).toBe(afterBuild); // memo hits convert NOTHING
  });

  it('params-object identity never matters, only slot values (shallow ===)', () => {
    const entry: InterpolationMemoEntry = { template: '{name} ({rank})' };
    const first = interpolateWithMemo(entry, { name: 'Rift', rank: 'S' });
    const probe = compositionProbe('never');
    // A FRESH object per call carrying an extra never-referenced probe value:
    // the memo must hit (same slot values) and never touch the extra param.
    const second = interpolateWithMemo(entry, { name: 'Rift', rank: 'S', extra: probe.value });
    expect(second).toBe(first);
    expect(probe.compositions()).toBe(0);
  });

  it('any changed slot rebuilds correctly, including the LAST of several', () => {
    const entry: InterpolationMemoEntry = { template: '{name} ({rank})' };
    expect(interpolateWithMemo(entry, { name: 'Rift', rank: 'S' })).toBe('Rift (S)');
    // Change only the second slot: a memo comparing fewer than all slots
    // would wrongly serve the stale result (mutant guard).
    expect(interpolateWithMemo(entry, { name: 'Rift', rank: 'A' })).toBe('Rift (A)');
    // And only the first.
    expect(interpolateWithMemo(entry, { name: 'Vale', rank: 'A' })).toBe('Vale (A)');
    // Back to the original pair still rebuilds the correct bytes.
    expect(interpolateWithMemo(entry, { name: 'Rift', rank: 'S' })).toBe('Rift (S)');
  });

  it('reuses the snapshot array across rebuilds (no per-change allocation)', () => {
    const entry: InterpolationMemoEntry = { template: '{a}/{b}' };
    interpolateWithMemo(entry, { a: 1, b: 2 });
    const snapshot = entry.lastValues;
    expect(snapshot).toBeDefined();
    interpolateWithMemo(entry, { a: 3, b: 4 });
    expect(entry.lastValues).toBe(snapshot); // same array object, mutated in place
    expect(entry.lastResult).toBe('3/4');
  });

  it('a slotless template returns the template itself even with values present', () => {
    const entry: InterpolationMemoEntry = { template: 'static text' };
    expect(interpolateWithMemo(entry, { a: 'ignored' })).toBe('static text');
    expect(entry.plan).toBeNull();
  });
});
