// The desktop shell's persisted settings, seen from the game in one place:
// the boot reflection of every shell-stored value into the local store, and
// the apply arm that pushes a player's change back out. Each value keeps its
// own module (the polarity, the next-launch contract, the capability probe);
// this one only fans out, so main.ts stays a firewall with one call each way.

import type { DesktopBridge } from '../runtime';
import {
  type DesktopDisplayModeSettings,
  syncDesktopDisplayModeSetting,
} from './desktop_display_mode_sync';
import {
  type DesktopGpuBackendSettings,
  initDesktopGpuBackendActive,
  pushDesktopGpuBackend,
  syncDesktopGpuBackendSetting,
} from './desktop_gpu_backend_sync';
import {
  type DesktopGpuPrefSettings,
  pushDesktopGpuPref,
  syncDesktopGpuPrefSetting,
} from './desktop_gpu_pref_sync';
import { reportDesktopGpuRenderer } from './desktop_gpu_report';
import { syncDesktopLaunchSettings } from './desktop_next_launch_settings';
import { pushDiscordPresenceEnabled } from './discord_presence';

export type DesktopShellSettings = DesktopGpuPrefSettings &
  DesktopGpuBackendSettings &
  DesktopDisplayModeSettings;

/** Reflect every shell-stored value at boot, report the page's renderer string
 *  the shell judges this launch on, and start listening for the rung it
 *  actually bound. Each reflection is its own fire-and-forget round trip; none
 *  blocks the others or the boot. */
export function syncDesktopShellSettings(
  bridge: DesktopBridge | null | undefined,
  createSettings: () => DesktopShellSettings,
): void {
  reportDesktopGpuRenderer(bridge);
  void syncDesktopGpuPrefSetting(bridge, createSettings);
  void syncDesktopGpuBackendSetting(bridge, createSettings);
  // The judgement lands AFTER the renderer report above, so this is a
  // subscription rather than a read: the options row reads the latched value
  // whenever the player opens it.
  initDesktopGpuBackendActive(bridge);
  void syncDesktopDisplayModeSetting(bridge, createSettings);
  // What this launch started with, for the two next-launch settings above: the
  // options window offers a restart when a stored value has moved off it.
  void syncDesktopLaunchSettings(bridge);
}

export interface DesktopApplySettings {
  set(key: 'forceHighPerfGpu', value: boolean): boolean;
  set(key: 'discordPresence', value: boolean): boolean;
  set(key: 'gpuBackend', value: number): number;
}

/** The apply arm for a shell-mirrored setting: stores the value locally and
 *  pushes it to the shell (the GPU levers apply at the next launch, the
 *  presence toggle live). True when the key was one of the shell's. */
export function applyDesktopShellSetting(
  key: string,
  value: unknown,
  settings: DesktopApplySettings,
  bridge: DesktopBridge | null | undefined,
): boolean {
  if (key === 'forceHighPerfGpu') {
    // The push owns the inversion (the shell stores the opt-out).
    pushDesktopGpuPref(bridge, settings.set('forceHighPerfGpu', !!value));
    return true;
  }
  if (key === 'gpuBackend') {
    pushDesktopGpuBackend(bridge, settings.set('gpuBackend', Number(value)));
    return true;
  }
  if (key === 'discordPresence') {
    // Same polarity on both sides: the shell drops its RPC connection on false.
    pushDiscordPresenceEnabled(bridge, settings.set('discordPresence', !!value));
    return true;
  }
  return false;
}
