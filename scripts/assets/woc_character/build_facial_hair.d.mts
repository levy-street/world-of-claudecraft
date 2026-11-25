export interface FacialFrame {
  /** The source piece's middle in x, and its half width. */
  cx: number;
  hw: number;
  /** Its bottom and top, its back and front. */
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  /** What the sage beard needs of the body (FRAME_EXTRA). */
  sageDrop?: number;
  sageSwing?: number;
}
export interface FacialStyle {
  /** The shipped beard this style reshapes, and the shipped file that beard is in. */
  from: string;
  file: string;
  shape: (p: number[], frame: FacialFrame) => number[];
  jitter?: (p: number[], frame: FacialFrame) => number[];
  /** The distance a point must stand off the head's skin (0 for none). */
  clear?: (p: number[], frame: FacialFrame) => number;
}
export const FACIAL_STYLES: Record<string, FacialStyle>;
export const FACIAL_STYLE_IDS: string[];
export const FRAME_EXTRA: Record<'a' | 'b', { sageDrop: number; sageSwing: number }>;
export function frameOf(points: number[][], extra?: Partial<FacialFrame>): FacialFrame;
export function reshape(
  style: FacialStyle,
  p: number[],
  n: number[],
  frame: FacialFrame,
): { p: number[]; n: number[] };
export function liftOff(p: number[], probe: (p: number[]) => number, clearance: number): number[];
