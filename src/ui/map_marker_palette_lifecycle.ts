// One event-driven bridge from the OS forced-colors channel to the Hud-owned
// marker raster cache. Theme changes call the same cache refresh explicitly
// after applying their CSS tokens. This module keeps matchMedia out of the
// cache and makes the listener lifecycle independently testable.

const FORCED_COLORS_QUERY = '(forced-colors: active)';

interface PaletteMediaQuery {
  addEventListener?(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener?(
    type: 'change',
    listener: (event: { readonly matches: boolean }) => void,
  ): void;
}

export interface MapMarkerPaletteMediaHost {
  matchMedia?(query: string): PaletteMediaQuery;
  requestAnimationFrame?(callback: () => void): number;
  cancelAnimationFrame?(handle: number): void;
}

export interface MapMarkerPaletteLifecycle {
  notify(): void;
  dispose(): void;
}

const activeLifecycleByHost = new WeakMap<MapMarkerPaletteMediaHost, () => void>();

export function installMapMarkerPaletteLifecycle(
  host: MapMarkerPaletteMediaHost,
  refresh: () => void,
): MapMarkerPaletteLifecycle {
  activeLifecycleByHost.get(host)?.();
  const query = host.matchMedia?.(FORCED_COLORS_QUERY) ?? null;
  let frame: number | null = null;
  let disposed = false;
  const commit = (): void => {
    frame = null;
    if (!disposed) refresh();
  };
  const notify = (): void => {
    if (disposed || frame !== null) return;
    if (host.requestAnimationFrame) {
      frame = host.requestAnimationFrame(commit);
      return;
    }
    refresh();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    query?.removeEventListener?.('change', notify);
    if (frame !== null) host.cancelAnimationFrame?.(frame);
    frame = null;
    if (activeLifecycleByHost.get(host) === dispose) activeLifecycleByHost.delete(host);
  };
  query?.addEventListener?.('change', notify);
  activeLifecycleByHost.set(host, dispose);
  return { notify, dispose };
}
