// Types for painted_ground_core.mjs (the painted ground converter's maths).
// Planes are row-major Float32Array channels, linear light 0..1.

export type Plane = Float32Array;
export type RGB = readonly [number, number, number] | readonly number[];

export const LUMA: readonly [number, number, number];
export function srgbToLinear(v: number): number;
export function linearToSrgb(v: number): number;

export function planesFromSrgb8(
  data: ArrayLike<number>,
  w: number,
  h: number,
  channels: number,
): Plane[];
export function srgb8FromPlanes(planes: readonly Plane[], w: number, h: number): Uint8Array;
export function grey8FromPlane(plane: Plane): Uint8Array;
export function luminance(planes: readonly Plane[]): Plane;
export function planeStats(plane: ArrayLike<number>): { mean: number; sd: number };
export function planesMean(planes: readonly Plane[]): number[];

export function isPowerOfTwo(n: number): boolean;
export function fft1d(re: Float64Array, im: Float64Array, inverse?: boolean): void;
export function fft2d(
  re: Float64Array,
  im: Float64Array,
  w: number,
  h: number,
  inverse?: boolean,
): void;
export function binFrequency(k: number, n: number): number;

export function periodicComponent(plane: Plane, w: number, h: number): Plane;
export function wrapSeamRatio(plane: Plane, w: number, h: number): { x: number; y: number };
export function lowpassCycles(plane: Plane, w: number, h: number, sigmaCycles: number): Plane;
export function blurWrap(plane: Plane, w: number, h: number, sigmaPx: number): Plane;

export interface DelightOptions {
  sigmaCycles: number;
  strength?: number;
}
export function delight(
  planes: readonly Plane[],
  w: number,
  h: number,
  opts: DelightOptions,
): Plane[];

export interface BandOptions {
  minCycles: number;
  maxCycles: number;
  bins?: number;
}
export function directionalAnisotropy(
  plane: Plane,
  w: number,
  h: number,
  opts: BandOptions,
): number;
export function isotropize(
  planes: readonly Plane[],
  w: number,
  h: number,
  opts: BandOptions & { strength: number },
): { planes: Plane[]; report: { before: number; after: number } };

export interface ColourOptions {
  target: RGB;
  chromaKeep?: number;
  contrast?: number;
  chromaVariation?: number;
}
export function normalizeColour(planes: readonly Plane[], opts: ColourOptions): Plane[];
export function softShoulder(v: number): number;

export interface HeightOptions {
  detailSigmaPx: number;
  broad?: number;
  smoothPx?: number;
  spread?: number;
}
export function deriveHeight(
  planes: readonly Plane[],
  w: number,
  h: number,
  opts: HeightOptions,
): Plane;
export function deriveNormal(
  height: Plane,
  w: number,
  h: number,
  opts: { strength: number; blurPx?: number },
): [Plane, Plane, Plane];
export function cavityMap(
  height: Plane,
  w: number,
  h: number,
  opts: { sigmaPx: number; gain?: number },
): Plane;
export function fitMeanSd(
  plane: ArrayLike<number>,
  targetMean: number,
  targetSd: number,
): { plane: Plane; mean: number; sd: number };
export function downsample2x(plane: Plane, w: number, h: number): Plane;

export const PHOTO_LAYER_MEANS: Readonly<Record<'Grass001' | 'Ground023' | 'Rock026', number[]>>;

export interface PaintedGroundRecipe {
  delight: DelightOptions;
  isotropize: BandOptions & { strength: number };
  colour: ColourOptions;
  height: HeightOptions;
  normal: { strength: number; blurPx?: number } | null;
}
export const PAINTED_GROUND_RECIPES: Readonly<
  Record<'grass' | 'dirt' | 'rock' | 'cobble' | 'leaves', PaintedGroundRecipe>
>;

export interface GroundAoChannelSpec {
  source: string;
  kind: 'cavity' | 'height';
  sigmaPx?: number;
  gain?: number;
  smoothPx?: number;
  mean: number;
  sd: number;
}
export const GROUND_AO_PACK: Readonly<{
  size: number;
  r: GroundAoChannelSpec;
  g: GroundAoChannelSpec;
  b: GroundAoChannelSpec;
  a: { photo: string };
}>;
export function groundAoChannel(
  height: Plane,
  w: number,
  h: number,
  spec: GroundAoChannelSpec,
): { plane: Plane; mean: number; sd: number };

export function processPaintedLayer(
  planes: readonly Plane[],
  w: number,
  h: number,
  recipe: PaintedGroundRecipe,
): {
  planes: Plane[];
  report: {
    seamBefore: { x: number; y: number };
    seamAfter: { x: number; y: number };
    anisotropyBefore: number;
    anisotropyAfter: number;
    mean: number[];
  };
};

export function emulateMacroNoise(seed?: number): {
  bytes: Uint8Array;
  sample: (u: number, v: number) => number;
};
