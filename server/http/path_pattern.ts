// Pure path-pattern compiler, no-regex routing guard, and matcher for the API
// request pipeline table router.
//
// Host-agnostic and PURE: this module imports nothing from src/sim, render, ui,
// game, or net, touches no DOM/Three, and references no req/res and no node:http
// at runtime. The only import is a TYPE-ONLY re-use of the canonical Method
// union (server/http/types.ts), which the compiler erases, so the emitted JS has
// zero runtime dependencies.
//
// The guard is no-regex by construction: it never builds a regular expression
// (dynamic or literal) to validate a pattern, and matching compares segments by
// string equality, so there is no per-request regex and no catastrophic-
// backtracking surface. The router (server/http/router.ts) is its thin consumer.

import type { Method } from './types';

/**
 * The HTTP method union the router subsystem speaks. This is an ALIAS of the
 * canonical Method (server/http/types.ts), which stays the single source of
 * truth; the router contract refers to it as HttpMethod, so we expose that
 * name without re-declaring the method set.
 */
export type HttpMethod = Method;

/** One compiled segment of a route pattern: a fixed literal or a ":name" param. */
export type PatternSegment = { kind: 'literal'; value: string } | { kind: 'param'; name: string };

/** A route pattern compiled into ordered segments, with param metadata. */
export interface CompiledPattern {
  /** The original path string passed to compilePattern (for diagnostics). */
  raw: string;
  /** Ordered segments; static patterns have only literal segments. */
  segments: PatternSegment[];
  /** True when the pattern has no param segments (eligible for the static map). */
  isStatic: boolean;
  /** Param names in declaration order (e.g. ['id'] for '/api/x/:id'). */
  paramNames: string[];
}

/**
 * Characters that signal a regular expression, a glob/wildcard, an alternation
 * group, or a misplaced param marker. A LITERAL segment containing any of these
 * is rejected by the no-regex routing guard. A literal '.' is intentionally
 * allowed: it is matched by exact string equality (not as a wildcard), and real
 * routes contain dotted segments (e.g. a '.well-known' path).
 */
const FORBIDDEN_LITERAL_CHARS: ReadonlySet<string> = new Set('*()|^$[]{}?+\\:');

/**
 * Param names that collide with a JavaScript object's prototype machinery when
 * used as a key on the captured-params object. Rejected at compile time so a
 * route can never declare a param that would be silently dropped (the '__proto__'
 * setter ignores a string assignment) or shadow an inherited property. Param
 * VALUES come from the wire but are only ever assigned to these validated,
 * developer-chosen NAMES (never used as keys), so there is no runtime
 * prototype-pollution path; this guards the developer-facing footgun.
 */
const RESERVED_PARAM_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const CHAR_UPPER_A = 65;
const CHAR_UPPER_Z = 90;
const CHAR_LOWER_A = 97;
const CHAR_LOWER_Z = 122;
const CHAR_UNDERSCORE = 95;
const CHAR_DIGIT_0 = 48;
const CHAR_DIGIT_9 = 57;
const CHAR_SLASH = 47;
const CHAR_COLON = 58;

/** A param name may start with an ASCII letter or an underscore. */
function isParamNameStart(code: number): boolean {
  return (
    (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z) ||
    (code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z) ||
    code === CHAR_UNDERSCORE
  );
}

/** A param name may continue with an ASCII letter, digit, or underscore. */
function isParamNameContinue(code: number): boolean {
  return isParamNameStart(code) || (code >= CHAR_DIGIT_0 && code <= CHAR_DIGIT_9);
}

/**
 * Validate a param name char by char (no regex). Accepts [A-Za-z_][A-Za-z0-9_]*,
 * which means a bare ':' (empty name) and a name starting with a digit are both
 * rejected.
 */
