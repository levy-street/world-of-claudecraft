export const WOC_SKIP_PRETEST: 'WOC_SKIP_PRETEST';

export function shouldSkipPretest(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean;

export function gateVitestSkipPretestEnv(): Record<string, string>;

export function shouldRunEntryPretest(opts: {
  legCount: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): boolean;
