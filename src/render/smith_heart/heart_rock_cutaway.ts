// The mountain's rock cut away round the camera (phase 2E). The rock kit
// skins the mountain right up to the fissures' clearance, and the camera may
// stand inside it: zoomed far out behind a player at an arena's rim (a boss
// target lifts the zoom ceiling to 40 yd), it sits in the mountain past the
// rim. The heightfield was see-through from inside (its faces culled); the
// rock's faces near the camera would stand as a wall. So the rock's material
// discards its fragments within HEART_ROCK_CUT_NEAR of the camera and
// dithers them out to HEART_ROCK_CUT_FAR: rock never hides the player from
// their own camera. Cosmetic only (the rock has no collider), on every tier.
// The same layer keeps the rock's shade from sinking to black (phase 2F,
// HEART_ROCK_SHADE_FLOOR).

import * as THREE from 'three';
import { breathEnvRockGlsl, breathEnvWeightGlsl } from './breath_env_plan_core';
import { breathRockStormGlsl, breathRockStormLiftGlsl } from './breath_rock_storm_core';
import { hammerEnvDepthGlsl } from './hammer_env_plan_core';
import {
  heartCrownCalmGlsl,
  heartCrownColorGlsl,
  heartCrownEmissiveGlsl,
} from './heart_crown_core';
import { HEART_ROCK_CUT_FAR, HEART_ROCK_CUT_NEAR, HEART_ROCK_STRATA } from './heart_rock_plan_core';
import { heatSootGlsl } from './heat_soot_core';
import { quenchEnvRockGlsl, quenchEnvWeightGlsl } from './quench_env_plan_core';
import { QUENCH_FROST_NOISE_GLSL, quenchFrostGlsl } from './quench_frost_core';

/** The drawn slot's origin (world x, z), for the rock's regional paint (the
 *  Quench's frost, phase 2H; the Heat's basalt, phase 2I): one rock material serves every slot, and only
 *  one Smith's Heart field draws at a time, so its frame driver sets it. */
export const HEART_ROCK_SLOT = { value: new THREE.Vector2() };

/** Is the camera in the Heart (the sky's area blend, 0 to 1)? The crown's paint
 *  and the Quench's frost hand the walls they share over by it. */
const HEART_ROCK_CORE = { value: 0 };

/** The painted rock on the Hammer's far skyline: a broad tile and a low contrast, so a whole
 *  mountain reads as one distant mass and never as a repeating pattern. `mean` is the painting's
 *  own mean colour (linear). */
export const HEART_ROCK_FAR_PAINT = {
  tile: 67,
  contrast: 0.4,
  mean: [0.17, 0.155, 0.145] as const,
} as const;

/** Is the camera in the Hammer vein (the sky's area blend, 0 to 1)? The other veins'
 *  rock standing on the Hammer's skyline wears the vein's painted rock for that camera
 *  and its own frost or basalt for every other: a wall reads as the vein it is seen
 *  from. 0 until the painted kit hands over its painting. */
const HEART_ROCK_HAMMER = { value: 0 };
const HEART_ROCK_HAMMER_PAINT: { value: THREE.Texture | null } = { value: null };

/** Hand the rock's material the vein's cliff painting (null: the kit has not landed). */
export function setHeartRockHammerPaint(paint: THREE.Texture | null): void {
  HEART_ROCK_HAMMER_PAINT.value = paint;
}

/** Tell the rock's material how far the camera is in the Hammer vein (the frame driver). */
export function setHeartRockHammer(k: number): void {
  HEART_ROCK_HAMMER.value = HEART_ROCK_HAMMER_PAINT.value ? k : 0;
}

/** The painted skyline's GLSL (slot space, the vertex normal, the two-scale read off
 *  the axes the vein's own rock uses: hammer_env_rock_paint.ts). */
export function heartRockHammerGlsl(): string {
  const mean = HEART_ROCK_FAR_PAINT.mean.map((v) => v.toFixed(3)).join(', ');
  return `if ( uHammerCam > 0.001 ) {
          vec3 hL = vRockCutWorld - vec3( uHeartSlot.x, 0.0, uHeartSlot.y );
          vec3 hB = pow( abs( normalize( vRockCutN ) ), vec3( 4.0 ) );
          hB /= hB.x + hB.y + hB.z;
          const mat2 hTurn = mat2( 0.8, 0.6, -0.6, 0.8 );
          vec3 hA = hL / ${HEART_ROCK_FAR_PAINT.tile.toFixed(1)};
          vec3 hPaint = texture2D( uHammerPaint, hTurn * hA.zy ).rgb * hB.x
            + texture2D( uHammerPaint, hTurn * hA.xz ).rgb * hB.y
            + texture2D( uHammerPaint, hTurn * hA.xy ).rgb * hB.z;
          hPaint = mix( vec3( ${mean} ), hPaint, ${HEART_ROCK_FAR_PAINT.contrast.toFixed(2)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, hPaint * 0.72, uHammerCam );
        }`;
}

