export interface GatePreflightOpts {
  label: string;
  shell: boolean;
  env?: Record<string, string | undefined>;
}

export function checkDependencySync(opts: GatePreflightOpts): string | null;

export function checkAudioTooling(opts: GatePreflightOpts): Promise<string | null>;

export function runGatePreflights(opts: GatePreflightOpts): Promise<void>;
