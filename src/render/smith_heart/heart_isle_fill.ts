// The Islands of the Wind's fill (heart_kit.ts's `isle` material: the
// Breath's floating isles and the stones drifting round them). The isles
// hang in open sky high over the sea of cloud, so most of what the raid sees
// of them from the Cornice faces DOWN, away from the sun, lit only by the
// hemisphere's ground tone: under the stock material the hang sank to a
// near-black, broken into hard blotches wherever a facet turned to the sun.
// Two touches on the stone's own program fix that, the painted world's L1
// and L6 (cool soft shadow, never black):
//   - a shade floor, a little of the stone's own colour no light takes away
//     (the mountain's rock has the same, HEART_ROCK_SHADE_FLOOR);
//   - the cloud sea's bounce: a cool light from below on every face that
//     turns down, so the hang reads as a lit blue-violet underside.
// One program for every isle piece; the key keeps it apart from the stone's.
// No texture, no light.

import type * as THREE from 'three';

/** The fill (linear rgb, shares of the stone's own colour): `floor` on
 *  every face, `under` more on a face turned straight down. */
export const HEART_ISLE_FILL = {
  floor: [0.11, 0.115, 0.14],
  under: [0.2, 0.23, 0.3],
} as const;

const KEY = `smith-heart-isle|${HEART_ISLE_FILL.floor.join(',')}|${HEART_ISLE_FILL.under.join(',')}`;

const vec = (v: readonly number[]): string => v.map((x) => x.toFixed(3)).join(', ');

/** How much of the stone's colour a face glows with, given its world
 *  normal's up component (the GLSL below, mirrored for the tests). */
export function heartIsleFillAt(normalY: number): [number, number, number] {
  const down = Math.max(0, Math.min(1, -normalY));
  const f = HEART_ISLE_FILL.floor;
  const u = HEART_ISLE_FILL.under;
  return [f[0] + u[0] * down, f[1] + u[1] * down, f[2] + u[2] * down];
}

/** Wire the fill into a lit vertex-colour material (returns it). */
export function applyHeartIsleFill<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
        {
          // normal: the shading normal in view space; back to world for its
          // up component (inverseTransformDirection: three's common chunk).
          float isleDown = clamp( -inverseTransformDirection( normal, viewMatrix ).y, 0.0, 1.0 );
          totalEmissiveRadiance += diffuseColor.rgb
            * ( vec3( ${vec(HEART_ISLE_FILL.floor)} ) + vec3( ${vec(HEART_ISLE_FILL.under)} ) * isleDown );
        }`,
    );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${KEY}|${prevKey()}`;
  return mat;
}
