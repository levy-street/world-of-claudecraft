// Unit tests for the client-perf half of the /metrics exporter
// (server/http/client_perf_metrics.ts): the woc_client_* series fed from stored
// /api/perf-report rows. These pin the exposed metric NAMES as literals (a
// rename fails the test, not just a constant swap), prove every label value is
// drawn from the fixed vocabularies even for hostile inputs (an unrecognized
// GPU bucket, zone string, or tier never becomes a new series), that benchmark
// reports are skipped, that the jank counter triggers exactly at the client's
// 250ms worst-10s clamp, that the suggestion catalog cannot drift from the
// ingest allowlist, and that the ingest emits through the slot only for rows
// that were actually stored.

import { EventEmitter } from 'node:events';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  getCharacter: vi.fn(),
  insertClientPerfReport: vi.fn(async () => {}),
}));

import { insertClientPerfReport } from '../../../server/db';
import {
  CLIENT_PERF_DEVICE_CLASSES,
  CLIENT_PERF_FPS_AVG_BUCKETS,
  CLIENT_PERF_FRAME_P95_BUCKETS_SECONDS,
  CLIENT_PERF_GFX_TIERS,
  CLIENT_PERF_GPU_FAMILIES,
  CLIENT_PERF_JANK_THRESHOLD_MS,
  CLIENT_PERF_LONG_TASK_BUCKETS_SECONDS,
  CLIENT_PERF_OS_FAMILIES,
  CLIENT_PERF_RENDER_SCALE_BUCKETS,
  CLIENT_PERF_SCENE_CLASSES,
  CLIENT_PERF_SUGGESTION_IDS,
  CLIENT_PERF_WORST10S_BUCKETS_SECONDS,
  type ClientPerfSample,
  classifyClientPerfGpuFamily,
  classifyClientPerfScene,
  clientPerfMetricsSink,
  noopClientPerfMetricsSink,
  registerClientPerfMetrics,
  setClientPerfMetricsSink,
} from '../../../server/http/client_perf_metrics';
import { handlePerfReport, perfReportInternalsForTest } from '../../../server/perf_report';

function sample(overrides: Partial<ClientPerfSample> = {}): ClientPerfSample {
  return {
    source: 'gameplay',
    gfxTier: 'high',
    mobileTouch: false,
    osFamily: 'windows',
    glRendererBucket: 'nvidia',
    zoneOrScenario: 'thornpeak_heights',
    fpsAvg: 48,
    frameP95Ms: 33.4,
    worst10sFrameP95Ms: 66.7,
    longTaskP95Ms: 120,
    effectiveRenderScale: 0.85,
    contextLostCount: 0,
    suggestionIds: [],
    ...overrides,
  };
}

function value(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? Number(m[1]) : Number.NaN;
}

afterEach(() => {
  setClientPerfMetricsSink(noopClientPerfMetricsSink);
  vi.clearAllMocks();
});

describe('classifyClientPerfGpuFamily', () => {
  it('maps the stored renderer buckets onto the fixed families', () => {
    expect(classifyClientPerfGpuFamily('nvidia')).toBe('nvidia');
    expect(classifyClientPerfGpuFamily('amd')).toBe('amd');
    expect(classifyClientPerfGpuFamily('intel')).toBe('intel-igpu');
    expect(classifyClientPerfGpuFamily('intel-uhd')).toBe('intel-igpu');
    expect(classifyClientPerfGpuFamily('intel-iris')).toBe('intel-igpu');
    expect(classifyClientPerfGpuFamily('apple')).toBe('apple');
    expect(classifyClientPerfGpuFamily('apple-m4-pro')).toBe('apple');
    expect(classifyClientPerfGpuFamily('software')).toBe('software');
  });

  it('collapses unknown and slug-fallback buckets to other, never a new value', () => {
    for (const hostile of ['unknown', 'qualcomm-adreno-640', 'x'.repeat(48), '', 'NVIDIA; DROP']) {
      expect(CLIENT_PERF_GPU_FAMILIES).toContain(classifyClientPerfGpuFamily(hostile));
    }
    expect(classifyClientPerfGpuFamily('qualcomm-adreno-640')).toBe('other');
    expect(classifyClientPerfGpuFamily('unknown')).toBe('other');
  });
});

