// Type declarations for electron/chromium_features.cjs, which electron/gpu_backend.cjs and
// electron/shader_disk_cache.cjs call at runtime and tests/electron_shader_disk_cache.test.ts
// exercises directly. main.cjs itself runs outside tsc; these types serve the tests.

export interface FeatureCommandLine {
  appendSwitch(name: string, value: string): void;
  getSwitchValue?(name: string): string;
}

export const ENABLE_FEATURES_SWITCH: string;
export function featureName(entry: string): string;
export function mergeFeatureList(
  existing: string | null | undefined,
  additions: readonly string[] | null | undefined,
): string;
export function appendEnabledFeatures(
  commandLine: FeatureCommandLine,
  features: readonly string[],
): string;
