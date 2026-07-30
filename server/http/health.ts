// Drain-aware liveness/readiness plus the /metrics exposition handlers for the
// API request pipeline.
//
// Liveness (/livez) answers 200 while the authoritative game loop is still
// completing passes, and 503 once it has completed none for longer than
// LIVEZ_STALE_MS. A wedged loop is otherwise invisible from outside: the event loop
// keeps accepting HTTP long after the game has stopped ticking, so a probe that
// only proved the process runs would report a dead world as healthy. A DRAINING
// process is always live: shutdown stops the loop on purpose, and a watchdog must
// leave a draining container alone rather than restart it mid-save.
//
// Readiness (/readyz) is drain-only and takes NO liveness input: 200 until shutdown
// calls markDraining(), then 503 so a load balancer or orchestrator stops routing
// NEW traffic while in-flight work drains. /metrics serves the Prometheus
// exposition text from the injected exporter.
//
// These are OPERATIONAL, dev-channel responses: plain English bodies, never a t()
// key and never the problem+json envelope (they are scraped by machines and read
// by operators, not shown to a player). Every response is Cache-Control: no-store
// so a proxy never serves a stale readiness state or a cached metrics snapshot.
//
// The drain flag and the liveness source are module-level singletons: the process
// has exactly one drain state and one game loop. markDraining() is idempotent and
// one-way for the process lifetime; resetHealthForTests() restores the initial
// state and unregisters the source so a test file stays isolated.

import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';
import { logger } from './logger';

/** The Cache-Control every health/metrics response carries: never cache operational state. */
export const HEALTH_CACHE_CONTROL = 'no-store';

/**
 * How long the game loop may complete no pass before /livez calls the process dead.
 * The loop runs at 20 Hz (a pass every 50 ms), so 30 s is roughly 600 missed passes:
 * far outside any GC pause, autosave, or scheduling hiccup (none of which is close to
 * a second), and comfortably inside the compose healthcheck's retry window, so a slow
 * tick never trips the watchdog but a wedged loop always does.
 */
export const LIVEZ_STALE_MS = 30_000;

/** true once markDraining() flips it; the process starts ready (not draining). */
let draining = false;

/** What liveness needs from the game loop: when it last made, or began trying to make, progress. */
export interface LivenessSource {
  /** Epoch millis of the last completed tick pass, or null while the loop warms up. */
  lastTickAt(): number | null;
  /**
   * Epoch millis when the loop was last started, or null before it starts. The
   * staleness backstop for a loop that has started but completed no pass yet, so a
   * loop that throws on every tick from the first one still goes stale.
   */
  loopStartedAt(): number | null;
}

/** The running loop, or null before startServer() registers one. */
let livenessSource: LivenessSource | null = null;

/**
 * Point liveness at the running game loop. main.ts registers the SAME source object
 * the /metrics gauges read (GameStateSource structurally satisfies this), at boot
 * inside startServer(); null unregisters. The health arms in routeHttpRequest never
 * reach for the game themselves: a probe must not be what constructs a GameServer.
 */
export function registerLivenessSource(source: LivenessSource | null): void {
  livenessSource = source;
}

/**
 * Flip the process into draining: /readyz starts answering 503 so new traffic is
 * shed while in-flight requests finish. Idempotent (repeat calls are a no-op) and
 * one-way for the process lifetime; shutdown calls it first.
 */
export function markDraining(): void {
  draining = true;
}

/** Readiness: true until markDraining(); false once the process is draining. */
export function isReady(): boolean {
  return !draining;
}

/**
 * Liveness: false only once the game loop is WEDGED (no completed pass for longer
 * than LIVEZ_STALE_MS), so a watchdog can restart a process whose world has stopped
 * making progress while its HTTP surface still answers. The precedence, in order:
 *  - DRAINING is live, always, and it wins over staleness: shutdown stops the loop
 *    deliberately, so a draining container must never be misread as wedged and
 *    restarted out from under its final saves.
 *  - WARMUP is live: no source registered (the game is not built yet), or the loop
 *    has not started at all. A probe must never fail on a process that is still booting.
 *  - Otherwise staleness is measured against the last completed pass, or, until one
 *    has completed, against the loop start. That backstop is what makes a loop that
 *    throws on its first tick and every tick after go stale: without it,
 *    lastTickAt() would stay null forever and the loop would read as warmup for life.
 */
