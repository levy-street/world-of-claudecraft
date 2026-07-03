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
  | 'bug-reports'
  | 'housekeeping'
  | 'housekeeping-rates'
  | 'housekeeping-calendar'
  | 'housekeeping-mobs'
  | 'housekeeping-spawns'
  | 'housekeeping-quests'
  | 'housekeeping-npcs'
  | 'housekeeping-items'
  | 'housekeeping-world';

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
  {
    id: 'housekeeping',
    labelKey: 'nav.housekeeping',
    defaultPage: 'housekeeping',
    items: [
      { id: 'housekeeping', labelKey: 'nav.hkOverview' },
      { id: 'housekeeping-rates', labelKey: 'nav.hkRates' },
      { id: 'housekeeping-calendar', labelKey: 'nav.hkCalendar' },
      { id: 'housekeeping-mobs', labelKey: 'nav.hkMobs' },
      { id: 'housekeeping-spawns', labelKey: 'nav.hkSpawns' },
      { id: 'housekeeping-quests', labelKey: 'nav.hkQuests' },
      { id: 'housekeeping-npcs', labelKey: 'nav.hkNpcs' },
      { id: 'housekeeping-items', labelKey: 'nav.hkItems' },
      { id: 'housekeeping-world', labelKey: 'nav.hkWorld' },
    ],
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
