export function parseDarwinAvailableMemory(vmStatOutput: string | null | undefined): number | null;

export function readDarwinVmStat(): string | null;

export function resolveAvailableMemoryBytes(opts: {
  platform: string;
  freeMemBytes: number;
  readVmStat?: () => string | null;
}): number;
