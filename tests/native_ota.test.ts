import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPendingOtaUpdate,
  notifyOtaAppReady,
  type OtaGlobalScope,
  type OtaUpdateHandlers,
  pendingOtaBundleId,
  watchOtaUpdates,
} from '../src/net/native_ota';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

function scopeWith(plugin: unknown): OtaGlobalScope {
  return { Capacitor: { Plugins: { CapacitorUpdater: plugin } } };
}

describe('notifyOtaAppReady', () => {
  it('confirms the bundle through the native plugin exactly once', async () => {
    const notifyAppReady = vi.fn(async () => ({ bundle: { id: 'b1' } }));
    await expect(
      notifyOtaAppReady({ native: true, scope: scopeWith({ notifyAppReady }) }),
    ).resolves.toBe(true);
    expect(notifyAppReady).toHaveBeenCalledTimes(1);
  });

  it('no-ops outside the native shells without touching the scope', async () => {
    const notifyAppReady = vi.fn();
    await expect(
      notifyOtaAppReady({ native: false, scope: scopeWith({ notifyAppReady }) }),
    ).resolves.toBe(false);
    expect(notifyAppReady).not.toHaveBeenCalled();
  });

  it('no-ops when the plugin is absent or malformed', async () => {
    await expect(notifyOtaAppReady({ native: true, scope: {} })).resolves.toBe(false);
    await expect(
      notifyOtaAppReady({ native: true, scope: scopeWith({ notifyAppReady: 'nope' }) }),
    ).resolves.toBe(false);
  });

  it('swallows a native failure instead of breaking boot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notifyAppReady = vi.fn(async () => {
      throw new Error('bridge error');
    });
    await expect(
      notifyOtaAppReady({ native: true, scope: scopeWith({ notifyAppReady }) }),
    ).resolves.toBe(false);
    warn.mockRestore();
  });
});

function noopHandlers(overrides: Partial<OtaUpdateHandlers> = {}): OtaUpdateHandlers {
  return {
    onProgress: () => {},
    onComplete: () => {},
    onStaged: () => {},
    onFailed: () => {},
    ...overrides,
  };
}

