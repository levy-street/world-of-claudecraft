export const I18N_ARTIFACTS: readonly string[];

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
    skipBrowser?: boolean;
    skipBuilds?: boolean;
    skipVitest?: boolean;
    skipTypes?: boolean;
  },
): FullGateStep[];
