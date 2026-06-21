import { pool } from './db';

// Read-side queries for the admin dashboard. All inputs are parameterized;
// sort columns are whitelisted before they reach SQL.

export interface OverviewCounts {
  accounts: number;
  characters: number;
  accountsToday: number;
  accountsWeek: number;
  sessionsToday: number;
  activeAccountsToday: number;
}

export async function overviewCounts(): Promise<OverviewCounts> {
  const res = await pool.query(`
    SELECT
      (SELECT count(*) FROM accounts)::int                                              AS accounts,
      (SELECT count(*) FROM characters)::int                                            AS characters,
      (SELECT count(*) FROM accounts WHERE created_at > now() - interval '1 day')::int  AS accounts_today,
      (SELECT count(*) FROM accounts WHERE created_at > now() - interval '7 days')::int AS accounts_week,
      (SELECT count(*) FROM play_sessions WHERE started_at > now() - interval '1 day')::int                  AS sessions_today,
      (SELECT count(DISTINCT account_id) FROM play_sessions WHERE started_at > now() - interval '1 day')::int AS active_accounts_today
  `);
  const r = res.rows[0];
  return {
    accounts: r.accounts,
    characters: r.characters,
    accountsToday: r.accounts_today,
    accountsWeek: r.accounts_week,
    sessionsToday: r.sessions_today,
    activeAccountsToday: r.active_accounts_today,
  };
}

export interface DayPoint {
  day: string;
  count: number;
}

export async function registrationsByDay(days: number): Promise<DayPoint[]> {
  const res = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
     FROM accounts
     WHERE created_at > now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [String(days)],
  );
  return res.rows;
}

export interface SessionDayPoint {
  day: string;
  sessions: number;
  uniqueAccounts: number;
  playtimeSeconds: number;
}

