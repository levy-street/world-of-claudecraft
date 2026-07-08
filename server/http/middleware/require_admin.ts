// Admin-auth gate + admin-scope :id loader for the API request pipeline. Two
// transitional, legacy-body middleware the migrated /admin/api routes mount,
// mirroring the account-owner seam (require_owned.ts) but for the OPERATOR scope:
//
//  - createRequireAdmin(getDb): the admin-auth gate. It mirrors the legacy
//    adminIdentity(req) resolver EXACTLY (server/admin.ts): resolve the 64-hex
//    bearer, look up the account, require at least one staff role
//    (staff_db.adminRolesForAccount, fail closed; roles are re-read on every
//    request so a dashboard revocation applies to the next call). On ANY failure
//    (absent/bad token, unknown account, non-staff account) it writes the legacy
//    admin envelope body { success: false, data: null, error: 'admin authentication
//    required' } at 401 and short-circuits (no next()), so the no-auth admin goldens
//    replay byte-identically. A missing/malformed bearer 401s WITHOUT a DB call.
//
//    After authentication it runs the CENTRAL AUTHORIZATION gate, mirroring the
//    legacy handleAdminApi preamble: the route's declared permission is resolved
//    from the ADMIN_ROUTE_PERMISSIONS table (server/admin_routes.ts) against the
//    CONCRETE request path, failing closed. An unmapped path answers 404 'unknown
//    admin endpoint' (or 405 'method not allowed' when the path exists under
//    another method), so a RouteDef registered without a permission row can never
//    execute; a mapped route 403s 'you do not have permission to do this' unless
//    the staff identity's expanded permission set holds the declared permission
//    ('any' admits any staff account). On success it sets ctx.account (admin
//    tokens are full-scope), stashes the resolved AdminIdentity on ctx.state for
//    the handlers (/me, staff-role writes), and calls next(). The gate applies NO
//    read-only-scope 403 and NO moderation gate (staff is trusted operator
//    authority), preserving the legacy gate byte-for-byte.
//
//  - requireAdminTarget(kind): the admin-scope :id loader. It decodes the :id param
//    with num({ int, min: 1 }) BEFORE any DB call (a non-numeric / non-positive id
//    throws the decode failure -> 422 via withErrors, exactly like require_owned.ts;
//    legacy's `\d+` route regexes 404-fell-through such an id, but no golden pins a
//    non-numeric admin id and no client sends one, so this is not a parity divergence
//    the harness can observe), stashes the decoded id on ctx.state for the handler,
//    and calls next(). It marks the route OPERATOR-scoped via RouteMeta.requireOwned
//    (ownerScope: 'operator'), which EXCLUDES it from the account-owner deny-by-default
//    coverage clause (checkRequireOwnedCoverage exempts operator + admin-surface :id
//    routes) and documents that admin denial is 403-flavored (the operator gate), not
//    the account 404 (anti-enumeration).
//
//    Deliberate parity-first scope note: unlike the account loader, this operator
//    loader does NOT load-and-authorize a cross-scope object or emit a 403/404 denial.
//    The legacy admin surface grants every operator UNIVERSAL authority over every
//    target (an admin can moderate any account), so there is no per-object ownership
//    to deny: requireAdmin's 401 IS the operator gate, and the handlers keep their own
//    legacy resource-not-found 404 ('account not found') byte-for-byte. The 403
//    operator-denial the OwnerScope type reserves is the seam for a future finer
//    operator sub-scope; it has no parity-faithful trigger on today's admin surface.
//
// This is a transitional artifact like bearer_active_guard.ts: it emits the legacy
// { success, data, error } admin bodies the operator dashboard keys on, NOT a coded
// problem+json envelope. The coded end-state lands at the ladder deletion.

import { type AdminPermission, permissionsForRoles } from '../../admin_permissions';
import { adminPathKnown, permissionForAdminRoute } from '../../admin_routes';
import { json } from '../../http_util';
import { num } from '../schema';
import type { Ctx, Middleware, Next, RouteMeta } from '../types';
import { bearerToken } from './bearer_active_guard';

// The exact legacy admin 401 body adminIdentity's null path produces via fail().
// A named constant so it cannot drift from the resolver it mirrors. The admin
// envelope is { success, data, error }, NOT problem+json.
export const ADMIN_AUTH_REQUIRED = {
  success: false,
  data: null,
  error: 'admin authentication required',
} as const;

/** The ctx.state key the decoded operator :id is stashed under for the handler. */
const ADMIN_TARGET_ID = 'adminTargetId';

/** The ctx.state key the resolved staff identity is stashed under for the handler. */
const ADMIN_IDENTITY = 'adminIdentity';

/**
 * The authenticated staff identity the gate resolves per request (the legacy
 * AdminIdentity shape): roles from accounts.admin_roles, permissions their
 * expanded union.
 */
export interface AdminIdentity {
  accountId: number;
  username: string;
  roles: string[];
  permissions: ReadonlySet<AdminPermission>;
}

/**
 * The two db reads the admin gate needs, bundled so a unit test can inject a fake
 * with no Postgres. The shape mirrors the real server exports the legacy
 * adminIdentity(req) resolver calls (db.accountForToken, staff_db.adminRolesForAccount).
 */
