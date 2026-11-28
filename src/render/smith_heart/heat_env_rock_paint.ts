// The Heat vein's painted rock on what its kit does not cover: the mountain's heightfield
// and the field's cliff faces, which stand behind and between the basalt stacks (the
// Hammer's, the Breath's and the Quench's own paints do the same for their veins). One mesh
// serves the whole main map, so the paint fades in by `heatEnvWeight` (where the basalt
// soot held): the other veins draw as they did. Triplanar in slot space (at the slot's world
// coordinates a derivative normal quantises to speckle), the basalt cliff painting read at
// two scales turned off the axes so it never lines up into a repeat; ash on the ledges, the
// faces turned down a warm umber.

import type { RockPaintLayer } from './hammer_env_rock_paint';
import { heartRockHeatOpenUniform } from './heart_rock_cutaway';
import { heatEnvPainting } from './heat_env_kit';
import {
  HEAT_ENV_FIELD_BASE,
  heatEnvOpenGlsl,
  heatEnvRockGlsl,
  heatEnvWeightGlsl,
} from './heat_env_plan_core';

/** The Heat's paint as a layer added in place to a material already cloned for it
 *  (breath_env_rock_paint.ts composeRockPaints); null with no painting. */
export function heatRockPaintLayer(): RockPaintLayer | null {
  const cliff = heatEnvPainting('cliff');
  if (!cliff) return null;
  return (m) => {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uHeatCliff = { value: cliff };
      shader.uniforms.uHeatOpen = heartRockHeatOpenUniform();
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHeatPaintLocal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vHeatPaintLocal = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHeatPaintLocal;
          uniform sampler2D uHeatCliff;
          uniform float uHeatOpen;
          ${heatEnvWeightGlsl()}
          ${heatEnvRockGlsl()}
          ${heatEnvOpenGlsl()}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          // The Heat's hall opened to its rings of basalt, seen from inside it (the
          // mountain's mass and the field's cliffs above the floor round the hall).
          if ( uHeatOpen > 0.0 ) {
            float hpOpenDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
            if ( heatEnvOpen( vHeatPaintLocal ) * uHeatOpen > hpOpenDither ) discard;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Outside any branch: the derivatives a quad straddling the vein's edge reads.
            vec3 hpDx = dFdx( vHeatPaintLocal );
            vec3 hpDy = dFdy( vHeatPaintLocal );
            vec3 hpC = cross( hpDx, hpDy );
            vec3 hpN = dot( hpC, hpC ) > 1e-12 ? normalize( hpC ) : vec3( 0.0, 1.0, 0.0 );
            if ( hpN.y < 0.0 ) hpN = -hpN;
            float hpW = heatEnvWeight( vHeatPaintLocal.xz );
            // Explicit gradients: the reads may sit behind the weight, so the rest of the
            // main map samples nothing. A plain dark slate base: the painting's own value.
            if ( hpW > 0.001 ) {
              vec3 hpRock = heatEnvRock( uHeatCliff, vHeatPaintLocal, hpN, hpDx, hpDy, vec3( ${HEAT_ENV_FIELD_BASE.join(', ')} ) );
              diffuseColor.rgb = mix( diffuseColor.rgb, hpRock, hpW );
            }
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 0.15, 0.14, 0.15 )
            * heatEnvWeight( vHeatPaintLocal.xz );`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|smith-heart-heat-rock-paint|open`;
    m.name = `${m.name || 'rock'}:heatPaint`;
  };
}