/** A fake plugin whose addListener records listeners and returns removable handles. */
function fakeEventsPlugin() {
  const listeners = new Map<string, (event: unknown) => void>();
  const removes: Array<ReturnType<typeof vi.fn>> = [];
  const plugin = {
    addListener: vi.fn((eventName: string, listener: (event: unknown) => void) => {
      listeners.set(eventName, listener);
      const remove = vi.fn(async () => {});
      removes.push(remove);
      return Promise.resolve({ remove });
    }),
  };
  return { plugin, listeners, removes };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('watchOtaUpdates', () => {
  it('maps the four download-lifecycle events onto the handlers', async () => {
    const { plugin, listeners } = fakeEventsPlugin();
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const onStaged = vi.fn();
    const onFailed = vi.fn();
    watchOtaUpdates(noopHandlers({ onProgress, onComplete, onStaged, onFailed }), {
      native: true,
      scope: scopeWith(plugin),
    });
    expect([...listeners.keys()].sort()).toEqual([
      'download',
      'downloadComplete',
      'downloadFailed',
      'updateAvailable',
    ]);
    listeners.get('download')?.({ percent: 37, bundle: { id: 'b' } });
    listeners.get('downloadComplete')?.({ bundle: { id: 'b' } });
    listeners.get('updateAvailable')?.({ bundle: { id: 'b', version: '1.2.3' } });
    listeners.get('downloadFailed')?.({ version: '1.2.3' });
    expect(onProgress).toHaveBeenCalledWith(37);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onStaged).toHaveBeenCalledWith('b');
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('a staged event without a usable bundle id still reports staged (id null)', () => {
    const { plugin, listeners } = fakeEventsPlugin();
    const onStaged = vi.fn();
    watchOtaUpdates(noopHandlers({ onStaged }), { native: true, scope: scopeWith(plugin) });
    listeners.get('updateAvailable')?.({});
    listeners.get('updateAvailable')?.({ bundle: { id: '' } });
    listeners.get('updateAvailable')?.(undefined);
    expect(onStaged.mock.calls.map((c) => c[0])).toEqual([null, null, null]);
  });

  it('clamps and defaults malformed percent payloads', () => {
    const { plugin, listeners } = fakeEventsPlugin();
    const onProgress = vi.fn();
    watchOtaUpdates(noopHandlers({ onProgress }), { native: true, scope: scopeWith(plugin) });
    listeners.get('download')?.({ percent: 250 });
    listeners.get('download')?.({ percent: -5 });
    listeners.get('download')?.({ percent: 'half' });
    listeners.get('download')?.(undefined);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([100, 0, 0, 0]);
  });

  it('unsubscribe removes the handles and stops forwarding events', async () => {
    const { plugin, listeners, removes } = fakeEventsPlugin();
    const onProgress = vi.fn();
    const unsubscribe = watchOtaUpdates(noopHandlers({ onProgress }), {
      native: true,
      scope: scopeWith(plugin),
    });
    await flushMicrotasks(); // let the handle promises resolve into the tracked list
    unsubscribe();
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1);
    listeners.get('download')?.({ percent: 50 });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('a handle resolving after unsubscribe is removed immediately', async () => {
    const remove = vi.fn(async () => {});
    let release: (handle: { remove: typeof remove }) => void = () => {};
    const plugin = {
      addListener: vi.fn(
        () => new Promise<{ remove: typeof remove }>((resolve) => (release = resolve)),
      ),
    };
    const unsubscribe = watchOtaUpdates(noopHandlers(), { native: true, scope: scopeWith(plugin) });
    unsubscribe();
    release({ remove });
    await flushMicrotasks();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('no-ops off native and when the plugin lacks addListener', () => {
    const { plugin } = fakeEventsPlugin();
    expect(() =>
      watchOtaUpdates(noopHandlers(), { native: false, scope: scopeWith(plugin) })(),
    ).not.toThrow();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(() =>
      watchOtaUpdates(noopHandlers(), {
        native: true,
        scope: scopeWith({ notifyAppReady: vi.fn() }),
      })(),
    ).not.toThrow();
  });

  it('a throwing handler is contained, never propagated into the bridge callback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { plugin, listeners } = fakeEventsPlugin();
    watchOtaUpdates(
      noopHandlers({
        onProgress: () => {
          throw new Error('painter exploded');
        },
      }),
      { native: true, scope: scopeWith(plugin) },
    );
    expect(() => listeners.get('download')?.({ percent: 10 })).not.toThrow();
    warn.mockRestore();
  });
});

/** A plugin exposing the bundle queries, with the running bundle and the next marker scripted. */
function queryPlugin(opts: { current?: unknown; next?: unknown; extra?: Record<string, unknown> }) {
  return {
    current: vi.fn(async () => opts.current),
    getNextBundle: vi.fn(async () => opts.next),
    ...opts.extra,
  };
}

const running = (id: string) => ({
  bundle: { id, version: '0.41.0', status: 'success' },
  native: '59',
});

describe('pendingOtaBundleId', () => {
  it('names the next bundle when it differs from the running one', async () => {
    const scope = scopeWith(
      queryPlugin({ current: running('cur'), next: { id: 'nxt', status: 'pending' } }),
    );
    await expect(pendingOtaBundleId({ native: true, scope })).resolves.toBe('nxt');
    // A marker with no status field is still a recorded bundle.
    const bare = scopeWith(queryPlugin({ current: running('cur'), next: { id: 'nxt' } }));
    await expect(pendingOtaBundleId({ native: true, scope: bare })).resolves.toBe('nxt');
  });

  it('is null when the marker names the running bundle (the stale marker set() leaves behind)', async () => {
    const scope = scopeWith(
      queryPlugin({ current: running('same'), next: { id: 'same', status: 'success' } }),
    );
    await expect(pendingOtaBundleId({ native: true, scope })).resolves.toBeNull();
  });

  it('is null for a marker in an unswitchable state', async () => {
    for (const status of ['error', 'downloading', 'deleted', 'deleting']) {
      const scope = scopeWith(
        queryPlugin({ current: running('cur'), next: { id: 'nxt', status } }),
      );
      await expect(pendingOtaBundleId({ native: true, scope })).resolves.toBeNull();
    }
  });

  it('is null when the plugin has no marker, however the bridge spells "none"', async () => {
    for (const next of [undefined, null, {}, { id: '' }]) {
      const scope = scopeWith(queryPlugin({ current: running('cur'), next }));
      await expect(pendingOtaBundleId({ native: true, scope })).resolves.toBeNull();
    }
  });

  it('names a revert to the shipped bundle too: set({ id: "builtin" }) is the plugin reset', async () => {
    // The plugin records builtin as next when the store build overtakes the
    // OTA channel; installNext() would switch to it on backgrounding anyway.
    const scope = scopeWith(
      queryPlugin({ current: running('cur'), next: { id: 'builtin', status: 'success' } }),
    );
    await expect(pendingOtaBundleId({ native: true, scope })).resolves.toBe('builtin');
  });

  it('is null when the running bundle cannot be read (never guess: a wrong apply reload-loops)', async () => {
    const malformed = scopeWith(
      queryPlugin({ current: {}, next: { id: 'nxt', status: 'pending' } }),
    );
    await expect(pendingOtaBundleId({ native: true, scope: malformed })).resolves.toBeNull();
    const noCurrent = scopeWith({ getNextBundle: vi.fn(async () => ({ id: 'nxt' })) });
    await expect(pendingOtaBundleId({ native: true, scope: noCurrent })).resolves.toBeNull();
  });

  it('is null off native, without the plugin, and on a bridge error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = queryPlugin({ current: running('cur'), next: { id: 'nxt' } });
    await expect(
      pendingOtaBundleId({ native: false, scope: scopeWith(plugin) }),
    ).resolves.toBeNull();
    expect(plugin.getNextBundle).not.toHaveBeenCalled();
    await expect(pendingOtaBundleId({ native: true, scope: {} })).resolves.toBeNull();
    const throwing = scopeWith({
      current: vi.fn(async () => running('cur')),
      getNextBundle: vi.fn(async () => {
        throw new Error('bridge error');
      }),
    });
    await expect(pendingOtaBundleId({ native: true, scope: throwing })).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe('applyPendingOtaUpdate', () => {
  it('switches to the named bundle through set(), never reload()', async () => {
    const set = vi.fn(async () => ({}));
    const reload = vi.fn(async () => ({}));
    const plugin = queryPlugin({ current: running('old'), extra: { set, reload } });
    await expect(
      applyPendingOtaUpdate({ bundleId: 'new', native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ id: 'new' });
    expect(reload).not.toHaveBeenCalled();
    // The named bundle wins over the plugin's own marker.
    expect(plugin.getNextBundle).not.toHaveBeenCalled();
  });

  it('refuses to re-apply the bundle already running', async () => {
    const set = vi.fn(async () => ({}));
    const plugin = queryPlugin({ current: running('same'), extra: { set } });
    await expect(
      applyPendingOtaUpdate({ bundleId: 'same', native: true, scope: scopeWith(plugin) }),
    ).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it('asks the plugin for its next marker when the caller has no id', async () => {
    const set = vi.fn(async () => ({}));
    const plugin = queryPlugin({
      current: running('cur'),
      next: { id: 'nxt', status: 'pending' },
      extra: { set },
    });
    await expect(applyPendingOtaUpdate({ native: true, scope: scopeWith(plugin) })).resolves.toBe(
      true,
    );
    expect(set).toHaveBeenCalledWith({ id: 'nxt' });
  });

  it('switches nothing when there is no staged bundle to name', async () => {
    const set = vi.fn(async () => ({}));
    const plugin = queryPlugin({ current: running('cur'), next: {}, extra: { set } });
    await expect(applyPendingOtaUpdate({ native: true, scope: scopeWith(plugin) })).resolves.toBe(
      false,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('falls back to reload() only when the plugin has no set()', async () => {
    const reload = vi.fn(async () => ({}));
    await expect(
      applyPendingOtaUpdate({ bundleId: 'new', native: true, scope: scopeWith({ reload }) }),
    ).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports failure off native, without the plugin, and on a bridge error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(applyPendingOtaUpdate({ native: false })).resolves.toBe(false);
    await expect(applyPendingOtaUpdate({ native: true, scope: {} })).resolves.toBe(false);
    const set = vi.fn(async () => {
      throw new Error('bridge error');
    });
    await expect(
      applyPendingOtaUpdate({
        bundleId: 'new',
        native: true,
        scope: scopeWith(queryPlugin({ current: running('old'), extra: { set } })),
      }),
    ).resolves.toBe(false);
    const reload = vi.fn(async () => {
      throw new Error('bridge error');
    });
    await expect(
      applyPendingOtaUpdate({ native: true, scope: scopeWith({ reload }) }),
    ).resolves.toBe(false);
    warn.mockRestore();
  });
});

describe('OTA wiring pins', () => {
  it('main.ts confirms the applied bundle at boot (live statement, not a comment)', () => {
    expect(read('src/main.ts')).toMatch(/^void notifyOtaAppReady\(\);$/m);
  });

  it('main.ts installs the visible update gate and consults it before the fatal overlay', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/^const otaUpdateGate = installOtaUpdateGate\(\{$/m);
    expect(main).toMatch(/if \(otaUpdateGate\.handleIncompatibleDisconnect\(reason\)\) return;/);
  });

  it('capacitor.config.ts points the updater at our own server with stats off', () => {
    const config = read('capacitor.config.ts');
    expect(config).toContain('CapacitorUpdater');
    expect(config).toContain('autoUpdate: true');
    expect(config).toContain("updateUrl: 'https://worldofclaudecraft.com/api/ota/updates'");
    expect(config).toContain("statsUrl: ''");
  });

  it('the config updateUrl path stays in lockstep with the served route', () => {
    // Both sides are literal-pinned above and in tests/server/ota_updates.test.ts;
    // this ties them together so a route rename cannot leave the shells
    // POSTing at a 404 with every suite green.
    const routePath = read('server/ota_updates.ts').match(/path: '([^']+)'/)?.[1];
    expect(routePath).toBe('/api/ota/updates');
    expect(read('capacitor.config.ts')).toContain(
      `updateUrl: 'https://worldofclaudecraft.com${routePath}'`,
    );
  });

  it('the updater plugin ships as a runtime dependency for cap sync', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@capgo/capacitor-updater']).toMatch(/^\^8\./);
  });
});
