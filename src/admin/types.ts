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
  y: number;
  z: number;
  facing: number;
  realm: string;
  zone: string;
  status: 'online' | 'combat' | 'dungeon' | 'dead';
  inDungeon: boolean;
  dungeonId: string | null;
  dungeonName: string | null;
  mapX: number;
  mapZ: number;
  sessionSeconds: number;
  lastSaveSecondsAgo: number;
}

export interface WorldMapZone {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
  levelRange: [number, number];
  biome: string;
  hub: { x: number; z: number; radius: number; name: string };
  graveyard: { x: number; z: number };
  lakes: { x: number; z: number; radius: number }[];
  pois: { x: number; z: number; label: string }[];
}

export interface WorldMapData {
  realm: string;
  generatedAt: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  zones: WorldMapZone[];
  dungeons: { id: string; name: string; doorPos: { x: number; z: number }; suggestedPlayers: number }[];
  players: LivePlayer[];
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
  characterNames: string[];
  online: boolean;
}

export interface ReportDetail {
  id: number;
  reason: string;
  details: string;
  status: string;
  createdAt: string;
  reporterAccountId: number | null;
  reporterUsername: string | null;
  reporterCharacterId: number | null;
  reporterCharacterName: string;
  reportedAccountId: number;
  reportedUsername: string;
  reportedCharacterId: number | null;
  reportedCharacterName: string;
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
