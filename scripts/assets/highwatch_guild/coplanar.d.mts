export interface ManorTriangle {
  part: string;
  material: string;
  a: number[];
  b: number[];
  c: number[];
  color: number[];
}
export interface CoplanarOverlap {
  parts: [string, string];
  gap: number;
  area: number;
  at: number[];
  normal: number[];
}
export const COPLANAR_LIMITS: { angleDeg: number; gap: number; minArea: number };
export function documentTriangles(doc: unknown): ManorTriangle[];
export function findCoplanarOverlaps(
  triangles: readonly ManorTriangle[],
  limits?: Partial<typeof COPLANAR_LIMITS>,
): CoplanarOverlap[];
export function visibleOverlaps(
  triangles: readonly ManorTriangle[],
  hits: readonly CoplanarOverlap[],
  limits?: Partial<typeof COPLANAR_LIMITS>,
): CoplanarOverlap[];
export function readManor(file: string): Promise<unknown>;
