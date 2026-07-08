// A per-process, fixed-cardinality throttle for the two log-only mismatch sinks
// (middleware/content_type.ts and middleware/origin_check.ts). Both gates run
// AHEAD of the route-local rate limiters in the dispatch onion, so without a
// bound a crafted wrong-Content-Type or cross-site-Origin flood on a mutating
// /api route would add one warn line per request before any limiter runs (a log
// amplification vector on the production default). This module caps those warn
// lines per fixed window.
//
// State is keyed on the mismatch's route TEMPLATE (RouteDef.path) plus method,
// NEVER the concrete request URL, so cardinality stays bounded by the registered
// route table (O(routes)), not by attacker-chosen paths. The bound never hides a
// flood silently: the first admitted line of each NEW window reports how many
// lines the prior window suppressed, so a sustained flood stays visible as at
// most MISMATCH_WARN_MAX_PER_WINDOW lines plus a suppressed tally per window per
// key. The throttle gates ONLY the warn line; the gates take their enforce
// decision (415/403) in the middleware independently of the sink, so a rejected
// request stays rejected even when its warn line is suppressed.
//
// Pure and host-agnostic: the clock is injected (the same now() seam as
// middleware/metric_sink.ts) so tests advance time deterministically; only the
// default binding uses Date.now. Server-only; the sim is untouched.

/** Max warn lines one (method, route-template) key may emit per window. */
export const MISMATCH_WARN_MAX_PER_WINDOW = 5;

/** The fixed suppression window, in milliseconds. */
export const MISMATCH_WARN_WINDOW_MS = 60_000;

/** The verdict for one mismatch: emit its warn line, or count it as suppressed. */
export interface MismatchWarnAdmission {
  /** True when the caller may emit this mismatch's warn line. */
  readonly emit: boolean;
  /**
   * On the first admitted line of a NEW window: how many lines the PRIOR active
   * window suppressed for this key (0 when none). Always 0 on a suppressed
   * admission and on later admitted lines within a window. The caller surfaces
   * a non-zero value on the emitted line so a flood's suppressed tail stays
   * visible. Note the prior active window may be OLDER than one windowMs when
   * the key sat idle in between: the tally describes that older burst, not
   * activity adjacent to the line that carries it.
   */
  readonly suppressed: number;
}

/** The seam the two default mismatch sinks call; injectable for tests. */
export interface MismatchWarnThrottle {
  admit(key: string): MismatchWarnAdmission;
}

/** Per-key window state: start time, lines emitted, lines suppressed. */
interface KeyWindow {
  windowStart: number;
  emitted: number;
  suppressed: number;
}

/**
 * Create a throttle. Defaults bind the named constants and Date.now; a test
 * injects a fake clock (and optionally smaller bounds) for determinism. Each
 * caller owns its own instance, so the two gates never share window state.
 * Entries are NEVER evicted, deliberately: the key space is bounded by the
 * registered route table (tiny fixed structs), so the map's ceiling is
 * O(routes x mutating methods), not O(requests), and a sweep would add code
 * for no safety.
 */
export function createMismatchWarnThrottle(
  opts: { maxPerWindow?: number; windowMs?: number; now?: () => number } = {},
): MismatchWarnThrottle {
  const maxPerWindow = opts.maxPerWindow ?? MISMATCH_WARN_MAX_PER_WINDOW;
  const windowMs = opts.windowMs ?? MISMATCH_WARN_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, KeyWindow>();
  return {
    admit(key: string): MismatchWarnAdmission {
      const t = now();
      const w = windows.get(key);
      if (w === undefined || t - w.windowStart >= windowMs) {
        const priorSuppressed = w?.suppressed ?? 0;
        windows.set(key, { windowStart: t, emitted: 1, suppressed: 0 });
        return { emit: true, suppressed: priorSuppressed };
      }
      if (w.emitted < maxPerWindow) {
        w.emitted += 1;
        return { emit: true, suppressed: 0 };
      }
      w.suppressed += 1;
      return { emit: false, suppressed: 0 };
    },
  };
}
