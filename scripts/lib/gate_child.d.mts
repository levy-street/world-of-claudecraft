export function runGateChild(
  cmd: string,
  args: string[],
  opts?: {
    stdio?: import('node:child_process').StdioOptions;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    cwd?: string;
    platform?: NodeJS.Platform;
    forceKillAfterMs?: number;
    quiescencePollMs?: number;
    quiescenceEscalationMs?: number;
  },
): Promise<{ status: number | null; signal: NodeJS.Signals | null }>;
