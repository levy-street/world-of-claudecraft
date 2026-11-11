// The Heart's crown dressed with the four veins' painted rock (plan:
// heart_env_dress_core.ts): each element's pieces placed through its own kit's instancer,
// on the kit's Heart variant (drawn only from the Heart, env_area_clip.ts `heart`). A kit
// that has not landed when the interior is built leaves its quarter as it was (its pieces
// were never prepared behind the curtain); a piece a kit lacks is left out.

import * as THREE from 'three';
import { breathEnvHas, breathEnvKitReady, instanceBreathEnv } from './breath_env_kit';
import { hammerEnvHas, hammerEnvKitReady, instanceHammerEnv } from './hammer_env_kit';
import type { RockPaintLayer } from './hammer_env_rock_paint';
import { heartEnvOpenGlsl, planHeartEnvDress } from './heart_env_dress_core';
import { heartRockCoreUniform } from './heart_rock_cutaway';
import { heatEnvHas, heatEnvKitReady, instanceHeatEnv } from './heat_env_kit';
import { instanceQuenchEnv, quenchEnvHas, quenchEnvKitReady } from './quench_env_kit';

/** The Heart's crown dressing, instance-local. */
export function buildHeartEnvDress(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHeartEnvDress';
  const plan = planHeartEnvDress();
  if (hammerEnvKitReady())
    group.add(
      instanceHammerEnv(
        plan.hammer.filter((p) => hammerEnvHas(p.piece)),
        lowGfx,
        'smithHeartHeartEnv:hammer',
        'heart',
      ),
    );
  if (breathEnvKitReady())
    group.add(
      instanceBreathEnv(
        plan.breath.filter((p) => breathEnvHas(p.piece)),
        lowGfx,
        'smithHeartHeartEnv:breath',
        'heart',
      ),
    );
  if (quenchEnvKitReady())
    group.add(
      instanceQuenchEnv(
        plan.quench.filter((p) => quenchEnvHas(p.piece)),
        lowGfx,
        'smithHeartHeartEnv:quench',
        'heart',
      ),
    );
  if (heatEnvKitReady())
    group.add(
      instanceHeatEnv(
        plan.heat.filter((p) => heatEnvHas(p.piece)),
        lowGfx,
        'smithHeartHeartEnv:heat',
        'heart',
      ),
    );
  return group;
}

/** The mountain's heightfield opened round the Heart, seen from inside it
 *  (heart_env_dress_core.ts `HEART_ENV_OPEN`), on the rock's own camera dither as the
 *  camera's Heart blend eases in: a layer for the mountain's own material only. */
export function heartOpenMountainLayer(): RockPaintLayer {
  return (m) => {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uHeartCore = heartRockCoreUniform();
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHeartOpenLocal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vHeartOpenLocal = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHeartOpenLocal;
          uniform float uHeartCore;
          ${heartEnvOpenGlsl()}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          // The Heart's crown opened to the four elements' cliffs, seen from inside it.
          if ( uHeartCore > 0.0 ) {
            float hoDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
            if ( heartEnvOpen( vHeartOpenLocal ) * uHeartCore > hoDither ) discard;
          }`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey()}|smith-heart-heart-open`;
  };
}
