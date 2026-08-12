export interface GatePreflightOptions {
  label: string;
  shell: boolean;
  env?: Record<string, string | undefined>;
  command?: string;
}

export function checkDependencySync(opts: {
  label: string;
  shell: boolean;
  env?: Record<string, string | undefined>;
}): string | null;

export function checkAudioTooling(opts: GatePreflightOptions): Promise<string | null>;

export function runGatePreflights(opts: GatePreflightOptions): Promise<void>;
