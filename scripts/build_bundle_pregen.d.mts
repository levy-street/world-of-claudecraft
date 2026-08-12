/** Captured output of one pregen step's child process. */
export interface PregenStepResult {
  stdout: string;
  stderr: string;
}

/** Node args for each independent pregen step, run relative to the repo root. */
export const PREGEN_STEPS: string[][];

/**
 * Spawn one pregen step and resolve with its captured stdout/stderr, or
 * reject with a descriptive error if it fails to spawn or exits non-zero.
 * `execPath` is the injected node binary path (defaults to process.execPath).
 */
export function runPregenStep(args: string[], execPath?: string): Promise<PregenStepResult>;

/**
 * Run every step concurrently via Promise.all; rejects if any step fails to
 * spawn or exits non-zero.
 */
export function runPregen(steps?: string[][]): Promise<void>;
