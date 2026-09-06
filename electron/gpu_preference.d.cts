// Type declarations for the CommonJS high-performance-GPU helper (electron/gpu_preference.cjs),
// which electron/main.cjs invokes at runtime and tests/electron_gpu_preference.test.ts exercises
// directly. main.cjs itself runs outside tsc; these types serve the test.

export const USER_GPU_PREFERENCES_KEY: string;
export const HIGH_PERFORMANCE_PREFERENCE: string;
export const HIGH_PERF_GPU_SWITCHES: readonly string[];
export const LINUX_PRIME_ENV: Readonly<Record<string, string>>;
export const LINUX_OZONE_X11_ARG: string;
export const PRIME_RELAUNCH_MARKER: string;
/** Beside the marker: the env names and the argv addition the PRIME relaunch planted. */
export const PRIME_RELAUNCH_ADDED_ENV: string;

export function buildLinuxPrimeEnv(
  existingEnv?: Record<string, string | undefined>,
  fileExists?: (path: string) => boolean,
): Record<string, string>;
export function hasExplicitOzonePlatformArg(argv?: string[]): boolean;
export function isLinuxHybridGpu(
  readdir?: (path: string) => string[],
  readFile?: (path: string, encoding: 'utf8') => string,
): boolean;
export function shouldRelaunchForLinuxPrime(
  env?: Record<string, string | undefined>,
  argv?: string[],
  fileExists?: (path: string) => boolean,
): boolean;

export interface SelfSpawnedChild {
  unref?(): void;
  /** Node's ChildProcess events: 'spawn' once the child exists, 'error' when it never will. */
  once?(event: 'spawn' | 'error', listener: (...args: unknown[]) => void): unknown;
}
export type SelfSpawn = (command: string, args: string[], options?: unknown) => SelfSpawnedChild;

export function resolveSelfSpawnTarget(
  env: Record<string, string | undefined> | undefined,
  execPath: string,
): string;

export interface SpawnDetachedSelfDeps {
  env: Record<string, string | undefined>;
  argv: string[];
  execPath?: string;
  spawn?: SelfSpawn;
  /** The child's 'spawn' event: it exists. */
  onSpawned?: (spawnTarget: string) => void;
  /** The child's 'error' event: it never started; this process is still running. */
  onSpawnFailed?: (err: unknown, spawnTarget: string) => void;
  /** The handle has no event surface: neither callback above can ever fire. */
  onUnobservable?: (spawnTarget: string) => void;
}
export function spawnDetachedSelf(deps: SpawnDetachedSelfDeps): string;

export interface RelaunchForLinuxPrimeDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  spawn?: SelfSpawn;
  execPath?: string;
  argv?: string[];
  isHybridGpu?: () => boolean;
  fileExists?: (path: string) => boolean;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
}
export function relaunchForLinuxPrime(deps?: RelaunchForLinuxPrimeDeps): boolean;

export function buildRegQueryArgs(exePath: string): string[];
export function buildRegWriteArgs(exePath: string, data?: string): string[];
export function parseRegQueryData(regQueryStdout: unknown): string;
export function mergeHighPerformancePreference(existingData: unknown): string;
export function alreadyHighPerformance(regQueryStdout: unknown): boolean;
export function hasUnparseableValueType(regQueryStdout: unknown): boolean;

export interface GpuDeviceSummary {
  vendorId: string;
  deviceId: string;
  active: boolean;
}
export function summarizeGpuDevices(gpuDevices: unknown): {
  devices: GpuDeviceSummary[];
  discreteInactive: boolean;
};

export interface ForceHighPerformanceGpuDeps {
  app?: {
    commandLine?: { appendSwitch(name: string): void };
    getPath?(name: string): string;
    isPackaged?: boolean;
  } | null;
  platform?: string;
  execFileSync?: (command: string, args: string[], options?: unknown) => string | Buffer;
  env?: Record<string, string | undefined>;
  regExe?: string;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
}

export function forceHighPerformanceGpu(deps?: ForceHighPerformanceGpuDeps): void;
