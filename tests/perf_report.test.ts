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
import {
  PREWARM_REPORT_BUDGET_VARIANTS,
  PREWARM_REPORT_COMPILE_UNITS,
  PREWARM_REPORT_TRANSITIONS,
} from '../src/game/perf_prewarm_lists_core';

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

  it('preserves the insane preset and tier independently for fleet segmentation', async () => {
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'insane-preset',
          graphicsPreset: 'insane',
          gfxTier: 'low',
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.79' },
      ),
      fakeRes(),
    );
    await handlePerfReport(
      fakeReq(
        {
          sessionId: 'insane-tier',
          graphicsPreset: 'auto',
          gfxTier: 'insane',
          rawSummary: {},
        },
        { remoteAddress: '203.0.113.80' },
      ),
      fakeRes(),
    );

    expect(insertClientPerfReport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        graphicsPreset: 'insane',
        gfxTier: 'low',
      }),
    );
    expect(insertClientPerfReport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        graphicsPreset: 'auto',
        gfxTier: 'insane',
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

  it('keeps the client and server prewarm list caps in lockstep', async () => {
    // Same deliberate-copy pattern as the crowd labels and the schema version:
    // server/ cannot import src/game, so the two constant sets are written
    // twice. Nothing else notices if one side is lowered and the other is not,
    // and the consequence is silent: the server would keep trimming a list the
    // client already trimmed, or store more than the client's own budget
    // reasoning assumed.
    expect(perfReportInternalsForTest.PREWARM_COMPILE_UNITS_MAX).toBe(PREWARM_REPORT_COMPILE_UNITS);
    expect(perfReportInternalsForTest.PREWARM_BUDGET_VARIANTS_MAX).toBe(
      PREWARM_REPORT_BUDGET_VARIANTS,
    );
    expect(perfReportInternalsForTest.PREWARM_PACING_TRANSITIONS_MAX).toBe(
      PREWARM_REPORT_TRANSITIONS,
    );
    // And to literals, so lowering BOTH sides in lockstep still has to be a
    // deliberate edit here rather than a silent drift.
    expect(perfReportInternalsForTest.PREWARM_COMPILE_UNITS_MAX).toBe(12);
    expect(perfReportInternalsForTest.PREWARM_BUDGET_VARIANTS_MAX).toBe(8);
    expect(perfReportInternalsForTest.PREWARM_PACING_TRANSITIONS_MAX).toBe(12);
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
            manifestPartial: 1,
            manifestTimedOut: 1,
            partialEntryIds: ['entities.player-archetypes'],
            timedOutEntryIds: ['diagnostics.baseline'],
            entries: [
              {
                id: 'textures.scene',
                category: 'world',
                required: true,
                status: 'partial',
                elapsedMs: 120,
                remainingMsAfter: 4200,
                programDelta: 0,
                textureDelta: 12,
                workDone: 12,
                workPlanned: 20,
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
            manifestPartial: 1,
            manifestTimedOut: 1,
            partialEntryIds: ['entities.player-archetypes'],
            entries: [
              expect.objectContaining({
                id: 'textures.scene',
                status: 'partial',
                textureDelta: 12,
                workDone: 12,
                workPlanned: 20,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('bounds the client-supplied prewarm entry-id lists instead of copying them verbatim', async () => {
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'public-hostile-entry-ids',
        rawSummary: {
          seconds: 30,
          rendererPrewarmSummary: {
            manifestPartial: 25,
            // Oversized: capped at the same 24-entry bound the entries block uses.
            partialEntryIds: Array.from({ length: 30 }, (_, i) => `partial-${i}`),
            // Overlong strings truncate to 80; non-string elements drop.
            timedOutEntryIds: ['y'.repeat(500), 42, { nested: true }, 'diagnostics.baseline'],
            // A non-array value is dropped outright, never stored.
            failedEntryIds: 'not-an-array',
            entries: [],
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
          rendererPrewarmSummary: expect.objectContaining({
            manifestPartial: 25,
            partialEntryIds: Array.from({ length: 24 }, (_, i) => `partial-${i}`),
            timedOutEntryIds: ['y'.repeat(80), 'diagnostics.baseline'],
          }),
        }),
      }),
    );
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const prewarm = (stored.rawSummary as Record<string, unknown>).rendererPrewarmSummary as Record<
      string,
      unknown
    >;
    expect(prewarm.failedEntryIds).toBeUndefined();
    // Documented contract (see the id-list sanitizer comment in
    // server/perf_report.ts compactPrewarmSummary): the scalar counts stay
    // authoritative and uncapped while the id lists are bounded SAMPLES, so
    // manifestPartial: 25 stored beside a 24-element partialEntryIds is the
    // intended shape of the signal, not a contradiction to normalize away.
    expect(prewarm.manifestPartial).toBe(25);
    expect((prewarm.partialEntryIds as string[]).length).toBe(24);
    expect((prewarm.partialEntryIds as string[]).length).toBeLessThan(
      prewarm.manifestPartial as number,
    );
  });

  it('bounds the streamed-prewarm diagnostic lists on the verbatim raw path', async () => {
    // compileUnits, per-entry budgetVariants and the adaptive pacing
    // transitions are client-supplied lists riding the same verbatim path the
    // resume block does. The client caps them, but any token holder can post a
    // hand-rolled report, so the bound has to be here.
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'public-hostile-prewarm-lists',
        rawSummary: {
          seconds: 30,
          rendererPrewarmSummary: {
            compileUnits: Array.from({ length: 200 }, (_, i) => ({ id: `unit-${i}` })),
            manifestEntries: [
              {
                id: 'programs.budget-variants',
                budgetVariants: Array.from({ length: 100 }, (_, i) => ({ index: i })),
              },
              // A non-array rides through untouched rather than throwing.
              { id: 'sky.current-zone', budgetVariants: 'not-an-array' },
            ],
            prewarmPacing: {
              adaptive: {
                transitions: Array.from({ length: 200 }, (_, i) => ({ atMs: i })),
              },
            },
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const raw = stored.rawSummary as Record<string, unknown>;
    expect(raw.truncated).toBeUndefined();
    const prewarm = raw.rendererPrewarmSummary as Record<string, unknown>;
    expect((prewarm.compileUnits as unknown[]).length).toBe(12);
    const entries = prewarm.manifestEntries as Record<string, unknown>[];
    expect((entries[0].budgetVariants as unknown[]).length).toBe(8);
    expect(entries[1].budgetVariants).toBe('not-an-array');
    const adaptive = (prewarm.prewarmPacing as Record<string, unknown>).adaptive as Record<
      string,
      unknown
    >;
    expect((adaptive.transitions as unknown[]).length).toBe(12);
    // Membership, not just length: the tail, so the pacer's end state survives.
    expect((adaptive.transitions as Record<string, unknown>[]).map((t) => t.atMs)).toEqual([
      188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199,
    ]);
    // compileUnits are kept by RANK, not position: the hostile fixture gives
    // them no timings, so the stable tie-break keeps the first twelve here.
    expect((prewarm.compileUnits as { id: string }[])[0].id).toBe('unit-0');
  });

  it('bounds the same lists under the legacy rendererPrewarm key', async () => {
    // The sanitizer walks BOTH prewarm keys because a client older than the
    // summary-only change still sends the twin, and any token holder can post
    // either. Without this case the loop could lose its second key in a
    // refactor and the suite would stay green. The current client also emits
    // its manifest entries as `entries`, not `manifestEntries`, so that arm of
    // the per-entry clamp is exercised here too.
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'public-hostile-legacy-prewarm-key',
        rawSummary: {
          seconds: 30,
          rendererPrewarm: {
            compileUnits: Array.from({ length: 200 }, (_, i) => ({ id: `unit-${i}` })),
            entries: [
              {
                id: 'programs.budget-variants',
                budgetVariants: Array.from({ length: 100 }, (_, i) => ({ index: i })),
              },
            ],
            prewarmPacing: {
              adaptive: { transitions: Array.from({ length: 200 }, (_, i) => ({ atMs: i })) },
            },
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const prewarm = (stored.rawSummary as Record<string, unknown>).rendererPrewarm as Record<
      string,
      unknown
    >;
    expect((prewarm.compileUnits as unknown[]).length).toBe(12);
    expect(
      ((prewarm.entries as Record<string, unknown>[])[0].budgetVariants as unknown[]).length,
    ).toBe(8);
    const adaptive = (prewarm.prewarmPacing as Record<string, unknown>).adaptive as Record<
      string,
      unknown
    >;
    expect((adaptive.transitions as unknown[]).length).toBe(12);
  });

  it('keeps a full client-capped prewarm snapshot under the raw summary byte cap', async () => {
    // The three new lists are large enough that a LEGITIMATE report can cross
    // RAW_SUMMARY_MAX_BYTES and get routed into compactRawSummary, whose
    // compactPrewarmSummary carries none of them: the diagnostic that motivated
    // the fields would be the first thing dropped. This pins that a snapshot at
    // exactly the client caps still rides the verbatim path.
    const res = fakeRes();
    const compileUnit = (i: number) => ({
      id: `weapon-skins:compile:skin_${i}`,
      lane: 'programs.compile-submit',
      submittedAtMs: 1000 + i,
      syncEndAtMs: 1010 + i,
      settledAtMs: 1200 + i,
      failedAtMs: null,
      programsBefore: i,
      programsAfter: i + 2,
      programDelta: 2,
      chargedLinks: 2,
      syncMs: 10.5,
      settledDurationMs: 190.25,
      statusAtReveal: 'settled',
    });
    const budgetVariant = (i: number) => ({
      index: i,
      levels: { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 },
      elapsedMs: 12.5,
      syncMs: 11.25,
      programsBefore: i,
      programsAfter: i + 3,
      programDelta: 3,
      passes: 1,
    });
    const transition = (i: number) => ({
      atMs: 500 + i,
      from: 'steady',
      to: 'backoff',
      reason: 'no-progress',
      windowLinks: 8,
      inFlightLinks: 4,
    });

    await handlePerfReport(
      fakeReq({
        sessionId: 'full-prewarm-snapshot',
        rawSummary: {
          seconds: 60,
          rendererPrewarmSummary: {
            elapsedMs: 14_000,
            manifestPlanned: 40,
            manifestCompleted: 38,
            compileUnits: Array.from({ length: PREWARM_REPORT_COMPILE_UNITS }, (_, i) =>
              compileUnit(i),
            ),
            manifestEntries: [
              {
                id: 'programs.budget-variants',
                category: 'world',
                status: 'completed',
                budgetVariants: Array.from({ length: PREWARM_REPORT_BUDGET_VARIANTS }, (_, i) =>
                  budgetVariant(i),
                ),
              },
            ],
            prewarmPacing: {
              available: true,
              mode: 'adaptive',
              adaptive: {
                state: 'steady',
                transitions: Array.from({ length: PREWARM_REPORT_TRANSITIONS }, (_, i) =>
                  transition(i),
                ),
              },
            },
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const raw = stored.rawSummary as Record<string, unknown>;
    // Not truncated: the whole point. A red here means the caps and the byte
    // budget have drifted apart and the compact path is now silently eating
    // the streamed-prewarm diagnostic.
    expect(raw.truncated).toBeUndefined();
    const prewarm = raw.rendererPrewarmSummary as Record<string, unknown>;
    expect((prewarm.compileUnits as unknown[]).length).toBe(12);
    expect(
      ((prewarm.manifestEntries as Record<string, unknown>[])[0].budgetVariants as unknown[])
        .length,
    ).toBe(8);
    // The real constraint, stated as a budget rather than a pass/fail on this
    // one fixture: the three streamed lists together must stay a minority of
    // the 16 KB raw-summary cap, because a real report also carries the 32
    // pre-existing manifest entries, the resume block, and every non-prewarm
    // section beside them. Measured against a real capture, a compile unit
    // costs about 280 bytes, so 32 of them (the caps this PR first shipped)
    // was ~9 KB and pushed every compiled session's report into the compact
    // path.
    const listBytes = Buffer.byteLength(
      JSON.stringify([
        prewarm.compileUnits,
        (prewarm.manifestEntries as Record<string, unknown>[])[0].budgetVariants,
        ((prewarm.prewarmPacing as Record<string, unknown>).adaptive as Record<string, unknown>)
          .transitions,
      ]),
    );
    // Sized from the exported caps, so RAISING a cap grows the fixture and
    // trips this budget instead of silently decoupling the claim above from
    // the constants it is about.
    expect(listBytes).toBeLessThan(7 * 1024);
  });

  it('keeps a REALISTIC full report under the raw summary cap, prewarm block included', async () => {
    // The byte test above measures the three lists in isolation, which is the
    // arithmetic and not the failure. The failure the first cap of 32 actually
    // had was a whole report crossing 16 KB: a real rawSummary also carries 32
    // manifest entries, the resume block, browser, gpuQueue, assets, input,
    // hud, netPipeline and the window rollups. This fixture approximates one.
    const res = fakeRes();
    const entry = (i: number) => ({
      id: `programs.entry-${i}`,
      category: 'world',
      required: i % 2 === 0,
      status: 'completed',
      elapsedMs: 120.5 + i,
      remainingMsAfter: 9000 - i * 10,
      programDelta: i,
      textureDelta: i * 2,
      workDone: i,
      workPlanned: i + 1,
      detail: `mode=async;timedOut=false;compileRoots=${i}`,
    });
    const window = () => ({
      frameMs: { p50: 8.4, p95: 21.7, p99: 44.2, max: 180.5 },
      fps: { avg: 58.2, min: 22.1 },
      longFrames: 4,
    });

    await handlePerfReport(
      fakeReq({
        sessionId: 'realistic-full-report',
        rawSummary: {
          graphicsConfigVersion: 16,
          seconds: 300,
          frames: 17_400,
          hiddenPresentSkips: 12,
          windows: { worst10s: window(), last60s: window(), session: window() },
          mainMs: { p50: 6.2, p95: 18.4, p99: 39.1 },
          rendererPhaseMs: { cull: 1.2, entities: 3.4, nameplates: 0.8, post: 2.1, present: 4.4 },
          rendererFoliage: { grass: 0.6, buckets: 18, drawn: 12_400 },
          rendererBudget: { level: 0.85, drops: 3, raises: 1 },
          rendererQualityBuckets: { levels: { grass: 1, foliage: 1, vfx: 1, weapons: 1 } },
          rendererDiagnostics: { prewarmGroups: 6, categories: 9 },
          rendererGpuQueue: { units: 40, stalls: 2, slowestMs: 118.4, waits: 6 },
          assets: { preload: { count: 220, ms: 4100 }, byType: { glb: 130, ktx2: 90 } },
          input: { latencyMs: { p50: 12.1, p95: 28.9 } },
          hud: { paints: 900, skipped: 120 },
          netPipeline: { snapshots: 6000, events: 1400, bytes: 2_400_000 },
          heapSawtooth: { collections: 115, medianMb: 620, peakMb: 1480 },
          browser: { longTasks: { totalMs: 2600, avg: 86.7, max: 430, lastAge: 4200 } },
          rendererPrewarmSummary: {
            elapsedMs: 14_000,
            maxMs: 15_000,
            remainingMs: 1000,
            budgetUsedRatio: 0.93,
            timedOut: false,
            createdViews: 57,
            candidateViews: 60,
            renderPasses: 42,
            programsDelta: 480,
            texturesDelta: 220,
            compileMode: 'async',
            compileMs: 5400,
            compileTimedOut: false,
            manifestPlanned: 40,
            manifestCompleted: 38,
            manifestPartial: 1,
            manifestSkipped: 0,
            manifestTimedOut: 1,
            manifestFailed: 0,
            partialEntryIds: ['vfx.weapon-skins'],
            timedOutEntryIds: ['sky.current-zone'],
            failedEntryIds: [],
            resume: {
              status: 'done',
              plannedEntries: 3,
              plannedUnits: 47,
              startedUnits: 47,
              failedUnits: 0,
              failedUnitIds: [],
              entries: [{ id: 'vfx.weapon-skins', lane: 'cosmetic', planned: 47, started: 47 }],
            },
            entries: Array.from({ length: 32 }, (_, i) => entry(i)),
            compileUnits: Array.from({ length: PREWARM_REPORT_COMPILE_UNITS }, (_, i) => ({
              id: `weapon-skins:compile:skin_${i}`,
              lane: 'programs.compile-submit',
              submittedAtMs: 1000 + i,
              syncEndAtMs: 1010 + i,
              settledAtMs: 1200 + i,
              failedAtMs: null,
              programsBefore: i,
              programsAfter: i + 2,
              programDelta: 2,
              chargedLinks: 2,
              syncMs: 10.5,
              settledDurationMs: 190.25,
              statusAtReveal: 'settled',
            })),
            prewarmPacing: {
              available: true,
              source: 'knobs',
              mode: 'adaptive',
              linksPerSecond: 40,
              burst: 8,
              compileBatchRoots: 32,
              hardMaxMs: 15_000,
              chargedLinks: 480,
              scope: 'world',
              submitStop: null,
              adaptive: {
                state: 'steady',
                windowLinks: 8,
                minWindowLinks: 2,
                maxWindowLinks: 16,
                maxWindowObserved: 14,
                estimatedLinksPerUnit: 2.1,
                inFlightLinks: 0,
                inFlightUnits: 0,
                peakInFlightLinks: 12,
                submittedUnits: 47,
                settledUnits: 47,
                failedUnits: 0,
                backoffCount: 2,
                noProgressCount: 0,
                lastSettlementMs: 13_400,
                transitions: Array.from({ length: PREWARM_REPORT_TRANSITIONS }, (_, i) => ({
                  atMs: 500 + i,
                  from: 'steady',
                  to: 'backoff',
                  reason: 'no-progress',
                  windowLinks: 8,
                  inFlightLinks: 4,
                })),
              },
            },
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const raw = stored.rawSummary as Record<string, unknown>;
    // The whole point: a realistic report at the shipped caps still rides the
    // verbatim path. A red here means the caps and the byte budget drifted
    // apart and the streamed-prewarm diagnostic is being silently compacted
    // away again, which is the failure the cap of 32 had.
    expect(raw.truncated).toBeUndefined();
    const prewarm = raw.rendererPrewarmSummary as Record<string, unknown>;
    expect((prewarm.compileUnits as unknown[]).length).toBe(PREWARM_REPORT_COMPILE_UNITS);
    expect((prewarm.entries as unknown[]).length).toBe(32);
    // Recorded so the margin is visible rather than implied: this fixture
    // lands here against the 16 KB cap, and the three streamed lists are the
    // part this branch added.
    const totalBytes = Buffer.byteLength(JSON.stringify(raw));
    const listBytes = Buffer.byteLength(
      JSON.stringify([
        prewarm.compileUnits,
        (prewarm.prewarmPacing as Record<string, unknown>).adaptive,
      ]),
    );
    // A BAND, not a ceiling alone. The lower bound catches a change that
    // silently guts the block (a dropped field reads as "still green" against a
    // ceiling alone). The upper bound is an EARLY WARNING deliberately set below
    // the real 16 KB cliff: this fixture measures 15286 bytes, so a first report
    // has only about 1.1 KB of margin, and a test that only asserted "under the
    // cap" would go red for the first time on the change that already broke it.
    // Later reports in a session are far smaller: the client's emit-on-change
    // gate drops the ~6.6 KB of streamed-prewarm lists once they stop changing,
    // which is what buys that margin back for the rest of the session.
    expect(listBytes).toBeGreaterThan(2 * 1024);
    expect(totalBytes).toBeLessThan(15_500);
  });

  it('carries the streamed-prewarm diagnostic across truncation into the compact path', async () => {
    // The other half of the byte story: when a report DOES overflow, the
    // compact rebuild must still say which unit stalled and whether the pacer
    // backed off. Before this, compactPrewarmSummary knew none of these fields,
    // so the diagnostic was dropped exactly on the heavy sessions it was added
    // to explain.
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'compact-prewarm-diagnostic',
        rawSummary: {
          seconds: 30,
          rendererPrewarmSummary: {
            manifestPlanned: 40,
            compileUnits: [
              // One FAILED unit, deliberately the cheapest by sync time: it
              // must survive compaction on the failure rule alone.
              {
                id: 'weapon-skins:compile:skin_failed',
                lane: 'programs.compile',
                syncMs: 0,
                settledDurationMs: 0,
                failedAtMs: 1234,
                programDelta: 0,
                statusAtReveal: 'failed',
              },
              ...Array.from({ length: 40 }, (_, i) => ({
                id: `weapon-skins:compile:skin_${i}`,
                lane: 'programs.compile',
                syncMs: i,
                settledDurationMs: i * 2,
                failedAtMs: null,
                programDelta: 3,
                statusAtReveal: 'settled',
              })),
            ],
            prewarmPacing: {
              mode: 'adaptive',
              source: 'knobs',
              adaptive: {
                state: 'backoff',
                backoffCount: 4,
                noProgressCount: 1,
                transitions: Array.from({ length: 40 }, (_, i) => ({
                  atMs: i,
                  from: 'steady',
                  to: 'backoff',
                  reason: 'no-progress',
                })),
              },
            },
          },
          // Forces the compact path.
          oversized: 'x'.repeat(40_000),
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const raw = stored.rawSummary as Record<string, unknown>;
    expect(raw.truncated).toBe(true);
    const prewarm = raw.rendererPrewarmSummary as Record<string, unknown>;
    // Present, and on the compact path's own tighter sample.
    const units = prewarm.compileUnits as Record<string, unknown>[];
    expect(units).toHaveLength(6);
    // The SLOWEST five plus the failure, not the first six. Taking the first
    // would keep the cheapest units, and this block exists to answer "which
    // unit stalled" on exactly the heavy reports that reach it. Emitted in
    // ORIGINAL order, so a reader still sees a timeline rather than a ranking;
    // the failure leads here because it was posted first, not because it won.
    expect(units.map((unit) => unit.id)).toEqual([
      'weapon-skins:compile:skin_failed',
      'weapon-skins:compile:skin_35',
      'weapon-skins:compile:skin_36',
      'weapon-skins:compile:skin_37',
      'weapon-skins:compile:skin_38',
      'weapon-skins:compile:skin_39',
    ]);
    // Every retained member is field-shaped by the compact path, never copied
    // verbatim.
    expect(units[0]).toEqual({
      id: 'weapon-skins:compile:skin_failed',
      lane: 'programs.compile',
      // The field the ranking selects on rides along, or a reader cannot tell
      // WHICH of the six was the failure it was chosen for.
      failedAtMs: 1234,
      syncMs: 0,
      settledDurationMs: 0,
      programDelta: 0,
      statusAtReveal: 'failed',
    });
    expect(units[1].failedAtMs).toBeNull();
    const adaptive = (prewarm.prewarmPacing as Record<string, unknown>).adaptive as Record<
      string,
      unknown
    >;
    expect(adaptive.state).toBe('backoff');
    expect(adaptive.backoffCount).toBe(4);
    expect(adaptive.transitions as unknown[]).toHaveLength(6);
    // And the whole compacted report still fits, which is the point of the path.
    expect(Buffer.byteLength(JSON.stringify(raw))).toBeLessThan(16 * 1024);
  });

  it('stores the four browser longtask fields inside raw summary, bounded (#2479)', async () => {
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'longtask-fields',
        longTaskCount: 3,
        longTaskP95Ms: 90,
        rawSummary: {
          seconds: 30,
          browser: { longTasks: { totalMs: 260, avg: 86.7, max: 130, lastAge: 4200 } },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        longTaskCount: 3,
        longTaskP95Ms: 90,
        rawSummary: {
          seconds: 30,
          browser: { longTasks: { totalMs: 260, avg: 86.7, max: 130, lastAge: 4200 } },
        },
      }),
    );
  });

  it('clamps a hostile browser longtask block and drops a malformed one', async () => {
    const { LONG_TASK_RAW_MS_MAX, LONG_TASK_RAW_AGE_MS_MAX } = perfReportInternalsForTest;
    const hostile = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'longtask-hostile',
        rawSummary: {
          browser: {
            longTasks: { totalMs: 9e9, avg: -50, max: 1e12, lastAge: 9e12 },
          },
        },
      }),
      hostile,
    );

    expect(hostile.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSummary: {
          browser: {
            longTasks: {
              totalMs: LONG_TASK_RAW_MS_MAX,
              avg: 0,
              max: LONG_TASK_RAW_MS_MAX,
              lastAge: LONG_TASK_RAW_AGE_MS_MAX,
            },
          },
        },
      }),
    );

    vi.mocked(insertClientPerfReport).mockClear();
    const nonNumericAge = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'longtask-age-nan',
        rawSummary: {
          browser: { longTasks: { totalMs: 10, avg: 10, max: 10, lastAge: 'not-a-number' } },
        },
      }),
      nonNumericAge,
    );
    expect(nonNumericAge.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        // Falls back to the client's own "no long task recorded yet" sentinel,
        // not the age ceiling.
        rawSummary: { browser: { longTasks: { totalMs: 10, avg: 10, max: 10, lastAge: -1 } } },
      }),
    );

    vi.mocked(insertClientPerfReport).mockClear();
    const malformed = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'longtask-malformed',
        rawSummary: { seconds: 12, browser: { longTasks: 'not-an-object' } },
      }),
      malformed,
    );
    expect(malformed.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ rawSummary: { seconds: 12 } }),
    );

    vi.mocked(insertClientPerfReport).mockClear();
    const missing = fakeRes();
    await handlePerfReport(
      fakeReq({ sessionId: 'longtask-missing', rawSummary: { seconds: 5 } }),
      missing,
    );
    expect(missing.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ rawSummary: { seconds: 5 } }),
    );
  });

  it('preserves the browser longtask block when public raw summaries are truncated', async () => {
    const res = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'longtask-truncated',
        rawSummary: {
          seconds: 30,
          browser: { longTasks: { totalMs: 200, avg: 66.7, max: 150, lastAge: 900 } },
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
          browser: { longTasks: { totalMs: 200, avg: 66.7, max: 150, lastAge: 900 } },
        }),
      }),
    );
    const stored = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    expect((stored.rawSummary as Record<string, unknown>).oversized).toBeUndefined();
  });

  it('stores the GPU queue block bounded, and keeps it when raw summaries are truncated (#3167)', async () => {
    const {
      GPU_QUEUE_RAW_MS_MAX,
      GPU_QUEUE_RAW_AGE_MS_MAX,
      GPU_QUEUE_RAW_STALLS_MAX,
      GPU_QUEUE_RAW_SLOWEST_MAX,
      GPU_QUEUE_RAW_TAILS_MAX,
      GPU_QUEUE_RAW_LANES_MAX,
      GPU_QUEUE_RAW_WAITS_MAX,
      GPU_QUEUE_RAW_WINDOW_MS_MAX,
      PREWARM_RESUME_ENTRIES_MAX,
      PREWARM_RESUME_STATUSES,
      PREWARM_RESUME_LANES,
    } = perfReportInternalsForTest;
    // The frame-cost fields ride here too. This sanitizer REBUILDS the block
    // from a fixed key set rather than filtering it, so a client field the
    // allowlist omits is dropped silently: this round-trip is what catches that.
    const wedged = {
      units: 12,
      totalSyncMs: 240.5,
      worstSyncMs: 88.2,
      totalFrameGapMs: 910.6,
      worstFrameGapMs: 604.1,
      worstUnsharedFrameGapMs: 306.5,
      pending: 6,
      stallCount: 1,
      active: { label: 'wedged-compile', priority: 40, ageMs: 91_000 },
      waitingTails: [{ label: 'released-gate', priority: 30, ageMs: 5000 }],
      stalls: [{ label: 'wedged-compile', priority: 40, ageMs: 91_000, settled: false }],
      slowest: [
        {
          label: 'live-view-compile',
          priority: 30,
          syncMs: 88.2,
          wallMs: 120.4,
          waitMs: 812.7,
          frameGapMs: 306.5,
          sharedFrameGap: 1,
        },
      ],
      blockiest: [
        {
          label: 'preview:armory:skin',
          priority: 10,
          syncMs: 9.4,
          wallMs: 740.2,
          waitMs: 0,
          frameGapMs: 604.1,
          sharedFrameGap: 2,
        },
      ],
      // The interval arm, and the grant latency it exists to carry: a live-view
      // unit waiting 812 ms behind a cosmetic lane is the starvation shape the
      // preview pacing pilot must be judged against, and none of the cumulative
      // fields above can express it.
      worstWaitMs: 812.7,
      longestWaits: [
        {
          label: 'live-view-compile',
          priority: 30,
          waitMs: 812.7,
          blockedBy: 'preview:armory:skin',
          blockedByPriority: 10,
          waitedOnTailCap: true,
          tails: ['preview:armory:skin'],
        },
      ],
      recent: {
        windowMs: 30_000,
        units: 2,
        totalSyncMs: 97.6,
        totalFrameGapMs: 910.6,
        worstSyncMs: 88.2,
        worstFrameGapMs: 604.1,
        worstWaitMs: 812.7,
        lanes: [
          {
            priority: 30,
            units: 1,
            worstWaitMs: 812.7,
            totalWaitMs: 812.7,
            worstSyncMs: 88.2,
            worstFrameGapMs: 306.5,
          },
          {
            priority: 10,
            units: 1,
            worstWaitMs: 0,
            totalWaitMs: 0,
            worstSyncMs: 9.4,
            worstFrameGapMs: 604.1,
          },
        ],
      },
    };
    const stored = fakeRes();

    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-wedge',
        rawSummary: { seconds: 30, rendererGpuQueue: wedged },
      }),
      stored,
    );

    expect(stored.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ rawSummary: { seconds: 30, rendererGpuQueue: wedged } }),
    );

    // A hostile payload cannot inject an absurd age, an unbounded stall list,
    // or a novel-length label into the admin raw-report reader.
    vi.mocked(insertClientPerfReport).mockClear();
    const hostile = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-hostile',
        rawSummary: {
          rendererGpuQueue: {
            units: -5,
            totalSyncMs: 'nope',
            worstSyncMs: 9e12,
            pending: 1e12,
            stallCount: 3,
            active: { label: 'x'.repeat(400), priority: 9e9, ageMs: 9e12 },
            waitingTails: Array.from({ length: 9 }, () => ({
              label: 'y'.repeat(300),
              priority: -9e9,
              ageMs: -5,
            })),
            stalls: Array.from({ length: 40 }, () => ({
              label: 'wedged',
              priority: 40,
              ageMs: 9e12,
              settled: 'yes',
            })),
            slowest: 'not-an-array',
            blockiest: Array.from({ length: 20 }, () => ({
              label: 'b'.repeat(200),
              priority: 10,
              syncMs: 1,
              wallMs: 1,
              waitMs: 1,
              frameGapMs: 1,
              sharedFrameGap: 1,
            })),
            // Sized to overrun every bound (12 > 8 waits, 8 > 4 tails, 100 > 80
            // label chars) while staying under the request body cap.
            longestWaits: Array.from({ length: 12 }, () => ({
              label: 'z'.repeat(100),
              priority: 9e9,
              waitMs: 9e12,
              blockedBy: 42,
              blockedByPriority: 'nope',
              waitedOnTailCap: 'yes',
              tails: Array.from({ length: 8 }, () => 'w'.repeat(100)),
            })),
            recent: {
              windowMs: 9e12,
              units: -3,
              worstWaitMs: 9e12,
              lanes: Array.from({ length: 30 }, (_unused, index) => ({
                priority: index,
                units: 9e12,
                worstWaitMs: 'nope',
              })),
            },
          },
        },
      }),
      hostile,
    );
    expect(hostile.statusCode).toBe(200);
    const hostileRow = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const hostileQueue = (hostileRow.rawSummary as Record<string, Record<string, unknown>>)
      .rendererGpuQueue;
    expect(hostileQueue).toMatchObject({
      units: 0,
      totalSyncMs: 0,
      worstSyncMs: GPU_QUEUE_RAW_MS_MAX,
      stallCount: 3,
      active: { label: 'x'.repeat(80), priority: 1000, ageMs: GPU_QUEUE_RAW_AGE_MS_MAX },
      slowest: [],
    });
    expect(hostileQueue.stalls).toHaveLength(GPU_QUEUE_RAW_STALLS_MAX);
    expect((hostileQueue.stalls as Record<string, unknown>[])[0].ageMs).toBe(
      GPU_QUEUE_RAW_AGE_MS_MAX,
    );
    // Pin the bound's VALUE too: comparing output length against the same
    // constant the sanitizer slices with would pass at any value.
    expect(GPU_QUEUE_RAW_TAILS_MAX).toBe(4);
    expect(hostileQueue.waitingTails).toHaveLength(GPU_QUEUE_RAW_TAILS_MAX);
    expect((hostileQueue.waitingTails as Record<string, unknown>[])[0]).toEqual({
      label: 'y'.repeat(80),
      priority: -1000,
      ageMs: 0,
    });
    // The interval block is rebuilt from a fixed key set like its parent, so a
    // hostile payload cannot turn the fixed-size lane readout into a list.
    const hostileRecent = hostileQueue.recent as Record<string, unknown>;
    expect(hostileRecent.units).toBe(0);
    // Pinned to the LITERAL as well: comparing the output against the constant
    // the sanitizer clamps with passes at any value, including one that removes
    // the bound entirely.
    expect(GPU_QUEUE_RAW_WINDOW_MS_MAX).toBe(600_000);
    expect(GPU_QUEUE_RAW_AGE_MS_MAX).toBe(1_800_000);
    expect(hostileRecent.windowMs).toBe(GPU_QUEUE_RAW_WINDOW_MS_MAX);
    expect(hostileRecent.worstWaitMs).toBe(GPU_QUEUE_RAW_AGE_MS_MAX);
    // The wait ranking is bounded and shaped like everything else here. Note
    // blockedBy is NULLABLE by design: a wait with nothing running points at the
    // tail cap, and coercing that to a string would invent a culprit.
    expect(hostileQueue.blockiest).toHaveLength(GPU_QUEUE_RAW_SLOWEST_MAX);
    expect(GPU_QUEUE_RAW_SLOWEST_MAX).toBe(8);
    expect(GPU_QUEUE_RAW_WAITS_MAX).toBe(8);
    expect(hostileQueue.longestWaits).toHaveLength(GPU_QUEUE_RAW_WAITS_MAX);
    const hostileWait = (hostileQueue.longestWaits as Record<string, unknown>[])[0];
    expect(hostileWait.label).toBe('z'.repeat(80));
    expect(hostileWait.waitMs).toBe(GPU_QUEUE_RAW_AGE_MS_MAX);
    expect(hostileWait.blockedBy).toBeNull();
    expect(hostileWait.blockedByPriority).toBe(0);
    expect(hostileWait.waitedOnTailCap).toBe(true);
    expect(hostileWait.tails).toHaveLength(GPU_QUEUE_RAW_TAILS_MAX);
    expect(GPU_QUEUE_RAW_LANES_MAX).toBe(8);
    expect(hostileRecent.lanes).toHaveLength(GPU_QUEUE_RAW_LANES_MAX);
    expect((hostileRecent.lanes as Record<string, unknown>[])[0].worstWaitMs).toBe(0);
    // A block missing entirely is still shaped, never absent: a reader that
    // has to feature-detect the interval arm cannot compare two reports.
    expect(hostileQueue.worstWaitMs).toBe(0);

    // The resume block, on the NORMAL ingest path. It had no test at all: the
    // claim "every new field is clamped" was unproven for this whole function,
    // and its sanitizer was only reachable from the oversized-report fallback,
    // so a hostile client could store unbounded lists on every ordinary report.
    vi.mocked(insertClientPerfReport).mockClear();
    const hostileResume = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'prewarm-resume-hostile',
        rawSummary: {
          rendererPrewarmSummary: {
            manifestPlanned: 30,
            resume: {
              status: 'totally-made-up',
              plannedEntries: 9e9,
              plannedUnits: -4,
              startedUnits: 'nope',
              failedUnits: 9e12,
              failedUnitIds: Array.from({ length: 40 }, () => 'f'.repeat(400)),
              entries: Array.from({ length: 40 }, (_unused, index) => ({
                id: 'e'.repeat(200),
                lane: index === 0 ? 'debt' : 'invented-lane',
                planned: 9e12,
                started: -1,
                failed: 'many',
              })),
            },
          },
        },
      }),
      hostileResume,
    );
    expect(hostileResume.statusCode).toBe(200);
    const resumeRow = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const storedResume = (
      (resumeRow.rawSummary as Record<string, Record<string, unknown>>)
        .rendererPrewarmSummary as Record<string, unknown>
    ).resume as Record<string, unknown>;
    expect(PREWARM_RESUME_ENTRIES_MAX).toBe(24);
    expect(storedResume.entries).toHaveLength(PREWARM_RESUME_ENTRIES_MAX);
    expect(storedResume.failedUnitIds).toHaveLength(PREWARM_RESUME_ENTRIES_MAX);
    expect((storedResume.failedUnitIds as string[])[0]).toHaveLength(160);
    // status and lane are enums, so an invented value falls back rather than
    // storing 16 characters a reader would have to guess the meaning of.
    expect(storedResume.status).toBe('none');
    expect(PREWARM_RESUME_STATUSES).toContain('done');
    const storedEntries = storedResume.entries as Record<string, unknown>[];
    expect(storedEntries[0]).toMatchObject({ id: 'e'.repeat(80), lane: 'debt' });
    expect(storedEntries[1].lane).toBe('cosmetic');
    expect(storedEntries[0].planned).toBe(100_000);
    expect(storedEntries[0].started).toBe(0);
    expect(PREWARM_RESUME_LANES).toEqual(['debt', 'cosmetic']);

    // The SAME clamp on the legacy `rendererPrewarm` key. The current client
    // sends only the summary, but a client older than that change still posts
    // the live stats object, whose resume block rides a getter, and any token
    // holder can post the key whatever their client does. Sanitizing only the
    // summary left the twin as an unclamped way into the same storage.
    vi.mocked(insertClientPerfReport).mockClear();
    const legacyTwin = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'prewarm-legacy-twin-hostile',
        rawSummary: {
          rendererPrewarm: {
            manifestPlanned: 30,
            resume: {
              status: 'totally-made-up',
              plannedUnits: 9e12,
              failedUnitIds: Array.from({ length: 40 }, () => 'f'.repeat(400)),
              entries: Array.from({ length: 40 }, () => ({
                id: 'e'.repeat(200),
                lane: 'invented-lane',
                planned: 9e12,
              })),
            },
          },
        },
      }),
      legacyTwin,
    );
    expect(legacyTwin.statusCode).toBe(200);
    const twinRow = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const storedTwin = (
      (twinRow.rawSummary as Record<string, Record<string, unknown>>).rendererPrewarm as Record<
        string,
        unknown
      >
    ).resume as Record<string, unknown>;
    expect(storedTwin.status).toBe('none');
    expect(storedTwin.plannedUnits).toBe(100_000);
    expect(storedTwin.entries).toHaveLength(PREWARM_RESUME_ENTRIES_MAX);
    expect(storedTwin.failedUnitIds).toHaveLength(PREWARM_RESUME_ENTRIES_MAX);
    expect((storedTwin.failedUnitIds as string[])[0]).toHaveLength(160);
    expect((storedTwin.entries as Record<string, unknown>[])[0]).toMatchObject({
      id: 'e'.repeat(80),
      lane: 'cosmetic',
      planned: 100_000,
    });

    // A malformed block is dropped rather than stored half-shaped.
    vi.mocked(insertClientPerfReport).mockClear();
    const malformed = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-malformed',
        rawSummary: { seconds: 12, rendererGpuQueue: 'not-an-object' },
      }),
      malformed,
    );
    expect(malformed.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({ rawSummary: { seconds: 12 } }),
    );

    // The compact path keeps it: a wedge is exactly what an oversized report
    // must still carry.
    vi.mocked(insertClientPerfReport).mockClear();
    const truncated = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-truncated',
        rawSummary: { seconds: 30, rendererGpuQueue: wedged, oversized: 'x'.repeat(40_000) },
      }),
      truncated,
    );
    expect(truncated.statusCode).toBe(200);
    expect(insertClientPerfReport).toHaveBeenCalledWith(
      expect.objectContaining({
        rawSummary: expect.objectContaining({ truncated: true, rendererGpuQueue: wedged }),
      }),
    );

    // Back-compat: an old client's block has no waitingTails key at all; it
    // stores with an explicit empty list, everything else untouched.
    vi.mocked(insertClientPerfReport).mockClear();
    const legacy = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-legacy',
        rawSummary: {
          rendererGpuQueue: {
            units: 3,
            totalSyncMs: 12.5,
            worstSyncMs: 8,
            pending: 1,
            stallCount: 0,
            active: null,
            stalls: [],
            slowest: [],
          },
        },
      }),
      legacy,
    );
    expect(legacy.statusCode).toBe(200);
    const legacyRow = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const legacyQueue = (legacyRow.rawSummary as Record<string, Record<string, unknown>>)
      .rendererGpuQueue;
    expect(legacyQueue.waitingTails).toEqual([]);
    expect(legacyQueue.units).toBe(3);

    // Junk entries are dropped by the record filter, real ones kept.
    vi.mocked(insertClientPerfReport).mockClear();
    const junk = fakeRes();
    await handlePerfReport(
      fakeReq({
        sessionId: 'gpu-queue-junk-tails',
        rawSummary: {
          rendererGpuQueue: {
            units: 1,
            totalSyncMs: 1,
            worstSyncMs: 1,
            pending: 0,
            stallCount: 0,
            active: null,
            waitingTails: [null, 'junk', { label: 'real-gate', priority: 30, ageMs: 100 }],
            stalls: [],
            slowest: [],
          },
        },
      }),
      junk,
    );
    expect(junk.statusCode).toBe(200);
    const junkRow = vi.mocked(insertClientPerfReport).mock.calls.at(-1)![0];
    const junkQueue = (junkRow.rawSummary as Record<string, Record<string, unknown>>)
      .rendererGpuQueue;
    expect(junkQueue.waitingTails).toEqual([{ label: 'real-gate', priority: 30, ageMs: 100 }]);
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
