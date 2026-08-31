import type * as http from 'node:http';
import {
  accountAndScopeForToken,
  type ClientPerfReportInsert,
  getCharacter,
  insertClientPerfReport,
} from './db';
import { clientPerfMetricsSink } from './http/client_perf_metrics';
import type { RateLimitOutcome } from './http/types';
import { json, readBody } from './http_util';
import { rateLimitNow, requestIp, windowedRateLimitOutcome } from './ratelimit';
import { REALM } from './realm';

// Bumped to 2 for the packet 0 report dimensions (zone, crowd, views,
// worst-10s; ruling R6); the intIn clamp below keeps version-1 clients valid.
const PERF_REPORT_SCHEMA_VERSION = 2;

// Fixed crowd labels (ruling R3). server/ cannot import src/game, so this is
// a deliberate copy of src/game/crowd_bucket.ts CROWD_BUCKET_LABELS;
// tests/perf_report.test.ts pins the two catalogs equal.
const CROWD_BUCKET_LABELS = ['lt10', '10-24', '25-49', '50-99', '100plus', 'unknown'] as const;
// Client-computed perf-doctor suggestion ids (ruling R14). Same deliberate-copy
// pattern as the crowd labels: server/ cannot import src/game, so this mirrors
// src/game/perf_doctor.ts PERF_SUGGESTION_IDS and the cross-boundary pin in
// tests/perf_suggestion_id_parity.test.ts is the drift guard. Everything else
// from the wire is dropped before it can reach storage or admin aggregates.
const KNOWN_PERF_SUGGESTION_IDS = [
  'hardware-acceleration',
  'integrated-gpu',
  'high-dpi',
  'forced-high-graphics',
  'low-memory',
  'browser-stalls',
  'heap-pressure',
  'context-loss',
] as const;
// The client analyzer caps its output at 3 suggestions per report; the server
// re-imposes the same ceiling so a hostile payload cannot widen the column.
const PERF_SUGGESTION_IDS_MAX = 3;
// A legitimate payload is at most 3 entries; scanning stops far above that so
// the sanitizer stays O(1) even if the body-size cap ever loosens upstream.
const PERF_SUGGESTION_IDS_SCAN_MAX = 64;
const PERF_REPORT_MAX_PER_MINUTE = 30;
const PERF_REPORT_WINDOW_MS = 60_000;
const PERF_REPORT_MAX_TRACKED_IPS = 5000;
const RAW_SUMMARY_MAX_BYTES = 16 * 1024;
const RAW_SUMMARY_DEV_TRACE_MAX_BYTES = 512 * 1024;
const PERF_REPORT_MAX_BODY_BYTES = 64 * 1024;
const PERF_REPORT_DEV_TRACE_MAX_BODY_BYTES = 768 * 1024;

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

const PERF_REPORT_MIN_INSERT_INTERVAL_MS = Math.max(
  10_000,
  Math.min(10 * 60_000, envNumber('PERF_REPORT_MIN_INSERT_INTERVAL_MS', 45_000)),
);
const PERF_REPORT_MAX_TRACKED_SESSIONS = 20_000;

const perfReportAttempts = new Map<string, number[]>();
const perfReportLastInsertBySession = new Map<string, number>();

// Time reads route through rateLimitNow (the shared ratelimit.ts clock seam) so a
// test can drive the window via setRateLimitClock, exactly like the other limiters.
function rateLimitedPerfReport(req: http.IncomingMessage): RateLimitOutcome {
  const ip = requestIp(req);
  const now = rateLimitNow();
  const windowStart = now - PERF_REPORT_WINDOW_MS;
  const updated = (perfReportAttempts.get(ip) ?? []).filter((t) => t > windowStart);
  updated.push(now);
  perfReportAttempts.set(ip, updated);

  if (perfReportAttempts.size > PERF_REPORT_MAX_TRACKED_IPS) {
    for (const [key, times] of perfReportAttempts) {
      if (times.length === 0 || times[times.length - 1] <= windowStart)
        perfReportAttempts.delete(key);
      if (perfReportAttempts.size <= PERF_REPORT_MAX_TRACKED_IPS) break;
    }
  }

  return windowedRateLimitOutcome(
    updated.length,
    PERF_REPORT_MAX_PER_MINUTE,
    updated[0],
    PERF_REPORT_WINDOW_MS,
    now,
  );
}

function throttleKey(req: http.IncomingMessage, sessionId: string): string {
  const session = sessionId || 'anonymous';
  return `${requestIp(req)}:${session}`;
}

function shouldStorePerfReport(
  req: http.IncomingMessage,
  sessionId: string,
  now = Date.now(),
): boolean {
  const key = throttleKey(req, sessionId);
  const previous = perfReportLastInsertBySession.get(key);
  perfReportLastInsertBySession.delete(key);
  perfReportLastInsertBySession.set(key, now);

  while (perfReportLastInsertBySession.size > PERF_REPORT_MAX_TRACKED_SESSIONS) {
    const oldest = perfReportLastInsertBySession.keys().next().value as string | undefined;
    if (!oldest) break;
    perfReportLastInsertBySession.delete(oldest);
  }

  return previous === undefined || now - previous >= PERF_REPORT_MIN_INSERT_INTERVAL_MS;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return Math.floor(numberIn(value, min, max, fallback));
}

