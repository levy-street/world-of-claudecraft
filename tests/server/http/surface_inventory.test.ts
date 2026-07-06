// Route-count freshness gate + content-type classification completeness for the
// surface inventory.
//
// Assertion 1 (FRESHNESS): re-derive the set of dispatched route descriptors
// directly from the dispatcher SOURCE files (as text: the four dispatchers plus
// every prefix-delegated sub-dispatcher module, see DISPATCHER_SOURCES) and
// assert it equals the set derivable from SURFACE_INVENTORY. A route added or
// removed in source without a matching inventory edit hard-fails. The gate
// anchors on route STRINGS and `*Match` regex SOURCES, never on line numbers.
//
// Assertion 2 (CLASSIFICATION COMPLETENESS): every `/api/*` path in the
// inventory has exactly one content-type class, the class map and the inventory
// cover the same set of /api paths, and the five class values are the named
// constants.
//
// What the freshness gate scans (so a future contributor can extend it):
//   * EXACT routes: any `=== '<path>'` comparison (regardless of left side, so
//     `url === ...`, `path === ...`, `url.pathname === ...` are all covered)
//     whose string begins with one of the four dispatched API prefixes
//     (/api/, /admin/api/, /internal/, /oauth/). This naturally excludes the
//     static/SSR prefix comparisons ('/', '/admin', '/wiki', '/p/', '/avatar/',
//     '/sitemap-characters.xml') and the `startsWith('/internal/discord/')`
//     prefix delegation (it is a prefix test, not an `=== '<path>'`).
//   * PARAM routes: every `const <name>Match = /<regex>/.exec(...)` whose regex
//     source begins with `^/<api-prefix>/`. This excludes the `^Bearer ...`
//     auth regexes.
//   * REGISTERED RouteDefs: every exact (non-:param) path in the route registry
//     (server/http/registry.ts apiRoutes). A registered RouteDef is a dispatch
//     arm all the same; until the ladder-deletion PR almost every migrated route
//     ALSO keeps its legacy `=== '<path>'` arm, so this union is a no-op for
//     them. It exists for families whose legacy serving is a SUFFIX-comparing
//     sub-dispatcher the text scan cannot see, and it keeps the gate correct
//     when the ladder deletion removes the legacy arms outright.
// To register a NEW route: add its row to SURFACE_INVENTORY (and, for an /api
// route, an API_CONTENT_TYPE entry). If it is a new `:param` route, give the row
// a `match` RegExp whose source equals the dispatcher's regex literal.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../../../server/http/registry';
import {
  API_CONTENT_TYPE,
  BINARY,
  CONTENT_TYPE_CLASSES,
  type ContentTypeClass,
  HTML,
  LEGACY_OKFALSE_405,
  PROBLEM_JSON,
  REDIRECT,
} from './content_type_classification';
import { DISPATCHED_PREFIXES, SURFACE_INVENTORY } from './surface_inventory';

// Resolve the dispatcher sources relative to THIS file, never the cwd (a shared
// worktree can run the suite from elsewhere). readFileSync accepts a URL.
//
// daily_rewards.ts is here because it is a PREFIX-DELEGATED sub-dispatcher: its
// exact-path arms sit behind `startsWith('/api/daily-rewards')` in main.ts and
// the /internal composite delegate, so scanning only the four dispatcher files
// misses them (the v0.19.0 merge added 6 routes the gate never saw). Any future
// module that owns its own `=== '/api/...'` (or /internal/, /oauth/, /admin/api/)
// path matching behind a prefix delegate MUST be added to this list, or its
// routes are invisible to the freshness gate.
const DISPATCHER_SOURCES = [
  new URL('../../../server/main.ts', import.meta.url),
  new URL('../../../server/admin.ts', import.meta.url),
  new URL('../../../server/oauth.ts', import.meta.url),
  new URL('../../../server/internal.ts', import.meta.url),
  new URL('../../../server/daily_rewards.ts', import.meta.url),
] as const;

const API_PREFIX_ALTERNATION = '(?:api|admin\\/api|internal|oauth)';

// Every `=== '<path>'` (or "<path>") comparison whose path starts with a
// dispatched API prefix. The quote is captured so the same quote closes it.
const EXACT_ROUTE_RE = new RegExp(`===\\s*(['"])(\\/${API_PREFIX_ALTERNATION}\\/[^'"]*)\\1`, 'g');