describe('classifyClientPerfScene', () => {
  it('maps prefixes and the fixed instance tokens onto scene classes', () => {
    expect(classifyClientPerfScene('dungeon:nythraxis_crypt')).toBe('dungeon');
    expect(classifyClientPerfScene('delve:collapsed_reliquary')).toBe('delve');
    expect(classifyClientPerfScene('battleground')).toBe('battleground');
    expect(classifyClientPerfScene('arena')).toBe('arena');
    expect(classifyClientPerfScene('yumi_maze')).toBe('yumi_maze');
    expect(classifyClientPerfScene('rift')).toBe('rift');
    expect(classifyClientPerfScene('instance')).toBe('instance');
    expect(classifyClientPerfScene('thornpeak_heights')).toBe('overworld');
  });

  it('sends the ingest defaults to other and any string to a fixed class', () => {
    expect(classifyClientPerfScene('')).toBe('other');
    expect(classifyClientPerfScene('gameplay')).toBe('other');
    expect(classifyClientPerfScene('benchmark')).toBe('other');
    for (const hostile of ['a'.repeat(80), 'dungeon', 'delve', 'zone with spaces']) {
      expect(CLIENT_PERF_SCENE_CLASSES).toContain(classifyClientPerfScene(hostile));
    }
  });
});

