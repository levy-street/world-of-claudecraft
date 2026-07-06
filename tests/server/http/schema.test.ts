// Tests for the in-house typed schema validator (server/http/schema.ts).
//
// Covers: scalar decode + string-to-number/boolean coercion; the one-pass collection
// (an object with N bad fields yields N issues, never first-fail); each stable code
// (type/required/min/max/int/minLength/maxLength/enum) and its render params; :id and
// page/pageSize style numeric bounds at the boundaries; nested child pointers; optional
// fields and defaults; the prototype-pollution safety of object() (declared keys only);
// the '~standard' validate adapter emitting CODES, not English; and compile-time
// type-level assertions (Infer equality, '~standard' assignability) checked by tsc.

import { describe, expect, it } from 'vitest';
import {
  bool,
  type DecodeResult,
  enum_,
  type Infer,
  type Issue,
  num,
  object,
  optional,
  str,
} from '../../../server/http/schema';
import type { StandardSchemaProps, StandardSchemaResult } from '../../../server/http/types';

// Unwrap a decode failure's issues; throws if the decode unexpectedly succeeded.
function issuesOf<T>(result: DecodeResult<T>): Issue[] {
  if (result.ok) throw new Error('expected a decode failure');
  return result.issues;
}

describe('scalars', () => {
  it('str: passes a string, rejects a non-string with code type', () => {
    expect(str().decode('hi')).toEqual({ ok: true, value: 'hi' });
    expect(issuesOf(str().decode(5))[0].code).toBe('type');
    expect(issuesOf(str().decode(undefined))[0].code).toBe('type');
  });

  it('str: enforces minLength and maxLength with params', () => {
    const tooShort = str({ minLength: 1 }).decode('');
    expect(issuesOf(tooShort)[0]).toMatchObject({ code: 'minLength', params: { minLength: 1 } });
    const tooLong = str({ maxLength: 3 }).decode('abcd');
    expect(issuesOf(tooLong)[0]).toMatchObject({ code: 'maxLength', params: { maxLength: 3 } });
    expect(str({ minLength: 1, maxLength: 3 }).decode('ab')).toEqual({ ok: true, value: 'ab' });
    // A falsy bound (maxLength:0) is honored, not treated as absent.
    expect(issuesOf(str({ maxLength: 0 }).decode('a'))[0]).toMatchObject({
      code: 'maxLength',
      params: { maxLength: 0 },
    });
    expect(str({ maxLength: 0 }).decode('')).toEqual({ ok: true, value: '' });
  });

  it('num: coerces a numeric string and keeps a real number', () => {
    expect(num().decode('7')).toEqual({ ok: true, value: 7 });
    expect(num().decode(7)).toEqual({ ok: true, value: 7 });
    expect(num().decode('  7  ')).toEqual({ ok: true, value: 7 });
    // Pins the characterIdParamDecode ledger claim: the decoder is WIDER than a
    // legacy \d+ route regex, so these spellings of a positive integer decode (and
    // reach the handler) where the legacy ladder 404-fell-through. (On the ADMIN
    // surface the v0.22.0 central permission gate rejects these spellings pre-decode
    // on both arms, so the narrowed adminIdParamDecode entry no longer cites them.)
    expect(num({ int: true, min: 1 }).decode('+5')).toEqual({ ok: true, value: 5 });
    expect(num({ int: true, min: 1 }).decode('5.0')).toEqual({ ok: true, value: 5 });
  });

  it('num: rejects NaN, non-finite, empty and non-numeric input with code type', () => {
    expect(issuesOf(num().decode('abc'))[0].code).toBe('type');
    expect(issuesOf(num().decode(''))[0].code).toBe('type');
    expect(issuesOf(num().decode('   '))[0].code).toBe('type');
    expect(issuesOf(num().decode('1e999'))[0].code).toBe('type'); // Infinity is rejected
    expect(issuesOf(num().decode(Number.NaN))[0].code).toBe('type');
    expect(issuesOf(num().decode(Number.POSITIVE_INFINITY))[0].code).toBe('type');
    expect(issuesOf(num().decode(Number.NEGATIVE_INFINITY))[0].code).toBe('type');
    expect(issuesOf(num().decode(true))[0].code).toBe('type');
    expect(issuesOf(num().decode(null))[0].code).toBe('type');
    expect(issuesOf(num().decode([]))[0].code).toBe('type');
  });

  it('num: rejects non-decimal numeric strings (hex/octal/binary/scientific/grouped)', () => {
    for (const bad of ['0x10', '0b101', '0o17', '1e3', '1,000', '1_000', 'Infinity', '7.']) {
      expect(issuesOf(num().decode(bad))[0].code).toBe('type');
    }
    // Canonical decimal forms (incl. signs, fraction, leading dot, negative zero) are accepted.
    expect(num().decode('-3')).toEqual({ ok: true, value: -3 });
    expect(num().decode('0.5')).toEqual({ ok: true, value: 0.5 });
    expect(num().decode('.5')).toEqual({ ok: true, value: 0.5 });
    expect(num().decode('-0')).toEqual({ ok: true, value: -0 });
  });

  it('num: enforces int, min and max with params', () => {
    expect(issuesOf(num({ int: true }).decode('2.5'))[0].code).toBe('int');
    expect(issuesOf(num({ min: 1 }).decode('0'))[0]).toMatchObject({
      code: 'min',
      params: { min: 1 },
    });
    expect(issuesOf(num({ max: 5 }).decode('6'))[0]).toMatchObject({
      code: 'max',
      params: { max: 5 },
    });
  });

  it('num: an int that is not a SAFE integer (> 2^53) is rejected (no id aliasing)', () => {
    expect(num({ int: true }).decode('9007199254740991')).toEqual({
      ok: true,
      value: 9007199254740991, // Number.MAX_SAFE_INTEGER
    });
    expect(issuesOf(num({ int: true }).decode('9007199254740993'))[0].code).toBe('int');
  });

  it('num: collects BOTH int and min for one value in a single pass', () => {
    const codes = issuesOf(num({ int: true, min: 1 }).decode('0.5')).map((i) => i.code);
    expect(codes).toEqual(['int', 'min']);
  });

  it('num: a falsy bound (min:0 / max:0) is honored, not treated as absent', () => {
    expect(issuesOf(num({ min: 0 }).decode('-1'))[0]).toMatchObject({
      code: 'min',
      params: { min: 0 },
    });
    expect(issuesOf(num({ max: 0 }).decode('1'))[0]).toMatchObject({
      code: 'max',
      params: { max: 0 },
    });
    expect(num({ min: 0, max: 0 }).decode('0')).toEqual({ ok: true, value: 0 });
  });

  it('decode honors an explicit pointer argument', () => {
    expect(issuesOf(num().decode('abc', '/custom'))[0]).toMatchObject({
      pointer: '/custom',
      code: 'type',
    });
  });

  it('bool: passes booleans and coerces the canonical string forms', () => {
    expect(bool().decode(true)).toEqual({ ok: true, value: true });
    expect(bool().decode(false)).toEqual({ ok: true, value: false });
    expect(bool().decode('true')).toEqual({ ok: true, value: true });
    expect(bool().decode('1')).toEqual({ ok: true, value: true });
    expect(bool().decode('false')).toEqual({ ok: true, value: false });
    expect(bool().decode('0')).toEqual({ ok: true, value: false });
    expect(bool().decode(' true ')).toEqual({ ok: true, value: true }); // trims, like num()
    expect(issuesOf(bool().decode('maybe'))[0].code).toBe('type');
    expect(issuesOf(bool().decode(2))[0].code).toBe('type');
  });

  it('enum_: accepts a member and rejects a non-member (case-sensitive) with code enum', () => {
    const sort = enum_(['asc', 'desc']);
    expect(sort.decode('asc')).toEqual({ ok: true, value: 'asc' });
    expect(issuesOf(sort.decode('sideways'))[0].code).toBe('enum');
    expect(issuesOf(sort.decode('ASC'))[0].code).toBe('enum'); // case-sensitive
    expect(issuesOf(sort.decode(1))[0].code).toBe('enum');
  });
});

