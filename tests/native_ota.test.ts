import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { notifyOtaAppReady, type OtaGlobalScope } from '../src/net/native_ota';

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

describe('OTA wiring pins', () => {
  it('main.ts confirms the applied bundle at boot (live statement, not a comment)', () => {
    expect(read('src/main.ts')).toMatch(/^void notifyOtaAppReady\(\);$/m);
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
