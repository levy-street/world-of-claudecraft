// Unit tests for the periodic-cache primitive shared by the app-aggregate metric
// collectors (server/http/periodic_collector.ts): it caches the last successful
// query result, refresh() re-runs the query, and a failed query keeps the previous
// snapshot rather than throwing into the timer. These are the caching + resilience
// guarantees both the business and client-perf collectors rely on.

import { describe, expect, it, vi } from 'vitest';
import { PeriodicCollector } from '../../../server/http/periodic_collector';

describe('PeriodicCollector', () => {
  it('starts null and caches the result of a refresh', async () => {
    const query = vi.fn(async () => 7);
    const collector = new PeriodicCollector(query, 60_000);

    expect(collector.current()).toBeNull();
    await collector.refresh();
    expect(collector.current()).toBe(7);
  });

  it('re-runs the query on each refresh and publishes the newest value', async () => {
    let n = 1;
    const query = vi.fn(async () => n);
    const collector = new PeriodicCollector(query, 60_000);

    await collector.refresh();
    expect(collector.current()).toBe(1);
    n = 42;
    await collector.refresh();
    expect(collector.current()).toBe(42);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good snapshot when a refresh fails, and never throws', async () => {
    let fail = false;
    const onError = vi.fn();
    const query = vi.fn(async () => {
      if (fail) throw new Error('db down');
      return 'ok';
    });
    const collector = new PeriodicCollector(query, 60_000, onError);

    await collector.refresh();
    expect(collector.current()).toBe('ok');

    fail = true;
    // Must not reject.
    await expect(collector.refresh()).resolves.toBe('ok');
    expect(collector.current()).toBe('ok');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping refreshes into one in-flight query', async () => {
    let resolve!: (value: number) => void;
    const query = vi.fn(() => new Promise<number>((done) => (resolve = done)));
    const collector = new PeriodicCollector(query, 60_000);

    const first = collector.refresh();
    const second = collector.refresh();
    expect(query).toHaveBeenCalledTimes(1);

    resolve(9);
    await expect(Promise.all([first, second])).resolves.toEqual([9, 9]);
    expect(collector.current()).toBe(9);
  });

  it('start() triggers an immediate refresh and stop() is safe before/after start', async () => {
    const query = vi.fn(async () => 5);
    const collector = new PeriodicCollector(query, 60_000);

    // Safe with no timer running.
    await collector.stop();

    collector.start();
    // start() kicks an immediate (async) refresh; let it settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(query).toHaveBeenCalled();

    await collector.stop();
    await collector.stop();
  });

  it('stop() waits for an in-flight refresh after clearing the interval', async () => {
    let resolve!: (value: number) => void;
    const collector = new PeriodicCollector(
      () => new Promise<number>((done) => (resolve = done)),
      60_000,
    );
    collector.start();
    let stopped = false;
    const stopping = collector.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    resolve(4);
    await stopping;
    expect(stopped).toBe(true);
  });
});
