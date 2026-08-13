// Render-side stamps for the boot/loading profiler. Same 'woc:load:' naming as
// src/game/load_profiler.ts (which owns collection + summarization); duplicated
// as a 3-line helper because render/ and game/ do not import each other. Native
// performance marks only: no allocation on hot paths, safe under Node.

const PREFIX = 'woc:load:';

export function renderLoadSpan<T>(phase: string, fn: () => T): T {
  try {
    performance.mark(`${PREFIX}${phase}:start`);
  } catch {
    // Instrumentation must never break a scene build.
  }
  try {
    return fn();
  } finally {
    try {
      performance.mark(`${PREFIX}${phase}:end`);
      performance.measure(`${PREFIX}${phase}`, `${PREFIX}${phase}:start`, `${PREFIX}${phase}:end`);
    } catch {
      // Best effort.
    }
  }
}

/** Record an already-elapsed segment (performance.now() timestamps) as a load span. */
export function renderLoadMeasure(phase: string, startMs: number, endMs: number): void {
  try {
    performance.measure(`${PREFIX}${phase}`, { start: startMs, end: endMs });
  } catch {
    // Best effort (older engines without the options form just skip the span).
  }
}

export async function renderLoadSpanAsync<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  try {
    performance.mark(`${PREFIX}${phase}:start`);
  } catch {
    // Instrumentation must never break a scene build.
  }
  try {
    return await fn();
  } finally {
    try {
      performance.mark(`${PREFIX}${phase}:end`);
      performance.measure(`${PREFIX}${phase}`, `${PREFIX}${phase}:start`, `${PREFIX}${phase}:end`);
    } catch {
      // Best effort.
    }
  }
}
