export interface SkyKtx2Resample {
  width: number;
  height: number;
}

export interface SkyKtx2Variant {
  suffix: string;
  source: string;
  resample: SkyKtx2Resample | null;
}

export interface SkyKtx2Job {
  stem: string;
  variant: string;
  source: string;
  target: string;
  resample: SkyKtx2Resample | null;
}

export const SKY_HDR_STEMS: string[];
export const SKY_KTX2_VARIANTS: SkyKtx2Variant[];
export const SKY_UASTC_LEVEL: number;
export const SKY_ZSTD_LEVEL: number;

export function skyHdrSourceName(stem: string, variant: SkyKtx2Variant): string;
export function skyKtx2Name(stem: string, variant: SkyKtx2Variant): string;
export function skyKtx2Jobs(stems?: string[], variants?: SkyKtx2Variant[]): SkyKtx2Job[];

export function buildBasisuHdrArgs(opts: {
  srcPath: string;
  dstPath: string;
  resample?: SkyKtx2Resample | null;
  uastcLevel?: number;
  zstdLevel?: number;
}): string[];

export function skyKtx2Paths(job: SkyKtx2Job, dir: string): { srcPath: string; dstPath: string };

export function parseArgs(
  argv: string[],
  defaultDir: string,
): { dir: string; dryRun: boolean; jobs: number; stems: string[] };