function nullableNumberIn(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function textIn(value: unknown, max: number, fallback = ''): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, max);
}

function choiceIn(value: unknown, choices: readonly string[], fallback: string): string {
  const text = textIn(value, 64);
  return choices.includes(text) ? text : fallback;
}

// Allowlist-filter, dedupe, and cap the client-supplied suggestion ids (ruling
// R14): unknown ids, non-string entries, duplicates, and everything past the
// cap are dropped silently (a beacon is never rejected over its diagnostics).
function suggestionIdsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value.slice(0, PERF_SUGGESTION_IDS_SCAN_MAX)) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!(KNOWN_PERF_SUGGESTION_IDS as readonly string[]).includes(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= PERF_SUGGESTION_IDS_MAX) break;
  }
  return out;
}

function browserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('firefox/')) return 'firefox';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('safari/')) return 'safari';
  return 'other';
}

function osFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('android')) return 'android';
  if (ua.includes('linux')) return 'linux';
  return 'other';
}

function bucketGpu(renderer: string): string {
  const r = renderer.toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|software/.test(r)) return 'software';
  if (/apple/.test(r)) {
    const chip = /(m[1-9][a-z0-9 ]*)/i.exec(renderer)?.[1]?.toLowerCase().replace(/\s+/g, '-');
    return chip ? `apple-${chip}` : 'apple';
  }
  if (/intel/.test(r)) {
    if (/iris/.test(r)) return 'intel-iris';
    if (/uhd|hd graphics/.test(r)) return 'intel-uhd';
    return 'intel';
  }
  if (/nvidia|geforce|rtx|gtx/.test(r)) return 'nvidia';
  if (/amd|radeon/.test(r)) return 'amd';
  return (
    renderer
      .slice(0, 48)
      .replace(/[^\w.-]+/g, '-')
      .toLowerCase() || 'other'
  );
}

