// Self-tests for the registry-introspection helpers. They prove the BOLA :id
// coverage rule (including the operator-scope exclusion) and the completeness
// checks against compliant and non-compliant fixtures.
import { describe, expect, it } from 'vitest';
import type { Ctx, RouteDef } from '../../../server/http/types';
import { checkRequireOwnedCoverage, checkRouteCompleteness } from './registry_introspect';

const noopHandler = (_ctx: Ctx): unknown => undefined;

describe('checkRequireOwnedCoverage', () => {
  it('yields no issues for a compliant route set', () => {
    const routes: RouteDef[] = [
      // Account-owned :id route WITH requireOwned ownerScope 'account'.
      {
        method: 'GET',
        path: '/api/characters/:id',
        surface: 'api',
        handler: noopHandler,
        meta: { requireOwned: { kind: 'character', ownerScope: 'account' } },
      },
      // Operator admin :id route WITHOUT requireOwned -> excluded (admin surface).
      {
        method: 'GET',
        path: '/admin/api/accounts/:id',
        surface: 'admin',
        handler: noopHandler,
      },
      // Param-less route -> OK.
      { method: 'GET', path: '/api/leaderboard', surface: 'api', handler: noopHandler },
      // Intentionally-public :id read marked meta.publicRead -> exempt, no loader needed.
      {
        method: 'GET',
        path: '/api/characters/:id/sheet',
        surface: 'api',
        handler: noopHandler,
        meta: { publicRead: true },
      },
    ];
    expect(checkRequireOwnedCoverage(routes)).toEqual([]);
  });

  it('still flags an account-owned :id route that is NOT marked publicRead', () => {
    const routes: RouteDef[] = [
      { method: 'GET', path: '/api/characters/:id', surface: 'api', handler: noopHandler },
    ];
    expect(checkRequireOwnedCoverage(routes)).toContainEqual({
      path: '/api/characters/:id',
      method: 'GET',
      problem: 'missing-require-owned',
    });
  });

  it('flags an account-owned :id route missing requireOwned, and an operator scope on a non-admin path', () => {
    const routes: RouteDef[] = [
      // Account-owned :id route MISSING requireOwned.
      { method: 'GET', path: '/api/characters/:id', surface: 'api', handler: noopHandler },
      // ownerScope 'operator' on a non-admin path.
      {
        method: 'POST',
        path: '/api/guilds/:id',
        surface: 'api',
        handler: noopHandler,
        meta: { requireOwned: { kind: 'guild', ownerScope: 'operator' } },
      },
    ];
    const issues = checkRequireOwnedCoverage(routes);
    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual({
      path: '/api/characters/:id',
      method: 'GET',
      problem: 'missing-require-owned',
    });
    expect(issues).toContainEqual({
      path: '/api/guilds/:id',
      method: 'POST',
      problem: 'wrong-owner-scope',
    });
  });
});

describe('checkRouteCompleteness', () => {
  it('yields no issues for complete routes', () => {
    const routes: RouteDef[] = [
      { method: 'GET', path: '/api/x', surface: 'api', handler: noopHandler },
    ];
    expect(checkRouteCompleteness(routes)).toEqual([]);
  });

  it('reports a missing handler', () => {
    const routes = [{ method: 'GET', path: '/api/x', surface: 'api' } as unknown as RouteDef];
    const issues = checkRouteCompleteness(routes);
    expect(issues).toContainEqual({ path: '/api/x', method: 'GET', problem: 'missing-handler' });
  });

  it('reports a missing path and a missing method', () => {
    const routes = [
      { method: 'GET', path: '', surface: 'api', handler: noopHandler } as unknown as RouteDef,
      { method: '', path: '/api/y', surface: 'api', handler: noopHandler } as unknown as RouteDef,
    ];
    const issues = checkRouteCompleteness(routes);
    expect(issues.some((i) => i.problem === 'missing-path')).toBe(true);
    expect(issues.some((i) => i.problem === 'missing-method')).toBe(true);
  });
});
