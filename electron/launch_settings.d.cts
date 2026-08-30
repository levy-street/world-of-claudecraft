// Type declarations for the next-launch settings lever (electron/launch_settings.cjs): the
// frozen snapshot of what this process started with, and the player-requested restart.
// main.cjs runs outside tsc; these types serve tests/electron_launch_settings.test.ts.

import type { GpuBackendSetting } from './gpu_backend.cjs';
import type { SelfSpawn } from './gpu_preference.cjs';

/** The next-launch settings as this process read them at startup, frozen. */
export interface LaunchSettings {
  readonly gpuForceOptOut: boolean;
  readonly gpuBackend: GpuBackendSetting;
}

export function launchSettingsSnapshot(
  prefs: { gpuForceOptOut?: unknown; gpuBackend?: unknown } | null | undefined,
): LaunchSettings;

/** This process's environment minus what the shell's own relaunch levers planted. */
export function restartEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined>;

/** This process's argv minus the X11 ozone argument the PRIME relaunch appended. */
export function restartArgv(
  argv: readonly string[],
  env: Record<string, string | undefined> | undefined,
): string[];

export interface RestartAppDeps {
  env?: Record<string, string | undefined>;
  argv?: string[];
  execPath?: string;
  spawn?: SelfSpawn;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
  /** The child's 'spawn' event: it exists (the shell hands over its lock and quits there). */
  onSpawned?: () => void;
}
/** Resolves true on the child's 'spawn' event, false when it never started or spawn threw. */
export function restartApp(deps?: RestartAppDeps): Promise<boolean>;
