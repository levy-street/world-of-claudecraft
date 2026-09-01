// Settings that take effect at the NEXT launch of the desktop shell, seen from
// the game: the registry of such settings, the snapshot of what THIS launch
// started with, and the restart that applies a changed one.
//
// The shell reads two of its stored preferences before Electron's own startup
// (the discrete-GPU force, the Linux graphics backend), so a setter persists
// them for the next launch and the running session keeps the old value. The
// getters serve the STORED values, which a setter moves live, so the shell
// also hands out a frozen snapshot of what it started with
// (electron/launch_settings.cjs, `getLaunchSettings`). A local setting that
// differs from that snapshot is "changed, restart to apply", and the options
// window offers the restart (src/ui/restart_strip_painter.ts) wherever such a row
// lives, since the rows sit in different tabs.
//
// Adding a next-launch setting is one entry in NEXT_LAUNCH_SETTINGS: the local
// key, the bridge capability that shows its row (a key whose row is hidden on
// this platform can never be pending, whatever a transferred settings blob
// says), and how to read its launch value off the snapshot. The push out and
// the boot reflection keep their own modules (desktop_gpu_pref_sync.ts,
// desktop_gpu_backend_sync.ts); this one only compares.
//
// Lives in src/game so main.ts stays a firewall, beside the other bridge
// consumers. Pinned by tests/desktop_next_launch_settings.test.ts.

import type { DesktopBridge, DesktopLaunchSettings } from '../runtime';
import { desktopGpuBackendSupported, gpuBackendValueFromSetting } from './desktop_gpu_backend_sync';
import { desktopGpuPrefSupported } from './desktop_gpu_pref_sync';
import type { GameSettings } from './settings';

export type NextLaunchSettingKey = 'forceHighPerfGpu' | 'gpuBackend';

export interface NextLaunchSetting<K extends NextLaunchSettingKey = NextLaunchSettingKey> {
  readonly key: K;
  /** Whether the installed shell shows this setting's row at all. */
  readonly supported: (bridge: DesktopBridge | null | undefined) => boolean;
  /** The local value THIS launch started with, read off the shell's snapshot;
   *  undefined when the snapshot does not carry it (an older shell). */
  readonly launchValue: (snapshot: DesktopLaunchSettings) => GameSettings[K] | undefined;
}

const BACKEND_SETTINGS = new Set(['auto', 'vulkan', 'opengl']);

export const NEXT_LAUNCH_SETTINGS: readonly NextLaunchSetting[] = [
  {
    key: 'forceHighPerfGpu',
    supported: desktopGpuPrefSupported,
    // The shell stores the opt-out; the row reads the force (the same inversion
    // desktop_gpu_pref_sync.ts makes at both of its crossings).
    launchValue: (snapshot) =>
      typeof snapshot.gpuForceOptOut === 'boolean' ? !snapshot.gpuForceOptOut : undefined,
  },
  {
    key: 'gpuBackend',
    supported: desktopGpuBackendSupported,
    launchValue: (snapshot) =>
      BACKEND_SETTINGS.has(snapshot.gpuBackend)
        ? gpuBackendValueFromSetting(snapshot.gpuBackend)
        : undefined,
  },
];

/** The minimal settings reader the comparison needs (the live Settings store). */
export interface NextLaunchSettingsReader {
  get<K extends NextLaunchSettingKey>(key: K): GameSettings[K];
}

/**
 * The keys whose local value differs from what `snapshot` launched with, among
 * the settings `bridge` shows a row for. Pure: the latched snapshot below is
 * one caller's input, a test's literal is another's. A key the snapshot does
 * not carry is never pending: no evidence, no restart to offer.
 */
export function pendingRestartKeysFor(
  snapshot: DesktopLaunchSettings | null | undefined,
  bridge: DesktopBridge | null | undefined,
  settings: NextLaunchSettingsReader,
  specs: readonly NextLaunchSetting[] = NEXT_LAUNCH_SETTINGS,
): NextLaunchSettingKey[] {
  if (!snapshot) return [];
  const pending: NextLaunchSettingKey[] = [];
  for (const spec of specs) {
    if (!spec.supported(bridge)) continue;
    const launched = spec.launchValue(snapshot);
    if (launched === undefined) continue;
    if (settings.get(spec.key) !== launched) pending.push(spec.key);
  }
  return pending;
}

/** The snapshot the shell handed us at boot, or null (the web, an older shell). */
let launchSnapshot: DesktopLaunchSettings | null = null;

function readSnapshot(state: unknown): DesktopLaunchSettings | null {
  if (!state || typeof state !== 'object') return null;
  const { gpuForceOptOut, gpuBackend } = state as {
    gpuForceOptOut?: unknown;
    gpuBackend?: unknown;
  };
  if (typeof gpuForceOptOut !== 'boolean') return null;
  if (typeof gpuBackend !== 'string' || !BACKEND_SETTINGS.has(gpuBackend)) return null;
  return { gpuForceOptOut, gpuBackend: gpuBackend as DesktopLaunchSettings['gpuBackend'] };
}

/**
 * Latch the shell's launch snapshot at boot. Fire-and-forget like the other
 * reflections: a missing getter (an older shell, the web), a dead channel or a
 * malformed answer leave the snapshot null, and null means the options window
 * never offers a restart, which is the right answer when nothing can be known.
 */
export async function syncDesktopLaunchSettings(
  bridge: DesktopBridge | null | undefined,
): Promise<void> {
  const read = bridge?.getLaunchSettings;
  if (typeof read !== 'function') return;
  let state: unknown;
  try {
    state = await read.call(bridge);
  } catch {
    return;
  }
  const snapshot = readSnapshot(state);
  if (snapshot) launchSnapshot = snapshot;
}

/** The keys pending a restart right now, against the latched snapshot. */
export function pendingRestartKeys(
  bridge: DesktopBridge | null | undefined,
  settings: NextLaunchSettingsReader,
): NextLaunchSettingKey[] {
  return pendingRestartKeysFor(launchSnapshot, bridge, settings);
}

/** True when the installed shell can restart itself on request. */
export function desktopRestartSupported(bridge: DesktopBridge | null | undefined): boolean {
  return typeof bridge?.restartApp === 'function';
}

/**
 * Ask the shell to restart. Resolves false when it could not (an older shell,
 * a dead channel, a child that never started), and the strip says so; when it
 * could, this process quits and the promise is moot. Never rejects.
 */
export async function requestDesktopRestart(
  bridge: DesktopBridge | null | undefined,
): Promise<boolean> {
  const restart = bridge?.restartApp;
  if (typeof restart !== 'function') return false;
  try {
    return (await restart.call(bridge)) === true;
  } catch {
    return false;
  }
}

/** Tests only: forget the latched snapshot between cases. */
export function resetDesktopLaunchSettingsForTest(): void {
  launchSnapshot = null;
}
