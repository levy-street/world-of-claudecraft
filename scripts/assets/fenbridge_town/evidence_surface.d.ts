import type * as THREE from 'three';

export interface FenbridgeEvidenceTextures {
  base: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

export interface FenbridgeEvidenceSurfaceStats {
  meshCount: number;
  textureBindings: number;
  pbrBindings: number;
  uvBounds: {
    minimum: [number, number];
    maximum: [number, number];
    span: [number, number];
  };
}

export function applyFenbridgeEvidenceSurface(
  root: THREE.Object3D,
  textures: FenbridgeEvidenceTextures,
): FenbridgeEvidenceSurfaceStats;
