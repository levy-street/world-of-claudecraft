// Capgo capacitor-updater glue for the native mobile shells (self-hosted OTA).
//
// The plugin's update machinery is native-side and config-driven
// (capacitor.config.ts CapacitorUpdater: autoUpdate against our own
// /api/ota/updates endpoint, stats disabled). The JS side is deliberately
// thin, a handful of duck-typed calls:
// - notifyAppReady(): the ONE mandatory call. A freshly applied bundle that
//   never reports ready within the plugin's appReadyTimeout is treated as
//   broken and rolled back to the previous bundle on the next launch.
//   main.ts calls this once at boot, so a bundle broken badly enough that
//   boot never runs simply never confirms, and the rollback safety net fires.
// - watchOtaUpdates(): subscribes to the native auto-updater's download
//   lifecycle events so the boot gate (ota_update_gate.ts) can show real
//   progress instead of the silent atBackground default, and learn the moment
//   a finished download is actually STAGED (see below).
// - pendingOtaBundleId(): asks the plugin whether it already holds a
//   downloaded bundle it has not switched to. The download runs natively and
//   can finish before this JS context existed (a cold start, or the context a
//   previous apply reloaded), in which case no event will ever tell us.
// - applyPendingOtaUpdate(): switches to a staged bundle NOW via the plugin's
//   set({ id }), the same switch autoUpdate performs on the next app
//   backgrounding. On success the WebView reloads and the current JS context
//   is destroyed mid-await.
//
// Event ordering, which the gate is built around: the plugin emits
// 'downloadComplete' from inside its download routine, BEFORE it verifies the
// bundle and records it as the next bundle; 'updateAvailable' fires once the
// bundle is verified, one statement before that record is written. So a
// reload() issued on downloadComplete finds no pending bundle and reloads the
// bundle already running, and the player boots into the same stale client
// (then meets the incompatible-version rejection at the door). The apply
// therefore keys on updateAvailable and names the bundle explicitly through
// set({ id }) rather than trusting the plugin's next marker to be in place.
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

interface CapacitorUpdaterSetPlugin {
  set(options: { id: string }): Promise<unknown>;
}

interface CapacitorUpdaterBundleQueryPlugin {
  getNextBundle(): Promise<unknown>;
  current(): Promise<unknown>;
}

/** The global-scope shape the duck-typed plugin lookup reads; injectable for tests. */
export interface OtaGlobalScope {
  Capacitor?: { Plugins?: Record<string, unknown> };
}

// Separate capability lookups on purpose: each caller degrades to a no-op on
// exactly the methods IT needs, so an older or partially-injected plugin never
// breaks the unrelated calls (notifyAppReady must keep confirming even if
// addListener were absent).
function updaterPluginWith<T extends object>(
  scope: OtaGlobalScope,
  methods: readonly string[],
): T | null {
  const plugin = scope.Capacitor?.Plugins?.CapacitorUpdater;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Record<string, unknown>;
  return methods.every((method) => typeof candidate[method] === 'function') ? (plugin as T) : null;
}

const updaterPlugin = (scope: OtaGlobalScope) =>
  updaterPluginWith<CapacitorUpdaterPlugin>(scope, ['notifyAppReady']);
const updaterEventsPlugin = (scope: OtaGlobalScope) =>
  updaterPluginWith<CapacitorUpdaterEventsPlugin>(scope, ['addListener']);
const updaterReloadPlugin = (scope: OtaGlobalScope) =>
  updaterPluginWith<CapacitorUpdaterReloadPlugin>(scope, ['reload']);
const updaterSetPlugin = (scope: OtaGlobalScope) =>
  updaterPluginWith<CapacitorUpdaterSetPlugin>(scope, ['set']);
const updaterBundleQueryPlugin = (scope: OtaGlobalScope) =>
  updaterPluginWith<CapacitorUpdaterBundleQueryPlugin>(scope, ['getNextBundle', 'current']);

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
  /** The bytes are down ('downloadComplete'); the plugin is still verifying. */
  onComplete(): void;
  /**
   * The bundle is verified and about to be recorded as the next bundle
   * ('updateAvailable'): the only signal an immediate apply may act on.
   * bundleId is null when the payload carried none; the apply then asks the
   * plugin for its next marker instead.
   */
  onStaged(bundleId: string | null): void;
  onFailed(): void;
}

