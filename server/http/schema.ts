// In-house typed schema validator for the API request pipeline.
//
// A zero-dependency body/params/query decoder: object/str/num/bool/enum/optional combinators
// that validate and TYPE request input, derive the handler input type via Infer<typeof S>, and
// collect EVERY field issue in one pass as stable CODES, never English (the server stays
// language-agnostic; the client code-matcher re-localizes the code). Each schema conforms to
// Standard Schema v1, already vendored in ./types as the frozen single home of the spine type
// contracts, so this module IMPORTS it rather than redefining it. params and query arrive as
// STRINGS, so num()/bool() coerce a string and num() rejects NaN (a :id never reaches a DB call
// as NaN). No route wiring, DB, middleware, or domain limits live here.

import type {
  StandardSchemaIssue,
  StandardSchemaProps,
  StandardSchemaResult,
  StandardSchemaV1,
} from './types';

/** A single field validation failure: a JSON-pointer-ish location plus a stable code. */
export interface Issue {
  /** JSON-pointer-ish path, e.g. '/page' or '/parent/child'. */
  pointer: string;
  /** Stable code, never English: type|required|min|max|int|minLength|maxLength|enum. */
  code: string;
  /** Render params for the code, e.g. { min: 1 } for 'min'; absent when the code carries none. */
  params?: Record<string, string | number>;
}

/** Decode outcome: the typed value, or ALL field issues in one pass (never first-fail). */
export type DecodeResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/**
 * A validator for a value of type T. Extends the vendored Standard Schema v1 type so it
 * conforms type-only; the runtime path is decode(), which returns codes, not English.
 */
export interface Schema<T> extends StandardSchemaV1<unknown, T> {
  decode(input: unknown, pointer?: string): DecodeResult<T>;
}

/** Derive a schema's decoded handler-input type: Infer<typeof S>. */
export type Infer<S> = S extends Schema<infer T> ? T : never;

const VENDOR = 'woc';
// Canonical decimal form for string-to-number coercion: an optional sign and either
// integer/fraction digits or a leading-dot fraction. It deliberately rejects hex/octal/
// binary/scientific strings ('0x10', '0b1', '1e3') so a string param never decodes to a
// surprising value. Anchored, with disjoint alternatives, so it is linear (ReDoS-safe).
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Split a pointer string '/a/b' into the Standard Schema path ['a', 'b']. */
function pointerToPath(pointer: string): string[] {
  return pointer === '' ? [] : pointer.slice(1).split('/');
}

/**
 * Wrap a decode fn into a Schema, attaching a real, conformant '~standard' whose validate()
 * is a thin sync adapter over decode() (still codes-only: the issue message carries the code).
 */
function makeSchema<T>(decode: Schema<T>['decode']): Schema<T> {
  const props: StandardSchemaProps<unknown, T> = {
    version: 1,
    vendor: VENDOR,
    validate: (value): StandardSchemaResult<T> => {
      const result = decode(value);
      if (result.ok) return { value: result.value };
      const issues: StandardSchemaIssue[] = result.issues.map((issue) => ({
        message: issue.code,
        path: pointerToPath(issue.pointer),
      }));
      return { issues };
    },
  };
  return { decode, '~standard': props };
}

/** Build a single-issue failure result (assignable to any DecodeResult<T>). */
function fail(pointer: string, code: string, params?: Issue['params']): DecodeResult<never> {
  return { ok: false, issues: [params ? { pointer, code, params } : { pointer, code }] };
}

export interface StrOpts {
  minLength?: number;
  maxLength?: number;
}

/** A string, optionally length-bounded. */
export function str(opts: StrOpts = {}): Schema<string> {
  return makeSchema<string>((input, pointer = '') => {
    if (typeof input !== 'string') return fail(pointer, 'type');
    const issues: Issue[] = [];
    if (opts.minLength !== undefined && input.length < opts.minLength) {
      issues.push({ pointer, code: 'minLength', params: { minLength: opts.minLength } });
    }
    if (opts.maxLength !== undefined && input.length > opts.maxLength) {
      issues.push({ pointer, code: 'maxLength', params: { maxLength: opts.maxLength } });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: input };
  });
}

export interface NumOpts {
  int?: boolean;
  min?: number;
  max?: number;
}

/**
 * A number. A string is coerced (params and query arrive as strings) but ONLY in canonical
 * decimal form (see DECIMAL); hex/scientific strings and NaN/non-finite are rejected with code
 * 'type', so a :id never decodes to a surprising value. With { int } the value must be a SAFE
 * integer (exactly representable, no aliasing of two distinct strings past 2^53).
 */
