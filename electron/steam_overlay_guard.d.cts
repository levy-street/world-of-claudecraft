// Type declarations for the CommonJS Steam overlay guard (electron/steam_overlay_guard.cjs),
// which electron/main.cjs invokes at runtime and tests/electron_steam_overlay_guard.test.ts
// exercises directly. main.cjs itself runs outside tsc; these types serve the test.

export const STEAM_OVERLAY_LIB: string;
export const GPU_SANDBOX_SWITCH: string;
export const OVERLAY_DETECTED_LOG: string;

export function steamOverlayPreloaded(env?: Record<string, string | undefined>): boolean;

export interface AllowGpuUnderSteamOverlayDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  app?: { commandLine?: { appendSwitch?(name: string): void } } | null;
  log?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
  };
}

export function allowGpuUnderSteamOverlay(deps?: AllowGpuUnderSteamOverlayDeps): boolean;
