import { normalizeAccountFlair, type StreamerLinks } from '../src/sim/account_flair';
import type { AdminAccountSort, AdminAccountSortDirection } from './admin_accounts_sort';
import {
  type ClientPerfSummaryBuckets,
  cleanHours,
  mapClientPerfSummaryRows,
  mapSuggestionCountRows,
  PERF_SUMMARY_LIMITS,
  type PerfSuggestionCount,
} from './client_perf_summary_shape';
import {
  DB_HEAVY_STATEMENT_TIMEOUT_MS,
  loadWorldState,
  pool,
  runWithStatementTimeout,
  saveWorldState,
} from './db';
import { REALM } from './realm';

// Read-side queries for the admin dashboard. All inputs are parameterized;
// sort columns are whitelisted before they reach SQL.

// Served to the admin Overview through the demand-driven 60s memo
// (server/admin_overview_cache.ts): every field, including siteUsersNow's
// "now", is as of the last memo refresh, up to ADMIN_OVERVIEW_TTL_MS stale.
export interface OverviewCounts {
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
}

// world_state key prefix for the folded per-realm all-time online peak.
// Single-sourced across foldOnlinePeak and the overviewCounts reader SQL (a
// drifting copy on either side would silently orphan the stored peak); it is a
// compile-time constant interpolated into SQL text, never user input. Declared
// ahead of OVERVIEW_COUNTS_SQL below so that template literal can reference it
// at module-load time.
export const ONLINE_PEAK_WORLD_STATE_PREFIX = 'admin_online_peak:';

// A big multi-subquery aggregate over accounts / characters / play_sessions,
// request-driven through the admin overview cache (server/admin_overview_cache.ts),
// which bounds how often the admin Overview poll can re-run it: run it on the
// raised allowance so a growing play_sessions table cannot trip the default
// statement timeout. peak_online_all_time is GREATEST of the retained sample
// window's live max and the folded world_state peak (foldOnlinePeak below), so
// a peak inside the retained window stays honest before the next fold and a
// pruned-away peak is never lost. Only foldOnlinePeak writes the peak key, but
// a tampered or corrupted stored value must degrade to 0 under the guarded
// cast, never take down the whole overview read; the digit-count bound in the
// regex is part of that guard (a digits-only value wider than int4 would pass
// a bare digit match and the ::int cast would then error out the whole read).
//
// The active/returning-account subqueries use the sargable
// `(ended_at IS NULL OR ended_at > cutoff)` form, never
// `COALESCE(ended_at, now()) > cutoff`: a volatile function (now()) inside
// the COALESCE makes the whole expression un-indexable, forcing a sequential
// scan of play_sessions on every admin Overview refresh. The OR form lets the
// planner serve both arms (still-open sessions, sessions that ended after the
// cutoff) from play_sessions_ended_account (ended_at, account_id), the
// concurrent index built in server/admin_db_indexes.ts.
export const OVERVIEW_COUNTS_SQL = `
    SELECT
      (SELECT count(*) FROM accounts)::int                                               AS accounts,
      (SELECT count(*) FROM characters)::int                                             AS characters,
      (SELECT count(*) FROM accounts WHERE created_at > now() - interval '1 day')::int   AS accounts_today,
      (SELECT count(*) FROM accounts WHERE created_at > now() - interval '7 days')::int  AS accounts_week,
      (SELECT count(*) FROM accounts WHERE created_at > now() - interval '30 days')::int AS accounts_month,
      (SELECT count(*) FROM play_sessions WHERE started_at > now() - interval '1 day')::int AS sessions_today,
      (SELECT count(DISTINCT account_id) FROM play_sessions
        WHERE started_at <= now() AND (ended_at IS NULL OR ended_at > now() - interval '1 day'))::int AS active_accounts_today,
      (SELECT count(DISTINCT account_id) FROM play_sessions
        WHERE started_at <= now() AND (ended_at IS NULL OR ended_at > now() - interval '7 days'))::int AS active_accounts_week,
      (SELECT count(DISTINCT account_id) FROM play_sessions
        WHERE started_at <= now() AND (ended_at IS NULL OR ended_at > now() - interval '30 days'))::int AS active_accounts_month,
      (SELECT count(DISTINCT ps.account_id) FROM play_sessions ps
        JOIN accounts a ON a.id = ps.account_id
        WHERE a.created_at <= now() - interval '1 day'
          AND ps.started_at <= now()
          AND (ps.ended_at IS NULL OR ps.ended_at > now() - interval '1 day'))::int AS returning_accounts_today,
      -- The rollup term keeps the average stable as old sessions fold forward.
      COALESCE(
        ((SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0) FROM play_sessions)
         + (SELECT COALESCE(sum(playtime_seconds), 0) FROM play_session_totals))
        / NULLIF((SELECT count(*) FROM accounts), 0),
      0)::bigint AS avg_playtime_seconds,
      COALESCE((SELECT max(online_players) FROM admin_online_samples
        WHERE realm = $1 AND sampled_at > now() - interval '1 day'), 0)::int AS peak_online_today,
      GREATEST(
        COALESCE((SELECT max(online_players) FROM admin_online_samples
          WHERE realm = $1), 0),
        COALESCE((SELECT CASE WHEN data->>'peak' ~ '^[0-9]{1,9}$'
            THEN (data->>'peak')::int ELSE 0 END FROM world_state
          WHERE key = '${ONLINE_PEAK_WORLD_STATE_PREFIX}' || $1), 0)
      )::int AS peak_online_all_time,
      (SELECT count(*) FROM site_presence_sessions
        WHERE last_seen_at > now() - interval '2 minutes')::int AS site_users_now
  `;

