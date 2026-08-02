// GPU frame/section timing over EXT_disjoint_timer_query_webgl2, the pure core.
// The adapter (gpu_timer.ts) probes the extension and owns the Three-facing
// marker passes; this module is the query-ring state machine, kept GL-object
// agnostic (structural interfaces) so a Vitest drives it with a fake context.
//
// Model: a frame opens with beginFrame(), split(label) closes the running
// TIME_ELAPSED query (if any) and opens the next labeled one, endFrame()
// closes the frame. Timer queries MUST NOT nest, so sequential splits are the
// only shape this core allows by construction. Results land asynchronously a
// few frames later; beginFrame() polls non-blockingly and folds resolved
// frames into the aggregation rings. A disjoint event (GPU clock anomaly:
// power state change, TDR, tab switch) invalidates every in-flight query, so
// those frames are dropped rather than recorded wrong.

/** The subset of WebGL2RenderingContext the timer touches (structural). */
export interface GpuTimerGl {
  createQuery(): object | null;
  deleteQuery(query: object): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, pname: number): unknown;
  getParameter(pname: number): unknown;
}

/** The two constants EXT_disjoint_timer_query_webgl2 exposes. */
export interface GpuTimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

// Core WebGL2 query constants (stable spec values, not extension-specific).
export const QUERY_RESULT_AVAILABLE = 0x8867;
export const QUERY_RESULT = 0x8866;

/** Per-section aggregate over the retained window. */
export interface GpuSectionStats {
  label: string;
  avgMs: number;
  p95Ms: number;
  samples: number;
}

export interface GpuTimerStats {
  /** Resolved whole-frame GPU totals over the retained window. */
  frames: number;
  frameAvgMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaxMs: number;
  sections: GpuSectionStats[];
  /** GPU clock disjoint events seen (each drops the in-flight frames). */
  disjoints: number;
  /** Frames that could not open every section because the pool ran dry. */
  starvedFrames: number;
}

export interface GpuSectionTimer {
  beginFrame(): void;
  /** Close the running section (if any) and open `label`. No-op outside a frame. */
  split(label: string): void;
  endFrame(): void;
  stats(): GpuTimerStats;
  /** Drop every in-flight query and retained sample (context restore). */
  reset(): void;
  dispose(): void;
}

// Pool and window sizing. A frame uses one query per section (scene plus up
// to five post passes today); results resolve within a few frames on every
// driver measured, so 48 pooled queries rides out a deep pipeline without
// unbounded allocation. The stats window holds four seconds at 60 fps, wide
// enough for stable p95s at the overlay's 1 Hz cadence.
const QUERY_POOL_CAP = 48;
const FRAME_RING_CAP = 240;
const SECTION_RING_CAP = 240;
const MAX_SECTIONS = 8;
const NS_PER_MS = 1e6;

interface PendingSection {
  query: object;
  label: string;
  ns: number;
  resolved: boolean;
}

interface PendingFrame {
  sections: PendingSection[];
  starved: boolean;
}

class SampleRing {
  private readonly values: Float32Array;
  private next = 0;
  private filled = 0;

  constructor(capacity: number) {
    this.values = new Float32Array(capacity);
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    if (this.filled < this.values.length) this.filled++;
  }

  get count(): number {
    return this.filled;
  }

