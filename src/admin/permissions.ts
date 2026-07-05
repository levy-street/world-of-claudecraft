// Client-side mirror of the admin permission vocabulary. The server is the
// authority (server/admin_permissions.ts gates every route); this list only
// drives presentation (sidebar filtering, route guard, hiding action buttons).
// tests/admin_permissions.test.ts asserts parity with the server module, so
// the two cannot drift silently. The admin bundle never imports server code.

export const ADMIN_PERMISSIONS = [
  'analytics.read',
  'ops_usage.read',
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

export function hasPermission(granted: readonly string[], permission: AdminPermission): boolean {
  return granted.includes(permission);
}
