// Type declarations for the CommonJS high-performance-GPU helper (electron/gpu_preference.cjs),
// which electron/main.cjs invokes at runtime and tests/electron_gpu_preference.test.ts exercises
// directly. main.cjs itself runs outside tsc; these types serve the test.

export const USER_GPU_PREFERENCES_KEY: string;
export const HIGH_PERFORMANCE_PREFERENCE: string;
export const HIGH_PERF_GPU_SWITCHES: readonly string[];

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