export interface AdminAuthDb {
  /** Account id for a live bearer token, or null (mirrors db.accountForToken). */
  accountForToken(token: string): Promise<number | null>;
  /** Staff username + roles, or null when not staff (mirrors staff_db.adminRolesForAccount). */
  adminRolesForAccount(accountId: number): Promise<{ username: string; roles: string[] } | null>;
}

/**
 * Build the admin-auth gate. `getDb` returns the LIVE db bundle on each request, so
 * a per-domain test seam (a mutable module-level bundle a setXDbForTests reassigns)
 * is read at call time, not captured at construction. On success it sets ctx.account
 * (admin tokens are full-scope), stashes the AdminIdentity on ctx.state, and calls
 * next(); on any rejection it writes the legacy admin envelope denial (401 / 403 /
 * fail-closed 404/405) and short-circuits.
 */
export function createRequireAdmin(getDb: () => AdminAuthDb): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const token = bearerToken(ctx.req);
    const db = getDb();
    const accountId = token === null ? null : await db.accountForToken(token);
    const staff = accountId === null ? null : await db.adminRolesForAccount(accountId);
    if (accountId === null || staff === null) {
      json(ctx.res, 401, ADMIN_AUTH_REQUIRED);
      return;
    }
    const identity: AdminIdentity = {
      accountId,
      username: staff.username,
      roles: staff.roles,
      permissions: permissionsForRoles(staff.roles),
    };

    // Central authorization gate, mirroring the legacy handleAdminApi preamble:
    // resolve the route's declared permission from the shared table before the
    // handler runs, failing closed on anything unmapped. For a registry-matched
    // route the 404/405 arms are backstops (the router already resolved the
    // route), but they keep a RouteDef with no permission row from ever executing.
    const method = ctx.req.method ?? '';
    if (method !== 'GET' && method !== 'POST') {
      json(ctx.res, 405, { success: false, data: null, error: 'method not allowed' });
      return;
    }
    const routePermission = permissionForAdminRoute(method, ctx.url.pathname);
    if (routePermission === null) {
      const known = adminPathKnown(ctx.url.pathname);
      json(ctx.res, known ? 405 : 404, {
        success: false,
        data: null,
        error: known ? 'method not allowed' : 'unknown admin endpoint',
      });
      return;
    }
    if (routePermission !== 'any' && !identity.permissions.has(routePermission)) {
      json(ctx.res, 403, {
        success: false,
        data: null,
        error: 'you do not have permission to do this',
      });
      return;
    }

    // NOMINAL stamp, not the token's real scope: the legacy gate never scope-checks
    // an admin bearer (accountForToken ignores the scope column, so a read-scope
    // companion token of a staff account passes too, parity-first). Today's admin
    // handlers read only ctxAccountId; do NOT trust ctx.account.scope downstream of
    // requireAdmin for a scope decision without resolving the token's actual scope.
    ctx.account = { accountId, scope: 'full' };
    ctx.state.set(ADMIN_IDENTITY, identity);
    await next();
  };
}

/**
 * The staff identity the requireAdmin gate stashed. A missing value is a
 * composition bug (the handler ran without the gate); the gate always runs
 * before the handler on every authed admin route.
 */
export function adminIdentityOf(ctx: Ctx): AdminIdentity {
  return ctx.state.get(ADMIN_IDENTITY) as AdminIdentity;
}

// Reject a non-numeric or non-positive :id BEFORE any DB call, so a query never
// receives NaN. A positive safe integer is required (ids are 1-based bigserial),
// matching the account loader's decode (require_owned.ts).
const idSchema = num({ int: true, min: 1 });

/**
 * Build the admin-scope :id loader for an operator resource `kind`. It decodes the
 * :id param (422 on a non-numeric / non-positive id, thrown before any DB call) and
 * stashes the decoded number on ctx.state for the handler, then calls next(). The
 * `kind` is the RouteMeta.requireOwned kind these routes carry (adminTargetMeta);
 * it is used only for readability/logging, since the operator scope grants universal
 * authority (see the module header) and this loader authorizes no cross-scope object.
 */
export function requireAdminTarget(_kind: string): Middleware {
  return async (ctx: Ctx, next: Next) => {
    const decoded = idSchema.decode(ctx.params.id, '/id');
    // A raw { ok: false, issues } is what toAppError maps to 422 validation.failed.
    if (!decoded.ok) throw decoded;
    ctx.state.set(ADMIN_TARGET_ID, decoded.value);
    await next();
  };
}

/**
 * The decoded, positive-integer operator :id the requireAdminTarget loader stashed.
 * A missing value is a composition bug (the handler ran without its loader), so it
 * is a programmer error; the loader always runs before the handler on these routes.
 */
export function adminTargetId(ctx: Ctx): number {
  return ctx.state.get(ADMIN_TARGET_ID) as number;
}

/** RouteMeta for a plain admin route: select the { success, data, error } envelope. */
export const ADMIN_META: RouteMeta = { envelope: 'admin' };

/**
 * RouteMeta for an operator-scoped admin :id route: the admin envelope PLUS the
 * operator requireOwned marker that excludes it from the account-owner deny-by-default
 * clause (checkRequireOwnedCoverage) and documents 403-flavored operator denial.
 */
export function adminTargetMeta(kind: string): RouteMeta {
  return { envelope: 'admin', requireOwned: { kind, ownerScope: 'operator' } };
}
