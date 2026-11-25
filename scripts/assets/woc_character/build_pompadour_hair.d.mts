export interface PompShape {
  combPasses: number;
  frontZ: number;
  crownZ: number;
  topY0: number;
  topY1: number;
  halfWidth: number;
  rise: number;
  reach: number;
  swell: number;
  crownLift: number;
  roundPasses: number;
  clearance: number;
  spanX: number;
  spanZ: number[];
}
export interface PompSurface {
  positions: number[][];
  triangles: number[][];
  /** True for a vertex on the surface's open edge (the hairline). */
  edge: boolean[];
}
export const POMPADOUR_ID: string;
export const POMP_PATCH: { u0: number; u1: number; v0: number; v1: number };
export const POMP_SHAPE: PompShape;
export function weldSurface(corners: { p: number[] }[]): PompSurface;
export function combSurface(surface: PompSurface, passes: number): PompSurface;
export function pompWeight(p: number[], shape: PompShape): number;
export function raisePomp(surface: PompSurface, shape: PompShape): PompSurface;
export function clearHead(
  surface: PompSurface,
  probe: (p: number[]) => number,
  clearance: number,
): number;
export function pompUv(p: number[], shape: PompShape): number[];
export function sculptPompadour(corners: { p: number[] }[], shape: PompShape): PompSurface;
