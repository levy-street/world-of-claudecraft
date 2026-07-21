// In-house table router for the API request pipeline.
//
// A pure (method, path) -> MatchResult function over a static-Map + dynamic
// table. It is the match PRIMITIVE the dispatcher places ahead of the
// legacy handleApi ladder. It writes no response, sets no header, parses no
// body, runs no middleware, and chooses no error envelope: it returns a small
// discriminated MatchResult and lets the dispatcher (dispatch.ts) and the error
// model (errors.ts) own every write.
//
// HEAD is served as GET (with head: true on the result); OPTIONS is synthesized
// from the real method set for the path (the dispatcher serves it as 204 with
// Allow + Vary: Origin); a known path under an unsupported method returns an
// honest 405 + Allow (the anti-enumeration 404-instead-of-405 override on auth
// routes is applied by the dispatcher from an explicit list, never here). Matching is
// no-regex by construction: it delegates to the pure path_pattern helpers, so
// there is no per-request regex.

import {
  type CompiledPattern,
  compilePattern,
  type HttpMethod,
  matchPattern,
  normalizePath,
} from './path_pattern';

/** The minimal route shape the router needs: a method and a path pattern. */
export interface RoutePattern {
  method: HttpMethod;
  path: string;
}

/** The outcome of matching one (method, path) pair against the route table. */
export type MatchResult<R> =
  | { kind: 'matched'; route: R; params: Record<string, string>; head: boolean }
  | { kind: 'methodNotAllowed'; allow: HttpMethod[] }
  | { kind: 'options'; allow: HttpMethod[] }
  | { kind: 'notFound' };

/** A built route table. match() is pure and allocation-light on the hot path. */
export interface Router<R extends RoutePattern> {
  match(method: string, path: string): MatchResult<R>;
}

/**
 * Canonical Allow-header ordering for the HTTP methods, as a COMPLETE map keyed
 * by every HttpMethod. Because it is typed `Record<HttpMethod, number>`, adding a
 * method to the canonical Method union (server/http/types.ts) without giving it
 * an order here is a tsc error, so the Allow set can never silently drop a
 * method. The synthesized HEAD/OPTIONS sit in their conventional positions (HEAD
 * after GET, OPTIONS last).
 */
const METHOD_ORDER: Record<HttpMethod, number> = {
  GET: 0,
  HEAD: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
  OPTIONS: 6,
};

const HEAD: HttpMethod = 'HEAD';
const GET: HttpMethod = 'GET';
const OPTIONS: HttpMethod = 'OPTIONS';

/**
 * HEAD and OPTIONS are SYNTHESIZED by the router (HEAD from GET, OPTIONS from the
 * real method set), so registering them as real routes is rejected to avoid a
 * silently shadowed handler.
 */
const SYNTHESIZED_METHODS: ReadonlySet<HttpMethod> = new Set([HEAD, OPTIONS]);

/**
 * The methods a route may be registered under: every canonical method except the
 * synthesized ones. Derived from METHOD_ORDER so a new Method is covered
 * automatically; held as a Set for membership tests that are safe against an
 * untrusted method token (no prototype-chain pitfall).
 */
const REGISTRABLE_METHODS: readonly HttpMethod[] = (
  Object.keys(METHOD_ORDER) as HttpMethod[]
).filter((method) => !SYNTHESIZED_METHODS.has(method));
const REGISTRABLE_METHOD_SET: ReadonlySet<HttpMethod> = new Set(REGISTRABLE_METHODS);

interface MethodTable<R> {
  /** Param-free paths, keyed by normalized path for O(1) exact lookup. */
  readonly static: Map<string, R>;
  /**
   * Param paths, scanned in registration order. A whole-path static match always
   * wins over any dynamic pattern (static is checked first), so a literal segment
   * beats a ':param' at the same position. Two dynamic patterns of DIFFERENT
   * shape that overlap on some path (e.g. '/:a/b' and '/x/:c' both match '/x/b')
   * resolve to the FIRST registered; ordering those by specificity is the
   * registry's job. Same-shape dynamic duplicates are rejected at build time (see
   * createRouter).
   */
  readonly dynamic: { pattern: CompiledPattern; route: R }[];
}

function sortAllow(methods: Set<HttpMethod>): HttpMethod[] {
  return [...methods].sort((a, b) => METHOD_ORDER[a] - METHOD_ORDER[b]);
}

