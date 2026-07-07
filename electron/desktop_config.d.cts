// Hand-written declarations for electron/desktop_config.cjs so the Vitest suite
// (tests/electron_desktop_config.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

import type { UpdateChannel } from './update_guard.cjs';

export type Distribution = 'website' | 'steam';

export interface DesktopConfigInput {
  packagedMetadata?: {
    wocDesktop?: {
      distribution?: unknown;
      crashSubmitUrl?: unknown;
      apiOrigin?: unknown;
      loginOrigin?: unknown;
    };
  } | null;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}

export interface DesktopConfig {
  distribution: Distribution;
  updaterEnabled: boolean;
  crashSubmitUrl: string;
  updateChannel: UpdateChannel;
  apiOrigin: string;
  loginOrigin: string;
}

export function resolveDistribution(input?: DesktopConfigInput): Distribution;
export function resolveCrashSubmitUrl(input?: DesktopConfigInput): string;
export function resolveDesktopOrigins(input?: DesktopConfigInput): {
  apiOrigin: string;
  loginOrigin: string;
};
export function updaterAllowed(input: {
  distribution: string;
  isPackaged: boolean | undefined;
}): boolean;
export function resolveDesktopConfig(input?: DesktopConfigInput): DesktopConfig;
