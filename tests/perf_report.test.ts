import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  getCharacter: vi.fn(),
  insertClientPerfReport: vi.fn(async () => {}),
}));

import { accountAndScopeForToken, getCharacter, insertClientPerfReport } from '../server/db';
import { handlePerfReport, perfReportInternalsForTest } from '../server/perf_report';
import { resetRateLimitClock, setRateLimitClock } from '../server/ratelimit';

// PERF_REPORT_MAX_PER_MINUTE / PERF_REPORT_WINDOW_MS are un-exported constants in
// server/perf_report; mirror them here (30 posts per 60s window per IP).
const PERF_REPORT_MAX_PER_MINUTE = 30;
const PERF_REPORT_WINDOW_MS = 60_000;

const VALID_TOKEN = 'b'.repeat(64);

function fakeReq(
  body: unknown,
  opts: { token?: string; method?: string; remoteAddress?: string } = {},
) {
  const req: any = new EventEmitter();
  req.method = opts.method ?? 'POST';
  req.url = '/api/perf-report';
  req.headers = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
  };
  req.socket = { remoteAddress: opts.remoteAddress ?? '203.0.113.10' };
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('perf report ingestion', () => {
  it('sanitizes and stores a bounded report with authenticated account context', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: 10, scope: 'full' });
    vi.mocked(getCharacter).mockResolvedValue({ id: 55 } as any);
    const res = fakeRes();

    await handlePerfReport(
      fakeReq(
        {
          schemaVersion: 99,
          releaseVersion: '0.9.0',
          buildId: 'abcdef123456',
          sessionId: 'sess',
          characterId: 55,
          graphicsPreset: 'ultra',
          gfxTier: 'ultra',
          autoGovernor: false,
          targetFps: 60,
          renderScale: 1,
          effectiveRenderScale: 0.95,
          fpsAvg: 58,
          frameP95Ms: 22,
          frameP99Ms: 38,
          longFrameCount: 2,
          rendererCalls: 600,
          rendererTriangles: 400000,
          rendererTextures: 90,
          rendererPrograms: 40,
          contextLostCount: 0,
          longTaskCount: 1,
          longTaskP95Ms: 70,
          memoryUsedMb: 120,
          memoryLimitMb: 4096,
          dpr: 2,
          viewportWidth: 1440,
          viewportHeight: 900,
          deviceMemory: 8,
          hardwareConcurrency: 12,
          mobileTouch: false,
          glVendor: 'Apple',
          glRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2)',
          source: 'benchmark',
          zoneOrScenario: 'bench_town',
          crowdBucket: '25-49',
          simEntities: 240,
          activeViews: 57,
          visibleViews: 31,
          worst10sFrameP95Ms: 180.5,
          rawSummary: { large: 'x'.repeat(18_000) },
        },
        { token: VALID_TOKEN },
      ),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledTimes(1);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        // 99 clamps to the current schema version (2 since the phase 03
        // dimensions, ruling R6).
        schemaVersion: 2,
        accountId: 10,
        characterId: 55,
        graphicsPreset: 'ultra',
        gfxTier: 'ultra',
        glRendererBucket: 'apple-m2',
        browserFamily: 'safari',
        osFamily: 'macos',
        viewportBucket: 'large-1440x900',
        crowdBucket: '25-49',
        simEntities: 240,
        activeViews: 57,
        visibleViews: 31,
        worst10sFrameP95Ms: 180.5,
        rawSummary: { truncated: true },
      }),
    );
  });

  it('keeps old schema-version-1 clients valid through the intIn clamp', async () => {
    const res = fakeRes();
    await handlePerfReport(
      fakeReq({ sessionId: 'v1-client', schemaVersion: 1, rawSummary: {} }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
    );
  });

  it('stores a read-token report anonymously without resolving its character', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: 10, scope: 'read' });
    const res = fakeRes();

    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'read-token-report',
          characterId: 55,
        },
        { token: VALID_TOKEN },
      ),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(getCharacter).not.toHaveBeenCalled();
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: null,
        characterId: null,
      }),
    );
  });

  it('mirrors the client crowd label catalog exactly', async () => {
    // server/ cannot import src/game (the R14-style parity pattern): the
    // sanitizer keeps a deliberate copy of the label list, and this
    // cross-boundary pin is the drift guard.
    const { CROWD_BUCKET_LABELS } = await import('../src/game/crowd_bucket');
    expect([...perfReportInternalsForTest.CROWD_BUCKET_LABELS]).toEqual([...CROWD_BUCKET_LABELS]);
  });

  it('keeps the client and server schema versions in lockstep', async () => {
    // Same deliberate-copy pattern as the crowd labels: the server clamp
    // ceiling must track the version the client stamps, or new-client rows
    // would silently clamp down and dashboards would mis-segment them.
    const { perfReporterInternalsForTest } = await import('../src/game/perf_reporter');
    expect(perfReportInternalsForTest.PERF_REPORT_SCHEMA_VERSION).toBe(
      perfReporterInternalsForTest.PERF_REPORT_SCHEMA_VERSION,
    );
    expect(perfReportInternalsForTest.PERF_REPORT_SCHEMA_VERSION).toBe(2);
  });

  it('accepts every fixed crowd label and folds hostile crowd input to unknown', async () => {
    for (const label of perfReportInternalsForTest.CROWD_BUCKET_LABELS) {
      vi.mocked(insertClientPerfReport).mockClear();
      await handlePerfReport(
        fakeReq(
          { sessionId: `crowd-${label}`, crowdBucket: label, rawSummary: {} },
          { remoteAddress: '203.0.113.61' },
        ),
        fakeRes(),
      );
      expect(insertClientPerfReport).toHaveBeenCalledWith(
        expect.objectContaining({ crowdBucket: label }),
      );
    }
    for (const hostile of ['lt10; DROP TABLE accounts', '100PLUS', 42, { label: 'lt10' }, null]) {
      vi.mocked(insertClientPerfReport).mockClear();
      await handlePerfReport(
        fakeReq(
          { sessionId: `crowd-hostile-${String(hostile)}`, crowdBucket: hostile, rawSummary: {} },
          { remoteAddress: '203.0.113.62' },
        ),
        fakeRes(),
      );
      expect(insertClientPerfReport).toHaveBeenCalledWith(
        expect.objectContaining({ crowdBucket: 'unknown' }),
      );
    }
  });

  it('clamps the crowd numerators and the worst-10s p95 against hostile numbers', async () => {
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'hostile-numbers',
          simEntities: -5,
          activeViews: 9e9,
          visibleViews: 'not-a-number',
          worst10sFrameP95Ms: -3,
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.63' },
      ),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        simEntities: 0,
        activeViews: 100_000,
        visibleViews: 0,
        worst10sFrameP95Ms: 0,
      }),
    );

    vi.mocked(insertClientPerfReport).mockClear();
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'hostile-numbers-2',
          simEntities: 33.9,
          activeViews: Number.NaN,
          visibleViews: 31,
          worst10sFrameP95Ms: 1e9,
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.64' },
      ),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        simEntities: 33,
        activeViews: 0,
        visibleViews: 31,
        worst10sFrameP95Ms: 1000,
      }),
    );
  });

  it('defaults the five dimension fields when an old client omits them', async () => {
    await handlePerfReport(
      fakeReq({ sessionId: 'old-client', rawSummary: {} }, { remoteAddress: '203.0.113.65' }),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        crowdBucket: 'unknown',
        simEntities: 0,
        activeViews: 0,
        visibleViews: 0,
        worst10sFrameP95Ms: 0,
      }),
    );
  });

  it('passes a provider zone id through the zone sanitizer for gameplay reports', async () => {
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'zone-flow',
          source: 'gameplay',
          zoneOrScenario: 'dungeon:hollow_crypt',
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.66' },
      ),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'gameplay', zoneOrScenario: 'dungeon:hollow_crypt' }),
    );
  });

  it('filters, dedupes, and caps hostile suggestion ids before storage', () => {
    const { suggestionIdsIn } = perfReportInternalsForTest;
    // Unknown ids and non-string entries drop; duplicates collapse; the cap
    // is 3 (the client analyzer ceiling re-imposed server-side).
    expect(
      suggestionIdsIn([
        'bogus-id',
        'hardware-acceleration',
        42,
        { id: 'high-dpi' },
        null,
        'hardware-acceleration',
        ' integrated-gpu ',
        'high-dpi',
        'low-memory',
        'context-loss',
      ]),
    ).toEqual(['hardware-acceleration', 'integrated-gpu', 'high-dpi']);
    expect(suggestionIdsIn('hardware-acceleration')).toEqual([]);
    expect(suggestionIdsIn(null)).toEqual([]);
    expect(suggestionIdsIn(undefined)).toEqual([]);
    expect(suggestionIdsIn({})).toEqual([]);
    // An oversized hostile array still yields at most the cap, and only known ids.
    const oversized = Array.from({ length: 5000 }, (_, i) =>
      i % 2 === 0 ? `junk-${i}` : 'browser-stalls',
    );
    expect(suggestionIdsIn(oversized)).toEqual(['browser-stalls']);
    // The scan window is bounded independently of the body-size cap: a known id
    // buried past the first 64 entries of a junk flood never gets scanned.
    const buried = Array.from({ length: 200 }, (_, i) =>
      i === 150 ? 'hardware-acceleration' : `junk-${i}`,
    );
    expect(suggestionIdsIn(buried)).toEqual([]);
  });

  it('stores sanitized suggestion ids on the row and defaults them empty', async () => {
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'suggestion-flow',
          suggestionIds: ['hardware-acceleration', 'DROP TABLE', 'hardware-acceleration'],
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.71' },
      ),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionIds: ['hardware-acceleration'] }),
    );

    vi.mocked(insertClientPerfReport).mockClear();
    await handlePerfReport(
      fakeReq(
        { sessionId: 'suggestion-old-client', rawSummary: {} },
        { remoteAddress: '203.0.113.72' },
      ),
      fakeRes(),
    );
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionIds: [] }),
    );
  });

  it('keeps GPU bucketing coarse', () => {
    expect(perfReportInternalsForTest.bucketGpu('Google SwiftShader')).toBe('software');
    expect(
      perfReportInternalsForTest.bucketGpu('ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)'),
    ).toBe('intel-iris');
    expect(perfReportInternalsForTest.bucketGpu('ANGLE (AMD Radeon Pro)')).toBe('amd');
  });

  it('drops duplicate inserts from the same session inside the server throttle window', async () => {
    const first = fakeRes();
    const second = fakeRes();
    const remoteAddress = '203.0.113.210';
    const sessionId = 'dupe-throttle';

    await handlePerfReport(
      fakeReq({ sessionId, rawSummary: { seconds: 30 } }, { remoteAddress }),
      first,
    );
    await handlePerfReport(
      fakeReq({ sessionId, rawSummary: { seconds: 35 } }, { remoteAddress }),
      second,
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledTimes(1);
  });

  it('rate-limits per IP through the shared injected clock (200 by design, no insert over cap)', async () => {
    // The perf-report limiter now reads time via ratelimit.rateLimitNow (the shared
    // setRateLimitClock seam), so a pinned clock drives its window with no real timers.
    // Distinct sessionIds keep the separate min-insert throttle from gating, so an
    // insert is observed exactly while the per-IP rate limiter allows the post.
    const remoteAddress = '203.0.113.99'; // a fresh per-IP bucket, unused elsewhere
    setRateLimitClock(() => 5_000_000);
    try {
      for (let i = 0; i < PERF_REPORT_MAX_PER_MINUTE; i++) {
        const res = fakeRes();
        await handlePerfReport(
          fakeReq({ sessionId: `cap-${i}`, rawSummary: {} }, { remoteAddress }),
          res,
        );
        expect(res.statusCode).toBe(200);
      }
      // The cap is drained: every allowed post stored a row.
      expect(insertClientPerfReport).toHaveBeenCalledTimes(PERF_REPORT_MAX_PER_MINUTE);

      // The (cap + 1)th post in the same window is rate-limited: still 200 by design,
      // but it returns before the insert, so the stored count does not move.
      const overCap = fakeRes();
      await handlePerfReport(
        fakeReq({ sessionId: 'cap-over', rawSummary: {} }, { remoteAddress }),
        overCap,
      );
      expect(overCap.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledTimes(PERF_REPORT_MAX_PER_MINUTE);

      // Roll the clock a full window forward: the t=5_000_000 entries age out, the
      // window is fresh, and a new post stores again.
      setRateLimitClock(() => 5_000_000 + PERF_REPORT_WINDOW_MS);
      const rolled = fakeRes();
      await handlePerfReport(
        fakeReq({ sessionId: 'cap-rolled', rawSummary: {} }, { remoteAddress }),
        rolled,
      );
      expect(rolled.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledTimes(PERF_REPORT_MAX_PER_MINUTE + 1);
    } finally {
      resetRateLimitClock();
    }
  });

  it('strips development trace data from public reports', async () => {
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'public',
        rawSummary: { seconds: 30, devTrace: { frames: [{ frameMs: 200 }] } },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSummary: { seconds: 30 },
      }),
    );
  });

  it('preserves compact prewarm data when public raw summaries are truncated', async () => {
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'public-large',
        rawSummary: {
          seconds: 30,
          rendererPrewarmSummary: {
            elapsedMs: 3200,
            maxMs: 5000,
            manifestPlanned: 14,
            manifestCompleted: 11,
            manifestTimedOut: 1,
            timedOutEntryIds: ['diagnostics.baseline'],
            entries: [
              {
                id: 'textures.scene',
                category: 'world',
                required: true,
                status: 'completed',
                elapsedMs: 120,
                remainingMsAfter: 4200,
                programDelta: 0,
                textureDelta: 12,
                detail: 'uploaded=12',
              },
            ],
          },
          oversized: 'x'.repeat(40_000),
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSummary: expect.objectContaining({
          truncated: true,
          seconds: 30,
          rendererPrewarmSummary: expect.objectContaining({
            elapsedMs: 3200,
            manifestPlanned: 14,
            manifestTimedOut: 1,
            entries: [
              expect.objectContaining({
                id: 'textures.scene',
                textureDelta: 12,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('preserves the net pipeline and heap sawtooth blocks when raw summaries are truncated', async () => {
    const res = fakeRes();
    const netPipeline = {
      snapshots: 240,
      resets: 1,
      approxBytesTotal: 480_000,
      gapMs: { count: 239, p50: 50, p95: 78, max: 900 },
      snapshotsPerRaf: { r0: 410, r1: 280, r2: 24, r3plus: 6 },
    };
    const heapSawtooth = { samples: 60, gcDropCount: 3, avgDropMb: 38.5, amplitudeMb: 42 };

    await handlePerfReport(
      fakeReq({
        sessionId: 'public-netpipeline',
        rawSummary: {
          seconds: 30,
          netPipeline,
          heapSawtooth,
          oversized: 'x'.repeat(40_000),
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSummary: expect.objectContaining({
          truncated: true,
          seconds: 30,
          netPipeline,
          heapSawtooth,
        }),
      }),
    );
    // The oversized filler itself must NOT survive the compact pass, or the
    // preserved-keys assertion above would be vacuous.
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    expect((stored.rawSummary as Record<string, unknown>).oversized).toBeUndefined();
  });

  it('strips development trace data in production even on loopback', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = fakeRes();

      await handlePerfReport(
        fakeReq(
          {
            sessionId: 'prod-loopback',
            rawSummary: { seconds: 30, devTrace: { frames: [{ frameMs: 200 }] } },
          },
          { remoteAddress: '127.0.0.1' },
        ),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(
        expect.objectContaining({
          rawSummary: { seconds: 30 },
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('allows larger development trace summaries from local non-production requests', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();

      await handlePerfReport(
        fakeReq(
          {
            sessionId: 'local-dev',
            rawSummary: {
              seconds: 30,
              devTrace: {
                frames: [{ frameMs: 200, detail: 'x'.repeat(9000) }],
              },
            },
          },
          { remoteAddress: '127.0.0.1' },
        ),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(
        expect.objectContaining({
          rawSummary: {
            seconds: 30,
            devTrace: {
              frames: [{ frameMs: 200, detail: 'x'.repeat(9000) }],
            },
          },
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('accepts local development trace request bodies above the normal route limit', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      const detail = 'x'.repeat(260_000);

      await handlePerfReport(
        fakeReq(
          {
            sessionId: 'local-large-dev',
            rawSummary: {
              seconds: 30,
              devTrace: {
                frames: [{ frameMs: 200, detail }],
              },
            },
          },
          { remoteAddress: '127.0.0.1' },
        ),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(
        expect.objectContaining({
          rawSummary: {
            seconds: 30,
            devTrace: {
              frames: [{ frameMs: 200, detail }],
            },
          },
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