// Every `const <name>Match = /<regex>/.exec(...)`. Group 1 is the const name,
// group 2 is the regex source body (slash-escaped exactly as `RegExp.source`
// reports it). `(?:\\.|[^\/\\\n])*` consumes escaped chars (\/ , \d) and stops
// at the first unescaped closing slash.
const PARAM_ROUTE_RE = /const\s+(\w*Match)\s*=\s*\/((?:\\.|[^/\\\n])*)\/[a-z]*\.exec/g;

const API_REGEX_PREFIXES = ['^\\/api\\/', '^\\/admin\\/api\\/', '^\\/internal\\/', '^\\/oauth\\/'];

// Every method-first dispatch arm, `(req.)?method === 'METHOD' && <lhs> === '<path>'`
// where <lhs> is one of url / path / url.pathname / pathname and the path begins
// with a dispatched API prefix. Group 1 is the method, group 3 the path. This is a
// SUPPLEMENTARY, method-aware companion to EXACT_ROUTE_RE (which is path-only): it
// catches a new HTTP method added on an ALREADY-present path, which the path-set
// equality above cannot see. It is deliberately a SUBSET check (see the test): arms
// that do not pair method and path in one condition (internal restart-countdown
// gates the method inside the block; the admin/internal `*Match` param arms compare
// against a RegExp, not a literal) are simply not captured here and stay covered by
// the path-set and param-regex gates. (The table router supersedes this whole scan
// once the legacy ladder is removed; until then it keeps method drift from
// slipping in silently.)
const EXACT_METHOD_ROUTE_RE = new RegExp(
  `(?:req\\.)?method\\s*===\\s*'([A-Z]+)'\\s*&&\\s*(?:url\\.pathname|url|path|pathname)\\s*===\\s*(['"])(\\/${API_PREFIX_ALTERNATION}\\/[^'"]*)\\2`,
  'g',
);

function readSources(): string {
  return DISPATCHER_SOURCES.map((url) => readFileSync(url, 'utf8')).join('\n');
}

function sourceExactPaths(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(EXACT_ROUTE_RE)) found.add(m[2]);
  return found;
}

function sourceParamRegexSources(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(PARAM_ROUTE_RE)) {
    const body = m[2];
    if (API_REGEX_PREFIXES.some((p) => body.startsWith(p))) found.add(body);
  }
  return found;
}

// `${method} ${path}` pairs for every method-first exact dispatch arm in source.
function sourceMethodPathPairs(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(EXACT_METHOD_ROUTE_RE)) found.add(`${m[1]} ${m[3]}`);
  return found;
}

const startsWithDispatchedPrefix = (path: string): boolean =>
  DISPATCHED_PREFIXES.some((p) => path.startsWith(p));

// Inventory rows that participate in the source comparison: a concrete dispatch
// arm (skip the unreachable orphan and the OPTIONS '*' wildcard preflight).
const dispatchedRows = SURFACE_INVENTORY.filter(
  (r) => !r.unreachable && startsWithDispatchedPrefix(r.path),
);

const inventoryExactPaths = new Set(dispatchedRows.filter((r) => !r.match).map((r) => r.path));
const inventoryRegexSources = new Set(
  SURFACE_INVENTORY.filter((r) => !r.unreachable && r.match).map((r) => (r.match as RegExp).source),
);
// Every concrete (method, path) the inventory records for an exact dispatched arm.
const inventoryMethodPathPairs = new Set(
  dispatchedRows.filter((r) => !r.match).map((r) => `${r.method} ${r.path}`),
);

const sorted = (s: Set<string>): string[] => [...s].sort();

// Exact paths a registered RouteDef dispatches (the migrated router side of the
// flag). Param routes (:id) are excluded: their legacy arms are `*Match` regexes
// covered by the param gate below, and a RouteDef path template is not a regex
// source. Paths whose inventory row is flagged `unreachable` (the swag claim:
// registered, but deliberately recorded as having no legacy dispatch arm) keep
// that classification; the unreachable filter on dispatchedRows already excludes
// them from the inventory side, so they must not enter the source side either.
// See the header note on REGISTERED RouteDefs.
const inventoryUnreachablePaths = new Set(
  SURFACE_INVENTORY.filter((r) => r.unreachable).map((r) => r.path),
);
const registryExactPaths = new Set(
  apiRoutes
    .filter((r) => !r.path.includes(':') && !inventoryUnreachablePaths.has(r.path))
    .map((r) => r.path),
);

