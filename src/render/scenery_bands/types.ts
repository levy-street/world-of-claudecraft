import type * as THREE from 'three';

export type Bounds = readonly [number, number, number, number];
export interface SceneryPart {
  source: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  matrix: THREE.Matrix4;
  index: number | null;
  tint: THREE.Color;
}
export interface SceneryPlacement {
  key: string;
  kind: 'foliage' | 'zone-instance' | 'landmark';
  owner: THREE.Object3D;
  parts: SceneryPart[];
  box: THREE.Box3;
  bounds: Bounds;
  x: number;
  z: number;
}

export interface SceneryRegion {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}