export function num(opts: NumOpts = {}): Schema<number> {
  return makeSchema<number>((input, pointer = '') => {
    let value: number;
    if (typeof input === 'number') value = input;
    else if (typeof input === 'string' && DECIMAL.test(input.trim())) value = Number(input.trim());
    else value = Number.NaN;
    if (!Number.isFinite(value)) return fail(pointer, 'type');
    const issues: Issue[] = [];
    if (opts.int && !Number.isSafeInteger(value)) issues.push({ pointer, code: 'int' });
    if (opts.min !== undefined && value < opts.min) {
      issues.push({ pointer, code: 'min', params: { min: opts.min } });
    }
    if (opts.max !== undefined && value > opts.max) {
      issues.push({ pointer, code: 'max', params: { max: opts.max } });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
  });
}

/** A boolean; the strings 'true'/'1' and 'false'/'0' coerce (query/params arrive as strings). */
export function bool(): Schema<boolean> {
  return makeSchema<boolean>((input, pointer = '') => {
    if (typeof input === 'boolean') return { ok: true, value: input };
    // Trim string input for parity with num()'s string coercion (' true ' from a query value).
    const raw = typeof input === 'string' ? input.trim() : input;
    if (raw === 'true' || raw === '1') return { ok: true, value: true };
    if (raw === 'false' || raw === '0') return { ok: true, value: false };
    return fail(pointer, 'type');
  });
}

/** A string restricted to one of `values`; a non-member yields code 'enum'. */
export function enum_<const V extends readonly string[]>(values: V): Schema<V[number]> {
  return makeSchema<V[number]>((input, pointer = '') => {
    if (typeof input === 'string' && (values as readonly string[]).includes(input)) {
      return { ok: true, value: input as V[number] };
    }
    return fail(pointer, 'enum');
  });
}

type Shape = Record<string, Schema<unknown>>;
type InferShape<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

/** Optional-field metadata that object() reads to allow absence and apply a default. */
interface OptionalSchema<T> extends Schema<T> {
  readonly optional: true;
  readonly makeDefault?: () => T;
}

function isOptional(s: Schema<unknown>): s is OptionalSchema<unknown> {
  return (s as Partial<OptionalSchema<unknown>>).optional === true;
}

/**
 * An object that reads ONLY declared keys (an input __proto__/constructor key is never read),
 * builds its output into a NULL-prototype object (so even a shape that declared a __proto__ key
 * could not pollute a prototype), collects every field issue in one pass, and nests child
 * pointers ('/parent/child').
 */
export function object<S extends Shape>(shape: S): Schema<InferShape<S>> {
  const keys = Object.keys(shape);
  return makeSchema<InferShape<S>>((input, pointer = '') => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail(pointer, 'type');
    }
    const source = input as Record<string, unknown>;
    const value: Record<string, unknown> = Object.create(null);
    const issues: Issue[] = [];
    for (const key of keys) {
      const child = shape[key];
      const childPointer = `${pointer}/${key}`;
      if (Object.hasOwn(source, key) && source[key] !== undefined) {
        const result = child.decode(source[key], childPointer);
        if (result.ok) value[key] = result.value;
        else issues.push(...result.issues);
      } else if (isOptional(child)) {
        value[key] = child.makeDefault ? child.makeDefault() : undefined;
      } else {
        issues.push({ pointer: childPointer, code: 'required' });
      }
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as InferShape<S> };
  });
}

/** Clone a default per use so a mutable (object/array) default is never shared across decodes. */
function cloneDefault<T>(def: T): T {
  return def !== null && typeof def === 'object' ? structuredClone(def) : def;
}

/** Make a field optional: absent input yields `def` (cloned) when supplied, else undefined. */
export function optional<T>(inner: Schema<T>): Schema<T | undefined>;
export function optional<T>(inner: Schema<T>, def: T): Schema<T>;
export function optional<T>(inner: Schema<T>, ...rest: [T] | []): Schema<T | undefined> {
  const hasDefault = rest.length > 0;
  const def = rest[0];
  const base = makeSchema<T | undefined>((input, pointer = '') => {
    if (input === undefined) return { ok: true, value: hasDefault ? cloneDefault(def) : undefined };
    return inner.decode(input, pointer);
  });
  const marked: OptionalSchema<T | undefined> = {
    ...base,
    optional: true,
    makeDefault: hasDefault ? () => cloneDefault(def) : undefined,
  };
  return marked;
}