export async function overviewCounts(): Promise<OverviewCounts> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(OVERVIEW_COUNTS_SQL, [REALM]),
  );
  const r = res.rows[0];
  return {
    accounts: r.accounts,
    characters: r.characters,
    accountsToday: r.accounts_today,
    accountsWeek: r.accounts_week,
    accountsMonth: r.accounts_month,
    sessionsToday: r.sessions_today,
    activeAccountsToday: r.active_accounts_today,
    activeAccountsWeek: r.active_accounts_week,
    activeAccountsMonth: r.active_accounts_month,
    returningAccountsToday: r.returning_accounts_today,
    avgPlaytimeSeconds: Number(r.avg_playtime_seconds),
    peakOnlineToday: r.peak_online_today,
    peakOnlineAllTime: r.peak_online_all_time,
    siteUsersNow: r.site_users_now,
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
  // A grouped scan over play_sessions on an admin-triggered read; run it on the
  // raised allowance so a growing play_sessions table cannot trip the default
  // statement timeout.
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT
         to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
         count(*)::int AS sessions,
         count(DISTINCT account_id)::int AS unique_accounts,
         COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0)::bigint AS playtime_seconds
       FROM play_sessions
       WHERE started_at > now() - ($1 || ' days')::interval
       GROUP BY 1 ORDER BY 1`,
      [String(days)],
    ),
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

export async function recordOnlineSample(
  onlinePlayers: number,
  onlineAccounts: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_online_samples (realm, online_players, online_accounts)
     VALUES ($1, $2, $3)`,
    [REALM, Math.max(0, Math.floor(onlinePlayers)), Math.max(0, Math.floor(onlineAccounts))],
  );
}

export interface SitePresenceInput {
  visitorId: string;
  page: string;
  ipHash: string;
  userAgentHash: string;
}

export async function recordSitePresence(input: SitePresenceInput): Promise<void> {
  await pool.query(
    `INSERT INTO site_presence_sessions (visitor_id, page, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (visitor_id) DO UPDATE SET
       page = EXCLUDED.page,
       last_seen_at = now(),
       ip_hash = EXCLUDED.ip_hash,
       user_agent_hash = EXCLUDED.user_agent_hash`,
    [input.visitorId, input.page, input.ipHash, input.userAgentHash],
  );
}

