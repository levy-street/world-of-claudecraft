// @vitest-environment happy-dom
import './_setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/admin/api';
import { auth } from '../../src/admin/state/auth.svelte';
import { createAutoRefresh } from '../../src/admin/state/auto_refresh.svelte';

const KEY = 'claudecraft_admin_test_auto_refresh';

describe('createAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads once on start, then on every interval, and stops on teardown', async () => {
    const load = vi.fn(async () => 1);
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    const stop = surface.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(surface.data).toBe(1);
    // Not a tick early: the cadence is the contract, so the interval must not
    // fire before it elapses.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(120_000); // four would-be intervals
    expect(load, 'the torn-down interval kept polling').toHaveBeenCalledTimes(2);
  });

  it('starts with the stored OFF preference and still loads once', async () => {
    // Today's onMount reads the preference and then refreshes unconditionally:
    // an operator who switched auto-refresh off still gets a populated page.
    localStorage.setItem(KEY, '0');
    const load = vi.fn(async () => 'x');
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(surface.enabled).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(load, 'a disabled surface armed an interval').toHaveBeenCalledTimes(1);
  });

  it('defaults to ON when nothing is stored, and when storage throws', async () => {
    const load = vi.fn(async () => 'x');
    expect(createAutoRefresh({ storageKey: KEY, intervalMs: 1000, load }).start()).toBeTypeOf(
      'function',
    );
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const blocked = createAutoRefresh({ storageKey: KEY, intervalMs: 1000, load });
      blocked.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(blocked.enabled).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });

  it('toggling off cancels the interval and persists the opt-out', async () => {
    const load = vi.fn(async () => 'x');
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    surface.setEnabled(false);
    expect(surface.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('0');
    await vi.advanceTimersByTimeAsync(90_000);
    expect(load, 'the cancelled interval refetched').toHaveBeenCalledTimes(1);
  });

  it('toggling back on refetches immediately AND re-arms the interval', async () => {
    const load = vi.fn(async () => 'x');
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    surface.setEnabled(false);
    surface.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load, 'toggle-on must refetch immediately').toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(KEY)).toBe('1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load, 'toggle-on must re-arm the interval').toHaveBeenCalledTimes(3);
  });

  it('drops a stale response so a slow first read cannot clobber a newer one', async () => {
    // The request-id guard: without it the interval's slower earlier response
    // lands last and the page shows older data than it already had.
    const resolvers: Array<(value: string) => void> = [];
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    surface.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resolvers).toHaveLength(2);
    resolvers[1]('newer');
    await vi.advanceTimersByTimeAsync(0);
    expect(surface.data).toBe('newer');
    resolvers[0]('older');
    await vi.advanceTimersByTimeAsync(0);
    expect(surface.data, 'a superseded response overwrote a newer one').toBe('newer');
  });

  it('drops a response that lands after teardown', async () => {
    let resolve: ((value: string) => void) | null = null;
    const surface = createAutoRefresh({
      storageKey: KEY,
      intervalMs: 30_000,
      load: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    const stop = surface.start();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    (resolve as unknown as (value: string) => void)('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(surface.data, 'a response after teardown was applied').toBeNull();
  });

  it('classifies a 403 as forbidden and a 500 as a generic error, and clears on success', async () => {
    let next: () => Promise<string> = async () => {
      throw new ApiError(403, 'you do not have permission to do this');
    };
    const surface = createAutoRefresh({
      storageKey: KEY,
      intervalMs: 30_000,
      load: () => next(),
    });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(surface.failure).toBe('forbidden');
    next = async () => {
      throw new ApiError(500, 'internal error');
    };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(surface.failure).toBe('error');
    next = async () => 'ok';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(surface.failure).toBe('none');
    expect(surface.data).toBe('ok');
  });

  it('hands a 401 to handleAuthFailure and paints no failure of its own', async () => {
    // A 401 forces a logout; painting a panel on top of the login screen would
    // be a second, contradictory answer to one failure.
    const spy = vi.spyOn(auth, 'handleAuthFailure');
    const surface = createAutoRefresh({
      storageKey: KEY,
      intervalMs: 30_000,
      load: async () => {
        throw new ApiError(401, 'admin authentication required');
      },
    });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveReturnedWith(true);
    expect(surface.failure).toBe('none');
    spy.mockRestore();
  });

  it('keeps the last good data when a later read fails', async () => {
    // A transient blip must not blank a populated dashboard; the failure line
    // is additive information, not a reset.
    let next: () => Promise<string> = async () => 'good';
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load: () => next() });
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    next = async () => {
      throw new Error('blip');
    };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(surface.failure).toBe('error');
    expect(surface.data).toBe('good');
  });

  it('is idempotent on a second start and arms exactly one interval', async () => {
    const load = vi.fn(async () => 'x');
    const surface = createAutoRefresh({ storageKey: KEY, intervalMs: 30_000, load });
    surface.start();
    surface.start();
    await vi.advanceTimersByTimeAsync(0);
    load.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load, 'a second start stacked a duplicate interval').toHaveBeenCalledTimes(1);
  });
});
