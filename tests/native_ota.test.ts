import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPendingOtaUpdate,
  notifyOtaAppReady,
  type OtaGlobalScope,
  type OtaUpdateHandlers,
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
  it('maps the three download-lifecycle events onto the handlers', async () => {
    const { plugin, listeners } = fakeEventsPlugin();
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    watchOtaUpdates(noopHandlers({ onProgress, onComplete, onFailed }), {
      native: true,
      scope: scopeWith(plugin),
    });
    expect([...listeners.keys()].sort()).toEqual([
      'download',
      'downloadComplete',
      'downloadFailed',
    ]);
    listeners.get('download')?.({ percent: 37, bundle: { id: 'b' } });
    listeners.get('downloadComplete')?.({ bundle: { id: 'b' } });
    listeners.get('downloadFailed')?.({ version: '1.2.3' });
    expect(onProgress).toHaveBeenCalledWith(37);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
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

describe('applyPendingOtaUpdate', () => {
  it('reports success when the plugin accepted the reload call', async () => {
    const reload = vi.fn(async () => ({}));
    await expect(
      applyPendingOtaUpdate({ native: true, scope: scopeWith({ reload }) }),
    ).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports failure off native, without the plugin, and on a bridge error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(applyPendingOtaUpdate({ native: false })).resolves.toBe(false);
    await expect(applyPendingOtaUpdate({ native: true, scope: {} })).resolves.toBe(false);
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
