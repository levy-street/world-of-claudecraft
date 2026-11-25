export interface MonkShape {
  around: number;
  topDrop: number;
  height: number;
  browDrop: number;
  thick: number;
  lift: number;
  /** Per step of the cross-section: how far down the band (0 to 1), what share of `thick`. */
  profile: number[][];
  repeats: number;
}
export interface SkullFrame {
  top: number;
  cx: number;
  cz: number;
}
export const MONK_ID: string;
export const MONK_SHAPE: MonkShape;
export function farthestHit(origin: number[], dir: number[], triangles: number[][][]): number;
export function skullFrame(triangles: number[][][]): SkullFrame;
export function ringU(step: number, shape: MonkShape): number;
export function growRing(
  frame: SkullFrame,
  scalp: (origin: number[], dir: number[]) => number,
  shape: MonkShape,
): { p: number[]; n: number[]; t: number[] }[];
