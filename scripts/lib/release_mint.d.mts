export const RELEASE_MINT_USAGE: string;

export function parseReleaseMintArgs(args: string[]): {
  version: string;
  dryRun: boolean;
  releaseRef: string;
};

export function requiredChecksCoverage(
  ruleset: unknown,
  releaseRef: string,
): { covered: boolean; reason: string };
