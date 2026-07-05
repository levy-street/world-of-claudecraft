import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  accountForToken: vi.fn(),
  getCharacter: vi.fn(),
  insertClientPerfReport: vi.fn(async () => {}),
}));

import { handlePerfReport, perfReportInternalsForTest } from '../server/perf_report';
import { accountForToken, getCharacter, insertClientPerfReport } from '../server/db';

const VALID_TOKEN = 'b'.repeat(64);

function fakeReq(body: unknown, opts: { token?: string; method?: string; remoteAddress?: string } = {}) {
  const req: any = new EventEmitter();
  req.method = opts.method ?? 'POST';
  req.url = '/api/perf-report';
  req.headers = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
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
    writeHead(status: number) { this.statusCode = status; },
    end(data?: string) { this.body = data ? JSON.parse(data) : null; },
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('perf report ingestion', () => {
  it('sanitizes and stores a bounded report with authenticated account context', async () => {
    vi.mocked(accountForToken).mockResolvedValue(10);
    vi.mocked(getCharacter).mockResolvedValue({ id: 55 } as any);
    const res = fakeRes();

    await handlePerfReport(fakeReq({
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
      rawSummary: { large: 'x'.repeat(18_000) },
    }, { token: VALID_TOKEN }), res);

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledTimes(1);
    expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      accountId: 10,
      characterId: 55,
      graphicsPreset: 'ultra',
      gfxTier: 'ultra',
      glRendererBucket: 'apple-m2',
      browserFamily: 'safari',
      osFamily: 'macos',
      viewportBucket: 'large-1440x900',
      rawSummary: { truncated: true },
    }));
  });

  it('keeps GPU bucketing coarse', () => {
    expect(perfReportInternalsForTest.bucketGpu('Google SwiftShader')).toBe('software');
    expect(perfReportInternalsForTest.bucketGpu('ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)')).toBe('intel-iris');
    expect(perfReportInternalsForTest.bucketGpu('ANGLE (AMD Radeon Pro)')).toBe('amd');
  });

  it('drops duplicate inserts from the same session inside the server throttle window', async () => {
    const first = fakeRes();
    const second = fakeRes();
    const remoteAddress = '203.0.113.210';
    const sessionId = 'dupe-throttle';

    await handlePerfReport(fakeReq({ sessionId, rawSummary: { seconds: 30 } }, { remoteAddress }), first);
    await handlePerfReport(fakeReq({ sessionId, rawSummary: { seconds: 35 } }, { remoteAddress }), second);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledTimes(1);
  });

  it('strips development trace data from public reports', async () => {
    const res = fakeRes();

    await handlePerfReport(fakeReq({
      sessionId: 'public',
      rawSummary: { seconds: 30, devTrace: { frames: [{ frameMs: 200 }] } },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
      rawSummary: { seconds: 30 },
    }));
  });

  it('preserves compact prewarm data when public raw summaries are truncated', async () => {
    const res = fakeRes();

    await handlePerfReport(fakeReq({
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
    }), res);

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
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
    }));
  });

  it('strips development trace data in production even on loopback', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = fakeRes();

      await handlePerfReport(fakeReq({
        sessionId: 'prod-loopback',
        rawSummary: { seconds: 30, devTrace: { frames: [{ frameMs: 200 }] } },
      }, { remoteAddress: '127.0.0.1' }), res);

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
        rawSummary: { seconds: 30 },
      }));
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

      await handlePerfReport(fakeReq({
        sessionId: 'local-dev',
        rawSummary: {
          seconds: 30,
          devTrace: {
            frames: [{ frameMs: 200, detail: 'x'.repeat(9000) }],
          },
        },
      }, { remoteAddress: '127.0.0.1' }), res);

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
        rawSummary: {
          seconds: 30,
          devTrace: {
            frames: [{ frameMs: 200, detail: 'x'.repeat(9000) }],
          },
        },
      }));
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

      await handlePerfReport(fakeReq({
        sessionId: 'local-large-dev',
        rawSummary: {
          seconds: 30,
          devTrace: {
            frames: [{ frameMs: 200, detail }],
          },
        },
      }, { remoteAddress: '127.0.0.1' }), res);

      expect(res.statusCode).toBe(200);
      expect(insertClientPerfReport).toHaveBeenCalledWith(expect.objectContaining({
        rawSummary: {
          seconds: 30,
          devTrace: {
            frames: [{ frameMs: 200, detail }],
          },
        },
      }));
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
