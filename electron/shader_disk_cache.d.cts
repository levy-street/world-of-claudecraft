// Type declarations for electron/shader_disk_cache.cjs, which electron/main.cjs invokes at
// runtime and tests/electron_shader_disk_cache.test.ts exercises directly. main.cjs itself
// runs outside tsc; these types serve the test.

import type { FeatureCommandLine } from './chromium_features.cjs';

export const SHADER_DISK_CACHE_FEATURE: string;
export const GPU_DISK_CACHE_SIZE_SWITCH: string;
export const GPU_DISK_CACHE_SIZE_KB: number;
export const SHADER_DISK_CACHE_DISABLE_ENV: string;
export const SHADER_DISK_CACHE_PLATFORMS: readonly string[];
export const MIN_CHROMIUM_WITH_BLOB_CACHE_FIXES: string;
export function chromiumAtLeast(version: string | null | undefined, minimum: string): boolean;

export interface ShaderDiskCacheDecision {
  enabled: boolean;
  reason: string;
}

export function decideShaderDiskCache(input: {
  platform: string;
  /** process.versions.chrome; the feature stays off below the fixed Chromium. */
  chromeVersion?: string | null;
  env?: Record<string, string | undefined> | null;
  prefs?: { shaderDiskCacheOptOut?: boolean } | null;
}): ShaderDiskCacheDecision;

export function applyShaderDiskCacheSwitches(
  app: { commandLine: FeatureCommandLine & { hasSwitch?(name: string): boolean } },
  decision: ShaderDiskCacheDecision | null | undefined,
): void;
