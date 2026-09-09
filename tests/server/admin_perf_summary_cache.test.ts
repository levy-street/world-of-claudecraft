// Wiring pins for the admin perf-summary memo (server/admin_perf_summary_cache.ts):
// the lazy singleton hours-keyed TTL cache over admin_db.clientPerfSummary. The
// primitive's full behavior matrix (single-flight, epoch bust, warn-once) is
// pinned by tests/server/cached_read.test.ts; this file pins THIS module's
// wiring of it: cold start, the TTL window, per-key isolation, hours
// normalization onto one shared key, stale-serve on a failed refresh, and the
// reset.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; admin_perf_summary_cache imports admin_db which imports it, so set a
// dummy URL. The pool never connects: every read here goes through the
// injected fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_perf_summary_cache';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerfSummary } from '../../server/admin_db';
import {
  ADMIN_PERF_SUMMARY_MAX_ENTRIES,
  ADMIN_PERF_SUMMARY_TTL_MS,
  readClientPerfSummaryCached,
  resetPerfSummaryCacheForTests,
  setPerfSummaryCacheForTests,
} from '../../server/admin_perf_summary_cache';

// Distinct value per hours window so a swapped or shared entry fails the pin.
function summaryFor(hours: number): PerfSummary {
  return {
    hours,
    generatedAt: 'now',
    totals: {
      sampleCount: hours,
      medianFps: 60,
      p95FrameMs: 18,
      p99FrameMs: 22,
      contextLossCount: 0,
      avgRenderScale: 1,
      avgEffectiveRenderScale: 0.9,
    },
    byPreset: [],
    byGfxTier: [],
    byGpu: [],
    byBackend: [],
    byBrowser: [],
    byOs: [],
    byScenario: [],
    byCrowd: [],
    worstGpuBuckets: [],
    byModel: [],
    byHpMismatch: [],
    suggestionCounts: [],
  };
}

let nowMs = 0;
let calls: number[] = [];
let fail = false;

beforeEach(() => {
  resetPerfSummaryCacheForTests();
  nowMs = 1_000_000;
  calls = [];
  fail = false;
  setPerfSummaryCacheForTests({
    query: async (hours) => {
      calls.push(hours);
      if (fail) throw new Error('refresh failed');
      return summaryFor(hours);
    },
    now: () => nowMs,
  });
});

afterEach(() => {
  resetPerfSummaryCacheForTests();
  vi.restoreAllMocks();
});

describe('admin perf-summary cache', () => {
  it('pins the TTL and the entry bound: one refresh per 60 second window, keyed over the whole cleanHours range', () => {
    expect(ADMIN_PERF_SUMMARY_TTL_MS).toBe(60_000);
    expect(ADMIN_PERF_SUMMARY_MAX_ENTRIES).toBe(168);
  });

  it('cold start awaits exactly one refresh and returns the injected body', async () => {
    const body = await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24]);
    expect(body).toEqual(summaryFor(24));
    // The one snapshot object is shared by every reader in the TTL window; the
    // memo freezes it so a consumer cannot poison the shared buckets.
    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(body.byPreset)).toBe(true);
  });

  it('a warm hit inside the TTL serves the snapshot without re-querying', async () => {
    await readClientPerfSummaryCached(24);
    nowMs += ADMIN_PERF_SUMMARY_TTL_MS - 1;
    const body = await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24]);
    expect(body).toEqual(summaryFor(24));
  });

  it('a read past the TTL re-queries', async () => {
    await readClientPerfSummaryCached(24);
    nowMs += ADMIN_PERF_SUMMARY_TTL_MS;
    const body = await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24, 24]);
    expect(body).toEqual(summaryFor(24));
  });

  it('a different hours window is its own cache key: one read each, independent TTLs', async () => {
    const day = await readClientPerfSummaryCached(24);
    const week = await readClientPerfSummaryCached(168);
    expect(calls).toEqual([24, 168]);
    expect(day).toEqual(summaryFor(24));
    expect(week).toEqual(summaryFor(168));
    // Warm on both, no re-query.
    await readClientPerfSummaryCached(24);
    await readClientPerfSummaryCached(168);
    expect(calls).toEqual([24, 168]);
  });

  it('normalizes hours onto ONE shared key (cleanHours), so equivalent raw inputs cost one read', async () => {
    // 6 and 6.9 both clamp to whole-hour 6, sharing one entry.
    await readClientPerfSummaryCached(6);
    await readClientPerfSummaryCached(6.9);
    expect(calls).toEqual([6]);
    // A non-finite input falls back to the 24h default, its own key.
    await readClientPerfSummaryCached(Number.NaN);
    expect(calls).toEqual([6, 24]);
  });

  it('an out-of-range hours input clamps into the 168-entry key space rather than growing it', async () => {
    // Above the range clamps to the 168h ceiling.
    await readClientPerfSummaryCached(10_000);
    await readClientPerfSummaryCached(168);
    expect(calls).toEqual([168]);
    // At or below zero clamps to the 1h floor (never the 24h default: only a
    // non-finite input falls back to that).
    await readClientPerfSummaryCached(0);
    await readClientPerfSummaryCached(1);
    expect(calls).toEqual([168, 1]);
  });

  it('a failed refresh after a success keeps serving the last snapshot', async () => {
    // The stale-serve path warns once per failure streak; keep test output clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readClientPerfSummaryCached(24);
    nowMs += ADMIN_PERF_SUMMARY_TTL_MS;
    fail = true;
    const body = await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24, 24]);
    expect(body).toEqual(summaryFor(24));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reset drops the instance so the next read is cold', async () => {
    await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24]);
    // Reset restores the REAL query, so re-inject the counting fake before the
    // next read; no clock advance, proving the re-query comes from the reset.
    resetPerfSummaryCacheForTests();
    setPerfSummaryCacheForTests({
      query: async (hours) => {
        calls.push(hours);
        return summaryFor(hours);
      },
      now: () => nowMs,
    });
    const body = await readClientPerfSummaryCached(24);
    expect(calls).toEqual([24, 24]);
    expect(body).toEqual(summaryFor(24));
  });
});
