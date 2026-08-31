// Registry-introspection helpers over a RouteDef[] (the frozen contract). They
// return structured issue arrays and NEVER throw, so tests assert on the results.
//
// Two checks:
//  - checkRouteCompleteness: every route needs a method, a non-empty path, and a
//    handler function.
//  - checkRequireOwnedCoverage: the BOLA :id rule. A route with a `:param`
//    segment that is account-owned MUST carry meta.requireOwned with ownerScope
//    'account'. Operator-scoped routes (surface 'admin', or an operator-scoped
//    requireOwned) are EXEMPT from the missing-loader clause; so is a route
//    explicitly marked meta.publicRead (an intentional no-owner public read,
//    e.g. a public character/leaderboard :id read). An operator
//    ownerScope on a NON-admin surface is itself a wrong-owner-scope error.
import type { RouteDef } from '../../../server/http/types';

export interface CompletenessIssue {
  path: string;
  method: string;
  problem: 'missing-method' | 'missing-path' | 'missing-handler';
}

export interface CoverageIssue {
  path: string;
  method: string;
  problem: 'missing-require-owned' | 'wrong-owner-scope';
}

/** True if the path has at least one `:param` segment. */
function hasParamSegment(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':') && segment.length > 1);
}

/**
 * Every route must declare a method, a non-empty path, and a handler function.
 * Defensive at runtime (a fixture may omit a "required" field), so it reports the
 * gaps rather than trusting the static type.
 */
export function checkRouteCompleteness(routes: RouteDef[]): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  for (const route of routes) {
    const path = route?.path ?? '';
    const method = route?.method ?? '';
    if (!method) issues.push({ path, method, problem: 'missing-method' });
    if (typeof path !== 'string' || path.trim().length === 0) {
      issues.push({ path, method, problem: 'missing-path' });
    }
    if (typeof route?.handler !== 'function') {
      issues.push({ path, method, problem: 'missing-handler' });
    }
  }
  return issues;
}

/**
 * Enforce the :id requireOwned presence rule. For each route with a `:param`
 * segment:
 *  - surface 'admin' is operator territory: exempt (no requireOwned required).
 *  - surface 'internal' is secret-gated operator territory too (no account
 *    bearer exists to own anything): exempt for the same reason. Residual:
 *    the ownership sweep proves every /internal route rides a secret gate,
 *    not that an account-scoped :id under /internal is owner-checked, so a
 *    future /internal/accounts/:id route would pass both guards; such a
 *    route should not exist (account data belongs on the api surface).
 *  - meta.publicRead marks an intentional no-owner public read: exempt.
 *  - otherwise it is account territory: it MUST carry meta.requireOwned. An
 *    operator-scoped requireOwned exempts it from the missing-loader clause but
 *    an operator ownerScope on a non-admin surface is reported as wrong-owner-scope.
 */
export function checkRequireOwnedCoverage(routes: RouteDef[]): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const route of routes) {
    const path = route?.path ?? '';
    const method = route?.method ?? '';
    if (!hasParamSegment(path)) continue;

    const requireOwned = route?.meta?.requireOwned;
    const isAdminSurface = route?.surface === 'admin';
    const isInternalSurface = route?.surface === 'internal';
    const isPublicRead = route?.meta?.publicRead === true;
    // Operator-scoped (admin session or internal secret) and explicitly-public
    // routes are exempt from the missing clause.
    const exemptFromMissing =
      isAdminSurface ||
      isInternalSurface ||
      isPublicRead ||
      requireOwned?.ownerScope === 'operator';

    if (!exemptFromMissing && !requireOwned) {
      issues.push({ path, method, problem: 'missing-require-owned' });
    }
    // An operator ownerScope is only valid on the admin surface.
    if (requireOwned?.ownerScope === 'operator' && !isAdminSurface) {
      issues.push({ path, method, problem: 'wrong-owner-scope' });
    }
  }
  return issues;
}
