// Type declarations for the CommonJS Linux GPU backend lever (electron/gpu_backend.cjs),
// which electron/main.cjs invokes at runtime and tests/electron_gpu_backend.test.ts exercises
// directly. main.cjs itself runs outside tsc; these types serve the test.

import type { AutoBackendCeiling } from './gpu_backend_policy.cjs';
import type { SelfSpawn } from './gpu_preference.cjs';

export type GpuBackendSetting = 'auto' | 'vulkan' | 'opengl';
/** A rung of the ladder, best first; see GPU_BACKEND_RUNGS. */
export type GpuBackendRung = 'vulkan-parallel-compile' | 'vulkan-plain' | 'opengl';
export type GpuBackend = 'vulkan' | 'default';

/**
 * The certainty that a session once ran healthy here, and under what. The adapter is
 * the active GPU's `vendorId:deviceId` from app.getGPUInfo, or '' when none was listed
 * (read as "unknown, the same machine"); never the renderer string, which names the
 * backend and would read the same card on OpenGL as another machine.
 */
export interface GpuBackendProof {
  backend: GpuBackendRung;
  appVersion: string;
  gpuAdapter: string;
}

/** The Auto memory, as it sits in desktop-prefs.json. */
export interface GpuBackendMemory {
  gpuBackend?: unknown;
  gpuBackendToAttempt?: unknown;
  gpuBackendProof?: GpuBackendProof | null;
  consecutiveGpuLaunchCrashes?: unknown;
  launchesSinceBackendReprobe?: unknown;
}

export const GPU_BACKEND_ENV: string;
export const GPU_BACKEND_RESCUE_ENV: string;
export const GPU_BACKEND_RUNGS: readonly GpuBackendRung[];
export const GPU_BACKEND_SETTINGS: readonly GpuBackendSetting[];
export const MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES: number;
export const REPROBE_HIGHER_BACKEND_EVERY_LAUNCHES: number;
export const REPROBE_WITHOUT_PROOF_EVERY_LAUNCHES: number;
export const SESSION_HEALTHY_AFTER_MS: number;
export const TOP_GPU_BACKEND_RUNG: GpuBackendRung;
export const VULKAN_BACKEND_SWITCHES: ReadonlyArray<readonly [string, string]>;
export const VULKAN_PARALLEL_COMPILE_SWITCH: readonly [string, string];

export interface GpuBackendLaunch {
  backend: GpuBackend;
  /** The parallel-compile ANGLE feature rides along (the top rung). */
  parallel: boolean;
  /** The rung this launch runs, which the judge compares its reading against. */
  rung: GpuBackendRung;
  /** This launch is Auto's periodic climb back to a higher rung. */
  reprobed: boolean;
  reason: string;
  /** The ladder applies (Linux); off it nothing is rescued, counted or remembered. */
  ladder: boolean;
  /** This launch belongs to the Auto memory (reads it, and writes it once judged). */
  auto: boolean;
  /** A rescue spawned this process; it inherits `auto` from its chain. */
  rescued: boolean;
  /** Auto wanted a higher rung and the policy's ceiling held it here; not `auto`. */
  capped: boolean;
}

export interface DecideGpuBackendLaunchInput {
  platform: string;
  env?: Record<string, string | undefined>;
  prefs?: GpuBackendMemory | null;
  /** This build's version; a proof from another version does not aim the climb. */
  appVersion?: string;
  /** The policy's ceiling; an Auto launch at or above it runs the ceiling, capped. */
  autoCeiling?: AutoBackendCeiling | null;
}
export function decideGpuBackendLaunch(input: DecideGpuBackendLaunchInput): GpuBackendLaunch;

/** A launch above `ceiling.rung` becomes a capped launch of that rung; else unchanged. */
export function capAutoLaunch(
  launch: GpuBackendLaunch,
  ceiling: AutoBackendCeiling | null | undefined,
): GpuBackendLaunch;

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

/** The rung a launch ACTUALLY bound, from what the GPU process reports. */
export function judgeGpuBackendLaunch(reading: {
  glRenderer?: unknown;
  softwareRendering?: unknown;
  /** Whether this launch carried the parallel-compile feature (the rung it asked for). */
  parallel?: boolean;
  /** Whether the page's context listed KHR_parallel_shader_compile; unknown keeps the rung. */
  parallelCompile?: boolean;
}): GpuBackendRung;

/** A Vulkan rung that bound something other than Vulkan: the rescue's judged trigger. */
export function backendDidNotBind(askedRung: unknown, boundRung: unknown): boolean;

/** The proof's machine key from app.getGPUInfo's device list, or '' when none is active. */
export function activeGpuAdapterKey(
  devices: ReadonlyArray<{ vendorId?: unknown; deviceId?: unknown; active?: unknown }> | undefined,
): string;

export function rungAbove(rung: unknown): GpuBackendRung | null;
export function rungBelow(rung: unknown): GpuBackendRung | null;
export function isHigherRung(rung: unknown, other: unknown): boolean;

/** Whether a launch should be rescued because its backend never came up at all. */
export function shouldRescueMissingGpu(input: { rung?: unknown; hardwareWebgl?: boolean }): boolean;

/** Whether to tell the player their own Vulkan choice is not what is running. */
export function requestedBackendUnavailable(input: {
  setting?: unknown;
  judged?: boolean;
  boundRung?: unknown;
}): boolean;

export function demoteAfterRepeatedCrashes(input: {
  prefs?: GpuBackendMemory | null;
  rung: unknown;
}): Partial<GpuBackendMemory> | null;

export function gpuBackendMemoryAfterHealthySession(input: {
  prefs?: GpuBackendMemory | null;
  rung: unknown;
  appVersion: string;
  gpuAdapter: string;
  /** A rescued child writes the proof it earned and never the attempt or the streak. */
  rescued?: boolean;
}): Partial<GpuBackendMemory> | null;

export function launchCounterAfterAutoLaunch(input: {
  prefs?: GpuBackendMemory | null;
  launch?: GpuBackendLaunch | null;
}): Partial<GpuBackendMemory> | null;

export interface RelaunchOnLowerBackendDeps {
  env?: Record<string, string | undefined>;
  argv?: string[];
  execPath?: string;
  spawn?: SelfSpawn;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
  /** The child's 'spawn' event: it exists (the shell releases its lock and exits there). */
  onSpawned?: () => void;
  /** The child's 'error' event: it never started; this process keeps running. */
  onSpawnFailed?: (err: unknown) => void;
}
/** Rescue: spawn a child on the rung BELOW `rung`; true when spawn() returned a handle
 *  (the child's start, or its failure to start, is reported through the callbacks). */
export function relaunchOnLowerBackend(
  deps: RelaunchOnLowerBackendDeps | undefined,
  rung: unknown,
): boolean;
