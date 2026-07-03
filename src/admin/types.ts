import type { AccountStatus } from './account_status';

// Shapes returned by the /admin/api endpoints (mirrors server/admin_db.ts
// and server/game.ts admin views).

export interface ServerStats {
  online: number;
  onlineAccounts: number;
  peakOnline: number;
  uptimeSeconds: number;
  tickMsAvg: number;
  simEntities: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export type UsageWindowKey = 'm1' | 'm5' | 'h1' | 'h24';

export interface ProviderUsageWindow {
  key: UsageWindowKey;
  labelKey: string;
  milliseconds: number;
}

export interface ProviderUsageMetric {
  key: string;
  labelKey: string;
  counts: Record<UsageWindowKey, number>;
}

export interface ProviderUsageCache {
  key: string;
  labelKey: string;
  entries: number;
  maxEntries: number | null;
  hits: number;
  misses: number;
  staleRefreshes: number;
  stores: number;
  failures: number;
  evictions: number;
  updatedAt: string | null;
}

export interface ProviderUsageSnapshot {
  generatedAt: string;
  windows: ProviderUsageWindow[];
  metrics: ProviderUsageMetric[];
  caches: ProviderUsageCache[];
}

export interface Overview {
  accounts: number;
  characters: number;
  accountsToday: number;
  accountsWeek: number;
  accountsMonth: number;
  sessionsToday: number;
  activeAccountsToday: number;
  activeAccountsWeek: number;
  activeAccountsMonth: number;
  returningAccountsToday: number;
  avgPlaytimeSeconds: number;
  peakOnlineToday: number;
  peakOnlineAllTime: number;
  siteUsersNow: number;
  server: ServerStats;
  usage: ProviderUsageSnapshot;
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
  location?: LivePlayerLocation;
  sessionSeconds: number;
  lastSaveSecondsAgo: number;
  moveSpeedMultiplier: number;
  runSpeed: number;
  swimming: boolean;
  auras: {
    id: string;
    name: string;
    kind: string;
    value: number;
    remaining: number;
    duration: number;
  }[];
}

export interface SuspiciousEvidence {
  kind: string;
  weight: number;
  detail: string;
  expiresAt: number;
}

export interface SuspiciousPlayer {
  ref: {
    accountId: number;
    characterId: number;
    name: string;
    ip: string;
  };
  score: number;
  evidence: SuspiciousEvidence[];
}

export interface SuspiciousPlayersData {
  players: SuspiciousPlayer[];
}

// Raw-value calibration histograms published by the bot detector. Histogram ids and
// the measured quantities are decided server-side at runtime; the shape is generic.
export interface CalibrationHistogramBucket {
  le: number;
  count: number;
}

export interface CalibrationHistogram {
  id: string;
  count: number;
  min: number;
  max: number;
  sum: number;
  buckets: CalibrationHistogramBucket[];
  overflowCount: number;
}

export interface DetectionCalibrationData {
  schemaVersion: 1;
  capturedAt: string;
  serverStartedAt: string;
  uptimeSeconds: number;
  histograms: CalibrationHistogram[];
}

export interface LivePlayerLocation {
  kind: 'overworld' | 'dungeon' | 'delve';
  zoneId: string | null;
  zone: string;
  instanceId: string | null;
  instance: string | null;
  instanceSlot: number | null;
  poiIndex: number | null;
  poi: string | null;
  poiDistance: number | null;
}

export interface Activity {
  days: number;
  registrations: { day: string; count: number }[];
  sessions: { day: string; sessions: number; uniqueAccounts: number; playtimeSeconds: number }[];
  classes: { key: string; count: number }[];
  levels: { key: string; count: number }[];
}

export type OnlineHistoryRange = '24h' | '7d' | '30d';

export interface OnlineHistory {
  range: OnlineHistoryRange;
  bucket: 'hour' | 'day';
  points: {
    bucketStart: string;
    avgPlayers: number;
    peakPlayers: number;
    avgAccounts: number;
    peakAccounts: number;
    avgSiteUsers: number;
    peakSiteUsers: number;
  }[];
}

export interface AccountRow {
  id: number;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  isAdmin: boolean;
  bannedAt: string | null;
  suspendedUntil: string | null;
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

export interface IpAssociationsData {
  ip: string;
  blocked: boolean;
  accounts: {
    accountId: number;
    username: string;
    isAdmin: boolean;
    online: boolean;
    status: AccountStatus;
    suspendedUntil: string | null;
    createdAt: string;
    createdWithIp: boolean;
    lastLoginWithIp: boolean;
    hasSession: boolean;
    lastSeenAt: string;
    characters: {
      characterId: number | null;
      characterName: string;
      realm: string | null;
      lastSeenAt: string;
      sessionCount: number;
    }[];
  }[];
  total: number;
  page: number;
  limit: number;
}

export interface SharedIpRow {
  ip: string;
  accountCount: number;
  lastSeenAt: string;
  blocked: boolean;
}

export type SharedIpsData = Paginated<SharedIpRow>;

export interface AccountDetail {
  id: number;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  isAdmin: boolean;
  online: boolean;
  bannedAt: string | null;
  suspendedUntil: string | null;
  moderationReason: string;
  chatMutedUntil: string | null;
  chatMuteReason: string;
  chatStrikes: number;
  lastLoginIp: string | null;
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
    ip: string | null;
  }[];
  moderationHistory: ModerationHistoryEntry[];
}

export interface ModerationHistoryEntry {
  id: number;
  action: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  adminAccountId: number | null;
  adminUsername: string | null;
}

export interface ModerationQueueRow {
  accountId: number;
  username: string;
  isAdmin: boolean;
  status: AccountStatus;
  suspendedUntil: string | null;
  openReports: number;
  latestReportAt: string;
  latestReason: string;
  characterNames: string[];
  online: boolean;
}

// Mirrors server/bug_report_db.ts BugReportRow (snake_case from the SQL row). The
// list row exposes only whether a screenshot exists; the bytes are fetched per
// report via GET /admin/api/bug-reports/:id/screenshot.
export interface BugReportRow {
  id: number;
  account_id: number | null;
  character_id: number | null;
  character_name: string;
  realm: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  description: string;
  has_screenshot: boolean;
  meta: unknown;
  status: string;
  created_at: string;
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

export interface ChatViolationRow {
  id: number;
  characterName: string;
  term: string;
  channel: string;
  message: string;
  action: string;
  muteSeconds: number;
  createdAt: string;
}

export interface ChatModerationDetail {
  chatMutedUntil: string | null;
  chatStrikes: number;
  violations: ChatViolationRow[];
}

export interface ModerationAccountDetail {
  account: AccountDetail;
  reports: ReportDetail[];
  chat: ChatModerationDetail;
  blockedIps: string[];
}

export interface BlockedIpRow {
  id: number;
  ip: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  createdByUsername: string | null;
}

export interface BlockedIpsData {
  rows: BlockedIpRow[];
}

export interface FilterWord {
  id: number;
  word: string;
  tier: 'soft' | 'hard';
  createdAt: string;
}

export interface EscalationConfig {
  warningsBeforeMute: number;
  muteLadderSeconds: number[];
}

export interface ChatModeratedAccount {
  id: number;
  username: string;
  isAdmin: boolean;
  chatStrikes: number;
  chatMutedUntil: string | null;
}

export interface ChatFilterData {
  soft: FilterWord[];
  hard: FilterWord[];
  config: EscalationConfig;
  accounts: ChatModeratedAccount[];
}

// One bar in the overview activity charts (BarChart.svelte). `title` overrides the
// default "<label>: <value><suffix>" hover tooltip.
export interface BarPoint {
  label: string;
  value: number;
  title?: string;
}

export interface LinePoint {
  label: string;
  value: number;
  secondaryValue?: number;
  title?: string;
}

// ---------------------------------------------------------------------------
// Housekeeping (game-config overrides). Shapes mirror server/housekeeping.ts
// exactly (this bundle never imports server or sim code).
// ---------------------------------------------------------------------------

export interface HkNumericFieldSpec {
  key: string;
  min: number;
  max: number;
  integer?: boolean;
}

export interface HkStatus {
  restartPending: boolean;
  savedErrors: string[];
  savedUpdatedAt: string | null;
}

export interface HkRates {
  xpRate: number;
  goldDropRate: number;
  lootChanceRate: number;
  mobHpRate: number;
  mobDmgRate: number;
  respawnSeconds: number;
  worldSeed: number | null;
}

export interface HkOverview {
  realm: string;
  worldSeed: number;
  devCommands: boolean;
  appliedAt: string | null;
  bootWarnings: string[];
  counts: {
    mobs: number;
    quests: number;
    items: number;
    npcs: number;
    camps: number;
    zones: number;
    dungeons: number;
    delves: number;
  };
  overrideCounts: {
    rates: number;
    calendar: number;
    xpTable: boolean;
    mobs: number;
    quests: number;
    items: number;
    npcs: number;
    camps: number;
  };
  status: HkStatus;
}

export interface HkCalendar {
  eventLimit: number;
  titleMax: number;
  noteMax: number;
  horizonDays: number;
  keepPastDays: number;
}

export interface HkCalendarCatalog {
  fields: HkNumericFieldSpec[];
  defaults: HkCalendar;
  applied: HkCalendar;
  saved: Partial<HkCalendar> | null;
  status: HkStatus;
}

export interface HkRatesCatalog {
  fields: HkNumericFieldSpec[];
  defaults: HkRates;
  applied: HkRates;
  saved: Partial<HkRates> | null;
  xpTableDefault: number[];
  xpTableSaved: number[] | null;
  status: HkStatus;
}

export interface HkLootRow {
  itemId?: string;
  itemName?: string;
  copper?: number;
  chance: number;
  questId?: string;
  rollGroup?: string;
}

export interface HkMobSpawnSummary {
  campCount: number;
  totalSpawns: number;
  zones: string[];
  dungeons: string[];
}

export type HkNumericValues = Record<string, number | undefined>;
export type HkFlagValues = Record<string, boolean | undefined>;

export interface HkMobRow {
  id: string;
  name: string;
  family: string;
  defaults: HkNumericValues;
  live: HkNumericValues;
  defaultFlags: HkFlagValues;
  liveFlags: HkFlagValues;
  lootDefault: HkLootRow[];
  lootLive: HkLootRow[];
  spawns: HkMobSpawnSummary;
  override: Record<string, unknown> | null;
}

export interface HkMobsCatalog {
  fields: HkNumericFieldSpec[];
  flagFields: string[];
  rows: HkMobRow[];
  status: HkStatus;
}

export interface HkQuestObjective {
  label: string;
  type: string;
  target: string;
  countDefault: number;
  countLive: number;
}

export interface HkQuestRow {
  id: string;
  name: string;
  zone: string | null;
  giverNpc: string | null;
  turnInNpc: string | null;
  requiresQuest: string | null;
  suggestedPlayers: number | null;
  defaults: HkNumericValues;
  live: HkNumericValues;
  retiredDefault: boolean;
  retiredLive: boolean;
  objectives: HkQuestObjective[];
  override: Record<string, unknown> | null;
}

export interface HkQuestsCatalog {
  fields: HkNumericFieldSpec[];
  rows: HkQuestRow[];
  status: HkStatus;
}

export interface HkItemRow {
  id: string;
  name: string;
  kind: string;
  slot: string | null;
  quality: string | null;
  defaults: HkNumericValues;
  live: HkNumericValues;
  statsDefault: Record<string, number> | null;
  statsLive: Record<string, number> | null;
  override: Record<string, unknown> | null;
}

export interface HkItemsCatalog {
  fields: HkNumericFieldSpec[];
  rows: HkItemRow[];
  status: HkStatus;
}

export interface HkNpcRow {
  id: string;
  name: string;
  title: string;
  zone: string;
  posDefault: { x: number; z: number };
  posLive: { x: number; z: number };
  questIds: string[];
  questNames: string[];
  market: boolean;
  dynamic: boolean;
  vendorDefault: { itemId: string; name: string }[] | null;
  vendorLive: { itemId: string; name: string }[] | null;
  override: Record<string, unknown> | null;
}

export interface HkNpcsCatalog {
  rows: HkNpcRow[];
  status: HkStatus;
}

export interface HkCampRow {
  index: number;
  mobId: string;
  mobName: string;
  zone: string;
  defaults: { count: number; radius: number; center: { x: number; z: number } };
  live: { count: number; radius: number; center: { x: number; z: number } };
  override: Record<string, unknown> | null;
}

export interface HkSpawnsCatalog {
  fields: HkNumericFieldSpec[];
  rows: HkCampRow[];
  status: HkStatus;
}

export interface HkZoneRow {
  id: string;
  name: string;
  levelRange: [number, number];
  biome: string;
  hubName: string;
  pois: string[];
  lakeCount: number;
  campCount: number;
  npcCount: number;
  questCount: number;
}

export interface HkDungeonRow {
  id: string;
  name: string;
  suggestedPlayers: number;
  spawnCount: number;
  bossNames: string[];
  overworldDoor: boolean;
}

export interface HkDelveRow {
  id: string;
  name: string;
  minLevel: number;
  suggestedPlayers: number;
  bosses: string[];
  tiers: {
    id: string;
    label: string;
    enemyLevelBonus: number;
    affixCount: number;
    rewardMult: number;
  }[];
  baseRewards: {
    copperMin: number;
    copperMax: number;
    firstClearXp: number;
    repeatClearXp: number;
  };
}

export interface HkWorldCatalog {
  zones: HkZoneRow[];
  dungeons: HkDungeonRow[];
  delves: HkDelveRow[];
  status: HkStatus;
}

export interface HkSaveResponse {
  saved: Record<string, unknown>;
  warnings: string[];
  status: HkStatus;
}
