import type { AdminPermission } from '../permissions';

// One navigation tree drives the sidebar, default section destinations, page titles,
// and route validation. Detail-only routes such as IP associations stay outside it.
// Each item carries the permission that makes it visible; the server enforces the
// same mapping on every endpoint (server/admin_routes.ts), so hiding here is pure
// presentation.
export type AdminPage =
  | 'overview'
  | 'usage'
  | 'accounts'
  | 'characters'
  | 'moderation'
  | 'suspicious-players'
  | 'detection-calibration'
  | 'antibot-config'
  | 'shared-ips'
  | 'chat-filter'
  | 'blocked-ips'
  | 'bug-reports'
  | 'staff';

export interface AdminNavItem {
  id: AdminPage;
  labelKey: string;
  permission: AdminPermission;
}

export interface AdminNavSection {
  id: string;
  labelKey?: string;
  defaultPage: AdminPage;
  items: readonly AdminNavItem[];
}

export const NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    id: 'dashboard',
    defaultPage: 'overview',
    items: [{ id: 'overview', labelKey: 'nav.overview', permission: 'analytics.read' }],
  },
  {
    id: 'operations',
    labelKey: 'nav.operations',
    defaultPage: 'usage',
    items: [{ id: 'usage', labelKey: 'nav.usage', permission: 'ops_usage.read' }],
  },
  {
    id: 'players',
    labelKey: 'nav.players',
    defaultPage: 'accounts',
    items: [
      { id: 'accounts', labelKey: 'nav.accounts', permission: 'accounts.read' },
      { id: 'characters', labelKey: 'nav.characters', permission: 'accounts.read' },
    ],
  },
  {
    id: 'moderation',
    labelKey: 'nav.moderation',
    defaultPage: 'moderation',
    items: [
      { id: 'moderation', labelKey: 'nav.reports', permission: 'moderation.read' },
      { id: 'shared-ips', labelKey: 'nav.sharedIps', permission: 'moderation.read' },
      { id: 'blocked-ips', labelKey: 'nav.blockedIps', permission: 'moderation.read' },
      { id: 'chat-filter', labelKey: 'nav.chatFilter', permission: 'moderation.read' },
    ],
  },
  {
    id: 'bot-detector',
    labelKey: 'nav.botDetector',
    defaultPage: 'suspicious-players',
    items: [
      { id: 'suspicious-players', labelKey: 'nav.liveEvidence', permission: 'botdetector.read' },
      {
        id: 'detection-calibration',
        labelKey: 'nav.calibration',
        permission: 'botdetector.read',
      },
      {
        id: 'antibot-config',
        labelKey: 'nav.antibotConfig',
        permission: 'botdetector.configure',
      },
    ],
  },
  {
    id: 'support',
    labelKey: 'nav.support',
    defaultPage: 'bug-reports',
    items: [{ id: 'bug-reports', labelKey: 'nav.bugReports', permission: 'support.read' }],
  },
  {
    id: 'administration',
    labelKey: 'nav.administration',
    defaultPage: 'staff',
    items: [{ id: 'staff', labelKey: 'nav.staff', permission: 'staff.manage' }],
  },
];

export const PAGES: readonly AdminNavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function itemForPage(page: AdminPage): AdminNavItem {
  const item = PAGES.find((candidate) => candidate.id === page);
  if (!item) {
    throw new Error(`unknown admin page: ${page}`);
  }
  return item;
}

// The IP-associations detail route lives outside the nav tree; it reads the
// same data as the accounts/shared-IP pages.
export const IP_ROUTE_PERMISSION: AdminPermission = 'accounts.read';

export type PermissionCheck = (permission: AdminPermission) => boolean;

// Sidebar filtering: drop items the operator cannot open, drop empty sections,
// and point each surviving section title at its first visible item.
export function visibleNavSections(can: PermissionCheck): AdminNavSection[] {
  const sections: AdminNavSection[] = [];
  for (const section of NAV_SECTIONS) {
    const items = section.items.filter((item) => can(item.permission));
    if (items.length === 0) continue;
    const defaultVisible = items.some((item) => item.id === section.defaultPage);
    sections.push({
      ...section,
      items,
      defaultPage: defaultVisible ? section.defaultPage : items[0].id,
    });
  }
  return sections;
}

export function firstVisiblePage(can: PermissionCheck): AdminPage | null {
  return PAGES.find((item) => can(item.permission))?.id ?? null;
}
