export interface SurfaceTuning {
  readonly midtone: number;
  readonly mottleBase: number;
  readonly occlusion: number;
  readonly contact: number;
  readonly grimeHeight: number;
  readonly grime: number;
  readonly dust: number;
  readonly wear: number;
  readonly seam: number;
  readonly grimeTone: readonly [number, number, number];
  readonly wearTone: readonly [number, number, number];
  readonly floor: number;
}

export interface OccluderBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly ownerId?: number;
}

export interface OccluderIndex {
  readonly boxes: readonly OccluderBox[];
  readonly cellSize: number;
  readonly min: readonly number[];
  readonly dims: readonly number[];
  readonly cells: readonly number[][];
}

export interface SurfaceWeights {
  midtone?: number;
  occlusion?: number;
  contact?: number;
  grime?: number;
  dust?: number;
  wear?: number;
  seam?: number;
  mottle?: number;
}

export interface ShadeSurfaceOptions {
  tint: readonly [number, number, number];
  offset?: readonly [number, number, number];
  occluders?: OccluderIndex | null;
  ownerId?: number;
  variation?: number;
  seed?: number;
  weights?: SurfaceWeights;
}

export const ORM_CENTER: number;
export const SURFACE_TUNING: SurfaceTuning;
export const UV_SCALE: Readonly<Record<string, number>>;

export function hash2(x: number, y: number, seed: number): number;
export function hash3(x: number, y: number, z: number, seed: number): number;
export function periodicNoise2(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number,
): number;
export function periodicFbm2(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
  aspect?: number,
): number;
export function valueNoise3(x: number, y: number, z: number, seed: number): number;
export function signedFbm3(x: number, y: number, z: number, seed: number, octaves?: number): number;
export function boxProjectUvInto(
  positions: Float32Array,
  normals: Float32Array,
  uvOut: Float32Array,
  scale: number,
  offset?: readonly [number, number, number],
): void;
export function buildOccluderIndex(boxes: OccluderBox[], cellSize?: number): OccluderIndex;
export function occlusionAt(
  index: OccluderIndex,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  ownerId: number,
): number;
export function shadeSurfaceInto(
  positions: Float32Array,
  normals: Float32Array,
  colorOut: Float32Array,
  options: ShadeSurfaceOptions,
): void;
