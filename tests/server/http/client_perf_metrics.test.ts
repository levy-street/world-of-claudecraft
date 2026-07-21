// Unit tests for the client-perf half of the /metrics exporter
// (server/http/client_perf_metrics.ts): the woc_client_* gauges publish the CACHED,
// already-capped aggregate rows at scrape time, dimensioned only by release_version
// and gl_renderer_bucket. These pin the exposed metric NAMES, prove the values match
// the injected rows, prove the SERIES COUNT stays under a fixed ceiling when the
// query returns the capped shape, prove a bucket that drops out of the top-N does
// NOT leave a stale series behind (reset-per-publish), prove caching (a scrape storm
// drives zero extra queries), and prove no per-session label ever appears.
//
// The cardinality CAP itself is enforced in SQL (server/client_perf_metrics_db.ts,
// covered by tests/client_perf_metrics_db.test.ts against a real Postgres); this
// file asserts the exporter faithfully publishes whatever capped rows it is given
// and never widens them.

import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import type { ClientPerfRow } from '../../../server/client_perf_metrics_db';
import { OTHER_GPU_BUCKET } from '../../../server/client_perf_metrics_db';
import {
  registerClientPerfMetrics,
  WOC_CLIENT_FPS,
  WOC_CLIENT_FRAME_P95_SECONDS,
  WOC_CLIENT_LONG_FRAMES_RATE,
} from '../../../server/http/client_perf_metrics';

function row(over: Partial<ClientPerfRow> = {}): ClientPerfRow {
  return {
    releaseVersion: 'v0.23.0',
    glRendererBucket: 'apple-m-series',
    sampleCount: 10,
    medianFps: 60,
    frameP95Seconds: 0.02,
    longFramesRate: 0.05,
    ...over,
  };
}

function sampleValue(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

function labelValues(text: string, label: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`${label}="([^"]*)"`, 'g');
  for (const m of text.matchAll(re)) values.add(m[1]);
  return values;
}

/** All woc_client_fps sample lines (one per label combo). */
function fpsSeries(text: string): string[] {
  return text.match(/^woc_client_fps\{[^}]*\} \S+$/gm) ?? [];
}

describe('registerClientPerfMetrics: gauges publish the cached rows at scrape time', () => {
  it('exposes every gauge under its exact exported name with the seeded values', async () => {
    const registry = new Registry();
    const rows: ClientPerfRow[] = [
      row({
        releaseVersion: 'v0.23.0',
        glRendererBucket: 'apple-m-series',
        medianFps: 59.5,
        frameP95Seconds: 0.018,
        longFramesRate: 0.04,
      }),
    ];
    const collector = registerClientPerfMetrics(
      registry,
      vi.fn(async () => rows),
      60_000,
    );
    await collector.refresh();
    const text = await registry.metrics();

    expect(WOC_CLIENT_FPS).toBe('woc_client_fps');
    expect(WOC_CLIENT_FRAME_P95_SECONDS).toBe('woc_client_frame_p95_seconds');
    expect(WOC_CLIENT_LONG_FRAMES_RATE).toBe('woc_client_long_frames_rate');
    for (const name of [
      WOC_CLIENT_FPS,
      WOC_CLIENT_FRAME_P95_SECONDS,
      WOC_CLIENT_LONG_FRAMES_RATE,
    ]) {
      expect(text).toContain(`# TYPE ${name} gauge`);
    }

    // prom-client emits labels in labelNames order (release_version, gl_renderer_bucket).
    const labels = '\\{release_version="v0.23.0",gl_renderer_bucket="apple-m-series"\\}';
    expect(sampleValue(text, new RegExp(`^woc_client_fps${labels} (\\S+)$`, 'm'))).toBe('59.5');
    expect(
      sampleValue(text, new RegExp(`^woc_client_frame_p95_seconds${labels} (\\S+)$`, 'm')),
    ).toBe('0.018');
    expect(
      sampleValue(text, new RegExp(`^woc_client_long_frames_rate${labels} (\\S+)$`, 'm')),
    ).toBe('0.04');
  });

  it('publishes nothing before the first refresh', async () => {
    const registry = new Registry();
    registerClientPerfMetrics(
      registry,
      vi.fn(async () => [row()]),
      60_000,
    );
    const text = await registry.metrics();
    expect(text).not.toMatch(/^woc_client_fps\{/m);
  });

  it('holds the total series count under a fixed ceiling for the capped shape', async () => {
    const registry = new Registry();
    // The DB cap is two releases (current + previous) and top-N=8 GPU buckets + one
    // 'other' fold, so at most 2 * 9 = 18 series per gauge. Seed exactly that worst
    // case: two releases, nine GPU buckets (eight real + other) each.
    const TOP_N = 8;
    const releases = ['v0.23.0', 'v0.22.1'];
    const buckets = [...Array.from({ length: TOP_N }, (_, i) => `gpu-${i}`), OTHER_GPU_BUCKET];
    const rows: ClientPerfRow[] = [];
    for (const releaseVersion of releases) {
      for (const glRendererBucket of buckets) {
        rows.push(row({ releaseVersion, glRendererBucket }));
      }
    }
    const collector = registerClientPerfMetrics(
      registry,
      vi.fn(async () => rows),
      60_000,
    );
    await collector.refresh();
    const text = await registry.metrics();

    const ceiling = 2 * (TOP_N + 1); // 18
    expect(fpsSeries(text).length).toBe(ceiling);
    expect(fpsSeries(text).length).toBeLessThanOrEqual(ceiling);
    // Only the two seeded releases and the fixed bucket set appear.
    expect(labelValues(text, 'release_version')).toEqual(new Set(releases));
    expect(labelValues(text, 'gl_renderer_bucket')).toEqual(new Set(buckets));
  });

  it('evicts a series when its bucket drops out of a later window (reset per publish)', async () => {
    const registry = new Registry();
    let rows: ClientPerfRow[] = [row({ glRendererBucket: 'gpu-old' })];
    const collector = registerClientPerfMetrics(
      registry,
      vi.fn(async () => rows),
      60_000,
    );

    await collector.refresh();
    expect(labelValues(await registry.metrics(), 'gl_renderer_bucket')).toContain('gpu-old');

    // Next window: gpu-old is no longer in the top-N; the query returns only gpu-new.
    rows = [row({ glRendererBucket: 'gpu-new' })];
    await collector.refresh();
    const buckets = labelValues(await registry.metrics(), 'gl_renderer_bucket');
    expect(buckets).toContain('gpu-new');
    expect(buckets).not.toContain('gpu-old');
  });

  it('caches: many scrapes after one refresh drive zero extra queries', async () => {
    const registry = new Registry();
    const query = vi.fn(async () => [row()]);
    const collector = registerClientPerfMetrics(registry, query, 60_000);

    await collector.refresh();
    expect(query).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) await registry.metrics();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('carries only release_version and gl_renderer_bucket labels, nothing per-session', async () => {
    const registry = new Registry();
    const collector = registerClientPerfMetrics(
      registry,
      vi.fn(async () => [row()]),
      60_000,
    );
    await collector.refresh();
    const text = await registry.metrics();

    expect(labelValues(text, 'release_version').size).toBeGreaterThan(0);
    expect(labelValues(text, 'gl_renderer_bucket').size).toBeGreaterThan(0);
    for (const forbidden of [
      'session',
      'session_id',
      'account',
      'account_id',
      'character',
      'character_id',
      'ip',
      'build_id',
    ]) {
      expect(labelValues(text, forbidden).size).toBe(0);
    }
  });
});
