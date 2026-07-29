export interface SampleSummary {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fixed-capacity phase history with O(1) writes.
 *
 * Renderer.sync records six samples per frame. Keeping those samples in a
 * circular buffer avoids shifting the full history once each array reaches
 * its cap. Snapshot work remains on the infrequent perfStats read path.
 */
export class RendererPhaseSampleWindow {
  private readonly values: Float64Array;
  private next = 0;
  private length = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('phase sample capacity must be a positive integer');
    }
    this.values = new Float64Array(capacity);
  }

  get count(): number {
    return this.length;
  }

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.values[this.next] = Math.min(250, value);
    this.next = (this.next + 1) % this.capacity;
    if (this.length < this.capacity) this.length++;
  }

  summarize(): SampleSummary {
    if (this.length === 0) return { count: 0, avg: 0, p95: 0, max: 0 };
    const sorted = new Float64Array(this.length);
    let total = 0;
    const start = this.length === this.capacity ? this.next : 0;
    for (let i = 0; i < this.length; i++) {
      const value = this.values[(start + i) % this.capacity];
      sorted[i] = value;
      total += value;
    }
    sorted.sort();
    const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return {
      count: this.length,
      avg: roundMs(total / this.length),
      p95: roundMs(sorted[p95Index]),
      max: roundMs(sorted[sorted.length - 1]),
    };
  }
}
