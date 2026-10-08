import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtaGlobalScope } from '../src/net/native_ota';
import { searchNativeUpdates } from '../src/net/native_update_search';

function scopeWith(plugin: unknown): OtaGlobalScope {
  return { Capacitor: { Plugins: { CapacitorUpdater: plugin } } };
}

function manualPlugin(event = 'updateAvailable') {
  const listeners = new Map<string, (event: unknown) => void>();
  const removes: Array<ReturnType<typeof vi.fn>> = [];
  const plugin = {
    addListener: vi.fn(async (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      const remove = vi.fn();
      removes.push(remove);
      return { remove };
    }),
    triggerUpdateCheck: vi.fn(
      async (): Promise<unknown> => listeners.get(event)?.({ bundle: { id: 'new' } }),
    ),
    set: vi.fn(),
  };
  return { plugin, listeners, removes };
}

afterEach(() => vi.useRealTimers());

describe('manual native update search', () => {
  it('does not read native capabilities outside native shells', async () => {
    const { plugin } = manualPlugin();
    await expect(
      searchNativeUpdates('1.0', { native: false, scope: scopeWith(plugin) }),
    ).resolves.toBe('unavailable');
    expect(plugin.addListener).not.toHaveBeenCalled();
  });

  it('applies an already staged bundle before starting another search', async () => {
    const { plugin } = manualPlugin();
    Object.assign(plugin, {
      current: vi.fn(async () => ({ bundle: { id: 'old' } })),
      getNextBundle: vi.fn(async () => ({ id: 'new', status: 'pending' })),
    });
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe('updating');
    expect(plugin.set).toHaveBeenCalledExactlyOnceWith({ id: 'new' });
    expect(plugin.triggerUpdateCheck).not.toHaveBeenCalled();
  });

  it('registers all listeners before triggering and leaves event-driven apply to the gate', async () => {
    const { plugin, removes, listeners } = manualPlugin();
    plugin.triggerUpdateCheck.mockImplementation(async () => {
      expect(listeners.size).toBe(5);
      listeners.get('updateAvailable')?.({ bundle: { id: 'new' } });
    });
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe('updating');
    expect(plugin.set).not.toHaveBeenCalled();
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
  });

  it('checks and opens the store when the OTA check finds no update', async () => {
    const { plugin } = manualPlugin('noNeedUpdate');
    const checkStore = vi.fn(async () => ({
      platform: 'android' as const,
      available: true,
      storeUrl: 'https://store.example/game',
    }));
    const openStore = vi.fn(async () => {});
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin), checkStore, openStore }),
    ).resolves.toBe('updating');
    expect(checkStore).toHaveBeenCalledExactlyOnceWith('1.0');
    expect(openStore).toHaveBeenCalledExactlyOnceWith('https://store.example/game');
  });

  it('reports no update when OTA is current and the store check is unavailable', async () => {
    const { plugin } = manualPlugin('noNeedUpdate');
    await expect(
      searchNativeUpdates('1.0', {
        native: true,
        scope: scopeWith(plugin),
        checkStore: vi.fn(async () => null),
      }),
    ).resolves.toBe('none');
  });

  it.each(['absent', 'unimplemented'])(
    'uses the store for an %s manual OTA capability',
    async (mode) => {
      const { plugin } = manualPlugin();
      const updater = mode === 'absent' ? {} : plugin;
      plugin.triggerUpdateCheck.mockRejectedValue({ code: 'UNIMPLEMENTED' });
      await expect(
        searchNativeUpdates('1.0', {
          native: true,
          scope: scopeWith(updater),
          checkStore: vi.fn(async () => ({ platform: 'ios' as const, available: false })),
        }),
      ).resolves.toBe('none');
    },
  );

  it.each(['downloadFailed', 'updateFailed'])('contains the %s event', async (event) => {
    const { plugin, removes } = manualPlugin(event);
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe('failed');
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
  });

  it('contains a native check rejection and removes its listeners', async () => {
    const { plugin, removes } = manualPlugin();
    plugin.triggerUpdateCheck.mockRejectedValue(new Error('offline'));
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe('failed');
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
  });

  it('falls back immediately when the native trigger reports unavailable', async () => {
    const { plugin } = manualPlugin();
    plugin.triggerUpdateCheck.mockResolvedValue({ status: 'unavailable', queued: false });
    const checkStore = vi.fn(async () => ({ platform: 'ios' as const, available: false }));
    await expect(
      searchNativeUpdates('1.0', { native: true, scope: scopeWith(plugin), checkStore }),
    ).resolves.toBe('none');
    expect(checkStore).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blocked', 'unavailable'],
    ['failed', 'failed'],
    ['up_to_date', 'none'],
  ] as const)(
    'preserves the %s classification before legacy noNeedUpdate',
    async (kind, outcome) => {
      const { plugin, listeners } = manualPlugin();
      plugin.triggerUpdateCheck.mockImplementation(async () => {
        listeners.get('updateCheckResult')?.({ kind });
        listeners.get('noNeedUpdate')?.({});
      });
      await expect(
        searchNativeUpdates('1.0', {
          native: true,
          scope: scopeWith(plugin),
          checkStore: vi.fn(async () => null),
        }),
      ).resolves.toBe(outcome);
    },
  );

  it('bounds a stalled check and makes late events inert', async () => {
    vi.useFakeTimers();
    const { plugin, removes, listeners } = manualPlugin('never');
    const checkStore = vi.fn(async () => null);
    const result = searchNativeUpdates('1.0', {
      native: true,
      scope: scopeWith(plugin),
      timeoutMs: 100,
      checkStore,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('failed');
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
    listeners.get('noNeedUpdate')?.({});
    expect(checkStore).not.toHaveBeenCalled();
  });

  it('does not apply a staged bundle when its second current query resolves after timeout', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    const set = vi.fn();
    const current = vi
      .fn()
      .mockResolvedValueOnce({ bundle: { id: 'old' } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
    const result = searchNativeUpdates('1.0', {
      native: true,
      scope: scopeWith({
        getNextBundle: vi.fn(async () => ({ id: 'new', status: 'pending' })),
        current,
        set,
      }),
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('failed');
    expect(current).toHaveBeenCalledTimes(2);
    release({ bundle: { id: 'old' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('removes registration handles that resolve after the deadline without triggering', async () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    const release: Array<(value: { remove: typeof remove }) => void> = [];
    const triggerUpdateCheck = vi.fn();
    const result = searchNativeUpdates('1.0', {
      native: true,
      scope: scopeWith({
        addListener: () => new Promise((resolve) => release.push(resolve)),
        triggerUpdateCheck,
      }),
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('failed');
    for (const resolve of release) resolve({ remove });
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledTimes(5);
    expect(triggerUpdateCheck).not.toHaveBeenCalled();
  });
});
