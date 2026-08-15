import type { BufferGeometry } from 'three';

export type FenbridgeBuckets = Record<string, BufferGeometry[]>;

export const FENBRIDGE_PALETTE: Readonly<Record<string, number>>;

export function createFenbridgeBuckets(): FenbridgeBuckets;

export function addPitchedRoof(
  buckets: FenbridgeBuckets,
  bucket: string,
  width: number,
  depth: number,
  eaveY: number,
  peakY: number,
  color: number,
  options?: Readonly<{
    ridgeAxis?: 'x' | 'z';
    center?: readonly [number, number, number];
  }>,
): void;
