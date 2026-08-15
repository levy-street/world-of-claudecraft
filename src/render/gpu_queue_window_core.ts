// Bounded RECENT-INTERVAL view over the background GPU queue's completed units,
// plus the per-priority breakdown the queue's scalars cannot carry.
//
// Why this exists, stated as the defect it removes. Every number
// background_gpu_queue.ts reports is either a lifetime counter or a lifetime
// MAXIMUM, and a maximum only moves on a record. So two arms of a pacing
// experiment can only be compared on "who set the higher lifetime record", and
// consecutive reports from one session cannot be differenced into per-interval
// values at all: the `slowest` and `blockiest` leaderboards never age out
// either, so a boot-time unit holds a slot for the rest of the session and a
// later report's list is not "what happened recently". A pacing change is
// judged on the interval it ran in, so it needs an interval readout.
//
// The second half is grant latency BY PRIORITY. The queue's whole promise is
// that a cosmetic lane never delays an actionable one, and today nothing
// measures the wait between enqueue and start, which is the only place that
// promise can break. A per-lane worst wait is what turns "the preview pilot
// must never delay ACTIONABLE_VIEW" from an intention into a check.
//
// Observation only: this core decides nothing and paces nothing. It is
// deliberately clock-free (every entry point takes the timestamp) so a test
// drives it with plain numbers and the sim-purity rules hold for free.
//
// Boundedness is structural, not a policy: lane rows are DERIVED from the
// retained samples on read rather than accumulated in a map, so lane
// cardinality can never exceed the sample cap however many distinct priority
// values callers invent.

/** One completed unit, reduced to what an interval readout needs. */
export interface GpuQueueWindowSample {
  priority: number;
  /** Enqueue to start: the grant latency a lane's units waited through. */
  waitMs: number;
  syncMs: number;
  frameGapMs: number;
  /** When the unit SETTLED, on the caller's clock. Settle time, not start time,
   *  and that choice is load-bearing twice over. It is the honest interval
   *  semantic ("what completed in the last N ms": a released tail that lived for
   *  seconds and finished just now DID just cost the frame). And because records
   *  are pushed at settle, it is monotonic in arrival order, which is what makes
   *  the prune below a correct prefix walk. Keying on START time would not be:
   *  a released tail can settle after a unit that started later, so the retained
   *  list would be unsorted and a prefix walk would stop at the first young
   *  sample and strand older ones behind it. */
  settledAtMs: number;
}

/** One priority lane's slice of the window. */
export interface GpuQueueLaneStat {
  priority: number;
  units: number;
  worstWaitMs: number;
  totalWaitMs: number;
  worstSyncMs: number;
  worstFrameGapMs: number;
}

export interface GpuQueueWindowStats {
  /** The interval these numbers cover, so a reader never has to guess whether a
   *  field is windowed or cumulative. */
  windowMs: number;
  /** Samples retained, i.e. units that completed inside the window. Zero after
   *  a quiet interval, which is itself the signal that the lane went idle. */
  units: number;
  totalSyncMs: number;
  totalFrameGapMs: number;
  worstSyncMs: number;
  worstFrameGapMs: number;
  worstWaitMs: number;
  /** One row per priority seen in the window, highest priority first. */
  lanes: GpuQueueLaneStat[];
}

export interface GpuQueueWindow {
  record(sample: GpuQueueWindowSample): void;
  stats(nowMs: number): GpuQueueWindowStats;
}

const DEFAULT_WINDOW_MS = 30_000;
// The cap is the memory bound; the window is the semantic one. 240 covers a
// busy 30 s of queue traffic and costs a few kilobytes, and a burst that
// overruns it drops its OLDEST samples, which is the same direction the window
// prunes in.
const DEFAULT_SAMPLE_LIMIT = 240;

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function createGpuQueueWindow(opts?: {
  windowMs?: number;
  sampleLimit?: number;
}): GpuQueueWindow {
  const windowMs = Math.max(1, opts?.windowMs ?? DEFAULT_WINDOW_MS);
  const sampleLimit = Math.max(1, opts?.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
  const samples: GpuQueueWindowSample[] = [];

  const prune = (nowMs: number): void => {
    const cutoff = nowMs - windowMs;
    let drop = 0;
    while (drop < samples.length && samples[drop].settledAtMs < cutoff) drop++;
    if (drop > 0) samples.splice(0, drop);
    if (samples.length > sampleLimit) samples.splice(0, samples.length - sampleLimit);
  };

  return {
    record(sample: GpuQueueWindowSample): void {
      samples.push(sample);
      // Pruned against the newest sample rather than a live clock, so recording
      // stays clock-free and the cap holds even in a session nothing ever reads.
      prune(sample.settledAtMs);
    },
    stats(nowMs: number): GpuQueueWindowStats {
      prune(nowMs);
      const lanes = new Map<number, GpuQueueLaneStat>();
      let totalSyncMs = 0;
      let totalFrameGapMs = 0;
      let worstSyncMs = 0;
      let worstFrameGapMs = 0;
      let worstWaitMs = 0;
      for (const sample of samples) {
        totalSyncMs += sample.syncMs;
        totalFrameGapMs += sample.frameGapMs;
        if (sample.syncMs > worstSyncMs) worstSyncMs = sample.syncMs;
        if (sample.frameGapMs > worstFrameGapMs) worstFrameGapMs = sample.frameGapMs;
        if (sample.waitMs > worstWaitMs) worstWaitMs = sample.waitMs;
        let lane = lanes.get(sample.priority);
        if (!lane) {
          lane = {
            priority: sample.priority,
            units: 0,
            worstWaitMs: 0,
            totalWaitMs: 0,
            worstSyncMs: 0,
            worstFrameGapMs: 0,
          };
          lanes.set(sample.priority, lane);
        }
        lane.units++;
        lane.totalWaitMs += sample.waitMs;
        if (sample.waitMs > lane.worstWaitMs) lane.worstWaitMs = sample.waitMs;
        if (sample.syncMs > lane.worstSyncMs) lane.worstSyncMs = sample.syncMs;
        if (sample.frameGapMs > lane.worstFrameGapMs) lane.worstFrameGapMs = sample.frameGapMs;
      }
      return {
        windowMs,
        units: samples.length,
        totalSyncMs: round1(totalSyncMs),
        totalFrameGapMs: round1(totalFrameGapMs),
        worstSyncMs: round1(worstSyncMs),
        worstFrameGapMs: round1(worstFrameGapMs),
        worstWaitMs: round1(worstWaitMs),
        lanes: [...lanes.values()]
          .sort((a, b) => b.priority - a.priority)
          .map((lane) => ({
            ...lane,
            worstWaitMs: round1(lane.worstWaitMs),
            totalWaitMs: round1(lane.totalWaitMs),
            worstSyncMs: round1(lane.worstSyncMs),
            worstFrameGapMs: round1(lane.worstFrameGapMs),
          })),
      };
    },
  };
}
