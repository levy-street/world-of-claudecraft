import type { Redis } from 'ioredis';

// Fixed-window rate limiting. Backed by Redis in production so limits hold
// across instances; the in-memory store is the fallback (and test double).

export interface CounterStore {
  /** Increment `key` inside the current window, returning the new count. */
  incr(key: string, windowSeconds: number): Promise<number>;
}

export class MemoryCounterStore implements CounterStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async incr(key: string, windowSeconds: number): Promise<number> {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowSeconds * 1000 });
      return 1;
    }
    b.count += 1;
    return b.count;
  }
}

export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: Redis) {}

  async incr(key: string, windowSeconds: number): Promise<number> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count;
  }
}

export async function checkRateLimit(
  store: CounterStore,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number }> {
  const count = await store.incr(key, windowSeconds);
  return { allowed: count <= limit, count };
}
