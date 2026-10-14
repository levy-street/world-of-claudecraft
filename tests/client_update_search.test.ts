import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  freshClientUrl,
  searchClientUpdates,
  searchDesktopUpdates,
  UPDATE_SEARCH_TIMEOUT_MS,
} from '../src/client_update_search';
import type { DesktopBridge, DesktopUpdateEvent } from '../src/runtime';

const host = vi.hoisted(() => ({
  native: false,
  desktop: false,
  bridge: null as DesktopBridge | null,
  nativeSearch: vi.fn(async () => 'none' as const),
}));
vi.mock('../src/net/online', () => ({
  get NATIVE_APP() {
    return host.native;
  },
  get DESKTOP_APP() {
    return host.desktop;
  },
}));
vi.mock('../src/runtime', () => ({ desktopBridge: () => host.bridge }));
vi.mock('../src/net/native_update_search', () => ({ searchNativeUpdates: host.nativeSearch }));

function fakeBridge() {
  let listener: (event: DesktopUpdateEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const checkForUpdates = vi.fn(async () => 'checking' as const);
  const bridge = {
    onUpdateEvent: (fn: typeof listener) => {
      listener = fn;
      return unsubscribe;
    },
    checkForUpdates,
  } as unknown as DesktopBridge;
  return {
    bridge,
    emit: (event: DesktopUpdateEvent) => listener(event),
    unsubscribe,
    checkForUpdates,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  host.native = host.desktop = false;
  host.bridge = null;
});

describe('client update search', () => {
  it('routes a browser search through a fresh navigation', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { href: 'https://example.com/play?realm=dev#login', replace });
    vi.spyOn(Date, 'now').mockReturnValue(42);
    expect(await searchClientUpdates('0.45.0')).toBe('updating');
    expect(replace).toHaveBeenCalledWith('https://example.com/play?realm=dev&woc-update=42#login');
    expect(host.nativeSearch).not.toHaveBeenCalled();
  });

  it('routes native clients to their updater and desktop clients to the shell bridge', async () => {
    host.native = true;
    expect(await searchClientUpdates('0.45.0')).toBe('none');
    expect(host.nativeSearch).toHaveBeenCalledWith('0.45.0');
    host.native = false;
    host.desktop = true;
    const rig = fakeBridge();
    host.bridge = rig.bridge;
    const result = searchClientUpdates('0.45.0');
    rig.emit({ type: 'downloaded' });
    expect(await result).toBe('ready');
  });

  it('keeps update recovery wired into both terminal mismatch paths', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(
      /onFatalRecoveryFailed:\s*\(\) =>\s*fatalOverlay\(userFacingApiError\(ONLINE_WORLD_INCOMPATIBLE_MESSAGE\), \{ searchUpdates: true \}\)/,
    );
    expect(main).toContain('searchUpdates: reason === ONLINE_WORLD_INCOMPATIBLE_MESSAGE,');
    expect(main).toContain(
      'searchUpdates: opts?.searchUpdates ? () => searchClientUpdates(__APP_VERSION__) : undefined,',
    );
  });
  it('refreshes the entry URL while preserving realm, login parameters and fragment', () => {
    expect(freshClientUrl('https://example.com/play?realm=dev&woc-update=old#login', 42)).toBe(
      'https://example.com/play?realm=dev&woc-update=42#login',
    );
  });

  it.each([
    ['downloaded', 'ready'],
    ['not-available', 'none'],
    ['error', 'failed'],
  ] as const)(
    'observes desktop %s before checking and cleans its listener',
    async (type, result) => {
      const rig = fakeBridge();
      const pending = searchDesktopUpdates(rig.bridge);
      expect(rig.checkForUpdates).toHaveBeenCalledTimes(1);
      rig.emit({ type });
      expect(await pending).toBe(result);
      expect(rig.unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it('waits through download progress rather than treating a check as completion', async () => {
    const rig = fakeBridge();
    const pending = searchDesktopUpdates(rig.bridge);
    rig.emit({ type: 'available', version: '1.0.0' });
    rig.emit({ type: 'progress', percent: 50 });
    expect(rig.unsubscribe).not.toHaveBeenCalled();
    rig.emit({ type: 'downloaded' });
    expect(await pending).toBe('ready');
  });

  it('bounds a stalled desktop check and cleans up', async () => {
    vi.useFakeTimers();
    const rig = fakeBridge();
    const pending = searchDesktopUpdates(rig.bridge);
    expect(UPDATE_SEARCH_TIMEOUT_MS).toBe(120_000);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(rig.unsubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('failed');
    expect(rig.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('degrades on older shells and disabled store-managed updaters', async () => {
    expect(await searchDesktopUpdates(null)).toBe('unavailable');
    const rig = fakeBridge();
    rig.bridge.checkForUpdates = async () => 'unavailable';
    expect(await searchDesktopUpdates(rig.bridge)).toBe('unavailable');
    expect(rig.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('offers restart immediately when the shell already downloaded the update', async () => {
    const rig = fakeBridge();
    rig.bridge.checkForUpdates = async () => 'ready';
    expect(await searchDesktopUpdates(rig.bridge)).toBe('ready');
  });
});