function coercePercent(event: unknown): number {
  const percent = (event as { percent?: unknown } | null | undefined)?.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

interface BundleRecord {
  id: string;
  status: string | null;
}

/** The `{ id, version, status, ... }` BundleInfo shape, read defensively. */
function bundleRecordOf(value: unknown): BundleRecord | null {
  if (!value || typeof value !== 'object') return null;
  const { id, status } = value as { id?: unknown; status?: unknown };
  if (typeof id !== 'string' || id.length === 0) return null;
  return { id, status: typeof status === 'string' ? status : null };
}

/** Every plugin event that names a bundle wraps it as `{ bundle: BundleInfo }`. */
function eventBundleId(event: unknown): string | null {
  return bundleRecordOf((event as { bundle?: unknown } | null | undefined)?.bundle)?.id ?? null;
}

/**
 * Subscribe to the native updater's download events ('download' fires with a
 * percent throughout, 'downloadComplete' when the bytes are down,
 * 'updateAvailable' once the bundle is verified and being staged,
 * 'downloadFailed' on any failure). The native side downloads on its own in
 * autoUpdate mode; this only OBSERVES so the gate can paint progress and time
 * its apply. Returns an unsubscribe that also covers listener handles that
 * resolve late. Never throws: on web/desktop, a missing plugin, or a bridge
 * failure the handlers simply never fire.
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
    track(
      plugin.addListener('updateAvailable', (ev) =>
        guarded(() => handlers.onStaged(eventBundleId(ev))),
      ),
    );
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

/** Bundle statuses under which the plugin's next marker names nothing switchable. */
const UNSWITCHABLE_STATUSES: ReadonlySet<string> = new Set([
  'error',
  'downloading',
  'deleted',
  'deleting',
]);

/**
 * The id of a downloaded bundle the plugin has recorded as "next" but not
 * switched to yet, or null. This is how a JS context learns about a download
 * that finished before it existed (cold start; the context an earlier apply
 * reloaded), since no event replays.
 *
 * Null whenever the answer cannot be PROVEN to be a different bundle: either
 * query unavailable, no next marker, a marker in an unswitchable state, or a
 * marker naming the running bundle. That last one is routine, not an error:
 * set({ id }) leaves the next marker pointing at what is now current, and
 * switching to the running bundle again would reload the app forever.
 */
export async function pendingOtaBundleId(
  opts: { native?: boolean; scope?: OtaGlobalScope } = {},
): Promise<string | null> {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return null;
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const plugin = updaterBundleQueryPlugin(scope);
  if (!plugin) return null;
  try {
    const [nextRaw, currentRaw] = await Promise.all([plugin.getNextBundle(), plugin.current()]);
    const next = bundleRecordOf(nextRaw);
    if (!next || (next.status !== null && UNSWITCHABLE_STATUSES.has(next.status))) return null;
    const current = bundleRecordOf((currentRaw as { bundle?: unknown } | null | undefined)?.bundle);
    if (!current) return null;
    return next.id === current.id ? null : next.id;
  } catch (err) {
    console.warn('OTA pending bundle query failed', err);
    return null;
  }
}

async function runningOtaBundleId(scope: OtaGlobalScope): Promise<string | null> {
  const plugin = updaterBundleQueryPlugin(scope);
  if (!plugin) return null;
  try {
    const currentRaw = await plugin.current();
    return (
      bundleRecordOf((currentRaw as { bundle?: unknown } | null | undefined)?.bundle)?.id ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Switch to a staged (downloaded and verified) OTA bundle NOW, the same
 * switch autoUpdate performs on the next backgrounding, pulled forward so the
 * pre-game gate can finish visibly. The bundle is named explicitly through
 * the plugin's set({ id }): with `bundleId` (from the updateAvailable payload)
 * when the caller has it, else whatever the plugin's own next marker names.
 * set() switches the current bundle and reloads the WebView; the new bundle
 * then confirms itself through notifyAppReady or the plugin rolls it back.
 *
 * On a real apply this JS context is destroyed, usually mid-await; false
 * means nothing was switched (web, plugin absent, no staged bundle to name,
 * the named bundle already running, bridge error) and the caller should fall
 * back to the plugin's apply-on-background. Never throws.
 *
 * reload() is kept only as the fallback for a plugin without set(): it
 * applies the plugin's next marker if that is already written and otherwise
 * merely reloads the running bundle.
 */
export async function applyPendingOtaUpdate(
  opts: { bundleId?: string | null; native?: boolean; scope?: OtaGlobalScope } = {},
): Promise<boolean> {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return false;
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const setPlugin = updaterSetPlugin(scope);
  if (!setPlugin) {
    const reloadPlugin = updaterReloadPlugin(scope);
    if (!reloadPlugin) return false;
    try {
      await reloadPlugin.reload();
      return true;
    } catch (err) {
      console.warn('OTA reload failed', err);
      return false;
    }
  }
  const bundleId = opts.bundleId ?? (await pendingOtaBundleId({ native, scope }));
  if (!bundleId) return false;
  // Never switch to the bundle already running: the plugin would reload the
  // same code and this gate would meet the same staged id again on boot.
  const running = await runningOtaBundleId(scope);
  if (running !== null && running === bundleId) return false;
  try {
    await setPlugin.set({ id: bundleId });
    // Some bridges resolve the call in the same tick the reload tears the
    // context down, so a resolve here does NOT prove nothing happened. Treat
    // it as success: the worst case (plugin resolved but declined to reload)
    // degrades to the pre-existing apply-on-background behavior.
    return true;
  } catch (err) {
    console.warn('OTA apply failed', err);
    return false;
  }
}
