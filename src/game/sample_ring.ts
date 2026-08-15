/** Fixed-capacity numeric history with O(1) writes and no steady-state garbage.
 *  Metrics consumers materialize a normal array only when producing a report. */
export class NumberSampleRing {
  private readonly data: Float64Array;
  private start = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('sample ring capacity must be a positive integer');
    }
    this.data = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(value: number): void {
    if (this.size < this.capacity) {
      this.data[(this.start + this.size) % this.capacity] = value;
      this.size++;
      return;
    }
    this.data[this.start] = value;
    this.start = (this.start + 1) % this.capacity;
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }

  toArray(): number[] {
    const out = new Array<number>(this.size);
    for (let index = 0; index < this.size; index++) {
      out[index] = this.data[(this.start + index) % this.capacity];
    }
    return out;
  }
}

export interface TimedSampleSnapshot {
  values: number[];
  firstAt: number | null;
  lastAt: number | null;
}

/** Fixed-capacity timestamp/value history. Expiry advances a cursor instead of
 *  shifting an array, avoiding one object allocation and an O(n) copy per frame. */
export class TimedNumberSampleRing {
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private start = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('timed sample ring capacity must be a positive integer');
    }
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(at: number, value: number): void {
    if (this.size < this.capacity) {
      const index = (this.start + this.size) % this.capacity;
      this.times[index] = at;
      this.values[index] = value;
      this.size++;
      return;
    }
    this.times[this.start] = at;
    this.values[this.start] = value;
    this.start = (this.start + 1) % this.capacity;
  }

  pruneBefore(minAt: number): void {
    while (this.size > 0 && this.times[this.start] < minAt) {
      this.start = (this.start + 1) % this.capacity;
      this.size--;
    }
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }

  /**
   * The retained window as timestamped entries, oldest first. ALLOCATES, so it
   * belongs off the per-frame path: the 1 Hz worst-window observer is the only
   * caller. Per-frame readers want snapshotSince(), which keeps the values in
   * one array and reports the span bounds instead.
   */
  entries(): { at: number; value: number }[] {
    const out = new Array<{ at: number; value: number }>(this.size);
    for (let offset = 0; offset < this.size; offset++) {
      const index = (this.start + offset) % this.capacity;
      out[offset] = { at: this.times[index], value: this.values[index] };
    }
    return out;
  }

  snapshotSince(minAt: number): TimedSampleSnapshot {
    let first = 0;
    while (first < this.size) {
      const index = (this.start + first) % this.capacity;
      if (this.times[index] >= minAt) break;
      first++;
    }
    const count = this.size - first;
    if (count <= 0) return { values: [], firstAt: null, lastAt: null };
    const out = new Array<number>(count);
    let firstAt = 0;
    let lastAt = 0;
    for (let offset = 0; offset < count; offset++) {
      const index = (this.start + first + offset) % this.capacity;
      const at = this.times[index];
      if (offset === 0) firstAt = at;
      lastAt = at;
      out[offset] = this.values[index];
    }
    return { values: out, firstAt, lastAt };
  }
}
