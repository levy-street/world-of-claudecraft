import type { Document } from '@gltf-transform/core';

export interface MulletSculptVertex {
  /** Position in the sculpt's own space, face down +z. */
  m: number[];
  n: number[];
}
export interface MulletSculpt {
  vertices: MulletSculptVertex[];
  indices: Uint32Array;
}
export interface MulletTopPlace {
  dx: number;
  dy: number;
  dz: number;
  inflate: number;
}
export interface MulletFit {
  scale: number;
  top: number;
  cx: number;
  cz: number;
  tailY: number;
  napeY: number;
  backY: number;
  keepDeg: number;
  cutDeg: number;
  hug: number;
  rise: number;
  lean: number;
  curl: number;
  narrow: number;
  tuck: number;
  tuckDrop: number;
  topPlace: MulletTopPlace;
}
export interface MulletCorner {
  /** Position in the rig's rest pose. */
  p: number[];
  n: number[];
  t: number[];
}
export interface MulletTailCorner extends MulletCorner {
  /** The corner's place in the sculpt, before the tail was drawn in. */
  m: number[];
}
export const MULLET_ID: string;
export const MULLET_TOP_ID: string;
export const TAIL_PANEL: { u0: number; u1: number; v0: number; v1: number };
export const MULLET_FIT: Record<'a' | 'b', MulletFit>;
export function readSculpt(doc: Document): MulletSculpt;
export function hugTail(m: number[], fit: MulletFit): number[];
export function tailUv(m: number[], fit: MulletFit): number[];
export function cutTail(
  sculpt: MulletSculpt,
  fit: MulletFit,
  headTriangles: number[][][],
): { soup: MulletTailCorner[]; mannequin: number };
export function placeTop<T extends { p: number[] }>(corners: T[], place: MulletTopPlace): T[];
