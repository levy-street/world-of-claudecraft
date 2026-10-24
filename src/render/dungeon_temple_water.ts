// The Drowned Temple's flood water: a translucent, self-animating sheet with
// layered-sine caustics, a fresnel sheen and bioluminescent glow, shared by the
// temple flood and the Drowned Court's aisle bands. Moved out of dungeon.ts
// (the monolith ratchet); DungeonInteriors caches one per instance. The
// shader pair itself (camera-relative, like every floor sheet) is
// temple_water_shader.ts.

import * as THREE from 'three';
import { sharedUniforms } from './gfx';
import { markSharedMaterial } from './shared_resource';
import { TEMPLE_WATER_FRAG, TEMPLE_WATER_VERT } from './temple_water_shader';

/** One temple water material (marked shared: the interiors' resource sweep
 *  leaves it alone, the owning DungeonInteriors keeps it for every room). */
export function createTempleWaterMaterial(): THREE.ShaderMaterial {
  return markSharedMaterial(
    new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uShallow: { value: new THREE.Color(0x49c9bd) },
        uDeep: { value: new THREE.Color(0x07303c) },
        uGlow: { value: new THREE.Color(0x76f0dd) },
      },
      vertexShader: TEMPLE_WATER_VERT,
      fragmentShader: TEMPLE_WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
}
