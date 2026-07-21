import { describe, expect, it } from 'vitest';
import { checkRateLimit, MemoryCounterStore } from '@/lib/ratelimit';

describe('fixed-window rate limiting', () => {
  it('allows up to the limit then blocks within a window', async () => {
    let t = 0;
    const store = new MemoryCounterStore(() => t);
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(store, 'ip:1.2.3.4', 3, 60)).allowed).toBe(true);
    }
    expect((await checkRateLimit(store, 'ip:1.2.3.4', 3, 60)).allowed).toBe(false);

    // Window rolls over → counter resets.
    t = 61_000;
    expect((await checkRateLimit(store, 'ip:1.2.3.4', 3, 60)).allowed).toBe(true);
  });

  it('tracks keys independently (per-IP vs per-wallet)', async () => {
    const store = new MemoryCounterStore(() => 0);
    await checkRateLimit(store, 'register:ip:a', 1, 60);
    expect((await checkRateLimit(store, 'register:ip:a', 1, 60)).allowed).toBe(false);
    expect((await checkRateLimit(store, 'register:wallet:w', 1, 60)).allowed).toBe(true);
  });
});