function viewportBucket(body: Record<string, unknown>): string {
  const supplied = textIn(body.viewportBucket, 32);
  if (/^(small|medium|large|wide|mobile|unknown)(-\d+x\d+)?$/.test(supplied)) return supplied;
  const w = intIn(body.viewportWidth, 0, 10000, 0);
  const h = intIn(body.viewportHeight, 0, 10000, 0);
  if (w <= 0 || h <= 0) return 'unknown';
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  if (short <= 480) return `mobile-${w}x${h}`;
  if (long >= 1800) return `wide-${w}x${h}`;
  if (long >= 1200) return `large-${w}x${h}`;
  return `medium-${w}x${h}`;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function allowDevTrace(req: http.IncomingMessage): boolean {
  return process.env.NODE_ENV !== 'production' && isLoopbackIp(requestIp(req));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// A genuine browser stall can legitimately run for several seconds (that is
// the whole point of longTasks.max as corroboration for a multi-second
// freeze), so the ceiling is generous rather than the sub-second bound the
// per-frame fields use.
const LONG_TASK_RAW_MS_MAX = 60_000;
// lastAge is time SINCE the last recorded long task, not a task duration: it
// can legitimately span a whole reporting interval between beacons, so its
// ceiling is scaled to that instead of a single task's length. -1 is the
// client's "no long task observed yet" sentinel (src/game/perf.ts).
const LONG_TASK_RAW_AGE_MS_MAX = 30 * 60_000;

// browser.longTasks.{totalMs,avg,max,lastAge} (issue #2479): the four
// longtask fields the client observer computes but the beacon used to drop.
// They ride inside raw_summary (JSONB, no DDL) rather than as new typed
// columns, but still get the same kind of numeric bound the typed frame
// columns get so a hostile payload cannot inject an absurd number into the
// admin raw-report reader. Applied unconditionally in rawSummary() (not only
// on the compact path), unlike compactPrewarmSummary below.
function sanitizeBrowserSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const longTasks = value.longTasks;
  if (!isRecord(longTasks)) return undefined;
  return {
    longTasks: {
      totalMs: nullableNumberIn(longTasks.totalMs, 0, LONG_TASK_RAW_MS_MAX) ?? 0,
      avg: nullableNumberIn(longTasks.avg, 0, LONG_TASK_RAW_MS_MAX) ?? 0,
      max: nullableNumberIn(longTasks.max, 0, LONG_TASK_RAW_MS_MAX) ?? 0,
      lastAge: nullableNumberIn(longTasks.lastAge, -1, LONG_TASK_RAW_AGE_MS_MAX) ?? -1,
    },
  };
}

// rendererGpuQueue (issue #3167): the background GPU queue drains one unit at
// a time (plus a small released-tail overlap), so the running unit, the
// released tails, and the stalls they record are the only evidence a
// never-settling unit leaves. Same JSONB-not-DDL treatment as the longtask
// block above, with the same kind of numeric bound. A completed unit's slice
// is a single piece of GPU work; an active unit's age is time SINCE it started
// and can span whole reporting intervals, hence the two different ceilings.
const GPU_QUEUE_RAW_MS_MAX = 60_000;
const GPU_QUEUE_RAW_AGE_MS_MAX = 30 * 60_000;
const GPU_QUEUE_RAW_STALLS_MAX = 8;
const GPU_QUEUE_RAW_SLOWEST_MAX = 8;
// Released compile-gate tails settling beside the active unit. The client caps
// them at the queue's own tail limit; this bound only defends the ingest.
const GPU_QUEUE_RAW_TAILS_MAX = 4;
// One row per priority lane in the recent-interval block. GPU_WORK_PRIORITY has
// six named lanes; the slack absorbs a caller passing its own number without
// letting a hostile payload turn a fixed-size block into a list.
const GPU_QUEUE_RAW_LANES_MAX = 8;
// Grant-wait examples. The client caps at 5; this only defends the ingest.
const GPU_QUEUE_RAW_WAITS_MAX = 8;
// The recent window is an INTERVAL readout, so its span is bounded by what a
// client could plausibly aggregate over rather than by a unit age.
const GPU_QUEUE_RAW_WINDOW_MS_MAX = 10 * 60_000;

function gpuQueueUnitLabel(value: unknown): string {
  return textIn(value, 80, 'unlabeled');
}

function gpuQueuePriority(value: unknown): number {
  return intIn(value, -1000, 1000, 0);
}

function sanitizeGpuQueueSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const active = isRecord(value.active)
    ? {
        label: gpuQueueUnitLabel(value.active.label),
        priority: gpuQueuePriority(value.active.priority),
        ageMs: numberIn(value.active.ageMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
      }
    : null;
  const stalls = Array.isArray(value.stalls) ? value.stalls : [];
  const slowest = Array.isArray(value.slowest) ? value.slowest : [];
  const blockiest = Array.isArray(value.blockiest) ? value.blockiest : [];
  const waitingTails = Array.isArray(value.waitingTails) ? value.waitingTails : [];
  return {
    units: intIn(value.units, 0, 10_000_000, 0),
    totalSyncMs: numberIn(value.totalSyncMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    worstSyncMs: numberIn(value.worstSyncMs, 0, GPU_QUEUE_RAW_MS_MAX, 0),
    // The frame-cost half of the client's queue readout. This sanitizer
    // REBUILDS the block from a fixed key set rather than merging, so a field
    // the client adds and this list omits is dropped silently: adding one here
    // is part of adding it there.
    totalFrameGapMs: numberIn(value.totalFrameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    worstFrameGapMs: numberIn(value.worstFrameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    worstUnsharedFrameGapMs: numberIn(
      value.worstUnsharedFrameGapMs,
      0,
      GPU_QUEUE_RAW_AGE_MS_MAX,
      0,
    ),
    pending: intIn(value.pending, 0, 1_000_000, 0),
    stallCount: intIn(value.stallCount, 0, 1_000_000, 0),
    active,
    waitingTails: waitingTails
      .slice(0, GPU_QUEUE_RAW_TAILS_MAX)
      .filter(isRecord)
      .map((tail) => ({
        label: gpuQueueUnitLabel(tail.label),
        priority: gpuQueuePriority(tail.priority),
        ageMs: numberIn(tail.ageMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
      })),
    stalls: stalls
      .slice(0, GPU_QUEUE_RAW_STALLS_MAX)
      .filter(isRecord)
      .map((stall) => ({
        label: gpuQueueUnitLabel(stall.label),
        priority: gpuQueuePriority(stall.priority),
        ageMs: numberIn(stall.ageMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
        settled: Boolean(stall.settled),
      })),
    slowest: slowest.slice(0, GPU_QUEUE_RAW_SLOWEST_MAX).filter(isRecord).map(sanitizeGpuQueueUnit),
    // Ranked by frame cost rather than sync slice: the units this metric exists
    // to surface report single-digit syncMs, so a sync-ordered list alone can
    // never carry them to the fleet.
    blockiest: blockiest
      .slice(0, GPU_QUEUE_RAW_SLOWEST_MAX)
      .filter(isRecord)
      .map(sanitizeGpuQueueUnit),
    worstWaitMs: numberIn(value.worstWaitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    longestWaits: (Array.isArray(value.longestWaits) ? value.longestWaits : [])
      .slice(0, GPU_QUEUE_RAW_WAITS_MAX)
      .filter(isRecord)
      .map((wait) => ({
        label: gpuQueueUnitLabel(wait.label),
        priority: gpuQueuePriority(wait.priority),
        waitMs: numberIn(wait.waitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
        // Nullable by design: a wait with nothing running points at the tail cap
        // rather than at a holder, and flattening that to a string would invent
        // a culprit.
        blockedBy: typeof wait.blockedBy === 'string' ? gpuQueueUnitLabel(wait.blockedBy) : null,
        blockedByPriority:
          wait.blockedByPriority === null || wait.blockedByPriority === undefined
            ? null
            : gpuQueuePriority(wait.blockedByPriority),
        waitedOnTailCap: Boolean(wait.waitedOnTailCap),
        tails: (Array.isArray(wait.tails) ? wait.tails : [])
          .slice(0, GPU_QUEUE_RAW_TAILS_MAX)
          .filter((tail): tail is string => typeof tail === 'string')
          .map((tail) => gpuQueueUnitLabel(tail)),
      })),
    recent: sanitizeGpuQueueRecent(value.recent),
  };
}

// The one INTERVAL-scoped block in the queue readout: everything beside it is
// cumulative or a lifetime maximum, so this is what a pacing A/B is read from.
// Rebuilt from a fixed key set like its parent, lanes included.
function sanitizeGpuQueueRecent(value: unknown): Record<string, unknown> {
  const record = isRecord(value) ? value : {};
  const lanes = Array.isArray(record.lanes) ? record.lanes : [];
  return {
    windowMs: numberIn(record.windowMs, 0, GPU_QUEUE_RAW_WINDOW_MS_MAX, 0),
    units: intIn(record.units, 0, 10_000_000, 0),
    totalSyncMs: numberIn(record.totalSyncMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    totalFrameGapMs: numberIn(record.totalFrameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    worstSyncMs: numberIn(record.worstSyncMs, 0, GPU_QUEUE_RAW_MS_MAX, 0),
    worstFrameGapMs: numberIn(record.worstFrameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    worstWaitMs: numberIn(record.worstWaitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    lanes: lanes
      .slice(0, GPU_QUEUE_RAW_LANES_MAX)
      .filter(isRecord)
      .map((lane) => ({
        priority: gpuQueuePriority(lane.priority),
        units: intIn(lane.units, 0, 10_000_000, 0),
        worstWaitMs: numberIn(lane.worstWaitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
        totalWaitMs: numberIn(lane.totalWaitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
        worstSyncMs: numberIn(lane.worstSyncMs, 0, GPU_QUEUE_RAW_MS_MAX, 0),
        worstFrameGapMs: numberIn(lane.worstFrameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
      })),
  };
}

function sanitizeGpuQueueUnit(unit: Record<string, unknown>): Record<string, unknown> {
  return {
    label: gpuQueueUnitLabel(unit.label),
    priority: gpuQueuePriority(unit.priority),
    syncMs: numberIn(unit.syncMs, 0, GPU_QUEUE_RAW_MS_MAX, 0),
    wallMs: numberIn(unit.wallMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    // Enqueue to start. A cosmetic lane delaying an actionable one shows up
    // here first, so it survives ingest beside the cost fields.
    waitMs: numberIn(unit.waitMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    frameGapMs: numberIn(unit.frameGapMs, 0, GPU_QUEUE_RAW_AGE_MS_MAX, 0),
    sharedFrameGap: intIn(unit.sharedFrameGap, 0, 1_000_000, 0),
  };
}

/** The per-level budget-variant costs, rebuilt field by field, or nothing when
 *  the entry carries none (every entry but programs.budget-variants). */
function compactBudgetVariants(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  const variants = value
    .slice(0, PREWARM_COMPACT_BUDGET_VARIANTS_MAX)
    .filter(isRecord)
    .map((variant) => ({
      index: nullableNumberIn(variant.index, 0, 1000),
      elapsedMs: nullableNumberIn(variant.elapsedMs, 0, 600_000),
      syncMs: nullableNumberIn(variant.syncMs, 0, 600_000),
      programDelta: nullableNumberIn(variant.programDelta, -10_000, 10_000),
      passes: nullableNumberIn(variant.passes, 0, 100_000),
    }));
  return variants.length > 0 ? { budgetVariants: variants } : {};
}

function compactPrewarmSummary(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, unknown> = {};
  const scalarKeys = [
    'elapsedMs',
    'maxMs',
    'remainingMs',
    'budgetUsedRatio',
    'timedOut',
    'createdViews',
    'candidateViews',
    'renderPasses',
    'programsDelta',
    'texturesDelta',
    'compileMode',
    'compileMs',
    'compileTimedOut',
    'manifestPlanned',
    'manifestCompleted',
    'manifestPartial',
    'manifestSkipped',
    'manifestTimedOut',
    'manifestFailed',
  ];
  for (const key of scalarKeys) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  // The three entry-id lists are client-supplied arrays and must never be
  // copied verbatim like the scalars above (bounded only by the body cap):
  // same bounds as the entries block below, non-arrays dropped outright.
  // Deliberate asymmetry with the scalar copy: the manifestPartial /
  // manifestTimedOut / manifestFailed COUNTS stay authoritative and uncapped
  // (clamping one would misreport the true count), while these id lists are
  // bounded SAMPLES. A stored count larger than its list length is therefore
  // the documented shape of this signal, not self-contradiction.
  for (const key of ['partialEntryIds', 'timedOutEntryIds', 'failedEntryIds']) {
    const ids = value[key];
    if (!Array.isArray(ids)) continue;
    out[key] = ids
      .slice(0, 24)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => textIn(id, 80));
  }
  const entries = Array.isArray(value.entries)
    ? value.entries
    : Array.isArray(value.manifestEntries)
      ? value.manifestEntries
      : [];
  out.entries = entries
    .slice(0, 24)
    .filter(isRecord)
    .map((entry) => ({
      id: textIn(entry.id, 80),
      category: textIn(entry.category, 24),
      required: Boolean(entry.required),
      status: textIn(entry.status, 16),
      elapsedMs: nullableNumberIn(entry.elapsedMs, 0, 60_000),
      remainingMsAfter: nullableNumberIn(entry.remainingMsAfter, 0, 60_000),
      programDelta: nullableNumberIn(entry.programDelta, -10_000, 10_000),
      textureDelta: nullableNumberIn(entry.textureDelta, -10_000, 10_000),
      workDone: nullableNumberIn(entry.workDone, 0, 100_000),
      workPlanned: nullableNumberIn(entry.workPlanned, 0, 100_000),
      detail: textIn(entry.detail, 160),
      // Carried across truncation for the same reason compileUnits and the
      // pacing transitions are: the per-level costs are the whole point of the
      // budget-variants entry, and dropping them here loses them on exactly the
      // overflowing reports they explain. Only one entry ever carries them, so
      // the cost is one small list, and every field is rebuilt not copied.
      ...compactBudgetVariants(entry.budgetVariants),
    }));
  const resume = sanitizePrewarmResume(value.resume);
  if (resume) out.resume = resume;
  // The streamed-prewarm diagnostic, carried across truncation on a TIGHTER
  // sample than the verbatim path. A report that overflows the byte cap is a
  // report from a heavy session, which is exactly when "which unit stalled"
  // and "did the pacer back off" are worth having: dropping these here would
  // lose the signal precisely where it matters. Same shape as the verbatim
  // path so a reader needs one parser, just fewer members.
  const compileUnits = Array.isArray(value.compileUnits) ? value.compileUnits : null;
  if (compileUnits) {
    out.compileUnits = rankedCompileUnits(compileUnits, PREWARM_COMPACT_COMPILE_UNITS_MAX).map(
      (unit) => ({
        id: textIn(unit.id, 80),
        lane: textIn(unit.lane, 40),
        // The field the ranking above SELECTS on: without it a reader sees
        // units chosen by the failure rule with no way to tell which failed.
        failedAtMs: nullableNumberIn(unit.failedAtMs, 0, 600_000),
        syncMs: nullableNumberIn(unit.syncMs, 0, 600_000),
        settledDurationMs: nullableNumberIn(unit.settledDurationMs, 0, 600_000),
        programDelta: nullableNumberIn(unit.programDelta, -10_000, 10_000),
        statusAtReveal: textIn(unit.statusAtReveal, 16),
      }),
    );
  }
  const pacing = value.prewarmPacing;
  if (isRecord(pacing)) {
    const adaptive = isRecord(pacing.adaptive) ? pacing.adaptive : null;
    const transitions = adaptive && Array.isArray(adaptive.transitions) ? adaptive.transitions : [];
    out.prewarmPacing = {
      mode: textIn(pacing.mode, 24),
      source: textIn(pacing.source, 24),
      adaptive: adaptive
        ? {
            state: textIn(adaptive.state, 24),
            backoffCount: nullableNumberIn(adaptive.backoffCount, 0, 100_000),
            noProgressCount: nullableNumberIn(adaptive.noProgressCount, 0, 100_000),
            transitions: transitions
              .slice(-PREWARM_COMPACT_TRANSITIONS_MAX)
              .filter(isRecord)
              .map((transition) => ({
                atMs: nullableNumberIn(transition.atMs, 0, 600_000),
                from: textIn(transition.from, 24),
                to: textIn(transition.to, 24),
                reason: textIn(transition.reason, 40),
              })),
          }
        : null,
    };
  }
  return out;
}

// The resume lane's outcome: whether the entries the deadline dropped ever ran.
// Rebuilt from a fixed key set, and only when the client sent one, so an older
// client's report is stored without a hollow block that a reader would have to
// tell apart from a lane that genuinely did nothing.
const PREWARM_RESUME_ENTRIES_MAX = 24;
// Mirrors PrewarmResumeStatus / PrewarmResumeEntryOutcome['lane'] in
// src/render/prewarm_resume_ledger_core.ts. server/ cannot import src/render,
// so this is a deliberate copy, the same pattern as CROWD_BUCKET_LABELS above.
const PREWARM_RESUME_STATUSES = ['none', 'scheduled', 'done', 'failed'] as const;
const PREWARM_RESUME_LANES = ['debt', 'cosmetic'] as const;

// The streamed-prewarm diagnostic lists, bounded on the SAME rule as the
// resume block above and for the same reason: they ride the verbatim raw path,
// the client caps are advisory (any token holder can post a hand-rolled
// report), and an unbounded list reaches storage on every report that fits
// under the body cap. Mirrors PREWARM_REPORT_COMPILE_UNITS /
// PREWARM_REPORT_BUDGET_VARIANTS / PREWARM_REPORT_TRANSITIONS in
// src/game/perf_reporter.ts; server/ cannot import src/game, so this is a
// deliberate copy, the same pattern as PREWARM_RESUME_STATUSES above.
// A length clamp, not a field rebuild: the shapes are read as opaque
// diagnostics, and it is their UNBOUNDED length that is the defect. Individual
// member fields stay unshaped here on purpose, so a retained member can still
// carry a long string or a nested object; what bounds THAT is the 16 KB
// RAW_SUMMARY_MAX_BYTES check below, which runs after these clamps and routes
// anything over it into compactPrewarmSummary, where every field IS rebuilt
// through textIn / nullableNumberIn. Storage is therefore bounded in bytes on
// both paths, and in shape on the compact one.
// The compact path's own, tighter sample: it exists to fit a report that
// already overflowed, so it carries fewer members and fewer fields per member.
const PREWARM_COMPACT_COMPILE_UNITS_MAX = 6;
const PREWARM_COMPACT_TRANSITIONS_MAX = 6;
const PREWARM_COMPACT_BUDGET_VARIANTS_MAX = 6;
// Scanned before ranking; far above any legitimate report (the client cap is 12).
const PREWARM_COMPILE_UNITS_SCAN_MAX = 256;

/**
 * The most diagnostic `limit` compile units, in their original order.
 *
 * Taking the FIRST few would keep the earliest units, which on a boot are the
 * cheap ones, and this block exists to answer "which unit stalled" on exactly
 * the heavy reports that overflow into the compact path. Failures rank above
 * everything, then synchronous time. Mirrors sampleCompileUnits in
 * src/game/perf_prewarm_lists_core.ts; server/ cannot import src/game, so this
 * is a deliberate copy, the same pattern as PREWARM_RESUME_STATUSES above.
 */
function rankedCompileUnits(units: unknown[], limit: number): Record<string, unknown>[] {
  // Bounded BEFORE the sort, the same shape as PERF_SUGGESTION_IDS_SCAN_MAX
  // above: a legitimate payload is at most the client cap, and an unauthenticated
  // ingest should not sort an attacker-sized array even once. The scan bound sits
  // far above any real report, so ranking is unaffected in practice.
  const records = units.slice(0, PREWARM_COMPILE_UNITS_SCAN_MAX).filter(isRecord);
  if (records.length <= limit) return records;
  return records
    .map((unit, index) => ({ unit, index }))
    .sort((a, b) => {
      const failed =
        Number(a.unit.failedAtMs === null || a.unit.failedAtMs === undefined) -
        Number(b.unit.failedAtMs === null || b.unit.failedAtMs === undefined);
      if (failed !== 0) return failed;
      const sync = numberIn(b.unit.syncMs, 0, 600_000, 0) - numberIn(a.unit.syncMs, 0, 600_000, 0);
      if (sync !== 0) return sync;
      // The client's own tie-break, so the two copies really do rank alike.
      const settled =
        numberIn(b.unit.settledDurationMs, 0, 600_000, 0) -
        numberIn(a.unit.settledDurationMs, 0, 600_000, 0);
      if (settled !== 0) return settled;
      return a.index - b.index;
    })
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.unit);
}
const PREWARM_COMPILE_UNITS_MAX = 12;
const PREWARM_BUDGET_VARIANTS_MAX = 8;
const PREWARM_PACING_TRANSITIONS_MAX = 12;

/** Bound the client-supplied prewarm diagnostic lists in place. */
function boundPrewarmDiagnosticLists(prewarm: Record<string, unknown>): void {
  if (Array.isArray(prewarm.compileUnits)) {
    // Ranked, not sliced: taking the first N here would throw away the slow and
    // failed units before the compact path (or a reader) ever sees them, which
    // is the opposite of what this list is for. A well-behaved client already
    // sampled the same way; a hand-rolled report has not.
    prewarm.compileUnits = rankedCompileUnits(prewarm.compileUnits, PREWARM_COMPILE_UNITS_MAX);
  }
  for (const key of ['manifestEntries', 'entries']) {
    const entries = prewarm[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.budgetVariants)) continue;
      entry.budgetVariants = entry.budgetVariants
        .slice(0, PREWARM_BUDGET_VARIANTS_MAX)
        .filter(isRecord);
    }
  }
  const pacing = prewarm.prewarmPacing;
  if (!isRecord(pacing)) return;
  const adaptive = pacing.adaptive;
  if (!isRecord(adaptive) || !Array.isArray(adaptive.transitions)) return;
  // The MOST RECENT, matching sampleTransitions on the client: a pacer's end
  // state is what a report is read for, and keeping the front would drop it.
  adaptive.transitions = adaptive.transitions
    .slice(-PREWARM_PACING_TRANSITIONS_MAX)
    .filter(isRecord);
}

function sanitizePrewarmResume(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const failedUnitIds = Array.isArray(value.failedUnitIds) ? value.failedUnitIds : [];
  return {
    // Enums, so an allowlist rather than 16 free characters: a client cannot
    // store a status a reader would then have to guess the meaning of.
    status: choiceIn(value.status, PREWARM_RESUME_STATUSES, 'none'),
    plannedEntries: intIn(value.plannedEntries, 0, 1000, 0),
    plannedUnits: intIn(value.plannedUnits, 0, 100_000, 0),
    startedUnits: intIn(value.startedUnits, 0, 100_000, 0),
    failedUnits: intIn(value.failedUnits, 0, 100_000, 0),
    failedUnitIds: failedUnitIds
      .slice(0, PREWARM_RESUME_ENTRIES_MAX)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => textIn(id, 160)),
    entries: entries
      .slice(0, PREWARM_RESUME_ENTRIES_MAX)
      .filter(isRecord)
      .map((entry) => ({
        id: textIn(entry.id, 80),
        lane: choiceIn(entry.lane, PREWARM_RESUME_LANES, 'cosmetic'),
        planned: intIn(entry.planned, 0, 100_000, 0),
        started: intIn(entry.started, 0, 100_000, 0),
        failed: intIn(entry.failed, 0, 100_000, 0),
      })),
  };
}

function compactRawSummary(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { truncated: true };
  for (const key of [
    'graphicsConfigVersion',
    'seconds',
    'frames',
    'windows',
    'mainMs',
    'rendererPhaseMs',
    'rendererFoliage',
    'rendererBudget',
    'rendererQualityBuckets',
    'input',
    'hud',
    'netPipeline',
    'heapSawtooth',
    'browser',
    // A wedged GPU queue is exactly what a truncated report must still carry:
    // the block is small and bounded, and it is the whole signal.
    'rendererGpuQueue',
  ]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  const prewarm = compactPrewarmSummary(value.rendererPrewarmSummary ?? value.rendererPrewarm);
  if (prewarm) out.rendererPrewarmSummary = prewarm;
  return out;
}

function rawSummary(value: unknown, devTraceAllowed = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const text = JSON.stringify(value);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!devTraceAllowed) delete parsed.devTrace;
    const browser = sanitizeBrowserSummary(parsed.browser);
    if (browser) parsed.browser = browser;
    else delete parsed.browser;
    const gpuQueue = sanitizeGpuQueueSummary(parsed.rendererGpuQueue);
    if (gpuQueue) parsed.rendererGpuQueue = gpuQueue;
    else delete parsed.rendererGpuQueue;
    // The prewarm summary rides through verbatim on this path, bounded only by
    // the body cap, so its client-supplied LISTS are bounded here explicitly.
    // Without this the resume block's entries and failed-unit ids reach storage
    // unclamped on every report under the size limit, and the compact path's
    // sanitizer only ever sees the oversized minority.
    // BOTH prewarm keys, never only the summary: the current client stopped
    // sending the full `rendererPrewarm` twin, but a client older than that
    // change still does (its resume block rides a getter on the live stats
    // object), the compact path still accepts the key as its fallback, and any
    // token holder can post one whatever their client does.
    for (const key of ['rendererPrewarmSummary', 'rendererPrewarm']) {
      const prewarm = parsed[key];
      if (!isRecord(prewarm)) continue;
      const resume = sanitizePrewarmResume(prewarm.resume);
      if (resume) prewarm.resume = resume;
      else delete prewarm.resume;
      boundPrewarmDiagnosticLists(prewarm);
    }
    const boundedText = JSON.stringify(parsed);
    const maxBytes = devTraceAllowed ? RAW_SUMMARY_DEV_TRACE_MAX_BYTES : RAW_SUMMARY_MAX_BYTES;
    if (Buffer.byteLength(boundedText) > maxBytes) {
      const compact = compactRawSummary(parsed);
      return Buffer.byteLength(JSON.stringify(compact)) > maxBytes ? { truncated: true } : compact;
    }
    return JSON.parse(boundedText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function authenticatedAccountId(req: http.IncomingMessage): Promise<number | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const info = await accountAndScopeForToken(m[1]);
  return info?.scope === 'full' ? info.accountId : null;
}

async function authenticatedCharacterId(
  accountId: number | null,
  value: unknown,
): Promise<number | null> {
  if (accountId === null) return null;
  const id = intIn(value, 1, Number.MAX_SAFE_INTEGER, 0);
  if (id <= 0) return null;
  const character = await getCharacter(accountId, id);
  return character ? id : null;
}

export async function handlePerfReport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (!rateLimitedPerfReport(req).allowed) return json(res, 200, { ok: true });

  const devTraceAllowed = allowDevTrace(req);
  const body = (await readBody(
    req,
    devTraceAllowed ? PERF_REPORT_DEV_TRACE_MAX_BODY_BYTES : PERF_REPORT_MAX_BODY_BYTES,
  )) as Record<string, unknown>;
  const sessionId = textIn(body.sessionId, 64);
  if (!shouldStorePerfReport(req, sessionId)) return json(res, 200, { ok: true });

  const accountId = await authenticatedAccountId(req);
  const userAgent = String(req.headers['user-agent'] ?? '');
  const glRenderer = textIn(body.glRenderer, 160);
  const releaseVersion = textIn(body.releaseVersion, 40);
  const buildId = textIn(body.buildId, 40);
  const source = choiceIn(body.source, ['gameplay', 'benchmark'], 'gameplay');

  const row: ClientPerfReportInsert = {
    schemaVersion: intIn(
      body.schemaVersion,
      1,
      PERF_REPORT_SCHEMA_VERSION,
      PERF_REPORT_SCHEMA_VERSION,
    ),
    releaseVersion,
    buildId,
    sessionId,
    accountId,
    characterId: await authenticatedCharacterId(accountId, body.characterId),
    realm: REALM,
    graphicsPreset: choiceIn(
      body.graphicsPreset,
      ['auto', 'low', 'medium', 'high', 'ultra', 'insane', 'advanced'],
      'auto',
    ),
    gfxTier: choiceIn(body.gfxTier, ['low', 'medium', 'high', 'ultra', 'insane'], 'low'),
    autoGovernor: Boolean(body.autoGovernor),
    targetFps: intIn(body.targetFps, 0, 240, 0),
    renderScale: numberIn(body.renderScale, 0.3, 1.5, 1),
    effectiveRenderScale: numberIn(body.effectiveRenderScale, 0.3, 1.5, 1),
    fpsAvg: numberIn(body.fpsAvg, 0, 300, 0),
    frameP95Ms: numberIn(body.frameP95Ms, 0, 1000, 0),
    frameP99Ms: numberIn(body.frameP99Ms, 0, 1000, 0),
    longFrameCount: intIn(body.longFrameCount, 0, 1_000_000, 0),
    rendererCalls: intIn(body.rendererCalls, 0, 1_000_000, 0),
    rendererTriangles: intIn(body.rendererTriangles, 0, 100_000_000, 0),
    rendererTextures: intIn(body.rendererTextures, 0, 100_000, 0),
    rendererPrograms: intIn(body.rendererPrograms, 0, 100_000, 0),
    contextLostCount: intIn(body.contextLostCount, 0, 1000, 0),
    longTaskCount: intIn(body.longTaskCount, 0, 1_000_000, 0),
    longTaskP95Ms: numberIn(body.longTaskP95Ms, 0, 1000, 0),
    memoryUsedMb: nullableNumberIn(body.memoryUsedMb, 0, 1_000_000),
    memoryLimitMb: nullableNumberIn(body.memoryLimitMb, 0, 1_000_000),
    dpr: numberIn(body.dpr, 0.1, 8, 1),
    viewportBucket: viewportBucket(body),
    deviceMemory: nullableNumberIn(body.deviceMemory, 0, 1024),
    hardwareConcurrency: intIn(body.hardwareConcurrency, 0, 1024, 0),
    mobileTouch: Boolean(body.mobileTouch),
    browserFamily: choiceIn(
      body.browserFamily,
      ['chrome', 'safari', 'firefox', 'edge', 'other'],
      browserFamily(userAgent),
    ),
    osFamily: choiceIn(
      body.osFamily,
      ['macos', 'windows', 'ios', 'android', 'linux', 'other'],
      osFamily(userAgent),
    ),
    glVendor: textIn(body.glVendor, 80),
    glRendererBucket: bucketGpu(glRenderer || textIn(body.glRendererBucket, 80)),
    zoneOrScenario: textIn(
      body.zoneOrScenario,
      80,
      source === 'benchmark' ? 'benchmark' : 'gameplay',
    ),
    source,
    crowdBucket: choiceIn(body.crowdBucket, CROWD_BUCKET_LABELS, 'unknown'),
    simEntities: intIn(body.simEntities, 0, 100_000, 0),
    activeViews: intIn(body.activeViews, 0, 100_000, 0),
    visibleViews: intIn(body.visibleViews, 0, 100_000, 0),
    worst10sFrameP95Ms: numberIn(body.worst10sFrameP95Ms, 0, 1000, 0),
    suggestionIds: suggestionIdsIn(body.suggestionIds),
    rawSummary: rawSummary(body.rawSummary, devTraceAllowed),
  };

  await insertClientPerfReport(row);
  // AFTER the insert on purpose: the /metrics series stay 1:1 with stored rows
  // (see server/http/client_perf_metrics.ts for the full emission contract).
  clientPerfMetricsSink().perfReportStored(row);
  return json(res, 200, { ok: true });
}

export const perfReportInternalsForTest = {
  bucketGpu,
  browserFamily,
  osFamily,
  viewportBucket,
  allowDevTrace,
  rawSummary,
  shouldStorePerfReport,
  suggestionIdsIn,
  CROWD_BUCKET_LABELS,
  KNOWN_PERF_SUGGESTION_IDS,
  PERF_REPORT_SCHEMA_VERSION,
  LONG_TASK_RAW_MS_MAX,
  LONG_TASK_RAW_AGE_MS_MAX,
  GPU_QUEUE_RAW_MS_MAX,
  GPU_QUEUE_RAW_AGE_MS_MAX,
  GPU_QUEUE_RAW_STALLS_MAX,
  GPU_QUEUE_RAW_SLOWEST_MAX,
  GPU_QUEUE_RAW_TAILS_MAX,
  GPU_QUEUE_RAW_LANES_MAX,
  GPU_QUEUE_RAW_WAITS_MAX,
  GPU_QUEUE_RAW_WINDOW_MS_MAX,
  PREWARM_RESUME_ENTRIES_MAX,
  PREWARM_RESUME_STATUSES,
  PREWARM_RESUME_LANES,
  PREWARM_COMPILE_UNITS_MAX,
  PREWARM_BUDGET_VARIANTS_MAX,
  PREWARM_PACING_TRANSITIONS_MAX,
};