describe('surface inventory: route-count freshness gate', () => {
  it('exact dispatched paths in source equal the inventory exact paths', () => {
    const fromSource = sourceExactPaths(readSources());
    // Guard against a vacuous pass: the scan must actually find routes.
    expect(fromSource.size).toBeGreaterThan(50);
    for (const p of registryExactPaths) fromSource.add(p);
    expect(sorted(fromSource)).toEqual(sorted(inventoryExactPaths));
  });

  it('param (:id) regex routes in source equal the inventory match sources', () => {
    const fromSource = sourceParamRegexSources(readSources());
    expect(fromSource.size).toBeGreaterThan(10);
    expect(sorted(fromSource)).toEqual(sorted(inventoryRegexSources));
  });

  it('every method-first (method, path) arm in source has an inventory row', () => {
    // Catches method drift the path-only set above cannot: a new HTTP method added
    // on an already-present path (e.g. a future `method === 'PUT' && url === '/api/status'`)
    // leaves the path set unchanged but adds a new (method, path) pair here. Subset
    // (not equality): arms that do not pair method and path in one condition are not
    // captured and stay covered by the path-set / param-regex gates above.
    const fromSource = sourceMethodPathPairs(readSources());
    expect(fromSource.size).toBeGreaterThan(30);
    const missing = [...fromSource].filter((pair) => !inventoryMethodPathPairs.has(pair));
    expect(missing).toEqual([]);
  });

  it('the orphan and the OPTIONS preflight are excluded from the source set', () => {
    // The swag-claim orphan has no dispatch arm, so it must NOT appear in source.
    const fromSource = sourceExactPaths(readSources());
    expect(fromSource.has('/api/discord/swag/claim')).toBe(false);
    const orphan = SURFACE_INVENTORY.find((r) => r.path === '/api/discord/swag/claim');
    expect(orphan?.unreachable).toBe(true);
    const preflight = SURFACE_INVENTORY.find(
      (r) => r.handler === 'routeHttpRequest OPTIONS-204 arm',
    );
    expect(preflight?.method).toBe('OPTIONS');
    expect(startsWithDispatchedPrefix(preflight?.path ?? '')).toBe(false);
  });

  it('every inventory row is unique on (dispatcher, method, path, variant)', () => {
    const keys = SURFACE_INVENTORY.map(
      (r) => `${r.dispatcher}\u0000${r.method}\u0000${r.path}\u0000${r.variant ?? ''}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('surface inventory: content-type classification completeness', () => {
  const apiRows = SURFACE_INVENTORY.filter((r) => r.path.startsWith('/api/'));
  const apiPaths = new Set(apiRows.map((r) => r.path));

  it('exposes exactly the five named content-type classes', () => {
    expect([...CONTENT_TYPE_CLASSES]).toEqual([
      PROBLEM_JSON,
      HTML,
      REDIRECT,
      BINARY,
      LEGACY_OKFALSE_405,
    ]);
    expect(new Set(CONTENT_TYPE_CLASSES).size).toBe(5);
  });

  it('classifies every /api path exactly once and adds no extras', () => {
    expect(sorted(new Set(Object.keys(API_CONTENT_TYPE)))).toEqual(sorted(apiPaths));
  });

  it('agrees with each /api inventory row on its content-type class', () => {
    for (const r of apiRows) {
      expect(API_CONTENT_TYPE[r.path]).toBe(r.contentType);
    }
  });

  it('only ever assigns one of the five named classes', () => {
    const valid = new Set<ContentTypeClass>(CONTENT_TYPE_CLASSES);
    for (const value of Object.values(API_CONTENT_TYPE)) {
      expect(valid.has(value)).toBe(true);
    }
    for (const r of SURFACE_INVENTORY) {
      if (r.contentType !== null) expect(valid.has(r.contentType)).toBe(true);
    }
  });

  it('maps REDIRECT to zero routes today (defined for completeness only)', () => {
    expect(Object.values(API_CONTENT_TYPE)).not.toContain(REDIRECT);
    expect(SURFACE_INVENTORY.map((r) => r.contentType)).not.toContain(REDIRECT);
  });
});