  /** Copies the live samples into a sorted scratch array (stats cadence only). */
  sorted(): number[] {
    const out: number[] = new Array(this.filled);
    for (let i = 0; i < this.filled; i++) out[i] = this.values[i];
    out.sort((a, b) => a - b);
    return out;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createGpuSectionTimer(gl: GpuTimerGl, ext: GpuTimerExt): GpuSectionTimer {
  const freeQueries: object[] = [];
  let allocatedQueries = 0;
  const pendingFrames: PendingFrame[] = [];
  let openFrame: PendingFrame | null = null;
  let openQuery: object | null = null;
  let disposed = false;

  const frameRing = new SampleRing(FRAME_RING_CAP);
  const sectionRings = new Map<string, SampleRing>();
  const sectionTotals = new Map<string, { sum: number; count: number }>();
  let disjoints = 0;
  let starvedFrames = 0;

  function takeQuery(): object | null {
    const pooled = freeQueries.pop();
    if (pooled) return pooled;
    if (allocatedQueries >= QUERY_POOL_CAP) return null;
    const created = gl.createQuery();
    if (created) allocatedQueries++;
    return created;
  }

  function releaseQuery(query: object): void {
    freeQueries.push(query);
  }

  function discardPending(): void {
    for (const frame of pendingFrames) {
      for (const section of frame.sections) releaseQuery(section.query);
    }
    pendingFrames.length = 0;
  }

  function recordFrame(frame: PendingFrame): void {
    // A starved frame is missing sections, so its total would understate the
    // real GPU cost: release its queries but keep it out of the rings. It was
    // already counted at endFrame time.
    if (frame.starved) return;
    let totalNs = 0;
    for (const section of frame.sections) {
      totalNs += section.ns;
      const ms = section.ns / NS_PER_MS;
      let ring = sectionRings.get(section.label);
      if (!ring) {
        if (sectionRings.size >= MAX_SECTIONS) continue;
        ring = new SampleRing(SECTION_RING_CAP);
        sectionRings.set(section.label, ring);
        sectionTotals.set(section.label, { sum: 0, count: 0 });
      }
      ring.push(ms);
      const totals = sectionTotals.get(section.label);
      if (totals) {
        totals.sum += ms;
        totals.count++;
      }
    }
    frameRing.push(totalNs / NS_PER_MS);
  }

  function poll(): void {
    // Disjoint first: reading the flag also resets it. When set, every
    // in-flight query is untrustworthy, so drop them all.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
      disjoints++;
      discardPending();
      return;
    }
    // Frames resolve in submission order; stop at the first incomplete one so
    // recorded frames stay whole.
    while (pendingFrames.length > 0) {
      const frame = pendingFrames[0];
      let complete = true;
      for (const section of frame.sections) {
        if (section.resolved) continue;
        const available = gl.getQueryParameter(section.query, QUERY_RESULT_AVAILABLE);
        if (available !== true) {
          complete = false;
          break;
        }
        section.ns = Number(gl.getQueryParameter(section.query, QUERY_RESULT)) || 0;
        section.resolved = true;
        releaseQuery(section.query);
      }
      if (!complete) break;
      pendingFrames.shift();
      recordFrame(frame);
    }
  }

  function closeOpenQuery(): void {
    if (!openQuery) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    openQuery = null;
  }

  return {
    beginFrame(): void {
      if (disposed) return;
      poll();
      openFrame = { sections: [], starved: false };
    },
    split(label: string): void {
      // Out-of-band renders (prewarm, census, screenshots) hit marker passes
      // without a surrounding frame; those splits must stay inert.
      if (disposed || !openFrame) return;
      closeOpenQuery();
      const query = takeQuery();
      if (!query) {
        openFrame.starved = true;
        return;
      }
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      openQuery = query;
      openFrame.sections.push({ query, label, ns: 0, resolved: false });
    },
    endFrame(): void {
      if (disposed || !openFrame) return;
      closeOpenQuery();
      if (openFrame.starved) starvedFrames++;
      // Even a starved frame's acquired queries are in flight on the GPU, so
      // they still ride the pending list back to the pool via poll().
      if (openFrame.sections.length > 0) pendingFrames.push(openFrame);
      openFrame = null;
    },
    stats(): GpuTimerStats {
      const sortedFrames = frameRing.sorted();
      let frameSum = 0;
      for (const ms of sortedFrames) frameSum += ms;
      const sections: GpuSectionStats[] = [];
      for (const [label, ring] of sectionRings) {
        const totals = sectionTotals.get(label);
        const sorted = ring.sorted();
        sections.push({
          label,
          avgMs: roundMs(totals && totals.count > 0 ? totals.sum / totals.count : 0),
          p95Ms: roundMs(percentile(sorted, 0.95)),
          samples: ring.count,
        });
      }
      return {
        frames: sortedFrames.length,
        frameAvgMs: roundMs(sortedFrames.length > 0 ? frameSum / sortedFrames.length : 0),
        frameP50Ms: roundMs(percentile(sortedFrames, 0.5)),
        frameP95Ms: roundMs(percentile(sortedFrames, 0.95)),
        frameMaxMs: roundMs(sortedFrames.length > 0 ? sortedFrames[sortedFrames.length - 1] : 0),
        sections,
        disjoints,
        starvedFrames,
      };
    },
    reset(): void {
      closeOpenQuery();
      openFrame = null;
      discardPending();
      frameRing.clear();
      sectionRings.clear();
      sectionTotals.clear();
    },
    dispose(): void {
      if (disposed) return;
      closeOpenQuery();
      openFrame = null;
      discardPending();
      for (const query of freeQueries) gl.deleteQuery(query);
      freeQueries.length = 0;
      disposed = true;
    },
  };
}
