// Shapes returned by the /admin/api endpoints (mirrors server/admin_db.ts
// and server/game.ts admin views).

export interface ServerStats {
  online: number;
  peakOnline: number;
  uptimeSeconds: number;
  tickMsAvg: number;
  simEntities: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export interface Overview {
  accounts: number;
  characters: number;
  accountsToday: number;
  accountsWeek: number;
  sessionsToday: number;
  activeAccountsToday: number;
  server: ServerStats;
}

export interface LivePlayer {
  pid: number;
  accountId: number;
  characterId: number;
  name: string;
  class: string;
  level: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  zone: string;
  sessionSeconds: number;
  lastSaveSecondsAgo: number;
}

export interface Activity {
  days: number;
  registrations: { day: string; count: number }[];
  sessions: { day: string; sessions: number; uniqueAccounts: number; playtimeSeconds: number }[];
  classes: { key: string; count: number }[];
  levels: { key: string; count: number }[];
}

export interface AccountRow {
  id: number;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  isAdmin: boolean;
  characterCount: number;
  maxLevel: number;
  playtimeSeconds: number;
}

export interface CharacterRow {
  id: number;
  name: string;
  class: string;
  level: number;
  accountId: number;
  username: string;
  copper: number;
  xp: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AccountDetail {
  id: number;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  isAdmin: boolean;
  playtimeSeconds: number;
  characters: {
    id: number;
    name: string;
    class: string;
    level: number;
    copper: number;
    xp: number;
    pos: { x: number; z: number } | null;
    createdAt: string;
    updatedAt: string;
  }[];
  recentSessions: {
    id: number;
    characterName: string;
    startedAt: string;
    endedAt: string | null;
    seconds: number;
  }[];
}

export interface ModerationQueueRow {
  accountId: number;
  username: string;
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  openReports: number;
  latestReportAt: string;
  latestReason: string;
  latestSource: string;
  latestReportKind: string;
  maxAbuseScore: number;
  abuseReasons: string[];
  characterNames: string[];
  online: boolean;
}

export interface ReportDetail {
  id: number;
  reason: string;
  details: string;
  status: string;
  source: string;
  reportKind: string;
  evidence: Record<string, unknown>;
  abuseScore: number;
  abuseReasons: string[];
  createdAt: string;
  reporterAccountId: number | null;
  reporterUsername: string | null;
  reporterCharacterId: number | null;
  reporterCharacterName: string;
  reportedAccountId: number;
  reportedUsername: string;
  reportedCharacterId: number | null;
  reportedCharacterName: string;
  relatedEvents: {
    id: number;
    createdAt: string;
    outcome: string;
    reason: string;
    reporterAccountId: number | null;
    reporterCharacterName: string;
    targetAccountId: number | null;
    targetCharacterName: string;
    detailsHash: string;
    detailsLength: number;
    ipHash: string;
    userAgentHash: string;
    abuseScore: number;
    abuseReasons: string[];
    evidence: Record<string, unknown>;
  }[];
  chatContext: {
    id: number;
    characterName: string;
    channel: string;
    message: string;
    createdAt: string;
  }[];
}

export interface ModerationAccountDetail {
  account: AccountDetail;
  reports: ReportDetail[];
}