export async function currentSitePresenceUsers(): Promise<number> {
  const res = await pool.query(
    `SELECT count(*)::int AS count
     FROM site_presence_sessions
     WHERE last_seen_at > now() - interval '2 minutes'`,
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function recordSitePresenceSample(activeVisitors: number): Promise<void> {
  await pool.query(
    `INSERT INTO admin_site_presence_samples (active_visitors)
     VALUES ($1)`,
    [Math.max(0, Math.floor(activeVisitors))],
  );
}

export type OnlineHistoryRange = '24h' | '7d' | '30d';
export type OnlineHistoryBucket = 'hour' | 'day';

export interface OnlineHistoryPoint {
  bucketStart: string;
  avgPlayers: number;
  peakPlayers: number;
  avgAccounts: number;
  peakAccounts: number;
  avgSiteUsers: number;
  peakSiteUsers: number;
}

export interface OnlineHistory {
  range: OnlineHistoryRange;
  bucket: OnlineHistoryBucket;
  points: OnlineHistoryPoint[];
}

const ONLINE_HISTORY_RANGES: Record<
  OnlineHistoryRange,
  { interval: string; bucket: OnlineHistoryBucket }
> = {
  '24h': { interval: '24 hours', bucket: 'hour' },
  '7d': { interval: '7 days', bucket: 'day' },
  '30d': { interval: '30 days', bucket: 'day' },
};

function cleanOnlineHistoryRange(range: string): OnlineHistoryRange {
  return range === '24h' || range === '7d' || range === '30d' ? range : '30d';
}

export async function onlineHistory(rangeInput: string): Promise<OnlineHistory> {
  const range = cleanOnlineHistoryRange(rangeInput);
  const config = ONLINE_HISTORY_RANGES[range];
  const res = await pool.query(
    `SELECT
       COALESCE(bucket_start, site_bucket_start) AS bucket_start,
       COALESCE(avg_players, 0) AS avg_players,
       COALESCE(peak_players, 0) AS peak_players,
       COALESCE(avg_accounts, 0) AS avg_accounts,
       COALESCE(peak_accounts, 0) AS peak_accounts,
       COALESCE(avg_site_users, 0) AS avg_site_users,
       COALESCE(peak_site_users, 0) AS peak_site_users
     FROM (
       SELECT
         date_trunc('${config.bucket}', sampled_at) AS bucket_start,
         round(avg(online_players)::numeric, 2) AS avg_players,
         max(online_players)::int AS peak_players,
         round(avg(online_accounts)::numeric, 2) AS avg_accounts,
         max(online_accounts)::int AS peak_accounts
       FROM admin_online_samples
       WHERE realm = $1
         AND sampled_at > now() - $2::interval
       GROUP BY 1
     ) online
     FULL OUTER JOIN (
       SELECT
         date_trunc('${config.bucket}', sampled_at) AS site_bucket_start,
         round(avg(active_visitors)::numeric, 2) AS avg_site_users,
         max(active_visitors)::int AS peak_site_users
       FROM admin_site_presence_samples
       WHERE sampled_at > now() - $2::interval
       GROUP BY 1
     ) site ON site.site_bucket_start = online.bucket_start
     ORDER BY bucket_start`,
    [REALM, config.interval],
  );
  return {
    range,
    bucket: config.bucket,
    points: res.rows.map((r) => ({
      bucketStart: r.bucket_start,
      avgPlayers: Number(r.avg_players),
      peakPlayers: Number(r.peak_players),
      avgAccounts: Number(r.avg_accounts),
      peakAccounts: Number(r.peak_accounts),
      avgSiteUsers: Number(r.avg_site_users),
      peakSiteUsers: Number(r.peak_site_users),
    })),
  };
}

// Metrics retention primitives. One advisory-locked process runs the retention
// sweep for the whole database: it folds each realm's all-time online peak into
// world_state first, then deletes expired rows in bounded batches. The fold is
// what makes pruning lossless for the admin Overview's all-time peak.
// ONLINE_PEAK_WORLD_STATE_PREFIX is declared above, ahead of OVERVIEW_COUNTS_SQL.

// Every realm with samples in this database, not just this process's REALM: the
// retention sweep runs in one advisory-locked process on behalf of the whole
// database, so it iterates every realm returned here. This is a FULL index-only
// scan over admin_online_samples_realm_sampled (Postgres has no skip scan), so
// it costs O(retained rows), not O(realms): fine exactly once per nightly run,
// never on a hot path.
export async function distinctOnlineSampleRealms(): Promise<string[]> {
  const res = await pool.query('SELECT DISTINCT realm FROM admin_online_samples');
  return res.rows.map((r) => String(r.realm));
}

// Fold the realm's live all-time online peak into world_state so pruning old
// samples never loses it. GREATEST semantics: the stored value only ever rises,
// and a fold that would not raise it writes nothing, so a no-op fold does not
// churn world_state daily. This is a read-compare-write, not an atomic SQL
// upsert: it is regression-safe only because the advisory-locked sweep is the
// SOLE caller; a second concurrent caller could overwrite a higher stored peak
// with a stale read. Errors intentionally propagate: the fold is the
// lossless-prune precondition, so a failed fold must make the sweep skip this
// realm's prune for the run.
export async function foldOnlinePeak(realm: string): Promise<void> {
  // Rides the realm-leading admin_online_samples_realm_sampled index.
  const res = await pool.query(
    'SELECT max(online_players)::int AS peak FROM admin_online_samples WHERE realm = $1',
    [realm],
  );
  const live = res.rows[0]?.peak;
  if (typeof live !== 'number' || !Number.isFinite(live)) return; // no samples: nothing to fold
  const key = ONLINE_PEAK_WORLD_STATE_PREFIX + realm;
  const stored = await loadWorldState<{ peak?: unknown }>(key);
  const storedPeak =
    typeof stored?.peak === 'number' && Number.isFinite(stored.peak) ? stored.peak : 0;
  if (live <= storedPeak) return;
  await saveWorldState(key, { peak: live });
}

// One bounded delete batch of expired admin_online_samples rows for one realm.
// The table's only non-PK index leads on realm (admin_online_samples_realm_sampled),
// so BOTH predicate arms are load-bearing: dropping the realm arm turns the
// subquery into a sequential scan, and dropping the sampled_at bound would
// delete every sample for the realm regardless of age. retentionDays <= 0 means
// keep forever. Returns the deleted row count so the sweep can loop to a short
// batch.
export async function pruneOnlineSamplesBatch(
  realm: string,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  // A fractional value must clamp to at least one day, never floor to '0 days'.
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM admin_online_samples
      WHERE id IN (
        SELECT id FROM admin_online_samples
         WHERE realm = $1 AND sampled_at < now() - ($2 || ' days')::interval
         ORDER BY sampled_at
         LIMIT $3)`,
    [realm, String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

// One bounded delete batch of expired admin_site_presence_samples rows (the
// table is database-wide, no realm column); the sampled_at predicate rides
// admin_site_presence_samples_sampled. retentionDays <= 0 means keep forever.
export async function pruneSitePresenceSamplesBatch(
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  // A fractional value must clamp to at least one day, never floor to '0 days'.
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM admin_site_presence_samples
      WHERE id IN (
        SELECT id FROM admin_site_presence_samples
         WHERE sampled_at < now() - ($1 || ' days')::interval
         ORDER BY sampled_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

// One bounded delete batch of stale site_presence_sessions rows. The table's
// PRIMARY KEY is visitor_id (there is no id column), so the batch subquery
// selects visitor_id; the last_seen_at predicate rides
// site_presence_sessions_last_seen. Shares one retention value with
// pruneSitePresenceSamplesBatch in production, hence the parallel signature.
// retentionDays <= 0 means keep forever.
export async function pruneSitePresenceSessionsBatch(
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  // A fractional value must clamp to at least one day, never floor to '0 days'.
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM site_presence_sessions
      WHERE visitor_id IN (
        SELECT visitor_id FROM site_presence_sessions
         WHERE last_seen_at < now() - ($1 || ' days')::interval
         ORDER BY last_seen_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

// PerfAggregate and PerfBucket live in the pure shape module next to the row
// mapper that produces them (client_perf_summary_shape.ts); re-exported so this
// module keeps its read-model surface.
export type { PerfAggregate, PerfBucket } from './client_perf_summary_shape';

export interface PerfSummary extends ClientPerfSummaryBuckets {
  hours: number;
  generatedAt: string;
  // Per-id report counts for the window (ruling R14): how many stored reports
  // carried each allowlisted perf-doctor suggestion id. A report carries up to
  // three ids, so these never partition the totals row.
  suggestionCounts: PerfSuggestionCount[];
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
  crowdBucket: string;
  simEntities: number;
  activeViews: number;
  visibleViews: number;
  worst10sFrameP95Ms: number;
  suggestionIds: string[];
  rawSummary: unknown;
}

function cleanPerfLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 100;
}

function cleanBeforeId(id: number | undefined): number | null {
  if (id === undefined || !Number.isFinite(id)) return null;
  const n = Math.floor(id);
  return n > 0 ? n : null;
}

export async function clientPerfSummary(hoursInput = 24): Promise<PerfSummary> {
  const hours = cleanHours(hoursInput);
  // TWO raised-timeout statements inside one transaction. The first (GROUPING
  // SETS over client_perf_reports) replaced the former seven serialized reads:
  // the () set is the totals row and each single-column set is one bucket list.
  // Postgres computes BOTH orderings as window ranks per grouping set (volume:
  // sample_count DESC with the key ASC tie-break under database collation;
  // worst: p95 DESC, sample_count DESC) and the outer filter caps each set at
  // its list limit, so only rows the response can show cross to Node.
  // p99_frame_ms stays percentile_cont(0.99) over frame_p95_ms, a long-standing
  // quirk preserved deliberately. The SECOND statement is the deliberate phase
  // 05 addition (ruling R14): suggestion_ids is an ARRAY column a report
  // carries up to three of, so its per-id counts come from a bounded unnest
  // aggregate, not another grouping set (which counts rows, not array
  // elements). The pure shape module (client_perf_summary_shape.ts) rebuilds
  // the response from both flat row sets.
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, async (query) => {
    const summary = await query(
      `WITH agg AS (
         SELECT
           graphics_preset,
           gfx_tier,
           gl_renderer_bucket,
           browser_family,
           os_family,
           zone_or_scenario,
           crowd_bucket,
           GROUPING(graphics_preset) AS g_preset,
           GROUPING(gfx_tier) AS g_gfxtier,
           GROUPING(gl_renderer_bucket) AS g_gpu,
           GROUPING(browser_family) AS g_browser,
           GROUPING(os_family) AS g_os,
           GROUPING(zone_or_scenario) AS g_scenario,
           GROUPING(crowd_bucket) AS g_crowd,
           count(*)::int AS sample_count,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_avg), 0)::real AS median_fps,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p95_frame_ms,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY frame_p95_ms), 0)::real AS p99_frame_ms,
           COALESCE(sum(context_lost_count), 0)::int AS context_loss_count,
           COALESCE(avg(render_scale), 0)::real AS avg_render_scale,
           COALESCE(avg(effective_render_scale), 0)::real AS avg_effective_render_scale
         FROM client_perf_reports
         WHERE created_at > now() - ($1 || ' hours')::interval
         GROUP BY GROUPING SETS ((), (graphics_preset), (gfx_tier), (gl_renderer_bucket), (browser_family), (os_family), (zone_or_scenario), (crowd_bucket))
       ),
       ranked AS (
         SELECT
           agg.*,
           (row_number() OVER (
             PARTITION BY g_preset, g_gfxtier, g_gpu, g_browser, g_os, g_scenario, g_crowd
             ORDER BY sample_count DESC, COALESCE(graphics_preset, gfx_tier, gl_renderer_bucket, browser_family, os_family, zone_or_scenario, crowd_bucket) ASC
           ))::int AS vol_rank,
           (row_number() OVER (
             PARTITION BY g_preset, g_gfxtier, g_gpu, g_browser, g_os, g_scenario, g_crowd
             ORDER BY p95_frame_ms DESC, sample_count DESC
           ))::int AS worst_rank
         FROM agg
       )
       SELECT * FROM ranked
       WHERE (g_preset + g_gfxtier + g_gpu + g_browser + g_os + g_scenario + g_crowd = 7)
          OR (g_preset = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byPreset})
          OR (g_gfxtier = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byGfxTier})
          OR (g_gpu = 0 AND (vol_rank <= ${PERF_SUMMARY_LIMITS.byGpu} OR worst_rank <= ${PERF_SUMMARY_LIMITS.worstGpu}))
          OR (g_browser = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byBrowser})
          OR (g_os = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byOs})
          OR (g_scenario = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byScenario})
          OR (g_crowd = 0 AND vol_rank <= ${PERF_SUMMARY_LIMITS.byCrowd})`,
      [String(hours)],
    );
    const suggestions = await query(
      `SELECT s.id AS suggestion_id, count(*)::int AS sample_count
         FROM client_perf_reports
         CROSS JOIN LATERAL unnest(suggestion_ids) AS s(id)
        WHERE created_at > now() - ($1 || ' hours')::interval
        GROUP BY s.id
        ORDER BY sample_count DESC, s.id ASC
        LIMIT ${PERF_SUMMARY_LIMITS.suggestionCounts}`,
      [String(hours)],
    );
    return { summaryRows: summary.rows, suggestionRows: suggestions.rows };
  });
  return {
    hours,
    generatedAt: new Date().toISOString(),
    ...mapClientPerfSummaryRows(res.summaryRows),
    suggestionCounts: mapSuggestionCountRows(res.suggestionRows),
  };
}

export async function clientPerfRaw(
  hoursInput = 24,
  limitInput = 100,
  beforeIdInput?: number,
): Promise<PerfRawRow[]> {
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
       browser_family, os_family, gl_vendor, gl_renderer_bucket, zone_or_scenario, source,
       crowd_bucket, sim_entities, active_views, visible_views, worst_10s_frame_p95_ms,
       suggestion_ids, raw_summary
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
    crowdBucket: r.crowd_bucket,
    simEntities: r.sim_entities,
    activeViews: r.active_views,
    visibleViews: r.visible_views,
    worst10sFrameP95Ms: r.worst_10s_frame_p95_ms,
    suggestionIds: r.suggestion_ids,
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
  // Operator-set account flair. The list carries only the two flags (the links
  // themselves ride the detail response, where the edit form reads them).
  isAi: boolean;
  isStreamer: boolean;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

export interface IpAssociationCharacter {
  characterId: number | null;
  characterName: string;
  realm: string | null;
  lastSeenAt: string;
  sessionCount: number;
}

export interface IpAssociationAccount {
  accountId: number;
  username: string;
  isAdmin: boolean;
  status: 'active' | 'suspended' | 'banned';
  suspendedUntil: string | null;
  createdAt: string;
  createdWithIp: boolean;
  lastLoginWithIp: boolean;
  hasSession: boolean;
  lastSeenAt: string;
  characters: IpAssociationCharacter[];
}

export interface IpAssociations {
  ip: string;
  accounts: IpAssociationAccount[];
  total: number;
  page: number;
  limit: number;
}

export interface SharedIpRow {
  ip: string;
  accountCount: number;
  lastSeenAt: string;
}

export type SharedIpSort = 'accounts' | 'last_seen';
export type SharedIpSortDirection = 'asc' | 'desc';

export async function listSharedIps(
  page: number,
  limit: number,
  sort: SharedIpSort = 'accounts',
  dir: SharedIpSortDirection = 'desc',
): Promise<Paginated<SharedIpRow>> {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `WITH account_ip_events AS (
       SELECT id AS account_id, created_ip AS ip, created_at AS seen_at
       FROM accounts
       WHERE created_ip IS NOT NULL AND created_ip <> ''
       UNION ALL
       SELECT id AS account_id, last_login_ip AS ip,
              COALESCE(last_login, created_at) AS seen_at
       FROM accounts
       WHERE last_login_ip IS NOT NULL AND last_login_ip <> ''
       UNION ALL
       SELECT account_id, ip_address AS ip, max(started_at) AS seen_at
       FROM play_sessions
       WHERE ip_address IS NOT NULL AND ip_address <> ''
       GROUP BY account_id, ip_address
     ),
     shared AS (
       SELECT ip,
              count(DISTINCT account_id)::int AS account_count,
              max(seen_at) AS last_seen_at
       FROM account_ip_events
       GROUP BY ip
       HAVING count(DISTINCT account_id) > 1
     )
     SELECT *, count(*) OVER ()::int AS total
     FROM shared
     ORDER BY
       CASE WHEN $3 = 'last_seen' AND $4 = 'asc' THEN last_seen_at END ASC,
       CASE WHEN $3 = 'last_seen' AND $4 = 'desc' THEN last_seen_at END DESC,
       CASE WHEN $3 = 'accounts' AND $4 = 'asc' THEN account_count END ASC,
       CASE WHEN $3 = 'accounts' AND $4 = 'desc' THEN account_count END DESC,
       CASE WHEN $3 = 'last_seen' THEN account_count END DESC,
       last_seen_at DESC,
       ip
     LIMIT $1 OFFSET $2`,
    [limit, offset, sort, dir],
  );
  return {
    rows: result.rows.map((row) => ({
      ip: row.ip,
      accountCount: Number(row.account_count),
      lastSeenAt: row.last_seen_at,
    })),
    total: Number(result.rows[0]?.total ?? 0),
    page,
    limit,
  };
}

export async function associationsForIp(
  ip: string,
  page: number,
  limit: number,
): Promise<IpAssociations> {
  const offset = (page - 1) * limit;
  const accounts = await pool.query(
    `WITH session_matches AS (
       SELECT account_id, max(started_at) AS latest_session_at
       FROM play_sessions
       WHERE ip_address = $1
       GROUP BY account_id
     ),
     matched AS (
       SELECT a.id, a.username, a.is_admin, a.created_at, a.suspended_until,
              CASE
                WHEN a.banned_at IS NOT NULL THEN 'banned'
                WHEN a.suspended_until > now() THEN 'suspended'
                ELSE 'active'
              END AS status,
              COALESCE(a.created_ip = $1, false) AS created_with_ip,
              COALESCE(a.last_login_ip = $1, false) AS last_login_with_ip,
              sm.latest_session_at,
              GREATEST(
                CASE WHEN a.created_ip = $1 THEN a.created_at ELSE '-infinity'::timestamptz END,
                CASE WHEN a.last_login_ip = $1
                  THEN COALESCE(a.last_login, a.created_at)
                  ELSE '-infinity'::timestamptz
                END,
                COALESCE(sm.latest_session_at, '-infinity'::timestamptz)
              ) AS last_seen_at
       FROM accounts a
       LEFT JOIN session_matches sm ON sm.account_id = a.id
       WHERE a.created_ip = $1 OR a.last_login_ip = $1 OR sm.account_id IS NOT NULL
     )
     SELECT *, count(*) OVER ()::int AS total
     FROM matched
     ORDER BY last_seen_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [ip, limit, offset],
  );

  const accountIds = accounts.rows.map((row) => Number(row.id));
  const characters =
    accountIds.length === 0
      ? { rows: [] }
      : await pool.query(
          `SELECT ps.account_id, ps.character_id,
                  COALESCE(c.name, ps.character_name) AS character_name, c.realm,
                  max(ps.started_at) AS last_seen_at,
                  count(*)::int AS session_count
           FROM play_sessions ps
           LEFT JOIN characters c ON c.id = ps.character_id
           WHERE ps.ip_address = $1 AND ps.account_id = ANY($2::int[])
           GROUP BY ps.account_id, ps.character_id, COALESCE(c.name, ps.character_name), c.realm
           ORDER BY ps.account_id, last_seen_at DESC, character_name`,
          [ip, accountIds],
        );

  const charactersByAccount = new Map<number, IpAssociationCharacter[]>();
  for (const row of characters.rows) {
    const accountId = Number(row.account_id);
    const list = charactersByAccount.get(accountId) ?? [];
    list.push({
      characterId: row.character_id === null ? null : Number(row.character_id),
      characterName: row.character_name,
      realm: row.realm ?? null,
      lastSeenAt: row.last_seen_at,
      sessionCount: Number(row.session_count),
    });
    charactersByAccount.set(accountId, list);
  }

  return {
    ip,
    accounts: accounts.rows.map((row) => ({
      accountId: Number(row.id),
      username: row.username,
      isAdmin: row.is_admin,
      status: row.status,
      suspendedUntil: row.suspended_until ?? null,
      createdAt: row.created_at,
      createdWithIp: row.created_with_ip,
      lastLoginWithIp: row.last_login_with_ip,
      hasSession: row.latest_session_at !== null,
      lastSeenAt: row.last_seen_at,
      characters: charactersByAccount.get(Number(row.id)) ?? [],
    })),
    total: Number(accounts.rows[0]?.total ?? 0),
    page,
    limit,
  };
}

