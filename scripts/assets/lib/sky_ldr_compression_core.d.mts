export type SkyLdrVariant = '2k' | '1k' | '512';

export interface SkyLdrSource {
  stem: string;
  variants: SkyLdrVariant[];
  removeStars?: boolean;
}

export interface SkyLdrJob {
  stem: string;
  variant: SkyLdrVariant;
  removeStars: boolean;
  sharpen: boolean;
  source: string;
  target: string;
  width: number;
  height: number;
}

export interface EquirectResizePlan {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  aspectError: number;
}

export type PixelBuffer = Uint8Array | Float32Array | Float64Array;

export const SKY_LDR_SOURCES: SkyLdrSource[];
export const SKY_LDR_STEMS: string[];
export const SKY_LDR_VARIANT_WIDTH: Record<SkyLdrVariant, number>;
export const WRAP_BLEND_DEG: number;
export const POLE_FILL_DEG: number;
export const POLE_SAMPLE_DEG: number;
export const SKY_LDR_UASTC_QUALITY: number;
export const SKY_LDR_RDO: { lambda: number; smoothBlockScale: number; smoothBlockStdDev: number };
export const SKY_LDR_ZSTD_LEVEL: number;

export function equirectSize(variant: string): { width: number; height: number };
export function equirectResizePlan(
  srcWidth: number,
  srcHeight: number,
  variant: string,
): EquirectResizePlan;
export function wrapBandPx(width: number): number;
export function poleFillRows(height: number): number;
export function poleSampleRows(height: number): number;
export function srgbByteToLinear(value: number): number;
export function linearToSrgbByte(value: number): number;
export function decodeSrgb(bytes: ArrayLike<number>): Float64Array;
export function encodeSrgb(linear: ArrayLike<number>): Uint8Array;
export function wrapBlendWeight(k: number, band: number): number;
export function wrapBlendInPlace<T extends PixelBuffer>(
  px: T,
  width: number,
  height: number,
  channels: number,
  bandPx: number,
): T;
export function poleFillInPlace(
  px: PixelBuffer,
  width: number,
  height: number,
  channels: number,
  fillRows: number,
  sampleRows: number,
): number[];
export function flipRowsInPlace<T extends PixelBuffer>(
  px: T,
  width: number,
  height: number,
  channels: number,
): T;
export function measureGlowU(
  px: PixelBuffer,
  width: number,
  height: number,
  channels: number,
  opts?: { loDeg?: number; hiDeg?: number; smoothFrac?: number },
): number;
export const STAR_REMOVE_RADIUS_AT_2K: number;
export const STAR_REMOVE_EXCESS: [number, number];
export const BIG_STAR_PEAK: number;
export const BIG_STAR_GLOW_AT_2K: number;
export const BIG_STAR_RING_AT_2K: number;
export const BIG_STAR_ARM_AT_2K: number;
export const STAR_DENSITY_BLUR_DEG: number;
export const STAR_DENSITY_PERCENTILE: number;
export interface SkySharpenOptions {
  fineSigmaPx: number;
  coarseSigmaPx: number;
  amount: number;
  threshold: number;
}
export const SKY_SHARPEN: SkySharpenOptions;
export function starRemoveRadius(width: number): number;
export function gaussianBlur(
  src: ArrayLike<number>,
  width: number,
  height: number,
  sigma: number,
): Float64Array;
export function removePointStarsInPlace(
  px: PixelBuffer,
  width: number,
  height: number,
  channels: number,
  radius: number,
  starCount?: Float64Array | null,
): number;
export function starDensityAlpha(
  starCount: ArrayLike<number>,
  width: number,
  height: number,
): Float64Array;
export function sharpenSkyInPlace<T extends PixelBuffer>(
  px: T,
  width: number,
  height: number,
  channels: number,
  opts?: SkySharpenOptions,
): T;
export function prepareSkyPixels(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  channels?: number,
  opts?: { removeStars?: boolean; sharpen?: boolean },
): { pixels: Uint8Array; channels: 3 | 4; zenith: number[]; glowU: number };
export function buildKtxLdrSkyArgs(opts: {
  srcPath: string;
  dstPath: string;
  alpha?: boolean;
}): string[];
export function skyLdrTargetName(stem: string, variant: string): string;
export function skyLdrJobs(stems?: string[], sources?: SkyLdrSource[]): SkyLdrJob[];
export function skyLdrPaths(
  job: SkyLdrJob,
  dirs: { srcDir: string; outDir: string },
): { srcPath: string; dstPath: string };
export function parseArgs(
  argv: string[],
  defaults: { srcDir: string; outDir: string },
): { srcDir: string; outDir: string; dryRun: boolean; stems: string[] };
