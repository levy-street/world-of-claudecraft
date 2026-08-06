import { describe, expect, it, vi } from 'vitest';
import {
  createNetPipelineStats,
  type NetPipelineSnapshotSample,
} from '../src/net/net_pipeline_stats';
import { bareClient } from './helpers/bare_client';

function sample(overrides: Partial<NetPipelineSnapshotSample> = {}): NetPipelineSnapshotSample {
  return {
    nowMs: 0,
    approxBytes: 0,
    parseMs: 0,
    applyMs: 0,
    entCount: 0,
    keepCount: 0,
    rawGapMs: null,
    ...overrides,
  };
}

describe('net pipeline stats module', () => {
  it('sums hand-computed totals and serves p50 p95 max digests over the rings', () => {
    const stats = createNetPipelineStats();
    stats.recordSnapshot(
      sample({ nowMs: 100, approxBytes: 100, parseMs: 2, applyMs: 1, entCount: 3, keepCount: 5 }),
    );
    stats.recordSnapshot(
      sample({
        nowMs: 150,
        approxBytes: 250,
        parseMs: 4,
        applyMs: 3,
        entCount: 2,
        keepCount: 0,
        rawGapMs: 50,
      }),
    );
    stats.recordSnapshot(
      sample({
        nowMs: 1050,
        approxBytes: 400,
        parseMs: 10,
        applyMs: 5,
        entCount: 1,
        keepCount: 2,
        rawGapMs: 900,
      }),
    );

    const s = stats.summary();
    expect(s.snapshots).toBe(3);
    expect(s.resets).toBe(0);
    expect(s.approxBytesTotal).toBe(750);
    expect(s.entCountTotal).toBe(6);
    expect(s.keepCountTotal).toBe(7);
    expect(s.parseMs).toEqual({ count: 3, p50: 4, p95: 10, max: 10 });
    expect(s.applyMs).toEqual({ count: 3, p50: 3, p95: 5, max: 5 });
    expect(s.gapMs).toEqual({ count: 2, p50: 50, p95: 900, max: 900 });
  });

  it('retains a 900 ms raw gap that the online EWMA filter would have eaten', () => {
    // online.ts feeds its snapInterval EWMA only gaps inside (5, 500); the raw
    // ring must keep the stall outliers outside that window, they ARE the signal.
    const stats = createNetPipelineStats();
    stats.recordSnapshot(sample({ nowMs: 100 }));
    stats.recordSnapshot(sample({ nowMs: 1000, rawGapMs: 900 }));
    expect(stats.summary().gapMs.count).toBe(1);
    expect(stats.summary().gapMs.max).toBe(900);
  });

  it('skips the gap ring on a null raw gap instead of recording a zero', () => {
    const stats = createNetPipelineStats();
    stats.recordSnapshot(sample({ rawGapMs: null }));
    expect(stats.summary().gapMs.count).toBe(0);
    expect(stats.summary().gapMs.max).toBe(0);
    expect(stats.summary().snapshots).toBe(1);
  });

  it('folds applied-since-last-frame counts into the 0 1 2 3plus histogram buckets', () => {
    const stats = createNetPipelineStats();
    stats.recordSnapshot(sample());
    stats.recordSnapshot(sample());
    stats.onAnimationFrame(16);
    expect(stats.summary().snapshotsPerRaf).toEqual({ r0: 0, r1: 0, r2: 1, r3plus: 0 });

    stats.onAnimationFrame(32);
    expect(stats.summary().snapshotsPerRaf).toEqual({ r0: 1, r1: 0, r2: 1, r3plus: 0 });

    stats.recordSnapshot(sample());
    stats.onAnimationFrame(48);
    expect(stats.summary().snapshotsPerRaf).toEqual({ r0: 1, r1: 1, r2: 1, r3plus: 0 });

    for (let i = 0; i < 4; i++) stats.recordSnapshot(sample());
    stats.onAnimationFrame(64);
    expect(stats.summary().snapshotsPerRaf).toEqual({ r0: 1, r1: 1, r2: 1, r3plus: 1 });
  });

  it('counts a reset and clears the pending per-frame tally without wiping the totals', () => {
    const stats = createNetPipelineStats();
    stats.recordSnapshot(sample({ approxBytes: 10 }));
    stats.recordSnapshot(sample({ approxBytes: 20 }));
    stats.noteReset();
    stats.onAnimationFrame(16);

    const s = stats.summary();
    expect(s.resets).toBe(1);
    // the two pre-reset applies must NOT fold into the post-reset frame
    expect(s.snapshotsPerRaf).toEqual({ r0: 1, r1: 0, r2: 0, r3plus: 0 });
    // the aggregate counters span the whole session
    expect(s.snapshots).toBe(2);
    expect(s.approxBytesTotal).toBe(30);
  });

  it('clears the pending tally on a visibility flip so the backlog never folds into one frame', () => {
    const stats = createNetPipelineStats();
    for (let i = 0; i < 3; i++) stats.recordSnapshot(sample());
    stats.noteVisibilityChange();
    stats.onAnimationFrame(16);
    const s = stats.summary();
    expect(s.snapshotsPerRaf).toEqual({ r0: 1, r1: 0, r2: 0, r3plus: 0 });
    expect(s.snapshots).toBe(3);
  });

  it('bounds each ring at 1024 recent samples while the digest count stays cumulative', () => {
    const stats = createNetPipelineStats();
    stats.recordSnapshot(sample({ rawGapMs: 999 }));
    for (let i = 0; i < 1023; i++) stats.recordSnapshot(sample({ rawGapMs: 1 }));
    expect(stats.summary().gapMs.count).toBe(1024);
    expect(stats.summary().gapMs.max).toBe(999);

    // one more push evicts the oldest (the 999) from the bounded ring, while
    // the cumulative count keeps growing past the capacity
    stats.recordSnapshot(sample({ rawGapMs: 1 }));
    expect(stats.summary().gapMs.count).toBe(1025);
    expect(stats.summary().gapMs.max).toBe(1);
  });
});