// Maps each allowlisted AdminAccountSort to the SQL it orders by. character_count,
// max_level, and playtime_seconds address their own SELECT-list aliases (Postgres
// resolves an ORDER BY item against the output column list), so no separate
// aggregate expression needs repeating here.
const ACCOUNT_SORT_COLUMNS: Record<AdminAccountSort, string> = {
  id: 'a.id',
  username: 'lower(a.username)',
  character_count: 'character_count',
  max_level: 'max_level',
  playtime_seconds: 'playtime_seconds',
  created_at: 'a.created_at',
  last_login: 'a.last_login',
};

export async function listAccounts(
  search: string,
  page: number,
  limit: number,
  sort: AdminAccountSort = 'id',
  dir: AdminAccountSortDirection = sort === 'username' ? 'asc' : 'desc',
): Promise<Paginated<AdminAccountRow>> {
  const pattern = search ? `%${escapeLike(search)}%` : '%';
  const offset = (page - 1) * limit;
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const column = ACCOUNT_SORT_COLUMNS[sort];
  // a.last_login is nullable (accounts that never logged in): Postgres sorts NULL
  // before every non-null value on DESC, which would put never-logged-in accounts
  // ahead of recently active ones under a descending "Last login" sort, the opposite
  // of what the header implies. Pin NULLS LAST for both directions so "never" always
  // sorts as the oldest possible login, not the newest.
  const nullsPolicy = sort === 'last_login' ? ' NULLS LAST' : '';
  // a.id is always the unique tiebreaker; for the id sort itself that would
  // just repeat "a.id DESC, a.id DESC", so it is the whole ORDER BY on its own.
  const order =
    sort === 'id' ? `a.id ${direction}` : `${column} ${direction}${nullsPolicy}, a.id ${direction}`;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT a.id, a.username, a.created_at, a.last_login, a.is_admin,
              a.banned_at, a.suspended_until, a.is_ai, a.is_streamer,
              count(c.id)::int AS character_count,
              COALESCE(max(c.level), 0)::int AS max_level,
              (COALESCE((SELECT sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))
                         FROM play_sessions s WHERE s.account_id = a.id), 0)
               + COALESCE((SELECT sum(t.playtime_seconds)
                           FROM play_session_totals t WHERE t.account_id = a.id), 0))::bigint AS playtime_seconds
       FROM accounts a
       LEFT JOIN characters c ON c.account_id = a.id
       WHERE a.username ILIKE $1
       GROUP BY a.id
       ORDER BY ${order}
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
      isAi: r.is_ai === true,
      isStreamer: r.is_streamer === true,
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
  guildId: number | null;
  guildName: string | null;
  guildRank: string | null;
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
  search: string,
  sort: string,
  dir: 'asc' | 'desc',
  page: number,
  limit: number,
): Promise<Paginated<AdminCharacterRow>> {
  const pattern = search ? `%${escapeLike(search)}%` : '%';
  const column = CHARACTER_SORT_COLUMNS[sort] ?? 'c.level';
  const pageColumn = column.replace('c.', 'page.');
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    pool.query(
      `WITH page AS MATERIALIZED (
         SELECT c.id, c.name, c.class, c.level, c.account_id, c.realm,
                c.state, c.created_at, c.updated_at
           FROM characters c
          WHERE c.name ILIKE $1
          ORDER BY ${column} ${direction}, c.id
          LIMIT $2 OFFSET $3
       )
       SELECT page.id, page.name, page.class, page.level, page.account_id, a.username,
              COALESCE((page.state->>'copper')::bigint, 0) AS copper,
              COALESCE((page.state->>'xp')::bigint, 0) AS xp,
              page.created_at, page.updated_at,
              g.id AS guild_id, g.name AS guild_name, gm.rank AS guild_rank
         FROM page
         JOIN accounts a ON a.id = page.account_id
         LEFT JOIN guild_members gm ON gm.character_id = page.id
         LEFT JOIN guilds g ON g.id = gm.guild_id AND g.realm = page.realm
        ORDER BY ${pageColumn} ${direction}, page.id`,
      [pattern, limit, offset],
    ),
    pool.query(
      `SELECT count(*)::int AS total
       FROM characters c
       WHERE c.name ILIKE $1`,
      [pattern],
    ),
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
      guildId: r.guild_id == null ? null : Number(r.guild_id),
      guildName: r.guild_name ?? null,
      guildRank: r.guild_rank ?? null,
    })),
    total: total.rows[0].total,
    page,
    limit,
  };
}

