import * as THREE from 'three';
import { markSharedMaterial } from './shared_resource';
import { sparkleTexture } from './textures';

/** Renderer-owned singleton material, shared by both ground-object families. */
export function groundObjectSparkleMaterial(lowGfx: boolean): THREE.SpriteMaterial {
  const material = markSharedMaterial(
    new THREE.SpriteMaterial({
      map: sparkleTexture(),
      transparent: true,
      depthWrite: false,
    }),
  );
  if (!lowGfx) material.color.setScalar(1.5);
  return material;
}

export function buildGroundObjectSparkle(material: THREE.SpriteMaterial): THREE.Sprite {
  const sparkle = new THREE.Sprite(material);
  sparkle.scale.set(0.9, 0.9, 1);
  sparkle.position.y = 1.35;
  return sparkle;
}
