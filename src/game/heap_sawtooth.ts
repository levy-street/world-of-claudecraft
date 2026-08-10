// 1 Hz used-heap sawtooth tracker (ruling R10): GC evidence for the
// net-pipeline verdict. Allocation churn shows up as the ramp slope
// (allocRateMbPerSec), GC as the drop edges (gcDropCount / avgDropMb), and the
// sawtooth height as amplitudeMb. Reader and clock are both injected: the
// PerfMonitor feeds its existing memorySnapshot source and its ungated 1 Hz
// tick clock, tests feed a synthetic series, and non-Chromium browsers (reader
// returning null) yield a null summary, never NaN.

export interface HeapSawtoothSummary {
  samples: number;
  seconds: number;
  gcDropCount: number;
  avgDropMb: number;
  allocRateMbPerSec: number;
  // max minus min of the bounded recent sample window (not lifetime)
  amplitudeMb: number;
  lastUsedMb: number;
}

/** Read-only GC-floor trend for the local `?perf` hitch referee. */
export interface HeapFloorTrend {
  startMb: number;
  endMb: number;
  growthMb: number;
  floorSamples: number;
}

export interface HeapFloorValley {
  readonly atMs: number;
  readonly floorMb: number;
}

export interface HeapSawtoothOptions {
  // Bytes of used JS heap, or null where the source does not exist
  // (performance.memory is Chromium-only).
  readUsedHeapBytes: () => number | null;
  // The full valley series is local dev evidence only. Fleet instances leave
  // this off, avoiding retained samples outside the hitch referee.
  recordFloorSeries?: () => boolean;
}

// Chrome quantizes performance.memory.usedJSHeapSize on non-isolated pages, so
// small decreases are quantization noise, not GC. A decrease only counts as a
// GC drop once the fall from the tracked baseline passes this floor; smaller
// dips leave the baseline in place, so a slow multi-sample decline still
// registers once its cumulative fall crosses the floor, while noise around a
// rising ramp is netted out of the allocation rate.
export const GC_DROP_MIN_MB = 2;

// ~6 minutes of 1 Hz samples bounds the amplitude window (and the module's
// memory); the counters and rates are cumulative since start/reset.
const WINDOW_CAPACITY = 360;
// The referee resets before its ten-minute soak. At the 1 Hz sample cadence,
// this retains every possible valley in that measurement with headroom while
// still bounding a dev overlay left open after the run.
const FLOOR_SERIES_CAPACITY = 720;

const BYTES_PER_MB = 1024 * 1024;

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export class HeapSawtooth {
  private readonly readUsedHeapBytes: () => number | null;
  private readonly recordFloorSeries: () => boolean;
  private window: number[] = [];
  private floorValleys: HeapFloorValley[] = [];
  private samples = 0;
  private firstAtMs = 0;
  private lastAtMs = 0;
  private lastUsedMb = 0;
  // Reference the deltas are judged against; only a rise or a counted GC drop
  // moves it (sub-floor dips do not, see GC_DROP_MIN_MB above).
  private baselineMb = 0;
  private dropCount = 0;
  private dropTotalMb = 0;
  private riseTotalMb = 0;
  private firstFloorMb = 0;
  private lastFloorMb = 0;
  private floorSamples = 0;

  constructor(options: HeapSawtoothOptions) {
    this.readUsedHeapBytes = options.readUsedHeapBytes;
    this.recordFloorSeries = options.recordFloorSeries ?? (() => false);
  }

  private recordFloorValley(atMs: number, floorMb: number): void {
    if (!this.recordFloorSeries()) return;
    this.floorValleys.push({ atMs, floorMb });
    if (this.floorValleys.length > FLOOR_SERIES_CAPACITY) {
      this.floorValleys.splice(0, this.floorValleys.length - FLOOR_SERIES_CAPACITY);
    }
  }

  sample(nowMs: number): void {
    const bytes = this.readUsedHeapBytes();
    if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return;
    const usedMb = bytes / BYTES_PER_MB;
    if (this.samples === 0) {
      this.firstAtMs = nowMs;
      this.baselineMb = usedMb;
      this.firstFloorMb = usedMb;
      this.lastFloorMb = usedMb;
      this.floorSamples = 1;
      this.recordFloorValley(nowMs, usedMb);
    } else {
      const delta = usedMb - this.baselineMb;
      if (delta > 0) {
        this.riseTotalMb += delta;
        this.baselineMb = usedMb;
      } else if (-delta >= GC_DROP_MIN_MB) {
        this.dropCount++;
        this.dropTotalMb += -delta;
        this.baselineMb = usedMb;
        this.lastFloorMb = usedMb;
        this.floorSamples++;
        this.recordFloorValley(nowMs, usedMb);
      }
    }
    this.samples++;
    this.lastAtMs = nowMs;
    this.lastUsedMb = usedMb;
    this.window.push(usedMb);
    if (this.window.length > WINDOW_CAPACITY) {
      this.window.splice(0, this.window.length - WINDOW_CAPACITY);
    }
  }

  summary(): HeapSawtoothSummary | null {
    // Rates need an elapsed span; this arm also covers the null-reader
    // browsers, which never accumulate a sample.
    if (this.samples < 2) return null;
    const seconds = Math.max(0.001, (this.lastAtMs - this.firstAtMs) / 1000);
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.window) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      samples: this.samples,
      seconds: round(seconds),
      gcDropCount: this.dropCount,
      avgDropMb: this.dropCount > 0 ? round(this.dropTotalMb / this.dropCount) : 0,
      allocRateMbPerSec: round(this.riseTotalMb / seconds),
      amplitudeMb: round(max - min),
      lastUsedMb: round(this.lastUsedMb),
    };
  }

  /**
   * Return the first and latest GC valleys without changing the production
   * summary shape. PerfMonitor exposes this only while its dev overlay is on.
   */
  floorTrend(): HeapFloorTrend | null {
    if (this.samples < 2 || this.floorSamples === 0) return null;
    return {
      startMb: round(this.firstFloorMb),
      endMb: round(this.lastFloorMb),
      growthMb: round(this.lastFloorMb - this.firstFloorMb),
      floorSamples: this.floorSamples,
    };
  }

  /** Return a copy so referee code cannot mutate the live tracker. */
  floorSeries(): readonly HeapFloorValley[] {
    return this.floorValleys.map((valley) => ({ ...valley }));
  }

  reset(): void {
    this.window = [];
    this.floorValleys = [];
    this.samples = 0;
    this.firstAtMs = 0;
    this.lastAtMs = 0;
    this.lastUsedMb = 0;
    this.baselineMb = 0;
    this.dropCount = 0;
    this.dropTotalMb = 0;
    this.riseTotalMb = 0;
    this.firstFloorMb = 0;
    this.lastFloorMb = 0;
    this.floorSamples = 0;
  }
}

export function createHeapSawtooth(options: HeapSawtoothOptions): HeapSawtooth {
  return new HeapSawtooth(options);
}
