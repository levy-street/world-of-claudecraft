import type { AdminPermission } from './admin_permissions';

// Declarative permission map for every /admin/api route (login excepted: it is
// the one unauthenticated endpoint). handleAdminApi consults this table BEFORE
// its handler chain and fails closed: a route missing here can never execute.
// tests/admin_routes.test.ts scans server/admin.ts and fails if a handled path
// has no entry, so adding a route without deciding its permission is loud.
// 'any' means any authenticated staff account (used by /me only).

export type AdminRoutePermission = AdminPermission | 'any';

interface AdminRouteRule {
  method: 'GET' | 'POST';
  pattern: string | RegExp;
  permission: AdminRoutePermission;
}

export const ADMIN_ROUTE_PERMISSIONS: readonly AdminRouteRule[] = [
  { method: 'GET', pattern: '/admin/api/me', permission: 'any' },

  { method: 'GET', pattern: '/admin/api/overview', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/provider-usage', permission: 'ops_usage.read' },
  { method: 'GET', pattern: '/admin/api/online', permission: 'accounts.read' },
  { method: 'GET', pattern: '/admin/api/online-history', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/activity', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/perf/summary', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/perf/raw', permission: 'analytics.read' },
  // Server tick-loop profiling capture: ops-sensitive, admin/superadmin only.
  { method: 'GET', pattern: '/admin/api/perf/tick', permission: 'ops.perf' },
  { method: 'POST', pattern: '/admin/api/perf/tick/capture', permission: 'ops.perf' },
  { method: 'GET', pattern: '/admin/api/characters', permission: 'accounts.read' },

  { method: 'GET', pattern: '/admin/api/accounts', permission: 'accounts.read' },
  { method: 'GET', pattern: /^\/admin\/api\/accounts\/(\d+)$/, permission: 'accounts.read' },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/accounts\/(\d+)\/reset-password$/,
    permission: 'accounts.password',
  },
  { method: 'GET', pattern: '/admin/api/shared-ips', permission: 'moderation.read' },
  { method: 'GET', pattern: '/admin/api/ip-associations', permission: 'accounts.read' },

  { method: 'GET', pattern: '/admin/api/moderation/queue', permission: 'moderation.read' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)$/,
    permission: 'moderation.read',
  },
  { method: 'GET', pattern: '/admin/api/chat-filter', permission: 'moderation.read' },
  { method: 'GET', pattern: '/admin/api/blocked-ips', permission: 'moderation.read' },

  { method: 'GET', pattern: '/admin/api/bug-reports', permission: 'support.read' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/bug-reports\/(\d+)\/screenshot$/,
    permission: 'support.read',
  },

  { method: 'GET', pattern: '/admin/api/suspicious-players', permission: 'botdetector.read' },
  { method: 'GET', pattern: '/admin/api/detection-calibration', permission: 'botdetector.read' },
  { method: 'GET', pattern: '/admin/api/antibot-config', permission: 'botdetector.configure' },
  {
    method: 'GET',
    pattern: '/admin/api/antibot-config/history',
    permission: 'botdetector.configure',
  },
  { method: 'POST', pattern: '/admin/api/antibot-config', permission: 'botdetector.configure' },

  { method: 'GET', pattern: '/admin/api/maps', permission: 'content.moderate' },
  { method: 'GET', pattern: '/admin/api/user-assets', permission: 'content.moderate' },

  { method: 'GET', pattern: '/admin/api/staff', permission: 'staff.manage' },
  { method: 'GET', pattern: '/admin/api/staff/history', permission: 'staff.manage' },
  { method: 'POST', pattern: '/admin/api/staff/roles', permission: 'staff.manage' },

  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/(suspend|unsuspend|ban|unban)$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/reactivate$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/chat-mute$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/lift-mute$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/note$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/reset-strikes$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/reports\/(\d+)\/ignore$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/characters\/(\d+)\/force-rename$/,
    permission: 'moderation.act',
  },

  { method: 'POST', pattern: '/admin/api/chat-filter/words', permission: 'chatfilter.manage' },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/chat-filter\/words\/(\d+)\/delete$/,
    permission: 'chatfilter.manage',
  },
  { method: 'POST', pattern: '/admin/api/chat-filter/config', permission: 'chatfilter.manage' },

  { method: 'POST', pattern: '/admin/api/blocked-ips', permission: 'ipblocks.manage' },
  { method: 'POST', pattern: '/admin/api/blocked-ips/delete', permission: 'ipblocks.manage' },

  {
    method: 'POST',
    pattern: /^\/admin\/api\/maps\/(\d+)\/unpublish$/,
    permission: 'content.moderate',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/user-assets\/(\d+)\/(block|unblock)$/,
    permission: 'content.moderate',
  },
];

function matches(pattern: string | RegExp, path: string): boolean {
  return typeof pattern === 'string' ? pattern === path : pattern.test(path);
}

export function permissionForAdminRoute(method: string, path: string): AdminRoutePermission | null {
  for (const rule of ADMIN_ROUTE_PERMISSIONS) {
    if (rule.method === method && matches(rule.pattern, path)) return rule.permission;
  }
  return null;
}

// True when the path is a known route under SOME method (drives 405 vs 404).
export function adminPathKnown(path: string): boolean {
  return ADMIN_ROUTE_PERMISSIONS.some((rule) => matches(rule.pattern, path));
}
