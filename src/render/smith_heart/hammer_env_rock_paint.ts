// The Hammer vein's painted rock on what the kit does not cover: the mountain's
// heightfield and the field's cliff faces, which stand behind and between the
// painted stacks. One mesh serves the whole main map, so the paint fades in by
// `hammerEnvWeight`: the other veins draw as they did. Triplanar in slot space (at
// the slot's world coordinates a derivative normal quantises to speckle), the
// painting read at two scales turned off the axes so it never lines up into a repeat.

import type * as THREE from 'three';
import { hammerEnvPainting } from './hammer_env_kit';
import { hammerEnvWeightGlsl } from './hammer_env_plan_core';

/** Yards one repeat of each scale of the rock, and of the moss, covers. */
const ROCK_TILE_A = 19;
const ROCK_TILE_B = 47;
const MOSS_TILE = 14;
/** The painting's value under the vein's strong sun. */
const ROCK_GAIN = 'vec3( 0.72, 0.71, 0.71 )';

/** A rock material's painted clone (the veins' layers composed on one:
 *  breath_env_rock_paint.ts composeRockPaints). */
export type HammerRockPaint = (material: THREE.Material) => THREE.Material;

/** A rock paint as a layer added in place to a material already cloned for it (so two
 *  veins' paints stack on one clone: a second clone would drop the first's hook). */
export type RockPaintLayer = (material: THREE.Material) => void;

/** The vein's paint as a layer (see `RockPaintLayer`); null with no paintings. */
export function hammerRockPaintLayer(): RockPaintLayer | null {
  const cliff = hammerEnvPainting('cliff');
  const moss = hammerEnvPainting('moss');
  if (!cliff || !moss) return null;
  return (m) => {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uEnvCliff = { value: cliff };
      shader.uniforms.uEnvMoss = { value: moss };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEnvPaintLocal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vEnvPaintLocal = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vEnvPaintLocal;
          uniform sampler2D uEnvCliff;
          uniform sampler2D uEnvMoss;
          ${hammerEnvWeightGlsl()}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Outside the gradient-sensitive branch: a quad straddling the vein's
            // edge keeps its derivatives.
            vec3 envC = cross( dFdx( vEnvPaintLocal ), dFdy( vEnvPaintLocal ) );
            vec3 envN = dot( envC, envC ) > 1e-12 ? normalize( envC ) : vec3( 0.0, 1.0, 0.0 );
            if ( envN.y < 0.0 ) envN = -envN;
            vec3 envB = pow( abs( envN ), vec3( 4.0 ) );
            envB /= envB.x + envB.y + envB.z;
            const mat2 envTurnA = mat2( 0.8, 0.6, -0.6, 0.8 );
            const mat2 envTurnB = mat2( 0.38, -0.92, 0.92, 0.38 );
            vec3 envA = vEnvPaintLocal / ${ROCK_TILE_A.toFixed(1)};
            vec3 envZ = vEnvPaintLocal.yzx / ${ROCK_TILE_B.toFixed(1)};
            vec3 envRockA = texture2D( uEnvCliff, envTurnA * envA.zy ).rgb * envB.x
              + texture2D( uEnvCliff, envTurnA * envA.xz ).rgb * envB.y
              + texture2D( uEnvCliff, envTurnA * envA.xy ).rgb * envB.z;
            vec3 envRockB = texture2D( uEnvCliff, envTurnB * envZ.xy ).rgb * envB.x
              + texture2D( uEnvCliff, envTurnB * envZ.zx ).rgb * envB.y
              + texture2D( uEnvCliff, envTurnB * envZ.yz ).rgb * envB.z;
            float envPatch = texture2D( uEnvMoss, vEnvPaintLocal.xz / 57.0 ).g;
            // The far scale steers which near scale shows, breaking the repeat.
            vec3 envRock = mix( envRockA, envRockB, smoothstep( 0.2, 0.45, envPatch ) );
            vec3 envMoss = texture2D( uEnvMoss, vEnvPaintLocal.xz / ${MOSS_TILE.toFixed(1)} ).rgb;
            float envTop = smoothstep( 0.62, 0.86, envN.y ) * smoothstep( 0.2, 0.42, envPatch );
            vec3 envPaint = mix( envRock, envMoss * 0.75, envTop * 0.7 ) * ${ROCK_GAIN};
            diffuseColor.rgb = mix( diffuseColor.rgb, envPaint, hammerEnvWeight( vEnvPaintLocal.xz ) );
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 0.26, 0.27, 0.32 )
            * hammerEnvWeight( vEnvPaintLocal.xz );`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|smith-heart-env-rock-paint`;
    m.name = `${m.name || 'rock'}:hammerPaint`;
  };
}
