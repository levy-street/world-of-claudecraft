// Capgo capacitor-updater glue for the native mobile shells (self-hosted OTA).
//
// The plugin's update machinery is native-side and config-driven
// (capacitor.config.ts CapacitorUpdater: autoUpdate against our own
// /api/ota/updates endpoint, stats disabled); the ONE mandatory JS-side call
// is notifyAppReady(): a freshly applied bundle that never reports ready
// within the plugin's appReadyTimeout is treated as broken and rolled back to
// the previous bundle on the next launch. main.ts calls this once at boot, so
// a bundle broken badly enough that boot never runs simply never confirms,
// and the rollback safety net fires.
//
// Duck-typed off window.Capacitor.Plugins like native_app_update.ts (the
// bridge injects every registered native plugin there), so the web bundle
// never imports the plugin package and non-native hosts no-op.

import { NATIVE_APP } from './online';

interface CapacitorUpdaterPlugin {
  notifyAppReady(): Promise<unknown>;
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
