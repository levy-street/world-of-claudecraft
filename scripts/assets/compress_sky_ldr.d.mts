import type { EquirectResizePlan, SkyLdrJob } from './lib/sky_ldr_compression_core.mjs';

export interface SkyLdrCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SkyLdrCompressionOptions {
  srcDir: string;
  outDir: string;
  dryRun: boolean;
  runKtxCommand?: (args: string[]) => Promise<SkyLdrCommandResult>;
}

export type SkyLdrCompressionStatus = 'converted' | 'failed' | 'would-convert';

export interface SkyLdrCompressionResult {
  job: SkyLdrJob;
  status: SkyLdrCompressionStatus;
  reason?: string;
  before: number;
  after: number;
  glowU?: number;
  aspectError?: number;
}

export function parseArgs(argv: string[]): {
  srcDir: string;
  outDir: string;
  dryRun: boolean;
  stems: string[];
};

export function preparedVariant(
  srcPath: string,
  job: SkyLdrJob,
): Promise<{
  plan: EquirectResizePlan;
  pixels: Uint8Array;
  channels: 3 | 4;
  zenith: number[];
  glowU: number;
}>;

export function convertJob(
  job: SkyLdrJob,
  opts: SkyLdrCompressionOptions,
): Promise<SkyLdrCompressionResult>;
