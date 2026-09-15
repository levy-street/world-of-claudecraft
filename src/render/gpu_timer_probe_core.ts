// The GPU timer probe's bracket ledger: host-agnostic, no GL. The WebGL2
// adapter (gpu_timer_probe.ts) hands it a query backend; a Vitest hands it a
// fake one. Named brackets open and close in submission order inside a frame,
// each on its own timer query; a query's result is read back on a LATER
// endFrame, never the one that issued it, so the readback never stalls the
// frame that produced the work. A disjoint event (the GPU clock jumped: a
// context switch, a power-state change) invalidates every query in flight, so
// the whole pending set is discarded when the flag comes back set.
//
// Timer queries cannot nest (one TIME_ELAPSED query is active per context), so
// a begin while a bracket is open throws: the renderer's submission is
// sequential by construction and a nested open is a wiring bug, not a runtime
// condition to absorb. A bracket reopened inside the same frame is ignored
// deterministically (counted, never timed twice) so a stray second open cannot
// double a bucket's sum.
//
// What the table covers: the brackets the frame's present submit opens, and
// nothing else. GPU work issued off the present path (the water simulation,
// impostor and ground bakes, prewarm draws) runs on the same context and is
// NOT in any bracket, so `frameSumMs` is the sum of the brackets, never the
// frame's whole GPU time; a bucket absent from the table is unmeasured, not
// free.

/** Query objects as the ledger sees them: created up front and recycled, so a
 *  steady frame allocates nothing. */
export interface GpuTimerQueryBackend<Q = unknown> {
  /** Null when the host cannot mint one (a lost context): the ledger halts. */
  createQuery(): Q | null;
  deleteQuery(query: Q): void;
  /** Whether a pooled query still belongs to the live context: after a
   *  context restore the old objects are dead, and a backend that can tell
   *  (WebGL's `isQuery`) lets the pool replace them instead of reusing them. */
  queryValid?(query: Q): boolean;
  beginQuery(query: Q): void;
  endQuery(): void;
  /** Non-blocking: whether the query's result can be read without a stall. */
  resultAvailable(query: Q): boolean;
  /** The elapsed GPU time in nanoseconds; only meaningful once available. */
  resultNs(query: Q): number;
  /** Read and clear the disjoint flag: true when the GPU clock jumped since
   *  the last read, which voids every query in flight. */
  disjoint(): boolean;
}

export interface GpuTimerBracketStats {
  /** Resolved samples inside the rolling window. */
  count: number;
  avg: number;
  p95: number;
  max: number;
}

export interface GpuTimerSnapshot {
  /** False when the host has no timer extension (or the probe is off): every
   *  other field is then empty and must not be read as a measurement. */
  available: boolean;
  brackets: Record<string, GpuTimerBracketStats>;
  /** Rolling average of the per-frame sum of the BRACKETS, in ms: the present
   *  submit's shadow, scene and post passes, not the frame's whole GPU time
   *  (see the module header for what is not bracketed). */
  frameSumMs: number;
  /** The per-frame bracket sum's full rolling stats, beside the average above. */
  frameSum: GpuTimerBracketStats;
  /** Frames whose results have been read back so far. */
  framesResolved: number;
  /** Frames discarded because the GPU clock was disjoint while they were in flight. */
  disjointFrames: number;
  /** Frames discarded because the pending ring overflowed (the GPU fell more
   *  than GPU_TIMER_PENDING_FRAMES behind the CPU). */
  droppedFrames: number;
  /** Frames still waiting for their results. */
  pendingFrames: number;
  /** Second opens of a bracket inside one frame, ignored rather than timed. */
  duplicateOpens: number;
  /** Scene submits whose `shadow` bracket was never handed over to the scene
   *  bracket (the shadow-map hook did not fire): the whole submit then sits
   *  under `shadow`, and this count says the label is not to be trusted. */
  sceneNoHandover: number;
  /** True once the backend refused to mint a query (a lost context): the
   *  ledger stopped issuing brackets and the table is frozen at that point. */
  halted: boolean;
}

/** Frames of samples each rolling stat covers. */
export const GPU_TIMER_STAT_WINDOW = 120;

/** How many frames may wait for their results before the oldest is dropped
 *  unresolved; a real GPU answers in two or three frames, so a ring this deep
 *  only ever fills when the results stop coming. */
export const GPU_TIMER_PENDING_FRAMES = 16;

