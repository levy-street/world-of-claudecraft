// The Deepglass arena floor's tide channel: moving light on its water.
//
// The channel is part of a placed GLB (arena_floor, bl_dg_arena.py), so its
// water is an ordinary glTF material named `arena_tide`: flat cyan emissive.
// This patches that material on the SHARED template (once, like the ship's
// canvas in ship_motion.ts) with a slow two-layer caustic in world space, so
// the ring of water ripples with light instead of lying there as a flat band.
// Keyed by material NAME; nothing else in the game is called that.
import type * as THREE from 'three';
import { sharedUniforms } from './gfx';

export const ARENA_TIDE_MATERIAL = 'arena_tide';

/** The caustic: two drifting cell fields, their bright seams summed. Pure
 *  function of world xz and time, so every wedge of the ring joins up. */
const CAUSTIC_GLSL = `
  vec2 wocTideP = vWocTideWorld.xz * 0.55;
  float wocT = uTime * 0.45;
  vec2 wocA = wocTideP + vec2(wocT * 0.6, -wocT * 0.4);
  vec2 wocB = wocTideP * 1.7 + vec2(-wocT * 0.5, wocT * 0.7);
  float wocC = 0.0;
  wocC += pow(abs(sin(wocA.x + sin(wocA.y * 1.3)) * cos(wocA.y - sin(wocA.x * 0.7))), 6.0);
  wocC += pow(abs(sin(wocB.x - cos(wocB.y * 0.8)) * cos(wocB.y + sin(wocB.x * 1.1))), 8.0) * 0.7;
  totalEmissiveRadiance *= 0.55 + 1.1 * clamp(wocC, 0.0, 1.2);
`;

/** Patch every `arena_tide` material under a freshly parsed template.
 *  Idempotent per material. */
export function attachArenaWater(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || mat.name !== ARENA_TIDE_MATERIAL || mat.userData.wocArenaWater) continue;
      mat.userData.wocArenaWater = true;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = sharedUniforms.uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWocTideWorld;')
          .replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            vec4 wocTideW = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              wocTideW = instanceMatrix * wocTideW;
            #endif
            vWocTideWorld = (modelMatrix * wocTideW).xyz;`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform float uTime;\nvarying vec3 vWocTideWorld;',
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>\n${CAUSTIC_GLSL}`,
          );
      };
      mat.customProgramCacheKey = () => 'woc-arena-tide';
      mat.needsUpdate = true;
    }
  });
}
