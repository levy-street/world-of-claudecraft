import type { StreamerLinks } from './account_flair';
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
}

// Provider usage is served on its own ops_usage.read-gated route, not inside
// the overview payload.
export interface ProviderUsageResponse {
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
  // Recurrence history, present only on kinds where re-triggering carries
  // information: distinct episodes this session, first and latest (epoch ms),
  // and the opening timestamps of the most recent episodes (bounded ring).
  occurrences?: number;
  firstAt?: number;
  lastAt?: number;
  episodesAt?: number[];
}

export interface SuspiciousPlayer {
  ref: {
    accountId: number;
    characterId: number;
    name: string;
    ip: string;
  };
  // CONFIRMED = an automated moderator report went out for this session.
  state: 'SUSPICIOUS' | 'CONFIRMED';
  snapshot: {
    capturedAt: number;
  } | null;
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
  isAi: boolean;
  isStreamer: boolean;
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
  isAi: boolean;
  isStreamer: boolean;
  streamerLinks: StreamerLinks;
  online: boolean;
  bannedAt: string | null;
  suspendedUntil: string | null;
  moderationReason: string;
  chatMutedUntil: string | null;
  chatMuteReason: string;
  chatStrikes: number;
  dailyRewardsBan?: { reason: string; createdAt: string } | null;
  dailyRewardsIpBans?: { ip: string; reason: string; createdAt: string }[];
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

export interface ModerationActionHistoryRow extends ModerationHistoryEntry {
  source: 'account' | 'ip';
  accountId: number | null;
  username: string | null;
  ip: string | null;
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

// Bot Detector > Configuration. Field ids, groups, labels, and help arrive as
// server data (the detector decides them at runtime; the evidence-detail
// precedent), so they render as-is rather than through t().
export type AntibotConfigValue = string | number | boolean | string[];

export interface AntibotConfigField {
  id: string;
  group: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multi_select';
  defaultValue: AntibotConfigValue;
  value: AntibotConfigValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface AntibotConfigCatalog {
  fields: AntibotConfigField[];
  updatedAt: string | null;
}

export interface AntibotConfigHistoryEntry {
  id: number;
  beforeData: Record<string, AntibotConfigValue>;
  afterData: Record<string, AntibotConfigValue>;
  note: string;
  createdAt: string;
  adminAccountId: number | null;
  adminUsername: string | null;
}

export interface AntibotConfigHistory {
  entries: AntibotConfigHistoryEntry[];
}

// Staff page (role management). assignableRoles never contains superadmin:
// it is grantable only via the grant script, and superadmin rows render
// read-only.
export interface StaffRow {
  accountId: number;
  username: string;
  roles: string[];
  lastLogin: string | null;
}

export interface StaffData {
  rows: StaffRow[];
  assignableRoles: string[];
}

export interface RoleChangeRow {
  id: number;
  accountId: number;
  username: string | null;
  adminUsername: string | null;
  rolesBefore: string[];
  rolesAfter: string[];
  createdAt: string;
}

export interface StaffHistoryData {
  rows: RoleChangeRow[];
}

// Server tick-loop profiling (GET /admin/api/perf/tick, POST .../capture). Mirrors
// server/game.ts PerfCaptureResult/PerfCaptureStatus and the TickProfiler shape.
export interface PerfPhaseStats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface PerfCaptureResult {
  captureId: string;
  capturedAt: number; // epoch ms the window closed
  durationMs: number;
  loopCallbacks: number;
  simTicks: number;
  catchUpCallbacks: number;
  maxTicksPerCallback: number;
  online: number;
  simEntities: number;
  aggroVisitsTotal: number;
  aggroVisitsMaxPerTick: number;
  threatVisitsTotal: number;
  threatVisitsMaxPerTick: number;
  profile: {
    samples: number;
    windowTicks: number;
    phases: Record<string, PerfPhaseStats>;
  };
}

export interface PerfCaptureStatus {
  captureId: string | null;
  capturing: boolean;
  endsAt: number | null; // epoch ms the in-flight capture closes
  last: PerfCaptureResult | null;
}
