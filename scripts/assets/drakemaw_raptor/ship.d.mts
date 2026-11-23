/** Repo root the build reads and writes under. */
export const ROOT: string;
/** Every file the shipped GLB is a function of, repo-relative. */
export const FINGERPRINT_INPUTS: readonly string[];
/** sha256 over FINGERPRINT_INPUTS (path, then bytes, for each); stamped into the
 *  shipped GLB's asset.extras.drakemawRaptor.fingerprint by ship(). */
export function fingerprint(root?: string): string;
export function ship(
  rawPath: string,
  sourcePath: string,
  statsPath: string,
  outPath: string,
): Promise<{ bytes: number; animations: string[] }>;