export function isLive(): boolean {
  if (draining) return true;
  if (livenessSource === null) return true;
  const reference = livenessSource.lastTickAt() ?? livenessSource.loopStartedAt();
  if (reference === null) return true;
  return Date.now() - reference <= LIVEZ_STALE_MS;
}

/**
 * Test-only: restore the initial (not-draining) state and unregister the liveness
 * source so a test file stays isolated.
 */
export function resetHealthForTests(): void {
  draining = false;
  livenessSource = null;
}

/** Write a plain-text operational response with the no-store header. */
function writePlain(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': HEALTH_CACHE_CONTROL,
  });
  res.end(body);
}

/** GET /livez: 200 'ok' while live, 503 once the game loop has wedged (see isLive). */
export function handleLivez(res: http.ServerResponse): void {
  if (isLive()) writePlain(res, 200, 'ok');
  else writePlain(res, 503, 'game loop stalled');
}

/** GET /readyz: 200 'ok' while ready, 503 'draining' once markDraining() has fired. */
export function handleReadyz(res: http.ServerResponse): void {
  if (isReady()) writePlain(res, 200, 'ok');
  else writePlain(res, 503, 'draining');
}

/** What handleMetrics needs from the exporter: the exposition text and its content type. */
export interface MetricsSource {
  metricsText(): Promise<string>;
  contentType: string;
}

/**
 * GET /metrics: serve the Prometheus exposition text with the exporter's content
 * type. metricsText() is awaited BEFORE the head is written, so an exposition
 * failure never propagates into the request path and never leaves a half-written
 * response: it is logged and answered 500 text/plain. Cache-Control: no-store on
 * both arms so a scrape is never served a cached snapshot.
 */
export async function handleMetrics(res: http.ServerResponse, deps: MetricsSource): Promise<void> {
  try {
    const text = await deps.metricsText();
    res.writeHead(200, {
      'Content-Type': deps.contentType,
      'Cache-Control': HEALTH_CACHE_CONTROL,
    });
    res.end(text);
  } catch (err) {
    logger.error({ err }, 'metrics exposition failed');
    writePlain(res, 500, 'metrics unavailable');
  }
}

// Length-guarded constant-time compare, mirroring
// server/http/middleware/require_internal_secret.ts secretsMatch (which mirrors
// server/internal.ts): the length check short-circuits (timingSafeEqual requires
// equal-length buffers) and the value compare is constant-time, so a mismatch
// reveals nothing about the expected token through timing. Never logs a value.
function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

// Extract the credential from an Authorization: Bearer <token> header, or '' when
// the header is absent or not a Bearer scheme. Case-insensitive scheme. A repeated
// header resolves to its FIRST value (node itself keeps only the first
// authorization header, so the array branch is defensive, not a bypass).
function bearerCredential(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

/**
 * GET /metrics access gate. The Prometheus exposition can leak operational shape,
 * so it is protected by a bearer token read from config (never a literal):
 *  - token empty (unset): the endpoint is feature-off, answered 404 so it hides
 *    entirely (mirrors require_internal_secret's feature-off 404, anti-enumeration).
 *  - token set, Authorization: Bearer <token> matches (length-guarded constant-time
 *    compare): serve the exposition via handleMetrics (200 + no-store).
 *  - token set, credential missing or wrong: an opaque 401 that never echoes the
 *    token (mirrors require_internal_secret's mismatch 401).
 * Every arm carries Cache-Control: no-store. /livez and /readyz stay open (the
 * caller mounts them separately). Dev-channel English bodies, never a t() key.
 */
export async function handleMetricsGate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: MetricsSource,
  token: string,
): Promise<void> {
  if (!token) {
    writePlain(res, 404, 'not found');
    return;
  }
  const presented = bearerCredential(req.headers.authorization);
  if (!secretsMatch(presented, token)) {
    writePlain(res, 401, 'unauthorized');
    return;
  }
  await handleMetrics(res, deps);
}
