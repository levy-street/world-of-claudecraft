// Always-on client net-pipeline counters (finding 20's net half; rulings R8, R9).
// JSON.parse and applySnapshot run synchronously OUTSIDE every other timing bucket,
// so ClientWorld records each snapshot frame here and src/main.ts drains the summary
// into the perf monitor once per animation frame. The module stays bucket-agnostic:
// src/net never imports src/game, main.ts is the junction (R8). Clock-injected:
// every timestamp rides in through call arguments; this module never reads
// performance.now itself.

export interface NetPipelineSnapshotSample {
  nowMs: number;
  // UTF-16 raw.length proxy, deliberately NOT a TextEncoder byte count (R9):
  // close enough for fleet aggregates and free on the hot 20 Hz path.
  approxBytes: number;
  parseMs: number;
  applyMs: number;
  entCount: number;
  keepCount: number;
  // Raw inter-arrival gap, read BEFORE the online (5,500) EWMA filter; null on
  // the first snapshot after a connect or reconnect (no prior arrival to gap to).
  rawGapMs: number | null;
}

export interface NetPipelineStatDigest {
  // Cumulative observations since construction; the percentiles cover only the
  // most recent RING_CAPACITY observations (bounded memory by design).
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface NetPipelineSummary {
  snapshots: number;
  resets: number;
  approxBytesTotal: number;
  entCountTotal: number;
  keepCountTotal: number;
  parseMs: NetPipelineStatDigest;
  applyMs: NetPipelineStatDigest;
  gapMs: NetPipelineStatDigest;
  // How many snapshots were applied between consecutive animation frames:
  // 0, 1, or a 2+ burst after a stall (R9 buckets). r0 DOMINATING is the
  // healthy steady state whenever the display outpaces the 20 Hz snapshot
  // rate (at 60 Hz about two thirds of frames are r0); starvation shows as
  // the gapMs digest stretching plus r2/r3plus bursts, not as r0 alone.
  snapshotsPerRaf: { r0: number; r1: number; r2: number; r3plus: number };
}

const RING_CAPACITY = 1024;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

class BoundedRing {
  private readonly values: number[] = [];
  private next = 0;
  private total = 0;
  // The digest is recomputed at most once per push (20 Hz), not per summary()
  // call (per frame): the sort cost stays off the render loop.
  private digestCache: NetPipelineStatDigest | null = null;

  push(v: number): void {
    this.total++;
    if (this.values.length < RING_CAPACITY) {
      this.values.push(v);
    } else {
      this.values[this.next] = v;
      this.next = (this.next + 1) % RING_CAPACITY;
    }
    this.digestCache = null;
  }

  digest(): NetPipelineStatDigest {
    if (this.digestCache === null) {
      const sorted = [...this.values].sort((a, b) => a - b);
      this.digestCache = {
        count: this.total,
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        max: round(sorted.length > 0 ? sorted[sorted.length - 1] : 0),
      };
    }
    return this.digestCache;
  }
}

export class NetPipelineStats {
  private readonly parseRing = new BoundedRing();
  private readonly applyRing = new BoundedRing();
  private readonly gapRing = new BoundedRing();
  private snapshots = 0;
  private resets = 0;
  private approxBytesTotal = 0;
  private entCountTotal = 0;
  private keepCountTotal = 0;
  private pendingSinceRaf = 0;
  private histogram = { r0: 0, r1: 0, r2: 0, r3plus: 0 };
  // Injected-clock bookkeeping, public for dev-console diagnostics only; the
  // summary record stays fixed-size without them.
  lastSnapshotAtMs = 0;
  lastRafAtMs = 0;

  recordSnapshot(sample: NetPipelineSnapshotSample): void {
    this.snapshots++;
    this.pendingSinceRaf++;
    this.approxBytesTotal += sample.approxBytes;
    this.entCountTotal += sample.entCount;
    this.keepCountTotal += sample.keepCount;
    this.parseRing.push(sample.parseMs);
    this.applyRing.push(sample.applyMs);
    // The raw ring keeps every gap, including the outliers the (5,500) EWMA
    // filter deliberately eats; those outliers ARE the signal here.
    if (sample.rawGapMs !== null) this.gapRing.push(sample.rawGapMs);
    this.lastSnapshotAtMs = sample.nowMs;
  }

  onAnimationFrame(nowMs: number): void {
    const applied = this.pendingSinceRaf;
    this.pendingSinceRaf = 0;
    this.lastRafAtMs = nowMs;
    if (applied === 0) this.histogram.r0++;
    else if (applied === 1) this.histogram.r1++;
    else if (applied === 2) this.histogram.r2++;
    else this.histogram.r3plus++;
  }

  noteReset(): void {
    // A reconnect got a fresh transport: count it and drop the pending per-rAF
    // tally so the pre-drop backlog never folds into a post-reconnect frame.
    // The aggregate counters and rings survive; they span the whole session.
    this.resets++;
    this.pendingSinceRaf = 0;
  }

  noteVisibilityChange(): void {
    // rAF pauses in a hidden tab while snapshots keep arriving; folding that
    // backlog into the first foreground frame would fake a 3plus burst (R9).
    this.pendingSinceRaf = 0;
  }

  summary(): NetPipelineSummary {
    return {
      snapshots: this.snapshots,
      resets: this.resets,
      approxBytesTotal: this.approxBytesTotal,
      entCountTotal: this.entCountTotal,
      keepCountTotal: this.keepCountTotal,
      parseMs: this.parseRing.digest(),
      applyMs: this.applyRing.digest(),
      gapMs: this.gapRing.digest(),
      snapshotsPerRaf: { ...this.histogram },
    };
  }
}

export function createNetPipelineStats(): NetPipelineStats {
  return new NetPipelineStats();
}
