// The Smith's Heart kits' ice (phase 2H, heart_kit.ts's ice slot): the
// Quench's blades, its heaped old ice, its frozen falls and the crystal grown
// in its stones. A lit, glossy vertex-colour material with two touches the
// stock material lacks, so a thick piece of ice reads as clear ice and never
// as blue stone:
//   - a cold sheen at the grazing angles (the sky's pale light off a polished
//     face, the thin edges glowing as light runs through them);
//   - a breath of the ice's own colour as light inside it, so its dense core
//     sinks to a deep blue in the shade, never to black (L6).
// One program for every kit's ice; the key below keeps it apart from the
// stock material's. No texture, no light.

import type * as THREE from 'three';

/** The sheen's colour (linear) and strength at a grazing angle. */
export const HEART_ICE_SHEEN = { color: [0.5, 0.66, 0.8], strength: 0.42, power: 2.6 } as const;
/** The share of the ice's own colour it glows with (its inner light). */
export const HEART_ICE_INNER = 0.14;

const KEY = `smith-heart-ice|${HEART_ICE_SHEEN.strength}|${HEART_ICE_SHEEN.power}|${HEART_ICE_INNER}`;

/** Wire the sheen into a standard material (returns it). */
export function applyHeartIceSheen<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    const [r, g, b] = HEART_ICE_SHEEN.color;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
        {
          // vViewPosition points from the fragment to the eye; normal is the
          // shading normal (view space) the lighting reads.
          float iceFacing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
          float iceGraze = pow( 1.0 - iceFacing, ${HEART_ICE_SHEEN.power.toFixed(2)} );
          totalEmissiveRadiance += vec3( ${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)} )
            * iceGraze * ${HEART_ICE_SHEEN.strength.toFixed(3)} * ( 0.6 + 0.4 * diffuseColor.b );
          totalEmissiveRadiance += diffuseColor.rgb * ${HEART_ICE_INNER.toFixed(3)};
        }`,
    );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${KEY}|${prevKey()}`;
  return mat;
}
