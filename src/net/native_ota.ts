// Capgo capacitor-updater glue for the native mobile shells (self-hosted OTA).
//
// The plugin's update machinery is native-side and config-driven
// (capacitor.config.ts CapacitorUpdater: autoUpdate against our own
// /api/ota/updates endpoint, stats disabled). The JS side is deliberately
// thin, three duck-typed calls:
// - notifyAppReady(): the ONE mandatory call. A freshly applied bundle that
//   never reports ready within the plugin's appReadyTimeout is treated as
//   broken and rolled back to the previous bundle on the next launch.
//   main.ts calls this once at boot, so a bundle broken badly enough that
//   boot never runs simply never confirms, and the rollback safety net fires.
// - watchOtaUpdates(): subscribes to the native auto-updater's download
//   lifecycle events so the boot gate (ota_update_gate.ts) can show real
//   progress instead of the silent atBackground default.
// - applyPendingOtaUpdate(): the plugin's reload(), which applies a fully
//   downloaded (staged) bundle by reloading the WebView immediately, the
//   same apply that normally waits for the next app backgrounding. On
//   success the current JS context is destroyed mid-await.
//
// Duck-typed off window.Capacitor.Plugins like native_app_update.ts (the
// bridge injects every registered native plugin there), so the web bundle
// never imports the plugin package and non-native hosts no-op.

import { NATIVE_APP } from './online';

interface CapacitorUpdaterPlugin {
  notifyAppReady(): Promise<unknown>;
}

interface OtaListenerHandle {
  remove(): Promise<void> | void;
}

interface CapacitorUpdaterEventsPlugin {
  addListener(
    eventName: string,
    listener: (event: unknown) => void,
  ): Promise<OtaListenerHandle> | OtaListenerHandle;
}

interface CapacitorUpdaterReloadPlugin {
  reload(): Promise<unknown>;
}

/** The global-scope shape the duck-typed plugin lookup reads; injectable for tests. */
export interface OtaGlobalScope {
  Capacitor?: { Plugins?: Record<string, unknown> };
}

function updaterPlugin(scope: OtaGlobalScope): CapacitorUpdaterPlugin | null {
  const plugin = scope.Capacitor?.Plugins?.CapacitorUpdater;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Partial<CapacitorUpdaterPlugin>;
  return typeof candidate.notifyAppReady === 'function'
    ? (candidate as CapacitorUpdaterPlugin)
    : null;
}

// Separate capability lookups on purpose: each caller degrades to a no-op on
// exactly the method IT needs, so an older or partially-injected plugin never
// breaks the unrelated calls (notifyAppReady must keep confirming even if
// addListener were absent).
function updaterEventsPlugin(scope: OtaGlobalScope): CapacitorUpdaterEventsPlugin | null {
  const plugin = scope.Capacitor?.Plugins?.CapacitorUpdater;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Partial<CapacitorUpdaterEventsPlugin>;
  return typeof candidate.addListener === 'function'
    ? (candidate as CapacitorUpdaterEventsPlugin)
    : null;
}

function updaterReloadPlugin(scope: OtaGlobalScope): CapacitorUpdaterReloadPlugin | null {
  const plugin = scope.Capacitor?.Plugins?.CapacitorUpdater;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Partial<CapacitorUpdaterReloadPlugin>;
  return typeof candidate.reload === 'function'
    ? (candidate as CapacitorUpdaterReloadPlugin)
    : null;
}

/**
 * Confirm the currently running OTA bundle as healthy. Returns true when the
 * plugin was reachable and acknowledged, false on every no-op path (web,
 * desktop, plugin absent, native call failed). Never throws: a failed confirm
 * must not break boot, and the worst outcome is the plugin's own rollback.
 */
export async function notifyOtaAppReady(
  opts: { native?: boolean; scope?: OtaGlobalScope } = {},
): Promise<boolean> {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return false;
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const plugin = updaterPlugin(scope);
  if (!plugin) return false;
  try {
    await plugin.notifyAppReady();
    return true;
  } catch (err) {
    console.warn('OTA notifyAppReady failed', err);
    return false;
  }
}

/** The download-lifecycle callbacks the boot gate consumes; percent is 0..100. */
export interface OtaUpdateHandlers {
  onProgress(percent: number): void;
  onComplete(): void;
  onFailed(): void;
}

function coercePercent(event: unknown): number {
  const percent = (event as { percent?: unknown } | null | undefined)?.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

/**
 * Subscribe to the native updater's download events ('download' fires with a
 * percent throughout, 'downloadComplete'/'downloadFailed' close it out). The
 * native side downloads on its own in autoUpdate mode; this only OBSERVES so
 * the gate can paint progress. Returns an unsubscribe that also covers
 * listener handles that resolve late. Never throws: on web/desktop, a missing
 * plugin, or a bridge failure the handlers simply never fire.
 */
export function watchOtaUpdates(
  handlers: OtaUpdateHandlers,
  opts: { native?: boolean; scope?: OtaGlobalScope } = {},
): () => void {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return () => {};
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const plugin = updaterEventsPlugin(scope);
  if (!plugin) return () => {};

  let closed = false;
  const handles: OtaListenerHandle[] = [];
  const track = (result: Promise<OtaListenerHandle> | OtaListenerHandle): void => {
    void Promise.resolve(result)
      .then((handle) => {
        // Unsubscribed before the bridge answered: remove immediately.
        if (closed) void Promise.resolve(handle.remove()).catch(() => {});
        else handles.push(handle);
      })
      .catch((err) => console.warn('OTA listener registration failed', err));
  };
  const guarded = (fn: () => void) => {
    if (closed) return;
    try {
      fn();
    } catch (err) {
      // A handler throw must never propagate into the native bridge callback.
      console.warn('OTA update handler failed', err);
    }
  };
  try {
    track(
      plugin.addListener('download', (ev) => guarded(() => handlers.onProgress(coercePercent(ev)))),
    );
    track(plugin.addListener('downloadComplete', () => guarded(() => handlers.onComplete())));
    track(plugin.addListener('downloadFailed', () => guarded(() => handlers.onFailed())));
  } catch (err) {
    console.warn('OTA listener registration failed', err);
  }
  return () => {
    closed = true;
    for (const handle of handles.splice(0)) {
      try {
        void Promise.resolve(handle.remove()).catch(() => {});
      } catch {
        // A failed remove only leaks an inert listener; never break teardown.
      }
    }
  };
}

/**
 * Apply a staged (fully downloaded) OTA bundle NOW via the plugin's reload():
 * the same apply that autoUpdate performs on the next backgrounding, pulled
 * forward so the pre-game gate can finish visibly. On a real apply the
 * WebView reloads and this JS context is destroyed, usually mid-await; false
 * means the reload path was unavailable (web, plugin absent, bridge error)
 * and the caller should fall back to the background apply. Never throws.
 */
export async function applyPendingOtaUpdate(
  opts: { native?: boolean; scope?: OtaGlobalScope } = {},
): Promise<boolean> {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return false;
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const plugin = updaterReloadPlugin(scope);
  if (!plugin) return false;
  try {
    await plugin.reload();
    // Some bridges resolve the call in the same tick the reload tears the
    // context down, so a resolve here does NOT prove nothing happened. Treat
    // it as success: the worst case (plugin resolved but declined to reload)
    // degrades to the pre-existing apply-on-background behavior.
    return true;
  } catch (err) {
    console.warn('OTA reload failed', err);
    return false;
  }
}