describe('vocabulary pins', () => {
  it('keeps the suggestion catalog equal to the ingest allowlist', () => {
    expect([...CLIENT_PERF_SUGGESTION_IDS]).toEqual([
      ...perfReportInternalsForTest.KNOWN_PERF_SUGGESTION_IDS,
    ]);
  });

  it('pins the label vocabularies as literals', () => {
    expect([...CLIENT_PERF_GFX_TIERS]).toEqual(['low', 'medium', 'high', 'ultra', 'insane']);
    expect([...CLIENT_PERF_DEVICE_CLASSES]).toEqual(['desktop', 'mobile']);
    expect([...CLIENT_PERF_GPU_FAMILIES]).toEqual([
      'nvidia',
      'amd',
      'intel-igpu',
      'apple',
      'software',
      'other',
    ]);
    expect([...CLIENT_PERF_OS_FAMILIES]).toEqual([
      'windows',
      'macos',
      'linux',
      'ios',
      'android',
      'other',
    ]);
    expect([...CLIENT_PERF_SCENE_CLASSES]).toEqual([
      'overworld',
      'dungeon',
      'delve',
      'battleground',
      'arena',
      'yumi_maze',
      'rift',
      'instance',
      'other',
    ]);
    expect(CLIENT_PERF_JANK_THRESHOLD_MS).toBe(250);
  });

  it('pins the histogram bucket edges as literals', () => {
    // The edges are the exporter's public contract: an edit silently rewrites
    // every dashboard quantile, so a change must be deliberate here too.
    expect([...CLIENT_PERF_FRAME_P95_BUCKETS_SECONDS]).toEqual([
      0.0125, 0.0167, 0.02, 0.025, 0.0334, 0.05, 0.0834, 0.125, 0.25,
    ]);
    expect([...CLIENT_PERF_WORST10S_BUCKETS_SECONDS]).toEqual([
      0.0334, 0.05, 0.0667, 0.0834, 0.125, 0.25,
    ]);
    expect([...CLIENT_PERF_FPS_AVG_BUCKETS]).toEqual([10, 15, 20, 25, 30, 40, 50, 60, 90, 120]);
    // Top edge at the ingest's 1000ms longTaskP95Ms clamp: a higher edge is
    // unreachable and would pin a lie into the contract.
    expect([...CLIENT_PERF_LONG_TASK_BUCKETS_SECONDS]).toEqual([0.05, 0.1, 0.2, 0.35, 0.5, 1]);
    expect([...CLIENT_PERF_RENDER_SCALE_BUCKETS]).toEqual([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
  });
});

describe('registerClientPerfMetrics', () => {
  it('exposes a stored gameplay report under the pinned names and labels', async () => {
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    sink.perfReportStored(
      sample({ contextLostCount: 2, suggestionIds: ['browser-stalls', 'integrated-gpu'] }),
    );

    const text = await registry.metrics();
    expect(
      value(
        text,
        /^woc_client_reports_total\{gfx_tier="high",device="desktop",gpu_family="nvidia"\} (\d+)$/m,
      ),
    ).toBe(1);
    expect(
      value(
        text,
        /^woc_client_frame_p95_seconds_sum\{gfx_tier="high",device="desktop"\} ([\d.]+)$/m,
      ),
    ).toBeCloseTo(0.0334, 5);
    expect(
      value(text, /^woc_client_fps_avg_sum\{gfx_tier="high",device="desktop"\} ([\d.]+)$/m),
    ).toBe(48);
    expect(
      value(
        text,
        /^woc_client_worst10s_frame_p95_seconds_sum\{scene="overworld",device="desktop"\} ([\d.]+)$/m,
      ),
    ).toBeCloseTo(0.0667, 5);
    expect(value(text, /^woc_client_long_task_p95_seconds_sum\{gfx_tier="high"\} ([\d.]+)$/m)).toBe(
      0.12,
    );
    expect(
      value(text, /^woc_client_effective_render_scale_sum\{gfx_tier="high"\} ([\d.]+)$/m),
    ).toBeCloseTo(0.85, 5);
    expect(value(text, /^woc_client_context_losses_total\{os="windows"\} (\d+)$/m)).toBe(2);
    expect(
      value(text, /^woc_client_suggestions_total\{suggestion="browser-stalls"\} (\d+)$/m),
    ).toBe(1);
    expect(
      value(text, /^woc_client_suggestions_total\{suggestion="integrated-gpu"\} (\d+)$/m),
    ).toBe(1);
  });

  it('counts jank exactly at the client clamp threshold', async () => {
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    sink.perfReportStored(sample({ worst10sFrameP95Ms: CLIENT_PERF_JANK_THRESHOLD_MS - 0.1 }));
    sink.perfReportStored(sample({ worst10sFrameP95Ms: CLIENT_PERF_JANK_THRESHOLD_MS }));

    const text = await registry.metrics();
    expect(
      value(text, /^woc_client_jank_reports_total\{gfx_tier="high",device="desktop"\} (\d+)$/m),
    ).toBe(1);
  });

  it('keeps non-finite and negative numerics out of the series', async () => {
    // These fields arrive clamped from the ingest; the defenses exist for a
    // direct caller, and a NaN reaching a histogram would poison its _sum.
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    sink.perfReportStored(
      sample({
        fpsAvg: Number.NaN,
        frameP95Ms: Number.POSITIVE_INFINITY,
        longTaskP95Ms: Number.NEGATIVE_INFINITY,
        effectiveRenderScale: Number.NaN,
        worst10sFrameP95Ms: Number.NaN,
        contextLostCount: -3,
      }),
    );
    // A negative finite value must not subtract from a monotone _sum, and an
    // Infinity worst-10s must not satisfy the jank threshold while its
    // histogram observes zero: the compare runs on the sanitized value.
    sink.perfReportStored(
      sample({
        frameP95Ms: -50,
        worst10sFrameP95Ms: Number.POSITIVE_INFINITY,
        fpsAvg: -10,
      }),
    );

    const text = await registry.metrics();
    expect(text).not.toMatch(/NaN|Infinity/);
    expect(
      value(text, /^woc_client_fps_avg_sum\{gfx_tier="high",device="desktop"\} ([\d.]+)$/m),
    ).toBe(0);
    // Infinity is floored to zero, not observed at the top bucket.
    expect(
      value(
        text,
        /^woc_client_frame_p95_seconds_sum\{gfx_tier="high",device="desktop"\} ([\d.]+)$/m,
      ),
    ).toBe(0);
    // Neither a NaN nor an Infinity worst-10s satisfies the jank threshold
    // (the series exists at its primed zero).
    expect(
      value(text, /^woc_client_jank_reports_total\{gfx_tier="high",device="desktop"\} (\d+)$/m),
    ).toBe(0);
    // A negative loss count never decrements the primed counter.
    expect(value(text, /^woc_client_context_losses_total\{os="windows"\} (\d+)$/m)).toBe(0);
  });

  it('never throws on a malformed direct-caller sample', () => {
    // The ingest always passes a sanitized row; the guard exists for a direct
    // caller, where a throw would otherwise 500 a beacon whose row is stored.
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    expect(() =>
      sink.perfReportStored({ ...sample(), suggestionIds: null as unknown as string[] }),
    ).not.toThrow();
  });

  it('zero-backfills the whole family at registration', async () => {
    const registry = new Registry();
    registerClientPerfMetrics(registry);

    const text = await registry.metrics();
    // Every counter cross product and every histogram series exists from
    // boot (the exporter's backfill design), so increase()/rate() see the
    // first post-deploy increment and the jank share reads 0%, not "no data".
    expect(
      value(
        text,
        /^woc_client_reports_total\{gfx_tier="insane",device="mobile",gpu_family="software"\} (\d+)$/m,
      ),
    ).toBe(0);
    expect(
      value(text, /^woc_client_jank_reports_total\{gfx_tier="low",device="desktop"\} (\d+)$/m),
    ).toBe(0);
    expect(
      value(
        text,
        /^woc_client_frame_p95_seconds_count\{gfx_tier="ultra",device="desktop"\} (\d+)$/m,
      ),
    ).toBe(0);
    expect(
      value(
        text,
        /^woc_client_worst10s_frame_p95_seconds_count\{scene="rift",device="mobile"\} (\d+)$/m,
      ),
    ).toBe(0);
    expect(value(text, /^woc_client_context_losses_total\{os="linux"\} (\d+)$/m)).toBe(0);
    expect(value(text, /^woc_client_suggestions_total\{suggestion="context-loss"\} (\d+)$/m)).toBe(
      0,
    );
  });

  it('skips benchmark-source reports entirely', async () => {
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    sink.perfReportStored(sample({ source: 'benchmark', zoneOrScenario: 'benchmark' }));

    const text = await registry.metrics();
    // Every series stays at its backfilled zero: nothing was observed.
    expect(
      value(
        text,
        /^woc_client_reports_total\{gfx_tier="high",device="desktop",gpu_family="nvidia"\} (\d+)$/m,
      ),
    ).toBe(0);
    expect(
      value(
        text,
        /^woc_client_frame_p95_seconds_count\{gfx_tier="high",device="desktop"\} (\d+)$/m,
      ),
    ).toBe(0);
  });

  it('never mints labels outside the vocabularies for hostile field values', async () => {
    const registry = new Registry();
    const sink = registerClientPerfMetrics(registry);

    sink.perfReportStored(
      sample({
        gfxTier: 'god-mode',
        osFamily: 'templeos',
        glRendererBucket: 'quantum-9000',
        zoneOrScenario: 'z'.repeat(80),
        mobileTouch: true,
        contextLostCount: 1,
        suggestionIds: ['not-a-real-suggestion'],
      }),
    );

    const text = await registry.metrics();
    // Unknown tier falls back to the ingest's own 'low' fallback, unknown GPU
    // to 'other', unknown OS to 'other', and a bare unknown zone reads as
    // overworld; the invented suggestion id is dropped.
    expect(
      value(
        text,
        /^woc_client_reports_total\{gfx_tier="low",device="mobile",gpu_family="other"\} (\d+)$/m,
      ),
    ).toBe(1);
    expect(value(text, /^woc_client_context_losses_total\{os="other"\} (\d+)$/m)).toBe(1);
    expect(text).not.toMatch(/god-mode|templeos|quantum-9000|zzzz|not-a-real-suggestion/);
  });
});

describe('perf-report ingest emission', () => {
  const VALID_IP_A = '203.0.113.77';

  function fakeReq(body: unknown, remoteAddress: string) {
    const req: any = new EventEmitter();
    req.method = 'POST';
    req.url = '/api/perf-report';
    req.headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0' };
    req.socket = { remoteAddress };
    req.destroy = vi.fn();
    setImmediate(() => {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    });
    return req;
  }

  function fakeRes() {
    const res: any = {
      statusCode: 0,
      body: null as any,
      writeHead(status: number) {
        this.statusCode = status;
      },
      end(data?: string) {
        this.body = data ? JSON.parse(data) : null;
      },
    };
    return res;
  }

  it('emits through the slot only for rows that were stored', async () => {
    const stored: ClientPerfSample[] = [];
    setClientPerfMetricsSink({
      perfReportStored(row) {
        stored.push(row);
      },
    });
    const body = {
      sessionId: 'emit-test-session',
      gfxTier: 'ultra',
      fpsAvg: 42,
      frameP95Ms: 40,
      worst10sFrameP95Ms: 250,
      zoneOrScenario: 'dungeon:sunken_bastion',
    };

    await handlePerfReport(fakeReq(body, VALID_IP_A), fakeRes());
    // Same session immediately again: the per-session insert throttle rejects
    // it before storage, so the slot must not fire a second time.
    await handlePerfReport(fakeReq(body, VALID_IP_A), fakeRes());

    expect(insertClientPerfReport).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
    expect(stored[0].gfxTier).toBe('ultra');
    expect(stored[0].zoneOrScenario).toBe('dungeon:sunken_bastion');
    expect(stored[0].worst10sFrameP95Ms).toBe(250);
  });

  it('holds the no-op sink by default so an unwired ingest never throws', () => {
    expect(clientPerfMetricsSink()).toBe(noopClientPerfMetricsSink);
    expect(() => clientPerfMetricsSink().perfReportStored(sample())).not.toThrow();
  });
});
