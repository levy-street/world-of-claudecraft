import * as THREE from 'three';

/** Live and boot-prewarm factory for Stonebound's double-sided weapon shell. */
export function createStoneboundWeaponShellMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x9a9384,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    wireframe: true,
  });
}

/** Live and boot-prewarm factory for Stonebound's front-sided armor shards. */
export function createStoneboundArmorShardMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x777065,
    transparent: true,
    opacity: 0.82,
    wireframe: true,
    depthWrite: false,
  });
}
