import * as http from 'node:http';
import { accountForToken, getCharacter, insertClientPerfReport, type ClientPerfReportInsert } from './db';
import { json, readBody } from './http_util';
import { requestIp } from './ratelimit';
import { REALM } from './realm';

const PERF_REPORT_SCHEMA_VERSION = 1;
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

function rateLimitedPerfReport(req: http.IncomingMessage): boolean {
  const ip = requestIp(req);
  const now = Date.now();
  const windowStart = now - PERF_REPORT_WINDOW_MS;
  const updated = (perfReportAttempts.get(ip) ?? []).filter((t) => t > windowStart);
  updated.push(now);
  perfReportAttempts.set(ip, updated);

  if (perfReportAttempts.size > PERF_REPORT_MAX_TRACKED_IPS) {
    for (const [key, times] of perfReportAttempts) {
      if (times.length === 0 || times[times.length - 1] <= windowStart) perfReportAttempts.delete(key);
      if (perfReportAttempts.size <= PERF_REPORT_MAX_TRACKED_IPS) break;
    }
  }

  return updated.length > PERF_REPORT_MAX_PER_MINUTE;
}

function throttleKey(req: http.IncomingMessage, sessionId: string): string {
  const session = sessionId || 'anonymous';
  return `${requestIp(req)}:${session}`;
}

function shouldStorePerfReport(req: http.IncomingMessage, sessionId: string, now = Date.now()): boolean {
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
  return renderer.slice(0, 48).replace(/[^\w.-]+/g, '-').toLowerCase() || 'other';
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
  const entries = Array.isArray(value.entries) ? value.entries : Array.isArray(value.manifestEntries) ? value.manifestEntries : [];
  out.entries = entries.slice(0, 24).filter(isRecord).map((entry) => ({
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
  return accountForToken(m[1]);
}

async function authenticatedCharacterId(accountId: number | null, value: unknown): Promise<number | null> {
  if (accountId === null) return null;
  const id = intIn(value, 1, Number.MAX_SAFE_INTEGER, 0);
  if (id <= 0) return null;
  const character = await getCharacter(accountId, id);
  return character ? id : null;
}

export async function handlePerfReport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (rateLimitedPerfReport(req)) return json(res, 200, { ok: true });

  const devTraceAllowed = allowDevTrace(req);
  const body = await readBody(req, devTraceAllowed ? PERF_REPORT_DEV_TRACE_MAX_BODY_BYTES : PERF_REPORT_MAX_BODY_BYTES) as Record<string, unknown>;
  const sessionId = textIn(body.sessionId, 64);
  if (!shouldStorePerfReport(req, sessionId)) return json(res, 200, { ok: true });

  const accountId = await authenticatedAccountId(req);
  const userAgent = String(req.headers['user-agent'] ?? '');
  const glRenderer = textIn(body.glRenderer, 160);
  const releaseVersion = textIn(body.releaseVersion, 40);
  const buildId = textIn(body.buildId, 40);
  const source = choiceIn(body.source, ['gameplay', 'benchmark'], 'gameplay');

  const row: ClientPerfReportInsert = {
    schemaVersion: intIn(body.schemaVersion, 1, PERF_REPORT_SCHEMA_VERSION, PERF_REPORT_SCHEMA_VERSION),
    releaseVersion,
    buildId,
    sessionId,
    accountId,
    characterId: await authenticatedCharacterId(accountId, body.characterId),
    realm: REALM,
    graphicsPreset: choiceIn(body.graphicsPreset, ['auto', 'low', 'medium', 'high', 'ultra', 'advanced'], 'auto'),
    gfxTier: choiceIn(body.gfxTier, ['low', 'medium', 'high', 'ultra'], 'low'),
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
    browserFamily: choiceIn(body.browserFamily, ['chrome', 'safari', 'firefox', 'edge', 'other'], browserFamily(userAgent)),
    osFamily: choiceIn(body.osFamily, ['macos', 'windows', 'ios', 'android', 'linux', 'other'], osFamily(userAgent)),
    glVendor: textIn(body.glVendor, 80),
    glRendererBucket: bucketGpu(glRenderer || textIn(body.glRendererBucket, 80)),
    zoneOrScenario: textIn(body.zoneOrScenario, 80, source === 'benchmark' ? 'benchmark' : 'gameplay'),
    source,
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
};