function pathExistsIn<R extends RoutePattern>(table: MethodTable<R>, path: string): boolean {
  if (table.static.has(path)) return true;
  for (const entry of table.dynamic) {
    if (matchPattern(entry.pattern, path)) return true;
  }
  return false;
}

/**
 * Compute the Allow set for a normalized path: every real method registered for
 * the path, plus synthesized HEAD (whenever GET is present) and OPTIONS (always,
 * when the path matches at least one method). Returns an empty array when the
 * path is unknown. Deterministically sorted by METHOD_ORDER.
 */
function computeAllow<R extends RoutePattern>(
  tables: Map<HttpMethod, MethodTable<R>>,
  path: string,
): HttpMethod[] {
  const methods = new Set<HttpMethod>();
  for (const [method, table] of tables) {
    if (pathExistsIn(table, path)) methods.add(method);
  }
  if (methods.size === 0) return [];
  if (methods.has(GET)) methods.add(HEAD);
  methods.add(OPTIONS);
  return sortAllow(methods);
}

/**
 * Build a router from a flat list of routes. Param-free paths go in a per-method
 * static Map for O(1) exact lookup; param paths go in a per-method dynamic list
 * in registration order. THROWS on a route registered under a non-registrable
 * method (HEAD/OPTIONS or junk) and on a duplicate (method, normalized path).
 */
export function createRouter<R extends RoutePattern>(routes: readonly R[]): Router<R> {
  const tables = new Map<HttpMethod, MethodTable<R>>();
  // Maps a (method, shape) key to the first raw path registered with that shape.
  // The shape replaces each param with a ':' placeholder (a literal can never be
  // or contain ':'), so two patterns that match the IDENTICAL set of request
  // paths collide and throw: textual duplicates ('/a' and '/a'), trailing-slash
  // duplicates ('/a' and '/a/'), and param-name-equivalent duplicates ('/a/:x'
  // and '/a/:y', where the second would otherwise be silently unreachable).
  const shapes = new Map<string, string>();
  for (const route of routes) {
    if (!REGISTRABLE_METHOD_SET.has(route.method)) {
      throw new Error(
        `Cannot register route method ${JSON.stringify(route.method)} for ${JSON.stringify(route.path)} (HEAD and OPTIONS are synthesized by the router; only ${REGISTRABLE_METHODS.join(', ')} may be registered)`,
      );
    }
    const pattern = compilePattern(route.path);
    const shapeKey = `${route.method} ${pattern.segments
      .map((segment) => (segment.kind === 'literal' ? segment.value : ':'))
      .join('/')}`;
    const prior = shapes.get(shapeKey);
    if (prior !== undefined) {
      throw new Error(
        `Conflicting route registration: ${route.method} ${route.path} matches the same request paths as ${route.method} ${prior}`,
      );
    }
    shapes.set(shapeKey, route.path);
    let table = tables.get(route.method);
    if (!table) {
      table = { static: new Map(), dynamic: [] };
      tables.set(route.method, table);
    }
    if (pattern.isStatic) {
      table.static.set(normalizePath(route.path), route);
    } else {
      table.dynamic.push({ pattern, route });
    }
  }

  // `method` is the raw request method token. HTTP method tokens are case-
  // sensitive (RFC 9110) and Node delivers them uppercase, so this does not
  // upper/lower-case the input: an unknown token (junk, or a lowercase method)
  // misses every method table and falls through to an honest 405 on a known path
  // or notFound on an unknown one.
  function match(method: string, path: string): MatchResult<R> {
    const normalized = normalizePath(path);
    if (method === OPTIONS) {
      const allow = computeAllow(tables, normalized);
      return allow.length > 0 ? { kind: 'options', allow } : { kind: 'notFound' };
    }
    const head = method === HEAD;
    const lookupMethod = head ? GET : (method as HttpMethod);
    const table = tables.get(lookupMethod);
    if (table) {
      const exact = table.static.get(normalized);
      if (exact) return { kind: 'matched', route: exact, params: {}, head };
      for (const entry of table.dynamic) {
        const params = matchPattern(entry.pattern, normalized);
        if (params) return { kind: 'matched', route: entry.route, params, head };
      }
    }
    const allow = computeAllow(tables, normalized);
    if (allow.length > 0) return { kind: 'methodNotAllowed', allow };
    return { kind: 'notFound' };
  }

  return { match };
}
