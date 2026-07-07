// Fine-grained admin authorization vocabulary. Permissions are an internal
// closed set consumed by code (the route table in admin_routes.ts, the
// in-game command checks, tests); operators are never assigned permissions
// directly. Roles are job-shaped bundles; an account carries a set of roles
// (accounts.admin_roles) and its effective permissions are the union.

export const ADMIN_PERMISSIONS = [
  'analytics.read',
  'ops_usage.read',
  'ops.perf',
  'accounts.read',
  'support.read',
  'moderation.read',
  'moderation.act',
  'moderation.spectate',
  'ipblocks.manage',
  'chatfilter.manage',
  'content.moderate',
  'botdetector.read',
  'botdetector.configure',
  'staff.manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// Permissions that only superadmin may hold. staff.manage (grant/revoke roles)
// is the privilege-escalation vector, so it is deliberately kept out of every
// dashboard-grantable role, including the otherwise-everything `admin` role. A
// test pins that these are reachable ONLY through superadmin.
export const SUPERADMIN_ONLY_PERMISSIONS: readonly AdminPermission[] = ['staff.manage'];

export const ADMIN_ROLES = ['superadmin', 'admin', 'moderator', 'viewer'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

// superadmin is grantable only via scripts/grant_admin.mjs or SQL, never from
// the dashboard; the staff API refuses it (see ASSIGNABLE_ADMIN_ROLES).
export const SUPERADMIN_ROLE: AdminRole = 'superadmin';

export const ASSIGNABLE_ADMIN_ROLES: readonly AdminRole[] = ADMIN_ROLES.filter(
  (role) => role !== SUPERADMIN_ROLE,
);

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  superadmin: ADMIN_PERMISSIONS,
  // The legacy "full admin": every tool the old is_admin flag conferred, minus
  // staff-role management. The boot backfill migrates pre-permission is_admin
  // accounts to this role, so nobody is silently handed staff.manage.
  admin: ADMIN_PERMISSIONS.filter(
    (permission) => !SUPERADMIN_ONLY_PERMISSIONS.includes(permission),
  ),
  moderator: [
    'analytics.read',
    'accounts.read',
    'moderation.read',
    'moderation.act',
    'moderation.spectate',
    'ipblocks.manage',
    'chatfilter.manage',
    'content.moderate',
  ],
  // Read-only composition brick. Deliberately EXCLUDES botdetector.read: the
  // anti-bot internals are sensitive, so only admin/superadmin see them.
  viewer: ['analytics.read', 'accounts.read', 'support.read', 'moderation.read'],
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

// Unknown role strings are ignored rather than fatal: a role retired from the
// vocabulary must not brick every request of an account that still carries it.
export function permissionsForRoles(roles: readonly string[]): Set<AdminPermission> {
  const permissions = new Set<AdminPermission>();
  for (const role of roles) {
    if (!isAdminRole(role)) continue;
    for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  return permissions;
}

// Strict validation for role WRITES (the staff API, the grant script): null on
// any non-array or unknown role name, deduped, normalized to vocabulary order.
export function sanitizeRoles(input: unknown): AdminRole[] | null {
  if (!Array.isArray(input)) return null;
  const roles = new Set<AdminRole>();
  for (const value of input) {
    if (!isAdminRole(value)) return null;
    roles.add(value);
  }
  return ADMIN_ROLES.filter((role) => roles.has(role));
}