/** The skyline's fall with distance (`HAMMER_ENV_DEPTH`), for that camera. */
export function heartRockHammerDepthGlsl(): string {
  return `outgoingLight *= mix( vec3( 1.0 ), hammerEnvDepth( length( vViewPosition ) ), uHammerCam );`;
}

/** The Breath's painted rebuild (breath_env_plan_core.ts): the rock kit's sculpts it keeps
 *  (the lips, the faces hung under the high walks, any band its kit did not take) wear its
 *  cliff painting where its weight holds, over the storm granite. Unset until the kit has
 *  landed, so the vein draws its storm granite as it did. */
const HEART_ROCK_BREATH_PAINT: { value: THREE.Texture | null } = { value: null };
const HEART_ROCK_BREATH_PAINTED = { value: 0 };

/** Hand the rock's material the Breath's cliff painting (null: the kit has not landed). */
export function setHeartRockBreathPaint(paint: THREE.Texture | null): void {
  HEART_ROCK_BREATH_PAINT.value = paint;
  HEART_ROCK_BREATH_PAINTED.value = paint ? 1 : 0;
}

/** The Breath's painted rock's GLSL (after the storm granite: slot space, the vertex
 *  normal; the gradients taken in the uniform branch, so the per-fragment weight may
 *  gate nothing). */
export function heartRockBreathGlsl(): string {
  return `if ( uBreathPainted > 0.5 ) {
          vec3 bpP = vRockCutWorld - vec3( uHeartSlot.x, 0.0, uHeartSlot.y );
          vec3 bpDx = dFdx( bpP );
          vec3 bpDy = dFdy( bpP );
          float bpW = breathEnvWeight( bpP.xz ) * ( 1.0 - uHeartCore );
          // Explicit gradients: the reads may sit behind the per-fragment weight, so rock
          // outside the Breath samples nothing.
          if ( bpW > 0.001 ) {
            vec3 bpRock = breathEnvRock( uBreathPaint, bpP, normalize( vRockCutN ), bpDx, bpDy, diffuseColor.rgb );
            diffuseColor.rgb = mix( diffuseColor.rgb, bpRock, bpW );
          }
        }`;
}

/** The Quench's painted rebuild (quench_env_plan_core.ts): the rock kit's sculpts it keeps
 *  (the lips, the faces hung under the walks, any band its kit did not take) wear its
 *  frozen cliff painting where its weight holds, over the frost. Unset until the kit has
 *  landed, so the vein draws its frost as it did. */
const HEART_ROCK_QUENCH_PAINT: { value: THREE.Texture | null } = { value: null };
const HEART_ROCK_QUENCH_PAINTED = { value: 0 };

/** Hand the rock's material the Quench's cliff painting (null: the kit has not landed). */
export function setHeartRockQuenchPaint(paint: THREE.Texture | null): void {
  HEART_ROCK_QUENCH_PAINT.value = paint;
  HEART_ROCK_QUENCH_PAINTED.value = paint ? 1 : 0;
}

/** The Quench's painted rock's GLSL (after the frost: slot space, the vertex normal; the
 *  gradients taken in the uniform branch, so the per-fragment weight may gate nothing).
 *  The Heart's side fades as the frost's does, by how far the camera is in the Heart. */
export function heartRockQuenchGlsl(): string {
  return `if ( uQuenchPainted > 0.5 ) {
          vec3 qpP = vRockCutWorld - vec3( uHeartSlot.x, 0.0, uHeartSlot.y );
          vec3 qpDx = dFdx( qpP );
          vec3 qpDy = dFdy( qpP );
          float qpW = quenchEnvWeight( qpP.xz, uHeartCore );
          // Explicit gradients: the reads may sit behind the per-fragment weight, so rock
          // outside the Quench samples nothing.
          if ( qpW > 0.001 ) {
            vec3 qpRock = quenchEnvRock( uQuenchPaint, qpP, normalize( vRockCutN ), qpDx, qpDy, diffuseColor.rgb );
            diffuseColor.rgb = mix( diffuseColor.rgb, qpRock, qpW );
          }
        }`;
}

/** The uniform holding how far the camera is in the Heart (the frame driver sets it): a
 *  paint layer on another material that hands the Heart's walls over by it shares it. */
export function heartRockCoreUniform(): { value: number } {
  return HEART_ROCK_CORE;
}

/** Tell the rock's material how far the camera is in the Heart (the frame driver). */
export function setHeartRockCore(k: number): void {
  HEART_ROCK_CORE.value = k;
}

/** Tell the rock's material which slot is drawn (the interior's frame driver). */
export function setHeartRockSlot(ox: number, oz: number): void {
  HEART_ROCK_SLOT.value.set(ox, oz);
}

/** The rock's shade floor (phase 2F): a little of its own colour, a breath
 *  cooler, that no occlusion takes away. Deep in the mountain's joints and
 *  turned from the low sun, 2E's rock sank to a near-black (it read as a
 *  saturated navy beside the warm lit faces); with the floor every shaded
 *  face keeps its cool grey (the painted world's L1 and L6), the lit ones
 *  barely change. */
