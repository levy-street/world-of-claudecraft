// The Quench vein's painted rock on what its kit does not cover: the mountain's
// heightfield and the field's cliff faces, which stand behind and between the glacier
// stacks (the Hammer's and the Breath's own paints do the same for their veins). One mesh
// serves the whole main map, so the paint fades in by `quenchEnvWeight` (where the frost
// held): the other veins draw as they did. Triplanar in slot space (at the slot's world
// coordinates a derivative normal quantises to speckle), the frozen cliff painting read at
// two scales turned off the axes so it never lines up into a repeat; snow on the ledges,
// the faces turned down a deep cold blue.

import type { RockPaintLayer } from './hammer_env_rock_paint';
import { heartRockCoreUniform } from './heart_rock_cutaway';
import { quenchEnvPainting } from './quench_env_kit';
import {
  QUENCH_ENV_FIELD_BASE,
  quenchEnvRockGlsl,
  quenchEnvWeightGlsl,
} from './quench_env_plan_core';

/** The Quench's paint as a layer added in place to a material already cloned for it
 *  (breath_env_rock_paint.ts composeRockPaints); null with no painting. */
export function quenchRockPaintLayer(): RockPaintLayer | null {
  const cliff = quenchEnvPainting('cliff');
  if (!cliff) return null;
  return (m) => {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uQuenchCliff = { value: cliff };
      // How far the camera is in the Heart: the paint hands the walls the Quench shares
      // with the Heart over by it, as the rock kit's does (heart_rock_cutaway.ts).
      shader.uniforms.uQuenchCore = heartRockCoreUniform();
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vQuenchPaintLocal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vQuenchPaintLocal = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vQuenchPaintLocal;
          uniform sampler2D uQuenchCliff;
          uniform float uQuenchCore;
          ${quenchEnvWeightGlsl()}
          ${quenchEnvRockGlsl()}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Outside any branch: the derivatives a quad straddling the vein's edge reads.
            vec3 qpDx = dFdx( vQuenchPaintLocal );
            vec3 qpDy = dFdy( vQuenchPaintLocal );
            vec3 qpC = cross( qpDx, qpDy );
            vec3 qpN = dot( qpC, qpC ) > 1e-12 ? normalize( qpC ) : vec3( 0.0, 1.0, 0.0 );
            if ( qpN.y < 0.0 ) qpN = -qpN;
            float qpW = quenchEnvWeight( vQuenchPaintLocal.xz, uQuenchCore );
            // Explicit gradients: the reads may sit behind the weight, so the rest of the
            // main map samples nothing. A plain slate base: the painting's own value.
            if ( qpW > 0.001 ) {
              vec3 qpRock = quenchEnvRock( uQuenchCliff, vQuenchPaintLocal, qpN, qpDx, qpDy, vec3( ${QUENCH_ENV_FIELD_BASE.join(', ')} ) );
              diffuseColor.rgb = mix( diffuseColor.rgb, qpRock, qpW );
            }
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 0.16, 0.18, 0.24 )
            * quenchEnvWeight( vQuenchPaintLocal.xz, uQuenchCore );`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|smith-heart-quench-rock-paint`;
    m.name = `${m.name || 'rock'}:quenchPaint`;
  };
}