function isValidParamName(name: string): boolean {
  if (name.length === 0) return false;
  if (!isParamNameStart(name.charCodeAt(0))) return false;
  for (let i = 1; i < name.length; i++) {
    if (!isParamNameContinue(name.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Split a path into its segments AFTER the leading slash, preserving internal
 * empty segments (a '//' double slash) so the matcher never collapses internal
 * slashes. Root '/' yields zero segments. A path is expected to start with '/'.
 */
function splitSegments(path: string): string[] {
  if (path === '/') return [];
  const body = path.charCodeAt(0) === CHAR_SLASH ? path.slice(1) : path;
  return body.split('/');
}

/**
 * Strip exactly one trailing slash from a path, unless the path is the root '/'.
 * Does NOT collapse internal slashes, decode percent-encoding, or resolve '..';
 * the request-context builder (context.ts) owns URL parsing and hands the router a clean
 * pathname. Idempotent for a single trailing slash; a path with two trailing
 * slashes loses one per call.
 */
export function normalizePath(path: string): string {
  if (path.length > 1 && path.charCodeAt(path.length - 1) === CHAR_SLASH) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Compile a route pattern into ordered segments and run the no-regex routing
 * guard. THROWS on a path that does not start with '/', an internal empty
 * segment (double slash), a literal segment containing a regex/glob/group/param
 * metacharacter, a bare ':' or a malformed ':name' param, a ':' that is not at
 * the start of a segment, or a duplicate param name. A single trailing slash is
 * tolerated (normalized away) so a pattern and its slashed form compile alike.
 */
export function compilePattern(path: string): CompiledPattern {
  if (typeof path !== 'string' || path.length === 0 || path.charCodeAt(0) !== CHAR_SLASH) {
    throw new Error(
      `Route pattern must be a non-empty path starting with "/": ${JSON.stringify(path)}`,
    );
  }
  const segments: PatternSegment[] = [];
  const paramNames: string[] = [];
  for (const part of splitSegments(normalizePath(path))) {
    if (part.length === 0) {
      throw new Error(
        `Empty path segment (double slash) is not allowed in route pattern: ${JSON.stringify(path)}`,
      );
    }
    if (part.charCodeAt(0) === CHAR_COLON) {
      const name = part.slice(1);
      if (!isValidParamName(name)) {
        throw new Error(
          `Invalid route param ":${name}" in pattern ${JSON.stringify(path)} (expected ":name" matching [A-Za-z_][A-Za-z0-9_]*)`,
        );
      }
      if (RESERVED_PARAM_NAMES.has(name)) {
        throw new Error(
          `Reserved route param ":${name}" in pattern ${JSON.stringify(path)} (a param may not be named __proto__, constructor, or prototype)`,
        );
      }
      if (paramNames.includes(name)) {
        throw new Error(`Duplicate route param ":${name}" in pattern ${JSON.stringify(path)}`);
      }
      paramNames.push(name);
      segments.push({ kind: 'param', name });
      continue;
    }
    for (const ch of part) {
      if (FORBIDDEN_LITERAL_CHARS.has(ch)) {
        throw new Error(
          `Illegal character ${JSON.stringify(ch)} in route segment ${JSON.stringify(part)} of pattern ${JSON.stringify(path)} (regex, wildcard, group, and enum-alternation patterns are not allowed)`,
        );
      }
    }
    segments.push({ kind: 'literal', value: part });
  }
  return { raw: path, segments, isStatic: paramNames.length === 0, paramNames };
}

/**
 * Match an already-normalized request path against a compiled pattern. Returns
 * the captured params (an empty object for a fully static pattern) or null when
 * the path does not match. Comparison is segment count then segment-by-segment
 * string equality with param capture; there is no per-request regex. A param
 * never captures an empty segment (so a stray '//' cannot match a ':name'). The
 * params object has a NULL prototype (Object.create(null)) so a downstream
 * lookup by an untrusted key can never read an inherited Object.prototype
 * member; this is defense-in-depth on top of the compile-time reserved-name
 * guard (param VALUES from the wire are only ever stored under validated NAMES).
 */
export function matchPattern(
  pattern: CompiledPattern,
  path: string,
): Record<string, string> | null {
  const parts = splitSegments(path);
  if (parts.length !== pattern.segments.length) return null;
  const params: Record<string, string> = Object.create(null);
  for (let i = 0; i < pattern.segments.length; i++) {
    const segment = pattern.segments[i];
    const part = parts[i];
    if (segment.kind === 'literal') {
      if (segment.value !== part) return null;
    } else {
      if (part.length === 0) return null;
      params[segment.name] = part;
    }
  }
  return params;
}
