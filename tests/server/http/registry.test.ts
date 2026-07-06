// Unit tests for the route registry (server/http/registry.ts): resolve()
// reuses the table router, the specificity sort orders overlapping dynamic
// routes, duplicate registrations are rejected at build time, and the BOLA-shadow
// guard fails a construction that would leave an account-owned route interceptable
// by an earlier, non-owned catch-all.

import { describe, expect, it } from 'vitest';
import {
  apiRegistry,
  apiRoutes,
  assertNoOwnedRouteShadowing,
  createApiRegistry,
} from '../../../server/http/registry';
import type { Method, RouteDef } from '../../../server/http/types';

const noopHandler = async (): Promise<void> => {};

function route(method: Method, path: string, meta?: RouteDef['meta']): RouteDef {
  return { method, path, surface: 'api', handler: noopHandler, meta };
}

function ownedAccount(method: Method, path: string, kind = 'thing'): RouteDef {
  return route(method, path, { requireOwned: { kind, ownerScope: 'account' } });
}

describe('createApiRegistry resolve()', () => {
  it('matches a registered dynamic route and captures its params', () => {
    const things = route('GET', '/api/things/:id');
    const registry = createApiRegistry([things]);
    const result = registry.resolve('GET', '/api/things/42');
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected a matched result');
    expect(result.route).toBe(things);
    expect(result.params.id).toBe('42');
    expect(Object.keys(result.params)).toEqual(['id']);
    expect(result.head).toBe(false);
  });

  it('matches a registered static route with empty params', () => {
    const health = route('GET', '/api/health');
    const registry = createApiRegistry([health]);
    const result = registry.resolve('GET', '/api/health');
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected a matched result');
    expect(result.route).toBe(health);
    expect(Object.keys(result.params)).toEqual([]);
  });

  it('serves HEAD from a registered GET route with head: true', () => {
    const registry = createApiRegistry([route('GET', '/api/health')]);
    const result = registry.resolve('HEAD', '/api/health');
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected a matched result');
    expect(result.head).toBe(true);
  });

  it('returns notFound for an unregistered path (the dispatcher delegates on this)', () => {
    const registry = createApiRegistry([route('GET', '/api/things/:id')]);
    expect(registry.resolve('GET', '/api/nope').kind).toBe('notFound');
  });

  it('returns methodNotAllowed with an Allow set for a known path under a wrong method', () => {
    const registry = createApiRegistry([route('GET', '/api/things/:id')]);
    const result = registry.resolve('POST', '/api/things/42');
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind !== 'methodNotAllowed') throw new Error('expected methodNotAllowed');
    expect(result.allow).toContain('GET');
  });
});

describe('createApiRegistry build-time rejection', () => {
  it('rejects a duplicate (method, path) registration (inherited from createRouter)', () => {
    const dupA = route('GET', '/api/dup');
    const dupB = route('GET', '/api/dup');
    expect(() => createApiRegistry([dupA, dupB])).toThrow();
  });
});

describe('specificity ordering', () => {
  it('resolves an overlapping request to the more specific route regardless of input order', () => {
    const owned = ownedAccount('GET', '/api/things/:id');
    const catchAll = route('GET', '/api/:a/:b');
    // catchAll is registered FIRST; the sort must still place owned ahead so the
    // request lands on the specific route, and the shadow guard must not throw.
    const registry = createApiRegistry([catchAll, owned]);
    const result = registry.resolve('GET', '/api/things/42');
    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected a matched result');
    expect(result.route).toBe(owned);
  });
});

describe('assertNoOwnedRouteShadowing', () => {
  it('does not throw when the owned route precedes the non-owned catch-all', () => {
    const owned = ownedAccount('GET', '/api/things/:id');
    const catchAll = route('GET', '/api/:a/:b');
    expect(() => assertNoOwnedRouteShadowing([owned, catchAll])).not.toThrow();
  });

  it('throws when a non-owned catch-all precedes an owned route it overlaps', () => {
    const shadow = route('GET', '/api/public/:id');
    const owned = ownedAccount('GET', '/api/:kind/:id');
    expect(() => assertNoOwnedRouteShadowing([shadow, owned])).toThrow();
  });

  it('flags the shadow through createApiRegistry when the sort cannot save the owned route', () => {
    // /api/public/:id (two leading literals) sorts ahead of /api/:kind/:id (one),
    // so even after the specificity sort the owned route stays shadowed.
    const owned = ownedAccount('GET', '/api/:kind/:id');
    const shadow = route('GET', '/api/public/:id');
    expect(() => createApiRegistry([owned, shadow])).toThrow();
  });

  it('ignores an earlier route under a different method', () => {
    const shadow = route('POST', '/api/:a/:b');
    const owned = ownedAccount('GET', '/api/orders/:id');
    expect(() => assertNoOwnedRouteShadowing([shadow, owned])).not.toThrow();
  });

  it('ignores an earlier route that runs its own ownership loader', () => {
    const earlierOwned = route('GET', '/api/public/:id', {
      requireOwned: { kind: 'operatorThing', ownerScope: 'operator' },
    });
    const owned = ownedAccount('GET', '/api/:kind/:id');
    expect(() => assertNoOwnedRouteShadowing([earlierOwned, owned])).not.toThrow();
  });

  it('ignores an earlier static route (matched before any dynamic pattern)', () => {
    const staticSpecial = route('GET', '/api/things/featured');
    const owned = ownedAccount('GET', '/api/things/:id');
    expect(() => assertNoOwnedRouteShadowing([staticSpecial, owned])).not.toThrow();
  });

  it('does not flag a static owned route (the static exact-map wins first)', () => {
    const catchAll = route('GET', '/api/:x');
    const ownedStatic = route('GET', '/api/me', {
      requireOwned: { kind: 'me', ownerScope: 'account' },
    });
    expect(() => assertNoOwnedRouteShadowing([catchAll, ownedStatic])).not.toThrow();
  });

  it('does not throw when a non-overlapping catch-all of a different length precedes an owned route', () => {
    const shorter = route('GET', '/api/:only');
    const owned = ownedAccount('GET', '/api/things/:id');
    expect(() => assertNoOwnedRouteShadowing([shorter, owned])).not.toThrow();
  });
});

describe('apiRoutes / apiRegistry defaults', () => {
  it('registers the public-read domain and matches its paths', () => {
    // The public-read domain (server/leaderboard.ts) lives on the RouteDef table,
    // so apiRoutes is non-empty; the default registry owns those GET paths.
    expect(apiRoutes.length).toBeGreaterThan(0);
    expect(apiRegistry.resolve('GET', '/api/leaderboard').kind).toBe('matched');
    expect(apiRegistry.resolve('GET', '/api/public/characters/someone/sheet').kind).toBe('matched');
  });

  it('still delegates (notFound) for a path no migrated domain owns', () => {
    expect(apiRegistry.resolve('GET', '/api/anything').kind).toBe('notFound');
  });
});
