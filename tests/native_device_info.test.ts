// The native device-memory bridge: measures ProcessInfo.physicalMemory through
// the duck-typed Capacitor plugin and caches it for the NEXT boot's synchronous
// graphics-profile read (src/device_memory_hint.ts). NATIVE_APP is baked from
// VITE_NATIVE_APP at module load, so each case stubs the env and re-imports.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_MEMORY_GB_KEY } from '../src/device_memory_hint';

// The default Vitest env is plain Node, so `window`/`localStorage` are absent and
// are stubbed here per case. Assign through an index signature rather than the
// real DOM types: the lib types declare `window` as a full `Window`, so a bare
// object literal is checked against that shape and fails to compile.
const g = globalThis as unknown as Record<string, unknown>;
const hadWindow = 'window' in globalThis;
const hadStorage = 'localStorage' in globalThis;

function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  return backing;
}

/** Install a fake Capacitor bridge exposing `getMemoryInfo`. */
function stubBridge(getMemoryInfo: (() => Promise<unknown>) | null): void {
  g.window = {
    Capacitor: { Plugins: getMemoryInfo ? { NativeDeviceInfo: { getMemoryInfo } } : {} },
  };
}

async function importFresh(): Promise<typeof import('../src/net/native_device_info')> {
  vi.resetModules();
  return import('../src/net/native_device_info');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (!hadWindow) delete g.window;
  if (!hadStorage) delete g.localStorage;
});

describe('primeNativeDeviceMemoryHint', () => {
  it('caches the measured GB through the plugin bridge', async () => {
    vi.stubEnv('VITE_NATIVE_APP', '1');
    const backing = stubStorage();
    stubBridge(async () => ({ physicalMemoryBytes: 3.9 * 1024 ** 3 }));
    const { primeNativeDeviceMemoryHint } = await importFresh();
    await primeNativeDeviceMemoryHint();
    expect(backing.get(DEVICE_MEMORY_GB_KEY)).toBe('3.9');
  });

  it('stores nothing when the bridge reports garbage', async () => {
    vi.stubEnv('VITE_NATIVE_APP', '1');
    const backing = stubStorage();
    stubBridge(async () => ({ physicalMemoryBytes: -1 }));
    const { primeNativeDeviceMemoryHint } = await importFresh();
    await primeNativeDeviceMemoryHint();
    expect(backing.has(DEVICE_MEMORY_GB_KEY)).toBe(false);
  });

  it('no-ops fail-soft when the plugin is missing or throws', async () => {
    vi.stubEnv('VITE_NATIVE_APP', '1');
    const backing = stubStorage();
    stubBridge(null);
    const missing = await importFresh();
    await expect(missing.primeNativeDeviceMemoryHint()).resolves.toBeUndefined();
    stubBridge(async () => {
      throw new Error('bridge fell over');
    });
    const throwing = await importFresh();
    await expect(throwing.primeNativeDeviceMemoryHint()).resolves.toBeUndefined();
    expect(backing.has(DEVICE_MEMORY_GB_KEY)).toBe(false);
  });

  it('never touches the bridge outside the native shell', async () => {
    vi.stubEnv('VITE_NATIVE_APP', '');
    const backing = stubStorage();
    let called = 0;
    stubBridge(async () => {
      called++;
      return { physicalMemoryBytes: 4 * 1024 ** 3 };
    });
    const { primeNativeDeviceMemoryHint } = await importFresh();
    await primeNativeDeviceMemoryHint();
    expect(called).toBe(0);
    expect(backing.has(DEVICE_MEMORY_GB_KEY)).toBe(false);
  });
});
