// Type declarations for the CommonJS host-essentials collector
// (electron/host_essentials.cjs), which electron/main.cjs invokes at runtime
// and tests/electron_host_essentials.test.ts exercises directly. main.cjs
// itself runs outside tsc; these types serve the test.

import type { QueryRegValueDeps, RegValueReading } from './gpu_preference.cjs';

export const POWER_SCHEMES_KEY: string;
export const GRAPHICS_DRIVERS_KEY: string;
export const GAME_BAR_KEY: string;
export const ACTIVE_POWER_SCHEME_VALUE: string;
export const ACTIVE_OVERLAY_AC_VALUE: string;
export const ACTIVE_OVERLAY_DC_VALUE: string;
export const HW_SCH_MODE_VALUE: string;
export const AUTO_GAME_MODE_VALUE: string;

export const POWER_PLAN_BY_GUID: Readonly<Record<string, string>>;
export const POWER_MODE_BY_GUID: Readonly<Record<string, string>>;
export const POWER_PLANS: readonly string[];
export const POWER_MODES: readonly string[];

export const HOST_MEM_TOTAL_MAX_MB: number;
export const HOST_MEM_TOTAL_STEP_MB: number;
export const HOST_MEM_FREE_STEP_MB: number;
export const APP_MEM_MAX_MB: number;
export const APP_MEM_STEP_MB: number;
export const HOST_ESSENTIALS_MIN_INTERVAL_MS: number;

export function normalizeGuid(value: unknown): string;
export function foldPowerPlanGuid(reading: RegValueReading): string;
export function foldPowerModeGuid(reading: RegValueReading): string;
export function foldHagsReading(reading: RegValueReading): boolean | null;
export function foldGameModeReading(reading: RegValueReading): boolean | null;
export function roundMb(megabytes: number | null, step: number): number | null;

export interface HostEssentialsAppMemory {
  appWorkingSetMb: number | null;
  appRendererWsMb: number | null;
  appGpuWsMb: number | null;
}
export function reduceAppMemory(metrics: unknown): HostEssentialsAppMemory;

export interface HostEssentialsLive extends HostEssentialsAppMemory {
  hostMemTotalMb: number | null;
  hostMemFreeMb: number | null;
  hostOnBattery: boolean | null;
}

export interface HostEssentialsStatic {
  hostPowerPlan: string;
  hostPowerMode: string;
  hostHags: boolean | null;
  hostGameMode: boolean | null;
}

export type HostEssentialsSnapshot = HostEssentialsLive & HostEssentialsStatic;

export interface HostEssentialsDeps extends QueryRegValueDeps {
  platform?: string;
  process?: { getSystemMemoryInfo?(): unknown };
  app?: { getAppMetrics?(): unknown } | null;
  powerMonitor?: { isOnBatteryPower?(): boolean } | null;
  queryRegValue?: (
    request: { key: string; valueName: string },
    deps?: QueryRegValueDeps,
  ) => Promise<RegValueReading>;
  /** The battery state the live half just read; decides WHICH overlay value is read. */
  onBattery?: boolean;
  now?: () => number;
  /** The anti-hammering floor between two collections. */
  minIntervalMs?: number;
}

export function readLiveHostEssentials(deps?: HostEssentialsDeps): HostEssentialsLive;
export function readStaticHostEssentials(deps?: HostEssentialsDeps): Promise<HostEssentialsStatic>;
export function createHostEssentials(deps?: HostEssentialsDeps): {
  snapshot(): Promise<HostEssentialsSnapshot>;
};
