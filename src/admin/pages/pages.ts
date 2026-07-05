// One navigation tree drives the sidebar, default section destinations, page titles,
// and route validation. Detail-only routes such as IP associations stay outside it.
export type AdminPage =
  | 'overview'
  | 'usage'
  | 'accounts'
  | 'characters'
  | 'moderation'
  | 'suspicious-players'
  | 'detection-calibration'
  | 'shared-ips'
  | 'chat-filter'
  | 'blocked-ips'
  | 'bug-reports';

export interface AdminNavItem {
  id: AdminPage;
  labelKey: string;
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
    items: [{ id: 'overview', labelKey: 'nav.overview' }],
  },
  {
    id: 'operations',
    labelKey: 'nav.operations',
    defaultPage: 'usage',
    items: [{ id: 'usage', labelKey: 'nav.usage' }],
  },
  {
    id: 'players',
    labelKey: 'nav.players',
    defaultPage: 'accounts',
    items: [
      { id: 'accounts', labelKey: 'nav.accounts' },
      { id: 'characters', labelKey: 'nav.characters' },
    ],
  },
  {
    id: 'moderation',
    labelKey: 'nav.moderation',
    defaultPage: 'moderation',
    items: [
      { id: 'moderation', labelKey: 'nav.reports' },
      { id: 'shared-ips', labelKey: 'nav.sharedIps' },
      { id: 'blocked-ips', labelKey: 'nav.blockedIps' },
      { id: 'chat-filter', labelKey: 'nav.chatFilter' },
    ],
  },
  {
    id: 'bot-detector',
    labelKey: 'nav.botDetector',
    defaultPage: 'suspicious-players',
    items: [
      { id: 'suspicious-players', labelKey: 'nav.liveEvidence' },
      { id: 'detection-calibration', labelKey: 'nav.calibration' },
    ],
  },
  {
    id: 'support',
    labelKey: 'nav.support',
    defaultPage: 'bug-reports',
    items: [{ id: 'bug-reports', labelKey: 'nav.bugReports' }],
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