describe('object', () => {
  it('decodes declared keys, coercing as it goes', () => {
    const s = object({ id: num({ int: true, min: 1 }), name: str(), active: bool() });
    expect(s.decode({ id: '7', name: 'Bob', active: 'true' })).toEqual({
      ok: true,
      value: { id: 7, name: 'Bob', active: true },
    });
  });

  it('collects EVERY field issue in one pass (3 bad fields => 3 issues)', () => {
    const s = object({ a: num(), b: str(), c: bool() });
    const issues = issuesOf(s.decode({ a: 'x', b: 5, c: 'maybe' }));
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.pointer).sort()).toEqual(['/a', '/b', '/c']);
    expect(issues.every((i) => i.code === 'type')).toBe(true);
  });

  it('reports a missing required field with code required', () => {
    const issues = issuesOf(object({ id: num() }).decode({}));
    expect(issues[0]).toMatchObject({ pointer: '/id', code: 'required' });
  });

  it('rejects a non-object (null, array, primitive) at the object pointer', () => {
    expect(issuesOf(object({ id: num() }).decode(null))[0]).toMatchObject({
      pointer: '',
      code: 'type',
    });
    expect(issuesOf(object({ id: num() }).decode([]))[0].code).toBe('type');
    expect(issuesOf(object({ id: num() }).decode('nope'))[0].code).toBe('type');
  });

  it('nests child pointers for nested objects', () => {
    const s = object({ parent: object({ child: num() }) });
    expect(issuesOf(s.decode({ parent: { child: 'x' } }))[0]).toMatchObject({
      pointer: '/parent/child',
      code: 'type',
    });
    expect(issuesOf(s.decode({ parent: 5 }))[0]).toMatchObject({
      pointer: '/parent',
      code: 'type',
    });
  });

  it('reads ONLY declared keys (an extra input key is dropped)', () => {
    const s = object({ a: num() });
    const result = s.decode({ a: 1, evil: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
      expect('evil' in result.value).toBe(false);
    }
  });

  it('is prototype-pollution-safe: an input __proto__/constructor key never pollutes Object.prototype', () => {
    const protoPayload = JSON.parse('{"__proto__":{"polluted":true},"name":"ok"}');
    const ctorPayload = JSON.parse('{"constructor":{"prototype":{"polluted":true}},"name":"ok"}');
    const s = object({ name: str() });
    expect(s.decode(protoPayload)).toEqual({ ok: true, value: { name: 'ok' } });
    expect(s.decode(ctorPayload)).toEqual({ ok: true, value: { name: 'ok' } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('builds a null-prototype output object (no inherited Object.prototype members)', () => {
    const result = object({ a: num() }).decode({ a: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.getPrototypeOf(result.value)).toBeNull();
      // A null-proto object inherits nothing, so a built-in member is absent, not shadowed.
      expect('toString' in result.value).toBe(false);
    }
  });

  it('is prototype-pollution-safe even when the SHAPE itself declares a __proto__ key', () => {
    // A computed-key '__proto__' is an OWN declared key (not a prototype mutation); decoding a
    // matching payload writes it as an own property of the null-proto output, never via the
    // inherited setter, so Object.prototype stays clean for a shape-declared __proto__ too.
    const s = object({ ['__proto__']: object({ polluted: bool() }) });
    const result = s.decode(JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
});

describe('optional and defaults', () => {
  it('absent optional with a default applies the default', () => {
    const page = optional(num({ int: true, min: 1 }), 1);
    expect(page.decode(undefined)).toEqual({ ok: true, value: 1 });
    expect(page.decode('3')).toEqual({ ok: true, value: 3 });
  });

  it('absent optional without a default yields undefined', () => {
    expect(optional(str()).decode(undefined)).toEqual({ ok: true, value: undefined });
  });

  it('a present optional value is still validated by the inner schema', () => {
    expect(issuesOf(optional(num()).decode('abc'))[0].code).toBe('type');
  });

  it('inside an object: a default fills an absent field while a required sibling still errors', () => {
    const s = object({ q: str(), page: optional(num({ int: true, min: 1 }), 1) });
    expect(s.decode({ q: 'hi' })).toEqual({ ok: true, value: { q: 'hi', page: 1 } });
    expect(issuesOf(s.decode({})).map((i) => i.pointer)).toContain('/q');
  });

  it('inside an object: a PRESENT but invalid optional value errors, not silently defaulted', () => {
    const s = object({ page: optional(num({ int: true, min: 1 }), 5) });
    expect(issuesOf(s.decode({ page: 'abc' }))[0]).toMatchObject({
      pointer: '/page',
      code: 'type',
    });
  });

  it('a default that is a falsy value (0) is still applied', () => {
    const offset = optional(num({ int: true, min: 0 }), 0);
    expect(offset.decode(undefined)).toEqual({ ok: true, value: 0 });
  });

  it('a mutable (object) default is cloned per decode, never shared by reference', () => {
    const filter = optional(object({ tag: str() }), { tag: 'all' });
    const first = filter.decode(undefined);
    const second = filter.decode(undefined);
    expect(first).toEqual({ ok: true, value: { tag: 'all' } });
    if (first.ok && second.ok && first.value && second.value) {
      expect(first.value).not.toBe(second.value); // distinct instances
      (first.value as { tag: string }).tag = 'mutated';
      expect((second.value as { tag: string }).tag).toBe('all'); // unpoisoned
    }
  });

  it('inside an object: a mutable default is cloned per decode via the object path, never shared', () => {
    // object() resolves an absent optional field through makeDefault(), a SEPARATE clone site from
    // optional().decode(undefined); this pins that path so a future drop of its clone is caught.
    const s = object({ filter: optional(object({ tag: str() }), { tag: 'all' }) });
    const first = s.decode({});
    const second = s.decode({});
    expect(first).toEqual({ ok: true, value: { filter: { tag: 'all' } } });
    if (first.ok && second.ok) {
      const a = first.value.filter;
      const b = second.value.filter;
      expect(a).not.toBe(b); // distinct instances through the object makeDefault path
      a.tag = 'mutated';
      expect(b.tag).toBe('all'); // unpoisoned across decodes
    }
  });
});

describe(':id and page/pageSize bounds', () => {
  it(':id-style: "7" decodes to 7 and "abc" yields an issue (never NaN)', () => {
    const id = num({ int: true, min: 1 });
    expect(id.decode('7')).toEqual({ ok: true, value: 7 });
    expect(issuesOf(id.decode('abc'))[0].code).toBe('type');
  });

  it('page/pageSize: accepts the boundary values and rejects just outside', () => {
    const page = num({ int: true, min: 1, max: 100 });
    expect(page.decode('1')).toEqual({ ok: true, value: 1 });
    expect(page.decode('100')).toEqual({ ok: true, value: 100 });
    expect(issuesOf(page.decode('0'))[0]).toMatchObject({ code: 'min', params: { min: 1 } });
    expect(issuesOf(page.decode('101'))[0]).toMatchObject({ code: 'max', params: { max: 100 } });
  });
});

describe('Standard Schema v1 ~standard adapter', () => {
  it('validate() returns the value on success', () => {
    const result = num({ min: 5 })['~standard'].validate(7) as StandardSchemaResult<number>;
    expect(result).toEqual({ value: 7 });
  });

  it('validate() emits CODES, not English, and a path array', () => {
    const scalar = num({ min: 5 })['~standard'].validate(1) as StandardSchemaResult<number>;
    if (!('issues' in scalar) || !scalar.issues) throw new Error('expected issues');
    expect(scalar.issues[0]).toEqual({ message: 'min', path: [] });

    const nested = object({ id: num() })['~standard'].validate({
      id: 'x',
    }) as StandardSchemaResult<{
      id: number;
    }>;
    if (!('issues' in nested) || !nested.issues) throw new Error('expected issues');
    expect(nested.issues[0]).toEqual({ message: 'type', path: ['id'] });
  });

  it('validate() converts a multi-segment pointer into a nested path array', () => {
    const s = object({ parent: object({ child: num() }) });
    const result = s['~standard'].validate({ parent: { child: 'x' } }) as StandardSchemaResult<{
      parent: { child: number };
    }>;
    if (!('issues' in result) || !result.issues) throw new Error('expected issues');
    expect(result.issues[0]).toEqual({ message: 'type', path: ['parent', 'child'] });
  });

  it('reports version 1 and a non-empty vendor', () => {
    expect(num()['~standard'].version).toBe(1);
    expect(typeof num()['~standard'].vendor).toBe('string');
    expect(num()['~standard'].vendor.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Compile-time type-level assertions. tsconfig includes tests/, so `tsc --noEmit`
// evaluates these; a drift makes Expect<false> fail to satisfy `extends true`.
// ---------------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const inferSchema = object({
  id: num({ int: true, min: 1 }),
  name: str({ minLength: 1, maxLength: 24 }),
  active: bool(),
  sort: enum_(['asc', 'desc']),
  page: optional(num({ int: true, min: 1 }), 1),
  cursor: optional(str()),
});

type ExpectedInfer = {
  id: number;
  name: string;
  active: boolean;
  sort: 'asc' | 'desc';
  page: number;
  cursor: string | undefined;
};

type _InferIsExact = Expect<Equal<Infer<typeof inferSchema>, ExpectedInfer>>;

// Nested + optional(object()) inference is exact too (not just one flat level).
const nestedSchema = object({
  outer: str(),
  inner: object({ child: num(), flag: optional(bool()) }),
  filter: optional(object({ tag: str() })),
});
type ExpectedNested = {
  outer: string;
  inner: { child: number; flag: boolean | undefined };
  filter: { tag: string } | undefined;
};
type _NestedInferIsExact = Expect<Equal<Infer<typeof nestedSchema>, ExpectedNested>>;

// Each combinator's '~standard' is assignable to the vendored StandardSchemaProps.
const _stdNum: StandardSchemaProps<unknown, number> = num()['~standard'];
const _stdStr: StandardSchemaProps<unknown, string> = str()['~standard'];
const _stdBool: StandardSchemaProps<unknown, boolean> = bool()['~standard'];
const _stdEnum: StandardSchemaProps<unknown, 'a' | 'b'> = enum_(['a', 'b'])['~standard'];
const _stdObject: StandardSchemaProps<unknown, { id: number }> = object({ id: num() })['~standard'];
const _stdOptional: StandardSchemaProps<unknown, number | undefined> = optional(num())['~standard'];

// Infer drives the decoded value type with no parallel hand-written interface.
it('Infer types the decoded object value', () => {
  const result = inferSchema.decode({ id: '1', name: 'a', active: true, sort: 'asc' });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const typed: ExpectedInfer = result.value;
    expect(typed.page).toBe(1);
  }
});

it('decodes a nested + optional(object()) schema at runtime', () => {
  const result = nestedSchema.decode({ outer: 'x', inner: { child: '4' } });
  expect(result.ok).toBe(true);
  if (result.ok) {
    const typed: ExpectedNested = result.value;
    expect(typed.inner.child).toBe(4);
    expect(typed.inner.flag).toBeUndefined();
    expect(typed.filter).toBeUndefined();
  }
  expect(issuesOf(nestedSchema.decode({ outer: 'x', inner: { child: 'nope' } }))[0]).toMatchObject({
    pointer: '/inner/child',
    code: 'type',
  });
});
