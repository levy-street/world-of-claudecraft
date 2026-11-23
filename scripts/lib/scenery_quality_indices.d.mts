import type * as THREE from 'three';
export function sceneryQualityIndices(
  geometry: THREE.BufferGeometry,
  targetTriangles?: number,
  permissive?: boolean,
): Uint32Array;
export interface SceneryZoneBounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}
export function isPalmBudgetTree(
  item: { x: number; z: number; owner: THREE.Object3D },
  source: THREE.Mesh,
  zone?: SceneryZoneBounds,
): boolean;
