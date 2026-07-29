export const GATE_WORKER_TIER_CAPS: Readonly<{
  low: 2;
  medium: 4;
  high: 8;
}>;

export function parseGateWorkerTier(
  value: string | undefined | null,
): 'low' | 'medium' | 'high' | null;

export function resolveGateWorkerTierCap(value: string | undefined | null): number | undefined;

export function computeGateWorkers(opts: {
  cpuCount: number;
  freeMemBytes: number;
  envOverride?: string | undefined;
  tierCap?: number | undefined;
}): number;
