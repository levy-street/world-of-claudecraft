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
  const { setting } = state as { setting?: unknown };
  if (setting !== 'auto' && setting !== 'vulkan' && setting !== 'opengl') return;
  createSettings().set('gpuBackend', gpuBackendValueFromSetting(setting));
}