export async function sessionsByDay(days: number): Promise<SessionDayPoint[]> {
  const res = await pool.query(
    `SELECT
       to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
       count(*)::int AS sessions,
       count(DISTINCT account_id)::int AS unique_accounts,
       COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0)::bigint AS playtime_seconds
     FROM play_sessions
     WHERE started_at > now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [String(days)],
  );
  return res.rows.map((r) => ({
    day: r.day,
    sessions: r.sessions,
    uniqueAccounts: r.unique_accounts,
    playtimeSeconds: Number(r.playtime_seconds),
  }));
}

export interface BucketCount {
  key: string;
  count: number;
}

export async function classDistribution(): Promise<BucketCount[]> {
  const res = await pool.query(
    `SELECT class AS key, count(*)::int AS count FROM characters GROUP BY class ORDER BY count DESC`,
  );
  return res.rows;
}

export async function levelDistribution(): Promise<BucketCount[]> {
  const res = await pool.query(
    `SELECT level::text AS key, count(*)::int AS count FROM characters GROUP BY level ORDER BY level`,
  );
  return res.rows;
}

export interface PerfAggregate {
  sampleCount: number;
  medianFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  contextLossCount: number;
  avgRenderScale: number;
  avgEffectiveRenderScale: number;
}

export interface PerfBucket extends PerfAggregate {
  key: string;
}

export interface PerfSummary {
  hours: number;
  generatedAt: string;
  totals: PerfAggregate;
  byPreset: PerfBucket[];
  byGpu: PerfBucket[];
  byBrowser: PerfBucket[];
  byOs: PerfBucket[];
  byScenario: PerfBucket[];
  worstGpuBuckets: PerfBucket[];
}

export interface PerfRawRow {
  id: number;
  createdAt: string;
  releaseVersion: string;
  buildId: string;
  sessionId: string;
  accountId: number | null;
  characterId: number | null;
  realm: string;
  graphicsPreset: string;
  gfxTier: string;
  autoGovernor: boolean;
  targetFps: number;
  renderScale: number;
  effectiveRenderScale: number;
  fpsAvg: number;
  frameP95Ms: number;
  frameP99Ms: number;
  longFrameCount: number;
  rendererCalls: number;
  rendererTriangles: number;
  rendererTextures: number;
  rendererPrograms: number;
  contextLostCount: number;
  longTaskCount: number;
  longTaskP95Ms: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  dpr: number;
  viewportBucket: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  mobileTouch: boolean;
  browserFamily: string;
  osFamily: string;
  glVendor: string;
  glRendererBucket: string;
  zoneOrScenario: string;
  source: string;
  rawSummary: unknown;
}

function cleanHours(hours: number): number {
  return Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.floor(hours))) : 24;
}

function cleanPerfLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 100;
}

function cleanBeforeId(id: number | undefined): number | null {
  if (id === undefined || !Number.isFinite(id)) return null;
  const n = Math.floor(id);
  return n > 0 ? n : null;
}

function perfAggregateFromRow(r: Record<string, unknown>): PerfAggregate {
  return {
    sampleCount: Number(r.sample_count ?? 0),
    medianFps: Number(r.median_fps ?? 0),
    p95FrameMs: Number(r.p95_frame_ms ?? 0),
    p99FrameMs: Number(r.p99_frame_ms ?? 0),
    contextLossCount: Number(r.context_loss_count ?? 0),
    avgRenderScale: Number(r.avg_render_scale ?? 0),
    avgEffectiveRenderScale: Number(r.avg_effective_render_scale ?? 0),
  };
}

async function perfAggregate(hours: number): Promise<PerfAggregate> {
  const res = await pool.query(
    `SELECT
       count(*)::int AS sample_count,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p95_frame_ms,
       COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms,
       COALESCE(sum(context_lost_count), 0)::int AS context_loss_count,
       COALESCE(avg(render_scale), 0)::real AS avg_render_scale,
       COALESCE(avg(effective_render_scale), 0)::real AS avg_effective_render_scale
     FROM client_perf_reports
     WHERE created_at > now() - ($1 || ' hours')::interval`,
    [String(hours)],
  );
  return perfAggregateFromRow(res.rows[0] ?? {});
}

async function perfBuckets(column: string, hours: number, limit: number, worstFirst = false): Promise<PerfBucket[]> {
  const order = worstFirst ? 'p95_frame_ms DESC, sample_count DESC' : 'sample_count DESC, key ASC';
  const res = await pool.query(
    `SELECT
       ${column} AS key,
       count(*)::int AS sample_count,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p95_frame_ms,
       COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms,
       COALESCE(sum(context_lost_count), 0)::int AS context_loss_count,
       COALESCE(avg(render_scale), 0)::real AS avg_render_scale,
       COALESCE(avg(effective_render_scale), 0)::real AS avg_effective_render_scale
     FROM client_perf_reports
     WHERE created_at > now() - ($1 || ' hours')::interval
     GROUP BY ${column}
     ORDER BY ${order}
     LIMIT $2`,
    [String(hours), limit],
  );
  return res.rows.map((r) => ({ key: String(r.key ?? ''), ...perfAggregateFromRow(r) }));
}

export async function clientPerfSummary(hoursInput = 24): Promise<PerfSummary> {
  const hours = cleanHours(hoursInput);
  const [totals, byPreset, byGpu, byBrowser, byOs, byScenario, worstGpuBuckets] = await Promise.all([
    perfAggregate(hours),
    perfBuckets('graphics_preset', hours, 20),
    perfBuckets('gl_renderer_bucket', hours, 50),
    perfBuckets('browser_family', hours, 20),
    perfBuckets('os_family', hours, 20),
    perfBuckets('zone_or_scenario', hours, 30),
    perfBuckets('gl_renderer_bucket', hours, 20, true),
  ]);
  return {
    hours,
    generatedAt: new Date().toISOString(),
    totals,
    byPreset,
    byGpu,
    byBrowser,
    byOs,
    byScenario,
    worstGpuBuckets,
  };
}

export async function clientPerfRaw(hoursInput = 24, limitInput = 100, beforeIdInput?: number): Promise<PerfRawRow[]> {
  const hours = cleanHours(hoursInput);
  const limit = cleanPerfLimit(limitInput);
  const beforeId = cleanBeforeId(beforeIdInput);
  const res = await pool.query(
    `SELECT
       id, created_at, release_version, build_id, session_id, account_id, character_id, realm,
       graphics_preset, gfx_tier, auto_governor, target_fps, render_scale, effective_render_scale,
       fps_avg, frame_p95_ms, frame_p99_ms, long_frame_count,
       renderer_calls, renderer_triangles, renderer_textures, renderer_programs, context_lost_count,
       long_task_count, long_task_p95_ms, memory_used_mb, memory_limit_mb,
       dpr, viewport_bucket, device_memory, hardware_concurrency, mobile_touch,
       browser_family, os_family, gl_vendor, gl_renderer_bucket, zone_or_scenario, source, raw_summary
     FROM client_perf_reports
     WHERE created_at > now() - ($1 || ' hours')::interval
       AND ($3::bigint IS NULL OR id < $3)
     ORDER BY id DESC
     LIMIT $2`,
    [String(hours), limit, beforeId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    releaseVersion: r.release_version,
    buildId: r.build_id,
    sessionId: r.session_id,
    accountId: r.account_id,
    characterId: r.character_id,
    realm: r.realm,
    graphicsPreset: r.graphics_preset,
    gfxTier: r.gfx_tier,
    autoGovernor: r.auto_governor,
    targetFps: r.target_fps,
    renderScale: r.render_scale,
    effectiveRenderScale: r.effective_render_scale,
    fpsAvg: r.fps_avg,
    frameP95Ms: r.frame_p95_ms,
    frameP99Ms: r.frame_p99_ms,
    longFrameCount: r.long_frame_count,
    rendererCalls: r.renderer_calls,
    rendererTriangles: r.renderer_triangles,
    rendererTextures: r.renderer_textures,
    rendererPrograms: r.renderer_programs,
    contextLostCount: r.context_lost_count,
    longTaskCount: r.long_task_count,
    longTaskP95Ms: r.long_task_p95_ms,
    memoryUsedMb: r.memory_used_mb,
    memoryLimitMb: r.memory_limit_mb,
    dpr: r.dpr,
    viewportBucket: r.viewport_bucket,
    deviceMemory: r.device_memory,
    hardwareConcurrency: r.hardware_concurrency,
    mobileTouch: r.mobile_touch,
    browserFamily: r.browser_family,
    osFamily: r.os_family,
    glVendor: r.gl_vendor,
    glRendererBucket: r.gl_renderer_bucket,
    zoneOrScenario: r.zone_or_scenario,
    source: r.source,
    rawSummary: r.raw_summary,
  }));
}

// Escape LIKE wildcards in user-supplied search text so "%" matches a literal
// percent sign instead of everything.
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface AdminAccountRow {
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

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

export async function listAccounts(search: string, page: number, limit: number): Promise<Paginated<AdminAccountRow>> {
  const pattern = search ? `%${escapeLike(search)}%` : '%';
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT a.id, a.username, a.created_at, a.last_login, a.is_admin,
              a.banned_at, a.suspended_until,
              count(c.id)::int AS character_count,
              COALESCE(max(c.level), 0)::int AS max_level,
              COALESCE((SELECT sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))
                        FROM play_sessions s WHERE s.account_id = a.id), 0)::bigint AS playtime_seconds
       FROM accounts a
       LEFT JOIN characters c ON c.account_id = a.id
       WHERE a.username ILIKE $1
       GROUP BY a.id
       ORDER BY a.id DESC
       LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS total FROM accounts WHERE username ILIKE $1`, [pattern]),
  ]);
  return {
    rows: rows.rows.map((r) => ({
      id: r.id,
      username: r.username,
      createdAt: r.created_at,
      lastLogin: r.last_login,
      isAdmin: r.is_admin,
      bannedAt: r.banned_at,
      suspendedUntil: r.suspended_until,
      characterCount: r.character_count,
      maxLevel: r.max_level,
      playtimeSeconds: Number(r.playtime_seconds),
    })),
    total: total.rows[0].total,
    page,
    limit,
  };
}