// R35 GM professions inspector: one character's identity plus its raw state
// blob (JSONB, already parsed by pg). The handler overlays a live
// serializeCharacter snapshot when the character is online, then shapes both
// through the pure characterProfessionsSheet normalizer. `state` is
// UNDEFINED when the caller suppressed the fetch (includeState false, the
// live path) and null/object when fetched: undefined-vs-null is what keeps
// "not fetched" distinguishable from "never entered" (SQL NULL blob), the
// distinction characterProfessionsSheetFromRow's emptyBlob derivation rides.
export interface AdminCharacterProfessionsRow {
  id: number;
  name: string;
  class: string;
  level: number;
  accountId: number;
  username: string;
  state: unknown;
  updatedAt: string;
}

export async function characterProfessionsRow(
  characterId: number,
  includeState = true,
): Promise<AdminCharacterProfessionsRow | null> {
  // includeState false when the caller holds a LIVE serializeCharacter
  // snapshot: the stored blob would be discarded, and `state` is the widest
  // column in the schema (a TOASTed detoast for nothing on the shared box).
  const res = await pool.query(
    `SELECT c.id, c.name, c.class, c.level, c.account_id, a.username,
            CASE WHEN $2::boolean THEN c.state ELSE NULL END AS state,
            c.updated_at
     FROM characters c
     JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [characterId, includeState],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    class: r.class,
    level: r.level,
    accountId: r.account_id,
    username: r.username,
    // Honest suppression: the CASE arm returns SQL NULL when the fetch was
    // skipped, which would be indistinguishable from a genuinely NULL blob.
    state: includeState ? r.state : undefined,
    updatedAt: r.updated_at,
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
  // Operator-set account flair, as the dashboard's edit form needs to read it back:
  // the two flags plus the stored links. The links are re-normalized on the way out
  // (normalizeAccountFlair), so a value that could not survive the write gate is not
  // echoed to the dashboard either.
  isAi: boolean;
  isStreamer: boolean;
  streamerLinks: StreamerLinks;
  dailyRewardsBan?: { reason: string; createdAt: string; expiresAt: string | null } | null;
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
    guildId: number | null;
    guildName: string | null;
    guildRank: string | null;
  }[];
  recentSessions: {
    id: number;
    characterName: string;
    startedAt: string;
    endedAt: string | null;
    seconds: number;
    ip: string | null;
  }[];
  moderationHistory: {
    id: number;
    action: string;
    reason: string;
    createdAt: string;
    expiresAt: string | null;
    adminAccountId: number | null;
    adminUsername: string | null;
  }[];
}

export interface DailyRewardPointEventRow {
  id: number;
  createdAt: string;
  kind: string;
  points: number;
  totalPoints: number;
  meta: Record<string, unknown>;
}

export interface DailyRewardPointEventLog {
  day: string;
  rows: DailyRewardPointEventRow[];
  total: number;
  truncated: boolean;
}

const DAILY_REWARD_POINT_EVENT_LIMIT_MAX = 250;

const DAILY_REWARD_EVENT_META_KEYS = [
  'baseClearPoints',
  'basePoints',
  'bonusType',
  'bountifulMultiplier',
  'bracket',
  'chestBasePoints',
  'chestTier',
  'delveId',
  'format',
  'matchType',
  'multiplier',
  'onlineMinutes',
  'outcome',
  'questId',
  'repeatIndex',
  'taskId',
  'taskType',
  'tierId',
  'tierMultiplier',
  'won',
] as const;

function eventMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of DAILY_REWARD_EVENT_META_KEYS) {
    const entry = source[key];
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      safe[key] = entry;
    }
  }
  return safe;
}

export async function dailyRewardPointEvents(
  accountId: number,
  day: string,
  limit = 100,
): Promise<DailyRewardPointEventLog> {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 100;
  const safeLimit = Math.max(1, Math.min(DAILY_REWARD_POINT_EVENT_LIMIT_MAX, requestedLimit));
  const result = await pool.query(
    `SELECT id, created_at, kind, points, meta, total_points, total_events
       FROM (
         SELECT id, created_at, kind, points, meta,
                SUM(points) OVER (
                  ORDER BY created_at DESC, id DESC
                  ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
                ) AS total_points,
                COUNT(*) OVER () AS total_events
           FROM daily_reward_events
          WHERE account_id = $1
            AND day = $2
            AND realm = $3
            AND points > 0
       ) events
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [accountId, day, REALM, safeLimit],
  );
  const total = Number(result.rows[0]?.total_events ?? 0);
  return {
    day,
    rows: result.rows.map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      kind: String(row.kind),
      points: Number(row.points),
      totalPoints: Number(row.total_points),
      meta: eventMeta(row.meta),
    })),
    total,
    truncated: total > result.rows.length,
  };
}

