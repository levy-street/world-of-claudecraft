// The desktop shell's graphics backend choice (Linux: a Vulkan trial), seen
// from the renderer. The shell prefs store is the source of truth and applies
// the choice at the NEXT launch; this module owns the renderer half: whether
// the installed shell exposes the choice at all and on this platform, the
// reflection of the STORED value into the local setting at boot, and the push
// of a player's choice out. Same shape as desktop_gpu_pref_sync.ts; the two
// gates are independent (an older shell has the GPU preference but not this).

import type { DesktopBridge, DesktopGpuBackendSetting } from '../runtime';

/** The stored values, in the order the options row lists them. */
export const GPU_BACKEND_SETTING_VALUES = { auto: 0, vulkan: 1, opengl: 2 } as const;

export interface DesktopGpuBackendSettings {
  set(key: 'gpuBackend', value: number): number;
}

export function gpuBackendSettingFromValue(value: number): DesktopGpuBackendSetting {
  const rounded = Math.round(value);
  if (rounded === GPU_BACKEND_SETTING_VALUES.vulkan) return 'vulkan';
  if (rounded === GPU_BACKEND_SETTING_VALUES.opengl) return 'opengl';
  return 'auto';
}

export function gpuBackendValueFromSetting(setting: string): number {
  if (setting === 'vulkan') return GPU_BACKEND_SETTING_VALUES.vulkan;
  if (setting === 'opengl') return GPU_BACKEND_SETTING_VALUES.opengl;
  return GPU_BACKEND_SETTING_VALUES.auto;
}

/** True when the installed shell exposes BOTH halves of the choice AND says
 *  this platform has one (Linux only; a Windows or macOS shell exposes the
 *  methods and answers false, so it shows no row). A bridge CAPABILITY plus
 *  a synchronous platform value, never isNativeAppShell() (true in the
 *  mobile shells too) and never an async answer the options window would
 *  have to wait for. */
export function desktopGpuBackendSupported(bridge: DesktopBridge | null | undefined): boolean {
  return (
    typeof bridge?.getGpuBackend === 'function' &&
    typeof bridge?.setGpuBackend === 'function' &&
    bridge?.hasGpuBackendChoice === true
  );
}

/** Push a player's choice to the shell store. Fire and forget: the shell
 *  applies it at the next launch, and a missing setter, a dead channel or a
 *  rejected write leave the options window undisturbed. */
export function pushDesktopGpuBackend(
  bridge: DesktopBridge | null | undefined,
  value: number,
): void {
  const write = bridge?.setGpuBackend;
  if (typeof write !== 'function') return;
  try {
    void Promise.resolve(write.call(bridge, gpuBackendSettingFromValue(value))).catch(() => {});
  } catch {
    /* the shell's channel is gone; the stored setting is still the player's */
  }
}

/** Reflect the shell's stored choice into the local setting at boot, writing
 *  settings.set DIRECTLY (not through the options change path, which would
 *  push the shell's own value straight back at it). Takes a settings FACTORY
 *  for the same reason desktop_gpu_pref_sync.ts does. Order matters: this
 *  runs at module scope in main.ts, before startGame's apply-all loop pushes
 *  the local value back through the `gpuBackend` arm; inverted, the local
 *  value would win over the shell's. */
export async function syncDesktopGpuBackendSetting(
  bridge: DesktopBridge | null | undefined,
  createSettings: () => DesktopGpuBackendSettings,
): Promise<void> {
  const read = bridge?.getGpuBackend;
  if (typeof read !== 'function') return;
  let state: unknown;
  try {
    state = await read.call(bridge);
  } catch {
    return;
  }
  if (!state || typeof state !== 'object') return;
  // The same answer carries the rung this launch is running: latch it here
  // rather than asking the shell twice for one payload. The latch and the row's
  // reader are at the foot of this module.
  activeState = readActive(state) ?? activeState;
  const { setting } = state as { setting?: unknown };
  if (setting !== 'auto' && setting !== 'vulkan' && setting !== 'opengl') return;
  createSettings().set('gpuBackend', gpuBackendValueFromSetting(setting));
}

/** What the options row shows about THIS launch, or null when the shell has not
 *  judged it yet (and on every non-desktop caller). Only the two fields the row
 *  reads: the row is about telling a player their choice did not take, not
 *  about mirroring the shell's whole state. */
export interface DesktopGpuBackendActive {
  active: string;
  requestedUnavailable: boolean;
}

/** The latched reading, refreshed by the shell's push. Latched rather than
 *  awaited per open, because the options row is built synchronously and a
 *  promise would paint the row once without the line and never again. */
let activeState: DesktopGpuBackendActive | null = null;

function readActive(state: unknown): DesktopGpuBackendActive | null {
  if (!state || typeof state !== 'object') return null;
  const { active, requestedUnavailable } = state as {
    active?: unknown;
    requestedUnavailable?: unknown;
  };
  // A rung the shell has not judged yet is absent, not a guess: showing the
  // asked-for backend as the active one is exactly the lie the row exists to
  // stop. Same for the flag, which is a strict boolean or nothing.
  if (typeof active !== 'string' || active === '') return null;
  if (typeof requestedUnavailable !== 'boolean') return null;
  return { active, requestedUnavailable };
}

/** Subscribe to the shell's push. The FIRST reading comes from the boot sync
 *  above, which already asks for the same payload; this is only how the row
 *  learns the rung once the shell has judged the launch, which happens after
 *  that read. Returns the unsubscribe. */
export function initDesktopGpuBackendActive(bridge: DesktopBridge | null | undefined): () => void {
  const subscribe = bridge?.onGpuBackendState;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, (state) => {
    activeState = readActive(state) ?? activeState;
  });
}

/** The reading the options row paints, or null while there is nothing to say. */
export function desktopGpuBackendActive(): DesktopGpuBackendActive | null {
  return activeState;
}

/** Tests only: forget the latched reading between cases. */
export function resetDesktopGpuBackendActiveForTest(): void {
  activeState = null;
}
