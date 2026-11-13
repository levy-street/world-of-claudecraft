// The Breath vein's painted rock on what its kit does not cover: the mountain's
// heightfield and the field's cliff faces, which stand behind and between the storm
// stacks (the Hammer's own paint does the same for its vein: hammer_env_rock_paint.ts).
// One mesh serves the whole main map, so the paint fades in by `breathEnvWeight`: the
// other veins draw as they did. Triplanar in slot space (at the slot's world coordinates
// a derivative normal quantises to speckle), the cliff painting read at two scales
// turned off the axes so it never lines up into a repeat; ledges facing the sky scoured
// pale, faces turned down falling to the storm's blue-violet.

import type * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import { markOwnedMaterial } from '../shared_resource';
import { breathEnvPainting } from './breath_env_kit';
import { breathEnvRockGlsl, breathEnvWeightGlsl } from './breath_env_plan_core';
import type { RockPaintLayer } from './hammer_env_rock_paint';

/** The Breath's paint as a layer added in place to a material already cloned for it;
 *  null with no painting. */
export function breathRockPaintLayer(): RockPaintLayer | null {
  const cliff = breathEnvPainting('cliff');
  if (!cliff) return null;
  return (m) => {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uBreathCliff = { value: cliff };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBreathPaintLocal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vBreathPaintLocal = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBreathPaintLocal;
          uniform sampler2D uBreathCliff;
          ${breathEnvWeightGlsl()}
          ${breathEnvRockGlsl()}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Outside any branch: the derivatives a quad straddling the vein's edge reads.
            vec3 brDx = dFdx( vBreathPaintLocal );
            vec3 brDy = dFdy( vBreathPaintLocal );
            vec3 brC = cross( brDx, brDy );
            vec3 brN = dot( brC, brC ) > 1e-12 ? normalize( brC ) : vec3( 0.0, 1.0, 0.0 );
            if ( brN.y < 0.0 ) brN = -brN;
            float brW = breathEnvWeight( vBreathPaintLocal.xz );
            // Explicit gradients: the reads may sit behind the weight, so the rest of the
            // main map samples nothing.
            if ( brW > 0.001 ) {
              vec3 brRock = breathEnvRock( uBreathCliff, vBreathPaintLocal, brN, brDx, brDy, diffuseColor.rgb );
              diffuseColor.rgb = mix( diffuseColor.rgb, brRock, brW );
            }
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 0.2, 0.21, 0.25 )
            * breathEnvWeight( vBreathPaintLocal.xz );`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|smith-heart-breath-rock-paint`;
    m.name = `${m.name || 'rock'}:breathPaint`;
  };
}

/** The veins' rock paints on one clone of a rock material, each layer in turn (each
 *  vein's paint holds where its weight does; the two never meet). Null with none. */
export function composeRockPaints(
  ...layers: (RockPaintLayer | null)[]
): ((material: THREE.Material) => THREE.Material) | null {
  const live = layers.filter((l): l is RockPaintLayer => !!l);
  if (live.length === 0) return null;
  return (source) => {
    // A clone copies the source's shared tag: strip it, so the interior's teardown frees
    // the clone it owns.
    const m = markOwnedMaterial(cloneMaterialWithHooks(source));
    for (const layer of live) layer(m);
    return m;
  };
}
