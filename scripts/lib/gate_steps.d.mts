export const I18N_ARTIFACTS: readonly string[];
export const I18N_RELEASE_TIER_SUITES: readonly string[];

export interface FullGateStep {
  name: string;
  cmd: string;
  args: string[];
  hint?: string;
  env?: Record<string, string>;
}

export function buildFullGateSteps(
  workers: number,
  opts?: {
    /** Adds the dedicated `vitest (release-tier i18n)` step (see I18N_RELEASE_TIER_SUITES). */
    releaseTier?: boolean;
    skipBrowser?: boolean;
    skipBuilds?: boolean;
    skipVitest?: boolean;
    skipTypes?: boolean;
  },
): FullGateStep[];
