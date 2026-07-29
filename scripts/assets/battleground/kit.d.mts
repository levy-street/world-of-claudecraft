export interface PieceExtents {
  width: number;
  depth: number;
  height: number;
  top: number;
  minY: number;
  centerX: number;
  centerZ: number;
}

export interface CourseFit {
  count: number;
  pitch: number;
  scaleX: number;
}

export function pieceExtents(assetData: unknown, assetId: string): PieceExtents;
export function r4(v: number): number;
export function yaw(a: number): number;
export function hash01(a: number, b: number): number;
export function stream(salt: number): {
  next(): number;
  range(lo: number, hi: number): number;
  pick<T>(list: readonly T[]): T;
};
export function mirrorPlacement<T extends { x: number; z: number; rotY?: number }>(p: T): T;
export function courseFit(pieceWidth: number, length: number, nominalScale: number): CourseFit;
export function bodyOffset(
  ext: PieceExtents,
  scaleX: number,
  scaleZ: number,
  rotY: number,
): { dx: number; dz: number };
