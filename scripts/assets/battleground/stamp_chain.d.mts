export interface HeightStamp {
  x: number;
  z: number;
  radius: number;
  delta: number;
  falloff: 'smooth' | 'flat';
  mode?: 'level';
  hardness?: number;
  alpha?: 'splatter';
}

export function hash01(x: number, y: number, salt: number): number;
export function splatterAlpha(u: number, v: number): number;
export function brushWeight(distanceRatio: number, hardness: number): number;
export function applyStamp(stamp: HeightStamp, x: number, z: number, h: number): number;
export function makeHeightAt(stamps: readonly HeightStamp[]): (x: number, z: number) => number;
