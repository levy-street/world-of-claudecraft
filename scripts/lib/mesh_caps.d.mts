export interface WeldResult {
  remap: Int32Array;
  representative: number[];
  uniqueCount: number;
}

export interface RimResult {
  /** Rims that form one closed cycle, as ordered welded ids. Only these are safe
   *  to fan from one of their own vertices. */
  cycles: number[][];
  /** Directed boundary edges on branching or pinched rims, left uncapped. */
  open: [number, number][];
  slivers: number;
}

export interface CapMesh {
  position: ArrayLike<number>;
  representative: number[];
}

export function weldVertices(position: ArrayLike<number>, eps?: number): WeldResult;
export function triangleCount(indices: ArrayLike<number> | null, positionLength: number): number;
export function boundaryRims(
  indices: ArrayLike<number> | null,
  remap: ArrayLike<number>,
  triCount: number,
): RimResult;
export function capCycles(mesh: CapMesh, cycles: number[][]): { triangles: number[] };
export function orientationDefects(
  indices: ArrayLike<number> | null,
  remap: ArrayLike<number>,
  triCount: number,
): { boundary: number; flipped: number };
