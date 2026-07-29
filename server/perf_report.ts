import type * as http from 'node:http';
import {
  accountAndScopeForToken,
  type ClientPerfReportInsert,
  getCharacter,
  insertClientPerfReport,
} from './db';
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
    'manifestTimedOut',
    'manifestFailed',
    'timedOutEntryIds',
    'failedEntryIds',
  ];
  for (const key of scalarKeys) {
    if (value[key] !== undefined) out[key] = value[key];
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
      detail: textIn(entry.detail, 160),
    }));
  return out;
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
};