export type ModerationHistoryTab = 'all' | 'mine' | 'notes';

// The action kinds the guild arm can carry, the guild-scoped sibling of the
// account-scoped MODERATION_ACTIONS (server/moderation_db.ts). Guild moderation
// used to write exactly one row shape, so the audit query stamped the
// discriminator as a literal; the dormant-slot bank purge made it two, so
// guild_moderation_actions gained an additive `action` column (defaulting to
// the rename literal, which is what keeps every pre-existing row correct) and
// the union now reads that column. The dashboard's label table
// (src/admin/labels.ts) keys off these constants and
// tests/admin/moderation_action_labels.test.ts pins the whole closed set
// against it, so a third guild action cannot regress to "Other action".
export const GUILD_RENAME_ACTION = 'guild_rename';
export const GUILD_BANK_PURGE_ACTION = 'guild_bank_purge';
export const GUILD_MODERATION_ACTIONS = [GUILD_RENAME_ACTION, GUILD_BANK_PURGE_ACTION] as const;

export interface ModerationActionHistoryEntry {
  source: 'account' | 'ip' | 'guild';
  id: number;
  accountId: number | null;
  username: string | null;
  ip: string | null;
  guildId: number | null;
  guildName: string | null;
  action: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  adminAccountId: number | null;
  adminUsername: string | null;
}

