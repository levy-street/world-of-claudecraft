export interface VisualPoolHooks<T> {
  reset(value: T): void;
  dispose(value: T): void;
}

interface PooledVisual<T> {
  key: string;
  value: T;
  usedAt: number;
}

export class CharacterVisualPool<T> {
  private readonly available = new Map<string, PooledVisual<T>[]>();
  private availableCount = 0;
  private clock = 0;

  constructor(
    readonly capacity: number,
    private readonly hooks: VisualPoolHooks<T>,
  ) {
    if ((!Number.isInteger(capacity) && capacity !== Number.POSITIVE_INFINITY) || capacity < 0) {
      throw new RangeError('visual pool capacity must be a non-negative integer');
    }
  }

  acquire(key: string): T | null {
    const bucket = this.available.get(key);
    const pooled = bucket?.pop();
    if (!pooled) return null;
    if (bucket?.length === 0) this.available.delete(key);
    this.availableCount--;
    this.hooks.reset(pooled.value);
    return pooled.value;
  }

  release(key: string, value: T): void {
    if (this.capacity === 0) {
      this.hooks.dispose(value);
      return;
    }
    while (this.availableCount >= this.capacity) this.evictOldest();
    const bucket = this.available.get(key) ?? [];
    if (bucket.length === 0) this.available.set(key, bucket);
    bucket.push({ key, value, usedAt: ++this.clock });
    this.availableCount++;
  }

  clear(): void {
    for (const bucket of this.available.values()) {
      for (const pooled of bucket) this.hooks.dispose(pooled.value);
    }
    this.available.clear();
    this.availableCount = 0;
  }

  get size(): number {
    return this.availableCount;
  }

  private evictOldest(): void {
    let oldest: PooledVisual<T> | null = null;
    for (const bucket of this.available.values()) {
      for (const pooled of bucket) {
        if (!oldest || pooled.usedAt < oldest.usedAt) oldest = pooled;
      }
    }
    if (!oldest) return;
    const bucket = this.available.get(oldest.key);
    if (!bucket) return;
    const index = bucket.indexOf(oldest);
    bucket.splice(index, 1);
    if (bucket.length === 0) this.available.delete(oldest.key);
    this.availableCount--;
    this.hooks.dispose(oldest.value);
  }
}