function wirePlayer(id: number, name: string) {
  return {
    id,
    k: 'player',
    tid: 'warrior',
    nm: name,
    lv: 10,
    x: 1,
    y: 0,
    z: 1,
    f: 0,
    hp: 100,
    mhp: 100,
  };
}

describe('bare client integration through the real onMessage path', () => {
  it('records two snapshot frames with computed byte and count sums via the lazy holder', () => {
    const client = bareClient(1);
    const internals = client as unknown as { onMessage(raw: string): void };
    const raw1 = JSON.stringify({ t: 'snap', ents: [wirePlayer(2, 'Bud')], keep: [] });
    const raw2 = JSON.stringify({
      t: 'snap',
      ents: [wirePlayer(2, 'Bud'), wirePlayer(3, 'Pal')],
      keep: [2],
    });

    internals.onMessage(raw1);
    internals.onMessage(raw2);

    const s = client.netPipeline().summary();
    expect(s.snapshots).toBe(2);
    expect(s.approxBytesTotal).toBe(raw1.length + raw2.length);
    expect(s.entCountTotal).toBe(3);
    expect(s.keepCountTotal).toBe(1);
    expect(s.parseMs.count).toBe(2);
    expect(s.applyMs.count).toBe(2);
    // the first frame has no prior arrival: only the second records a raw gap
    expect(s.gapMs.count).toBe(1);
    expect(s.gapMs.max).toBeGreaterThanOrEqual(0);
    // the mirrored world really applied the frames, this was not a stub path
    expect(client.entities.get(2)?.name).toBe('Bud');
  });

  it('reads the raw gap BEFORE applySnapshot moves lastSnapAt so a stall gap survives', () => {
    // applySnapshot sets lastSnapAt = now; if the raw-gap read moved below the
    // apply call, every recorded gap would collapse to about zero and the
    // stall outliers (the whole point of the raw ring) would vanish.
    //
    // performance.now() starts near ZERO in a fresh vitest worker, and the
    // recorder reads lastSnapAt <= 0 as the no-prior-snapshot sentinel, so the
    // rewind below must land STRICTLY positive. Fake performance.now() (same
    // idiom as tests/interest.test.ts) so the precondition is instant and
    // exact instead of a real sleep loop racing libuv's millisecond-truncated
    // timer clock.
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const REWIND_MS = 900;
      const SENTINEL_MARGIN_MS = 300;
      vi.advanceTimersByTime(REWIND_MS + SENTINEL_MARGIN_MS);

      const client = bareClient(1);
      const internals = client as unknown as { onMessage(raw: string): void };
      const rewound = performance.now() - REWIND_MS;
      // Pin the precondition itself, so a future regression here names the clock
      // instead of the recorder the two assertions below are actually about.
      expect(rewound).toBeGreaterThan(0);
      (client as any).lastSnapAt = rewound;
      internals.onMessage(JSON.stringify({ t: 'snap', ents: [wirePlayer(2, 'Bud')], keep: [] }));

      const s = client.netPipeline().summary();
      expect(s.gapMs.count).toBe(1);
      expect(s.gapMs.max).toBeGreaterThanOrEqual(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts an omitted keep list as zero keeps instead of failing', () => {
    const client = bareClient(1);
    const internals = client as unknown as { onMessage(raw: string): void };
    internals.onMessage(JSON.stringify({ t: 'snap', ents: [wirePlayer(2, 'Bud')] }));

    const s = client.netPipeline().summary();
    expect(s.snapshots).toBe(1);
    expect(s.entCountTotal).toBe(1);
    expect(s.keepCountTotal).toBe(0);
  });

  it('fires noteReset from the hello reconnect arm and restarts the raw gap baseline', () => {
    const client = bareClient(1);
    const internals = client as unknown as { onMessage(raw: string): void };
    internals.onMessage(JSON.stringify({ t: 'snap', ents: [wirePlayer(2, 'Bud')], keep: [] }));
    internals.onMessage(JSON.stringify({ t: 'snap', ents: [], keep: [2] }));
    expect(client.netPipeline().summary().gapMs.count).toBe(1);

    (client as any).reconnectAttempts = 1;
    internals.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    internals.onMessage(JSON.stringify({ t: 'snap', ents: [wirePlayer(2, 'Bud')], keep: [] }));

    const s = client.netPipeline().summary();
    expect(s.resets).toBe(1);
    expect(s.snapshots).toBe(3);
    // hello zeroed lastSnapAt, so the post-reconnect snapshot records no gap
    expect(s.gapMs.count).toBe(1);
  });
});