export interface ModerationActionHistoryPage {
  rows: ModerationActionHistoryEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function listModerationActions(
  tab: ModerationHistoryTab,
  adminAccountId: number,
  page: number,
  limit: number,
): Promise<ModerationActionHistoryPage> {
  const offset = (page - 1) * limit;
  // $1 is always the realm: only the guild arm is realm-scoped (accounts and
  // blocked IPs are global), and pinning it first keeps the tab parameter at a
  // fixed $2 across all three tabs.
  const params: unknown[] = [REALM];
  let accountWhereSql = '';
  let ipWhereSql = '';
  let guildWhereSql = 'WHERE guild_action.realm = $1';
  if (tab === 'mine') {
    params.push(adminAccountId);
    accountWhereSql = 'WHERE action_log.admin_account_id = $2';
    ipWhereSql = 'WHERE ip_action.admin_account_id = $2';
    guildWhereSql = 'WHERE guild_action.realm = $1 AND guild_action.admin_account_id = $2';
  } else if (tab === 'notes') {
    params.push(adminAccountId);
    accountWhereSql = "WHERE action_log.admin_account_id = $2 AND action_log.action = 'note'";
    ipWhereSql = 'WHERE false';
    // A guild rename is never a note, so the notes tab excludes the arm outright.
    // The realm predicate stays in front of the constant: it is the only place
    // $1 appears, and Postgres refuses to parse a statement carrying a parameter
    // no arm references ("could not determine data type of parameter $1").
    guildWhereSql = 'WHERE guild_action.realm = $1 AND false';
  }
  const pageParams = [...params, limit, offset];
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const auditSql = `SELECT *
       FROM (
         SELECT 'account' AS source,
                action_log.id,
                action_log.account_id,
                target.username,
                NULL::text AS ip,
                action_log.action,
                action_log.reason,
                action_log.created_at,
                action_log.expires_at,
                action_log.admin_account_id,
                admin.username AS admin_username,
                NULL::int AS guild_id,
                NULL::text AS guild_name
         FROM account_moderation_actions action_log
         JOIN accounts target ON target.id = action_log.account_id
         LEFT JOIN accounts admin ON admin.id = action_log.admin_account_id
         ${accountWhereSql}
         UNION ALL
         SELECT 'ip' AS source,
                ip_action.id,
                NULL::int AS account_id,
                NULL::text AS username,
                ip_action.ip,
                ip_action.action,
                ip_action.reason,
                ip_action.created_at,
                NULL::timestamptz AS expires_at,
                ip_action.admin_account_id,
                admin.username AS admin_username,
                NULL::int AS guild_id,
                NULL::text AS guild_name
         FROM blocked_ip_actions ip_action
         LEFT JOIN accounts admin ON admin.id = ip_action.admin_account_id
         ${ipWhereSql}
         UNION ALL
         SELECT 'guild' AS source,
                guild_action.id,
                NULL::int AS account_id,
                NULL::text AS username,
                NULL::text AS ip,
                guild_action.action,
                guild_action.reason,
                guild_action.created_at,
                NULL::timestamptz AS expires_at,
                guild_action.admin_account_id,
                admin.username AS admin_username,
                guild_action.guild_id,
                COALESCE(guild.name, guild_action.new_name) AS guild_name
         FROM guild_moderation_actions guild_action
         LEFT JOIN accounts admin ON admin.id = guild_action.admin_account_id
         LEFT JOIN guilds guild
                ON guild.id = guild_action.guild_id AND guild.realm = guild_action.realm
         ${guildWhereSql}
       ) audit_log`;
  const [rows, total] = await Promise.all([
    pool.query(
      `${auditSql}
       ORDER BY created_at DESC, id DESC, source
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      pageParams,
    ),
    pool.query(
      `SELECT count(*)::int AS total
       FROM (${auditSql}) count_log`,
      params,
    ),
  ]);
  return {
    rows: rows.rows.map((entry) => ({
      source: entry.source,
      id: Number(entry.id),
      accountId: entry.account_id === null ? null : Number(entry.account_id),
      username: entry.username ?? null,
      ip: entry.ip ?? null,
      guildId: entry.guild_id === null ? null : Number(entry.guild_id),
      guildName: entry.guild_name ?? null,
      action: entry.action,
      reason: entry.reason,
      createdAt: entry.created_at,
      expiresAt: entry.expires_at ?? null,
      adminAccountId: entry.admin_account_id === null ? null : Number(entry.admin_account_id),
      adminUsername: entry.admin_username ?? null,
    })),
    total: Number(total.rows[0]?.total ?? 0),
    page,
    limit,
  };
}

export async function accountDetail(accountId: number): Promise<AccountDetail | null> {
  const [account, characters, sessions, moderationHistory, dailyRewardsIpBans] = await Promise.all([
    // The account row carries a correlated sum over ALL of this account's
    // play_sessions, the one scan here that grows without bound, so run it on the
    // raised allowance; the remaining reads stay bounded (LIMIT-capped or indexed
    // lookups) on the default timeout.
    runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
      query(
        `SELECT id, username, created_at, last_login, is_admin, banned_at, suspended_until,
                COALESCE(moderation_reason, '') AS moderation_reason,
                chat_muted_until,
                COALESCE(chat_mute_reason, '') AS chat_mute_reason,
                COALESCE(chat_strikes, 0) AS chat_strikes,
                is_ai, is_streamer, streamer_links,
                active_daily_rewards_ban.daily_rewards_ban_reason,
                active_daily_rewards_ban.daily_rewards_banned_at,
                active_daily_rewards_ban.daily_rewards_ban_expires_at,
                last_login_ip,
                (COALESCE((SELECT sum(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.started_at)))
                           FROM play_sessions s WHERE s.account_id = accounts.id), 0)
                 + COALESCE((SELECT sum(t.playtime_seconds)
                             FROM play_session_totals t WHERE t.account_id = accounts.id), 0))::bigint AS playtime_seconds
         FROM accounts
         LEFT JOIN LATERAL (
           SELECT reason AS daily_rewards_ban_reason,
                  created_at AS daily_rewards_banned_at,
                  expires_at AS daily_rewards_ban_expires_at
             FROM daily_reward_bans
            WHERE account_id = accounts.id
              AND (expires_at IS NULL OR expires_at > now())
         ) active_daily_rewards_ban ON true
         WHERE id = $1`,
        [accountId],
      ),
    ),
    pool.query(
      `SELECT c.id, c.name, c.class, c.level,
              COALESCE((c.state->>'copper')::bigint, 0) AS copper,
              COALESCE((c.state->>'xp')::bigint, 0) AS xp,
              c.state->'pos' AS pos, c.created_at, c.updated_at,
              g.id AS guild_id, g.name AS guild_name, gm.rank AS guild_rank
       FROM characters c
       LEFT JOIN guild_members gm ON gm.character_id = c.id
       LEFT JOIN guilds g ON g.id = gm.guild_id AND g.realm = c.realm
       WHERE c.account_id = $1
       ORDER BY c.level DESC, c.id`,
      [accountId],
    ),
    pool.query(
      `SELECT id, character_name, started_at, ended_at, ip_address,
              EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::bigint AS seconds
       FROM play_sessions WHERE account_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [accountId],
    ),
    pool.query(
      `SELECT action_log.id, action_log.action, action_log.reason,
              action_log.created_at, action_log.expires_at,
              action_log.admin_account_id, admin.username AS admin_username
       FROM account_moderation_actions action_log
       LEFT JOIN accounts admin ON admin.id = action_log.admin_account_id
       WHERE action_log.account_id = $1
       ORDER BY action_log.created_at DESC, action_log.id DESC
       LIMIT 50`,
      [accountId],
    ),
    // The moderation view's own IP-ban lookback, deliberately OR-shaped
    // (admin-triggered, bounded to one account, off the hot path). The
    // association arm keeps an aged-out link visible: once retention folds an
    // account's old play_sessions rows into account_ip_associations, only that
    // arm still ties the account to its banned IP.
    pool.query(
      `SELECT ib.ip_address, ib.reason, ib.created_at
         FROM daily_reward_ip_bans ib
        WHERE ib.ip_address = (SELECT last_login_ip FROM accounts WHERE id = $1)
           OR EXISTS (
             SELECT 1 FROM play_sessions ps
              WHERE ps.account_id = $1 AND ps.ip_address = ib.ip_address
           )
           OR EXISTS (
             SELECT 1 FROM account_ip_associations assoc
              WHERE assoc.account_id = $1 AND assoc.ip_address = ib.ip_address
           )
        ORDER BY ib.created_at DESC`,
      [accountId],
    ),
  ]);
  const a = account.rows[0];
  if (!a) return null;
  const flair = normalizeAccountFlair({
    ai: a.is_ai,
    streamer: a.is_streamer,
    links: a.streamer_links,
  });
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
    isAi: flair.ai,
    isStreamer: flair.streamer,
    streamerLinks: flair.links,
    dailyRewardsBan:
      a.daily_rewards_ban_reason == null
        ? null
        : {
            reason: String(a.daily_rewards_ban_reason),
            createdAt: a.daily_rewards_banned_at,
            expiresAt: a.daily_rewards_ban_expires_at ?? null,
          },
    dailyRewardsIpBans: (dailyRewardsIpBans?.rows ?? []).map((row) => ({
      ip: String(row.ip_address),
      reason: String(row.reason),
      createdAt: row.created_at,
    })),
    lastLoginIp: a.last_login_ip ?? null,
    playtimeSeconds: Number(a.playtime_seconds),
    characters: characters.rows.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      copper: Number(c.copper),
      xp: Number(c.xp),
      pos:
        c.pos && typeof c.pos.x === 'number' && typeof c.pos.z === 'number'
          ? { x: c.pos.x, z: c.pos.z }
          : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      guildId: c.guild_id == null ? null : Number(c.guild_id),
      guildName: c.guild_name ?? null,
      guildRank: c.guild_rank ?? null,
    })),
    recentSessions: sessions.rows.map((s) => ({
      id: s.id,
      characterName: s.character_name,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      seconds: Number(s.seconds),
      ip: s.ip_address ?? null,
    })),
    moderationHistory: moderationHistory.rows.map((entry) => ({
      id: Number(entry.id),
      action: entry.action,
      reason: entry.reason,
      createdAt: entry.created_at,
      expiresAt: entry.expires_at ?? null,
      adminAccountId: entry.admin_account_id === null ? null : Number(entry.admin_account_id),
      adminUsername: entry.admin_username ?? null,
    })),
  };
}
