export interface AxisCorrection {
  name: string;
  basis: [number, number][];
  isIdentity: boolean;
}

export interface MeshGeometry {
  position: ArrayLike<number>;
  normal: ArrayLike<number>;
  index: ArrayLike<number> | null;
}

export interface AxisVerdict {
  best: string;
  bestScore: number;
  identity: number;
  samples: number;
  scores: Map<string, number>;
  healthy: boolean;
}

export const AXIS_CORRECTIONS: AxisCorrection[];
export const IDENTITY_CORRECTION: AxisCorrection;
export const SCORE_SAMPLE_TARGET: number;

export function correctionByName(name: string): AxisCorrection | null;
export function applyCorrection(
  basis: [number, number][],
  x: number,
  y: number,
  z: number,
  out: number[],
): number[];
export function scoreAxisCorrections(
  geometry: MeshGeometry,
  sampleTarget?: number,
): { scores: Map<string, number>; samples: number };
export function bestAxisCorrection(
  geometry: MeshGeometry,
  opts?: { minScore?: number; sampleTarget?: number },
): AxisVerdict;
export function rotateNormalsInPlace<T extends { length: number; [i: number]: number }>(
  normals: T,
  correction: AxisCorrection,
): T;
