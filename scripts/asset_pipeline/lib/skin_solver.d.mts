export type Vec3 = readonly [number, number, number] | number[];

export interface BoneSegment {
  /** Index of the joint this segment is attributed to. */
  joint: number;
  a: Vec3;
  b: Vec3;
  /** +1 for a `.l` bone, -1 for `.r`, 0 for a centre bone. */
  side: number;
}

export interface SolveOptions {
  influences?: number;
  sideGuard?: number;
  centerX?: number;
  minWeightFrac?: number;
  falloff?: number;
  radii?: number[] | null;
  radiusPercentile?: number;
  /** [floor, ceiling] as multiples of the median measured radius. */
  radiusBand?: readonly [number, number] | number[];
  minRadius?: number;
  maxRadius?: number;
}

export interface SolvedWeights {
  joints: Uint16Array;
  weights: Float32Array;
  /** Points that fell outside every radius and were assigned to one bone. */
  rigid: number;
}

export interface WeldResult {
  nodeOf: Int32Array;
  nodePos: number[][];
}

export interface ComponentResult {
  label: Int32Array;
  count: number;
}

export declare function distToSegment(p: Vec3, a: Vec3, b: Vec3): number;
export declare function sideAllows(seg: BoneSegment, lx: number, sideGuard: number): boolean;
export declare function segmentRadii(
  points: Vec3[],
  segments: BoneSegment[],
  opts?: SolveOptions,
): number[];
export declare function solveSkinWeights(
  points: Vec3[],
  segments: BoneSegment[],
  opts?: SolveOptions,
): SolvedWeights;
export declare function weldPositions(points: Vec3[], tol?: number): WeldResult;
export declare function buildAdjacency(
  nodeCount: number,
  indices: ArrayLike<number>,
  nodeOf: ArrayLike<number>,
): number[][];
export declare function smoothWeights(
  joints: Uint16Array,
  weights: Float32Array,
  adj: number[][],
  opts?: { iters?: number; mix?: number; influences?: number },
): void;
export declare function connectedComponents(
  nodeCount: number,
  indices: ArrayLike<number>,
  nodeOf: ArrayLike<number>,
  adjacency?: number[][] | null,
): ComponentResult;
export declare function rigidifyShells(
  nodeJoints: Uint16Array,
  nodeWeights: Float32Array,
  label: ArrayLike<number>,
  count: number,
  influences: number,
  opts?: { maxShellNodes?: number; nodePos?: number[][] | null },
): number;