export const GPU_TIMER_UNAVAILABLE: GpuTimerSnapshot = Object.freeze({
  available: false,
  brackets: {},
  frameSumMs: 0,
  frameSum: { count: 0, avg: 0, p95: 0, max: 0 },
  framesResolved: 0,
  disjointFrames: 0,
  droppedFrames: 0,
  pendingFrames: 0,
  duplicateOpens: 0,
  sceneNoHandover: 0,
  halted: false,
});

interface Segment<Q> {
  name: string;
  query: Q;
}

interface PendingFrame<Q> {
  id: number;
  segments: Segment<Q>[];
}

/** A fixed-capacity ring of numbers with the stats the overlay reads. */
class SampleRing {
  private readonly values: number[];
  private next = 0;
  private filled = 0;

  constructor(private readonly capacity: number) {
    this.values = new Array<number>(capacity).fill(0);
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  stats(): GpuTimerBracketStats {
    const n = this.filled;
    if (n === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
    const sorted = this.values.slice(0, n).sort((a, b) => a - b);
    let sum = 0;
    for (const v of sorted) sum += v;
    const p95Index = Math.min(n - 1, Math.ceil(n * 0.95) - 1);
    return {
      count: n,
      avg: round3(sum / n),
      p95: round3(sorted[Math.max(0, p95Index)]),
      max: round3(sorted[n - 1]),
    };
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export class GpuTimerLedger<Q = unknown> {
  private readonly free: Q[] = [];
  private readonly pending: PendingFrame<Q>[] = [];
  private current: Segment<Q>[] = [];
  private openName: string | null = null;
  private frameId = 0;
  private readonly bracketRings = new Map<string, SampleRing>();
  private readonly frameSumRing: SampleRing;
  private framesResolved = 0;
  private disjointFrames = 0;
  private droppedFrames = 0;
  private duplicateOpens = 0;
  private halted = false;
  private disposed = false;

  constructor(
    private readonly backend: GpuTimerQueryBackend<Q>,
    private readonly window = GPU_TIMER_STAT_WINDOW,
    private readonly maxPendingFrames = GPU_TIMER_PENDING_FRAMES,
  ) {
    this.frameSumRing = new SampleRing(window);
  }

  /** The bracket currently open, or null between brackets. */
  get open(): string | null {
    return this.openName;
  }

  /** Open a named bracket. Throws on nesting; a name already opened this
   *  frame is ignored (and counted) so it is never timed twice. */
  begin(name: string): void {
    if (this.disposed || this.halted) return;
    if (this.openName !== null) {
      throw new Error(`gpu timer: bracket '${name}' opened while '${this.openName}' is open`);
    }
    for (const segment of this.current) {
      if (segment.name === name) {
        this.duplicateOpens++;
        return;
      }
    }
    const query = this.pooledQuery() ?? this.backend.createQuery();
    if (query === null) {
      // The host cannot mint a query (a lost context): stop issuing rather
      // than throw from inside the frame submit. The table stays readable.
      this.halted = true;
      return;
    }
    this.backend.beginQuery(query);
    this.current.push({ name, query });
    this.openName = name;
  }

  /** Close the open bracket. A close with nothing open is a no-op, which is
   *  what a bracket ignored as a duplicate leaves behind. */
  end(): void {
    if (this.disposed || this.openName === null) return;
    this.backend.endQuery();
    this.openName = null;
  }

  /** Seal this frame's brackets, then read back the frames whose results are
   *  in, oldest first. This frame's own queries are never read here. */
  endFrame(): void {
    if (this.disposed) return;
    this.end();
    const id = this.frameId++;
    if (this.current.length > 0) {
      this.pending.push({ id, segments: this.current });
      this.current = [];
    }
    if (this.backend.disjoint()) {
      this.disjointFrames += this.pending.length;
      this.discardAllPending();
    }
    while (this.pending.length > this.maxPendingFrames) {
      const dropped = this.pending.shift();
      if (dropped) {
        this.droppedFrames++;
        this.recycle(dropped);
      }
    }
    while (this.pending.length > 0) {
      const frame = this.pending[0];
      if (frame.id === id || !this.frameReady(frame)) break;
      this.pending.shift();
      this.resolve(frame);
    }
  }

  snapshot(): GpuTimerSnapshot {
    const brackets: Record<string, GpuTimerBracketStats> = {};
    for (const [name, ring] of this.bracketRings) brackets[name] = ring.stats();
    const frameSum = this.frameSumRing.stats();
    return {
      available: true,
      brackets,
      frameSumMs: frameSum.avg,
      frameSum,
      framesResolved: this.framesResolved,
      disjointFrames: this.disjointFrames,
      droppedFrames: this.droppedFrames,
      pendingFrames: this.pending.length,
      duplicateOpens: this.duplicateOpens,
      sceneNoHandover: 0,
      halted: this.halted,
    };
  }

  /** Release every query object. The ledger is inert afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.end();
    this.disposed = true;
    this.discardAllPending();
    for (const segment of this.current) this.free.push(segment.query);
    this.current = [];
    for (const query of this.free) this.backend.deleteQuery(query);
    this.free.length = 0;
  }

  /** The next live query from the pool; dead ones (a restored context) are
   *  released on the way. */
  private pooledQuery(): Q | null {
    for (;;) {
      const query = this.free.pop();
      if (query === undefined) return null;
      if (!this.backend.queryValid || this.backend.queryValid(query)) return query;
      this.backend.deleteQuery(query);
    }
  }

  private frameReady(frame: PendingFrame<Q>): boolean {
    // Queries complete in submission order, so the LAST segment answers for
    // the whole frame; the earlier ones are checked anyway because a backend
    // is allowed to be pessimistic about any of them.
    for (let i = frame.segments.length - 1; i >= 0; i--) {
      if (!this.backend.resultAvailable(frame.segments[i].query)) return false;
    }
    return true;
  }

  private resolve(frame: PendingFrame<Q>): void {
    let sumMs = 0;
    for (const segment of frame.segments) {
      const ms = this.backend.resultNs(segment.query) / 1e6;
      sumMs += ms;
      let ring = this.bracketRings.get(segment.name);
      if (!ring) {
        ring = new SampleRing(this.window);
        this.bracketRings.set(segment.name, ring);
      }
      ring.push(ms);
    }
    this.frameSumRing.push(sumMs);
    this.framesResolved++;
    this.recycle(frame);
  }

  private discardAllPending(): void {
    for (const frame of this.pending) this.recycle(frame);
    this.pending.length = 0;
  }

  private recycle(frame: PendingFrame<Q>): void {
    for (const segment of frame.segments) this.free.push(segment.query);
  }
}

/** Pass labels for the composer's per-pass brackets, set at build time by
 *  post.ts and read by the composer's timed render arm. Kept beside the pass
 *  objects in a WeakMap rather than on them, so the flag-off path leaves
 *  three's objects byte-identical. A pass without a label is timed under
 *  `pass` (constructor names do not survive minification). */
const passLabels = new WeakMap<object, string>();

export const GPU_TIMER_UNLABELLED_PASS = 'pass';

/** The shadow maps render first inside three's `render()`, so a pass that
 *  draws the scene opens as `shadow` and the adapter's shadow-map hook hands
 *  the bracket over to the pass's own name once the maps are drawn. */
export const GPU_TIMER_SHADOW_BRACKET = 'shadow';
/** The plain scene pass (RenderPass, or the direct draw off the composer). */
export const GPU_TIMER_SCENE_BRACKET = 'scene';
/** The AO pass draws the scene itself and computes AO after it, in one pass. */
export const GPU_TIMER_SCENE_AO_BRACKET = 'scene+ao';

export function labelGpuTimerPass<T extends object>(pass: T, name: string): T {
  passLabels.set(pass, name);
  return pass;
}

export function gpuTimerPassName(pass: object): string {
  return passLabels.get(pass) ?? GPU_TIMER_UNLABELLED_PASS;
}

/** Whether a bracket name is one that draws the scene (and so opens as `shadow`). */
export function gpuTimerBracketDrawsScene(name: string): boolean {
  return name === GPU_TIMER_SCENE_BRACKET || name === GPU_TIMER_SCENE_AO_BRACKET;
}

/** The `?perf` overlay lines for the probe: nothing when it is off or the
 *  extension is missing (the overlay stays the size players know). */
export function gpuTimerOverlayLines(snapshot: GpuTimerSnapshot | undefined): string[] {
  if (!snapshot || !snapshot.available) return [];
  const lines: string[] = [];
  const health =
    `gpu brackets ${snapshot.frameSum.avg}/${snapshot.frameSum.p95}ms` +
    `  frames ${snapshot.framesResolved}` +
    (snapshot.disjointFrames > 0 ? `  disjoint ${snapshot.disjointFrames}` : '') +
    (snapshot.droppedFrames > 0 ? `  dropped ${snapshot.droppedFrames}` : '') +
    (snapshot.sceneNoHandover > 0 ? `  nohandover ${snapshot.sceneNoHandover}` : '') +
    (snapshot.halted ? '  HALTED' : '');
  lines.push(health);
  for (const [name, stats] of Object.entries(snapshot.brackets)) {
    lines.push(`  ${name} ${stats.avg}/${stats.p95}ms  max ${stats.max}  n ${stats.count}`);
  }
  return lines;
}
