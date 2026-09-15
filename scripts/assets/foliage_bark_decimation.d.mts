import type { Document } from '@gltf-transform/core';

export const FOLIAGE_BARK_SIMPLIFY_ERROR: number;
export const FOLIAGE_BARK_TRIANGLE_SHORTFALL: number;
export const FOLIAGE_BARK_BOUNDS_TOLERANCE: number;

export interface FoliageFieldBarkAsset {
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly barkTriangleBudget: number;
  readonly outputPath: string;
  readonly outputSha256: string;
}

export const FOLIAGE_FIELD_BARK_ASSETS: readonly FoliageFieldBarkAsset[];

export function isFoliageFieldCopyCatalogId(id: string): boolean;

export function isFoliageBarkMaterial(name: string): boolean;

export interface FoliageBarkSimplifier {
  simplify(
    indices: Uint32Array,
    positions: Float32Array,
    stride: number,
    targetIndexCount: number,
    targetError: number,
    flags?: readonly string[],
  ): [Uint32Array, number];
  getScale(positions: Float32Array, stride: number): number;
}

export interface FoliageBarkDecimationReport {
  readonly sourceTriangles: number;
  readonly sourceVertices: number;
  readonly barkTriangles: number;
  readonly barkVertices: number;
  readonly relativeError: number;
  readonly absoluteError: number;
  readonly boundsShift: number;
  readonly barkBoundsShift: number;
}

export function decimateFoliageBarkDocument(
  document: Document,
  options: {
    readonly barkTriangleBudget: number;
    readonly simplifier: FoliageBarkSimplifier;
    readonly encoder: unknown;
  },
): Promise<FoliageBarkDecimationReport>;