export const HEART_ROCK_SHADE_FLOOR = ['0.20', '0.215', '0.25'] as const;

/** The world's beds in the rock's paint (phase 2G): each bed of the grid
 *  (`HEART_ROCK_STRATA`) its own value and a breath warmer or cooler (M5),
 *  a soft parting along every bed line, the lines swelling a little across
 *  the mountain (never ruler-straight). Laid on the same grid as the
 *  pieces' ledges, so the strata run on unbroken round the whole mountain
 *  however the pieces meet. */
export const HEART_ROCK_BED_TONE = 0.09;

/** The bed paint's GLSL (`vRockCutWorld` in, `diffuseColor` scaled). */
export function heartRockBedGlsl(): string {
  const S = HEART_ROCK_STRATA;
  return `{
          float bedY = vRockCutWorld.y - ${S.zero.toFixed(2)}
            + 0.45 * sin( vRockCutWorld.x * 0.013 + vRockCutWorld.z * 0.009 );
          float bedU = bedY / ${S.lift.toFixed(2)};
          float bedI = floor( bedU );
          float bedF = fract( bedU );
          float bedH = fract( sin( bedI * 12.9898 + 4.1414 ) * 43758.5453 );
          float bedK = 1.0 + ${HEART_ROCK_BED_TONE.toFixed(2)} * ( bedH * 2.0 - 1.0 );
          float bedLine = 1.0 - 0.14 * ( 1.0 - smoothstep( 0.0, 0.035, bedF ) );
          vec3 bedTint = mix( vec3( 1.03, 1.0, 0.95 ), vec3( 0.96, 0.99, 1.05 ), bedH );
          diffuseColor.rgb *= bedK * bedLine * bedTint;
        }`;
}

const KEY = `smith-heart-rock-cutaway|beds2g|storm3b|breathPaint|frost2h|quenchPaint|soot2i|crownAaa|hammerSky|hammerFar|${HEART_ROCK_CUT_NEAR}|${HEART_ROCK_CUT_FAR}|${HEART_ROCK_SHADE_FLOOR.join(',')}`;

/** Wire the cutaway into a rock material (before any other layer: those
 *  compose with it). */
export function applyRockCutaway(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uHeartSlot = HEART_ROCK_SLOT;
    shader.uniforms.uHeartCore = HEART_ROCK_CORE;
    shader.uniforms.uHammerCam = HEART_ROCK_HAMMER;
    shader.uniforms.uHammerPaint = HEART_ROCK_HAMMER_PAINT;
    shader.uniforms.uBreathPaint = HEART_ROCK_BREATH_PAINT;
    shader.uniforms.uBreathPainted = HEART_ROCK_BREATH_PAINTED;
    shader.uniforms.uQuenchPaint = HEART_ROCK_QUENCH_PAINT;
    shader.uniforms.uQuenchPainted = HEART_ROCK_QUENCH_PAINTED;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRockCutWorld;\nvarying vec3 vRockCutN;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 rockCut = vec4( transformed, 1.0 );
          vec4 rockCutN = vec4( objectNormal, 0.0 );
          #ifdef USE_INSTANCING
            rockCut = instanceMatrix * rockCut;
            rockCutN = instanceMatrix * rockCutN;
          #endif
          vRockCutWorld = ( modelMatrix * rockCut ).xyz;
          vRockCutN = ( modelMatrix * rockCutN ).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${hammerEnvDepthGlsl()}\nvarying vec3 vRockCutWorld;\nvarying vec3 vRockCutN;\nuniform vec2 uHeartSlot;\nuniform float uHeartCore;\nuniform float uHammerCam;\nuniform sampler2D uHammerPaint;\nuniform sampler2D uBreathPaint;\nuniform float uBreathPainted;\nuniform sampler2D uQuenchPaint;\nuniform float uQuenchPainted;\n${breathEnvWeightGlsl()}\n${breathEnvRockGlsl()}\n${quenchEnvWeightGlsl()}\n${quenchEnvRockGlsl()}\n${QUENCH_FROST_NOISE_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          float rockCut = ( distance( vRockCutWorld, cameraPosition ) - ${HEART_ROCK_CUT_NEAR.toFixed(1)} )
            / ${(HEART_ROCK_CUT_FAR - HEART_ROCK_CUT_NEAR).toFixed(1)};
          float rockDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
          if ( rockCut < rockDither ) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${heartRockBedGlsl()}
${breathRockStormGlsl()}
${heartRockBreathGlsl()}
${quenchFrostGlsl()}
${heartRockQuenchGlsl()}
${heatSootGlsl()}
${heartCrownColorGlsl()}
${heartRockHammerGlsl()}`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `${heartCrownCalmGlsl()}\n#include <lights_physical_fragment>`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3( ${HEART_ROCK_SHADE_FLOOR.join(', ')} );
${breathRockStormLiftGlsl()}
${heartCrownEmissiveGlsl()}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `${heartRockHammerDepthGlsl()}\n#include <opaque_fragment>`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${KEY}|${prevKey()}`;
}
