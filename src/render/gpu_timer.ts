export interface GpuTimingSnapshot {
  enabled: boolean;
  supported: boolean;
  sampleIntervalFrames: number;
  sampleCount: number;
  latestMs: number | null;
  averageMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  disjointCount: number;
  droppedSamples: number;
}

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface TimerQueryContext {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  createQuery(): WebGLQuery | null;
  deleteQuery(query: WebGLQuery): void;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
  getExtension(name: 'EXT_disjoint_timer_query_webgl2'): TimerQueryExtension | null;
}

interface QuerySlot {
  query: WebGLQuery;
  pending: boolean;
}

const DEFAULT_SAMPLE_INTERVAL_FRAMES = 300;
const DEFAULT_QUERY_SLOTS = 4;
const SAMPLE_HISTORY_SIZE = 64;

/**
 * Samples GPU frame duration without blocking the CPU. Query results are only
 * read after the browser reports them available, and a small fixed ring owns
 * every query and history slot.
 */
export class GpuFrameTimer {
  private extension: TimerQueryExtension | null = null;
  private readonly querySlots: QuerySlot[] = [];
  private readonly samplesMs = new Float64Array(SAMPLE_HISTORY_SIZE);
  private readonly summaryScratch = new Float64Array(SAMPLE_HISTORY_SIZE);
  private activeSlot: QuerySlot | null = null;
  private sampleWriteIndex = 0;
  private storedSampleCount = 0;
  private totalSampleCount = 0;
  private disjointCount = 0;
  private droppedSamples = 0;
  private latestMs: number | null = null;
  private averageMs: number | null = null;
  private p95Ms: number | null = null;
  private maxMs: number | null = null;

  constructor(
    private readonly gl: TimerQueryContext | null,
    readonly sampleIntervalFrames = DEFAULT_SAMPLE_INTERVAL_FRAMES,
    private readonly querySlotCount = DEFAULT_QUERY_SLOTS,
  ) {
    this.initializeQueries();
  }

  beginFrame(frameIndex: number): boolean {
    if (
      !this.gl ||
      !this.extension ||
      this.activeSlot ||
      this.querySlots.length === 0 ||
      frameIndex % this.sampleIntervalFrames !== 0
    ) {
      return false;
    }
    if (this.poll()) return false;
    const slot = this.querySlots.find((candidate) => !candidate.pending);
    if (!slot) {
      this.droppedSamples++;
      return false;
    }
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, slot.query);
    this.activeSlot = slot;
    return true;
  }

  endFrame(started: boolean): void {
    if (!started || !this.gl || !this.extension || !this.activeSlot) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.activeSlot.pending = true;
    this.activeSlot = null;
  }

  reset(): void {
    this.activeSlot = null;
    if (this.gl) {
      for (const slot of this.querySlots) {
        try {
          this.gl.deleteQuery(slot.query);
        } catch {
          // Context restoration invalidates the old query objects.
        }
      }
    }
    this.querySlots.length = 0;
    this.initializeQueries();
    this.sampleWriteIndex = 0;
    this.storedSampleCount = 0;
    this.totalSampleCount = 0;
    this.disjointCount = 0;
    this.droppedSamples = 0;
    this.latestMs = null;
    this.averageMs = null;
    this.p95Ms = null;
    this.maxMs = null;
  }

  snapshot(): GpuTimingSnapshot {
    return {
      enabled: this.gl !== null,
      supported: this.querySlots.length > 0,
      sampleIntervalFrames: this.sampleIntervalFrames,
      sampleCount: this.totalSampleCount,
      latestMs: this.latestMs,
      averageMs: this.averageMs,
      p95Ms: this.p95Ms,
      maxMs: this.maxMs,
      disjointCount: this.disjointCount,
      droppedSamples: this.droppedSamples,
    };
  }

  dispose(): void {
    if (!this.gl) return;
    for (const slot of this.querySlots) this.gl.deleteQuery(slot.query);
    this.querySlots.length = 0;
    this.activeSlot = null;
  }

  private initializeQueries(): void {
    if (!this.gl) return;
    this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!this.extension) return;
    for (let i = 0; i < Math.max(1, this.querySlotCount); i++) {
      const query = this.gl.createQuery();
      if (query) this.querySlots.push({ query, pending: false });
    }
  }

  private poll(): boolean {
    if (!this.gl || !this.extension) return false;
    let hasPendingQuery = false;
    for (const slot of this.querySlots) {
      if (!slot.pending) continue;
      hasPendingQuery = true;
      break;
    }
    if (!hasPendingQuery) return false;
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT) === true) {
      for (const slot of this.querySlots) slot.pending = false;
      this.disjointCount++;
      return true;
    }
    for (const slot of this.querySlots) {
      if (
        !slot.pending ||
        this.gl.getQueryParameter(slot.query, this.gl.QUERY_RESULT_AVAILABLE) !== true
      ) {
        continue;
      }
      const elapsedNs = Number(this.gl.getQueryParameter(slot.query, this.gl.QUERY_RESULT));
      slot.pending = false;
      if (!Number.isFinite(elapsedNs) || elapsedNs < 0) continue;
      this.latestMs = elapsedNs / 1_000_000;
      this.samplesMs[this.sampleWriteIndex] = this.latestMs;
      this.sampleWriteIndex = (this.sampleWriteIndex + 1) % SAMPLE_HISTORY_SIZE;
      this.storedSampleCount = Math.min(SAMPLE_HISTORY_SIZE, this.storedSampleCount + 1);
      this.totalSampleCount++;
      this.updateSummary();
    }
    return false;
  }

  private updateSummary(): void {
    let total = 0;
    for (let i = 0; i < this.storedSampleCount; i++) {
      const value = this.samplesMs[i];
      total += value;
      this.summaryScratch[i] = value;
    }
    this.summaryScratch.subarray(0, this.storedSampleCount).sort();
    this.averageMs = total / this.storedSampleCount;
    this.p95Ms =
      this.summaryScratch[
        Math.min(this.storedSampleCount - 1, Math.ceil(this.storedSampleCount * 0.95) - 1)
      ];
    this.maxMs = this.summaryScratch[this.storedSampleCount - 1];
  }
}