export interface AdminCharacterRow {
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

const CHARACTER_SORT_COLUMNS: Record<string, string> = {
  id: 'c.id',
  name: 'c.name',
  class: 'c.class',
  level: 'c.level',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
};

export async function listCharacters(
  sort: string,
  dir: 'asc' | 'desc',
  page: number,
  limit: number,
): Promise<Paginated<AdminCharacterRow>> {
  const column = CHARACTER_SORT_COLUMNS[sort] ?? 'c.level';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT c.id, c.name, c.class, c.level, c.account_id, a.username,
              COALESCE((c.state->>'copper')::bigint, 0) AS copper,
              COALESCE((c.state->>'xp')::bigint, 0) AS xp,
              c.created_at, c.updated_at
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       ORDER BY ${column} ${direction}, c.id
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS total FROM characters`),
  ]);
  return {
    rows: rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      class: r.class,
      level: r.level,
      accountId: r.account_id,
      username: r.username,
      copper: Number(r.copper),
      xp: Number(r.xp),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: total.rows[0].total,
    page,
    limit,
  };
}

export interface AccountDetail {
  id: number;
  username: string;
  createdAt: string;
  lastLogin: string | null;
  isAdmin: boolean;
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
}

export async function accountDetail(accountId: number): Promise<AccountDetail | null> {
  const [account, characters, sessions] = await Promise.all([
    pool.query(
      `SELECT id, username, created_at, last_login, is_admin, banned_at, suspended_until,
              COALESCE(moderation_reason, '') AS moderation_reason,
              chat_muted_until,
              COALESCE(chat_mute_reason, '') AS chat_mute_reason,
              COALESCE(chat_strikes, 0) AS chat_strikes,
              last_login_ip,
              COALESCE((SELECT sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))
                        FROM play_sessions s WHERE s.account_id = accounts.id), 0)::bigint AS playtime_seconds
       FROM accounts WHERE id = $1`,
      [accountId],
    ),
    pool.query(
      `SELECT id, name, class, level,
              COALESCE((state->>'copper')::bigint, 0) AS copper,
              COALESCE((state->>'xp')::bigint, 0) AS xp,
              state->'pos' AS pos, created_at, updated_at
       FROM characters WHERE account_id = $1 ORDER BY level DESC, id`,
      [accountId],
    ),
    pool.query(
      `SELECT id, character_name, started_at, ended_at, ip_address,
              EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::bigint AS seconds
       FROM play_sessions WHERE account_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [accountId],
    ),
  ]);
  const a = account.rows[0];
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    createdAt: a.created_at,
    lastLogin: a.last_login,
    isAdmin: a.is_admin,
    bannedAt: a.banned_at,
    suspendedUntil: a.suspended_until,
    moderationReason: a.moderation_reason,
    chatMutedUntil: a.chat_muted_until,
    chatMuteReason: a.chat_mute_reason,
    chatStrikes: Number(a.chat_strikes ?? 0),
    lastLoginIp: a.last_login_ip ?? null,
    playtimeSeconds: Number(a.playtime_seconds),
    characters: characters.rows.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      copper: Number(c.copper),
      xp: Number(c.xp),
      pos: c.pos && typeof c.pos.x === 'number' && typeof c.pos.z === 'number' ? { x: c.pos.x, z: c.pos.z } : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    recentSessions: sessions.rows.map((s) => ({
      id: s.id,
      characterName: s.character_name,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      seconds: Number(s.seconds),
      ip: s.ip_address ?? null,
    })),
  };
}
