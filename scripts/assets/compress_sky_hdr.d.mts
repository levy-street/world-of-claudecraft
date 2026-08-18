import type { SkyKtx2Job } from './lib/sky_hdr_compression_core.mjs';

export interface SkyHdrCompressionCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SkyHdrCompressionOptions {
  dir: string;
  dryRun: boolean;
  runBasisuCommand?: (args: string[]) => Promise<SkyHdrCompressionCommandResult>;
}

export type SkyHdrCompressionStatus = 'converted' | 'failed' | 'would-convert';

export interface SkyHdrCompressionResult {
  job: SkyKtx2Job;
  status: SkyHdrCompressionStatus;
  reason?: string;
  before: number;
  after: number;
}

export function convertJob(
  job: SkyKtx2Job,
  opts: SkyHdrCompressionOptions,
): Promise<SkyHdrCompressionResult>;
