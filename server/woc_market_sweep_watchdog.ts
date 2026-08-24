// Duration watchdog for the $WOC Exchange sweep. The pass reports elapsedMs
// only when it ENDS (onSweepPass), so a wedged in-flight pass, the exact
// failure H11 flags (a hung economy service turning the chain-poll arms into
// a 50-minute camp), was silent until it finished. This module is the
// mid-flight voice: the shell stamps pass start and each segment as it
// enters, and an unref()'d timer warns while the pass is STILL RUNNING past
// the bound, naming the segment it is stuck in. The readout feeds the
// stuck-custody ops surface (GET /internal/woc-market/stuck; main.ts merges
// it in), so an operator sees a camping pass in the same place they see
// parked custody.
//
// The bound is one confirm timeout: a single hung chain confirm legitimately
// pins a pass for up to 60 seconds, so warning earlier would page on normal
// brownouts, and a pass past ONE confirm timeout is by construction more
// than one row deep into a wedged service. The warn repeats every bound
// while the pass runs (a camping pass should stay loud), but scores ONE
// overrun per pass in the readout.
//
// Wall clock is correct here (server-only, never sim). The timer callback is
// exposed as tick() so tests drive it with the injected clock and no fake
// timers (the monitor's logTick shape).
//
// Coverage honesty: the readout answers the SHELL's pass (begin/segment/end
// are the shell's stamps). A test's or an eager poke's direct
// service.sweepPass() run never stamps it, so `running: false` means "the
// shell is idle", not "no sweep work is executing anywhere".

export const WOC_MARKET_SWEEP_OVERRUN_WARN_MS = 60_000;

export interface WocMarketSweepWatchdogReadout {
  /** A pass is running right now. */
  running: boolean;
  /** The segment the running pass is currently in (null between begin and
   *  the first segment stamp). */
  segment: string | null;
  /** Wall-clock start of the running pass, null when idle. */
  startedAtMs: number | null;
  /** Age of the running pass (0 when idle). */
  elapsedMs: number;
  /** Passes that exceeded the warn bound since boot. */
  overruns: number;
  /** The most recent overrun observation (segment it was in, its age when
   *  last observed, when). */
  lastOverrun: { segment: string | null; elapsedMs: number; atMs: number } | null;
  /** Duration of the last COMPLETED pass, null before the first. */
  lastPassMs: number | null;
}

export interface WocMarketSweepWatchdogDeps {
  /** Warn sink (main.ts wires console.warn). */
  log(line: string): void;
  /** Overrun bound; defaults to WOC_MARKET_SWEEP_OVERRUN_WARN_MS. */
  warnMs?: number;
  /** Injected clock for tests; production omits it (Date.now). */
  now?: () => number;
}

export interface WocMarketSweepWatchdog {
  begin(): void;
  segment(name: string): void;
  end(): void;
  /** The timer body; exposed for tests (production's interval calls it). */
  tick(): void;
  readout(): WocMarketSweepWatchdogReadout;
  /** Clear the shared interval (shutdown symmetry with the monitor/sweep). */
  stop(): void;
}

export function createWocMarketSweepWatchdog(
  deps: WocMarketSweepWatchdogDeps,
): WocMarketSweepWatchdog {
  const now = deps.now ?? Date.now;
  const warnMs = deps.warnMs ?? WOC_MARKET_SWEEP_OVERRUN_WARN_MS;

  let startedAtMs: number | null = null;
  let currentSegment: string | null = null;
  let warnedThisPass = false;
  let nextWarnAtMs = 0;
  let overruns = 0;
  let lastOverrun: WocMarketSweepWatchdogReadout['lastOverrun'] = null;
  let lastPassMs: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (startedAtMs === null) return;
    const at = now();
    if (at < nextWarnAtMs) return;
    const elapsedMs = at - startedAtMs;
    if (!warnedThisPass) {
      warnedThisPass = true;
      overruns++;
    }
    lastOverrun = { segment: currentSegment, elapsedMs, atMs: at };
    nextWarnAtMs = at + warnMs;
    try {
      deps.log(
        `[woc_market] sweep pass overrun: ${elapsedMs}ms and still running in segment ${currentSegment ?? 'none'}`,
      );
    } catch {
      // The log sink threw; there is no safer sink to report that to (the
      // monitor's beat-never-throws contract).
    }
  };

  return {
    begin(): void {
      startedAtMs = now();
      currentSegment = null;
      warnedThisPass = false;
      nextWarnAtMs = startedAtMs + warnMs;
      if (timer === null) {
        // One shared low-cost interval, armed lazily on the first pass and
        // left running (a no-op while idle): re-arming per pass would churn a
        // timer every 5 seconds forever. Coarser than warnMs is fine; the
        // guarantee is "loud within about a bound", not to the millisecond.
        timer = setInterval(tick, Math.max(1_000, Math.floor(warnMs / 4)));
        timer.unref?.();
      }
    },
    segment(name: string): void {
      currentSegment = name;
    },
    end(): void {
      if (startedAtMs !== null) lastPassMs = now() - startedAtMs;
      startedAtMs = null;
      currentSegment = null;
    },
    tick,
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    readout(): WocMarketSweepWatchdogReadout {
      return {
        running: startedAtMs !== null,
        segment: currentSegment,
        startedAtMs,
        elapsedMs: startedAtMs === null ? 0 : now() - startedAtMs,
        overruns,
        lastOverrun,
        lastPassMs,
      };
    },
  };
}
