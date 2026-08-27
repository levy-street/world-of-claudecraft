// Type declarations for the CommonJS Linux GPU backend lever (electron/gpu_backend.cjs),
// which electron/main.cjs invokes at runtime and tests/electron_gpu_backend.test.ts exercises
// directly. main.cjs itself runs outside tsc; these types serve the test.

import type { SelfSpawn } from './gpu_preference.cjs';

export type GpuBackendSetting = 'auto' | 'vulkan' | 'opengl';
export type VulkanVerdict = 'untested' | 'ok' | 'failed';
export type GpuBackend = 'vulkan' | 'default';

export const GPU_BACKEND_ENV: string;
export const GPU_BACKEND_SETTINGS: readonly GpuBackendSetting[];
export const VULKAN_BACKEND_SWITCHES: ReadonlyArray<readonly [string, string]>;
export const VULKAN_TRIAL_RELAUNCH_MARKER: string;
export const VULKAN_VERDICTS: readonly VulkanVerdict[];

export interface GpuBackendLaunch {
  backend: GpuBackend;
  trial: boolean;
  reason: string;
}

export interface DecideGpuBackendLaunchInput {
  platform: string;
  env?: Record<string, string | undefined>;
  prefs?: { gpuBackend?: unknown; vulkanVerdict?: unknown } | null;
}
export function decideGpuBackendLaunch(input: DecideGpuBackendLaunchInput): GpuBackendLaunch;

export function applyGpuBackendSwitches(
  app: { commandLine: { appendSwitch(name: string, value: string): void } },
  launch: GpuBackendLaunch | null | undefined,
): void;

export function hasGetGpuInfoEvidence(
  aux:
    | {
        glRenderer?: unknown;
        softwareRendering?: unknown;
      }
    | null
    | undefined,
): boolean;

export function judgeVulkanLaunch(reading: {
  glRenderer?: unknown;
  softwareRendering?: unknown;
}): VulkanVerdict;

export interface RelaunchAfterFailedTrialDeps {
  env?: Record<string, string | undefined>;
  argv?: string[];
  execPath?: string;
  spawn?: SelfSpawn;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
}
export function relaunchAfterFailedTrial(deps?: RelaunchAfterFailedTrialDeps): boolean;
