// The painted kits' shared material look (the Hammer vein's, hammer_env_kit.ts, the
// Breath's, breath_env_kit.ts, the Quench's, quench_env_kit.ts, and the Heat's,
// heat_env_kit.ts): a painting carries its
// own light, so a turned face keeps a floor of the art's own colour no shadow takes away; a
// rock the camera can stand in is cut away round it (heart_rock_cutaway.ts's rule, the same
// dither); a Tripo atlas spread over a sixty yard stack takes the kit's cliff painting
// faintly over it in two turned scales, so it stays painted up close; the painted crystal
// glows (the Breath's sky-blue, the Quench's cyan, the Heat's gold over its crystal and its
// molten); and the Quench's ice shines from within
// and its snow stays bright. Each kit hands its own numbers; the program key carries every
// number baked in.

import type * as THREE from 'three';
import { HEART_ROCK_CUT_FAR, HEART_ROCK_CUT_NEAR } from './heart_rock_plan_core';

/** The strokes laid over a rock atlas: the painting (read when the program compiles),
 *  the yards one repeat of each scale covers, how strongly they show, and the
 *  painting's mean linear value (the overlay only adds strokes). */
export interface EnvStrokes {
  map: () => THREE.Texture | null;
  tileA: number;
  tileB: number;
  strength: number;
  mean: number;
}

export interface EnvLook {
  /** Cut away round the camera (a rock the camera can stand in). */
  cutaway: boolean;
  /** The strokes over a rock atlas (cut-away rock only), or none. */
  strokes: EnvStrokes | null;
  /** The share of the painting's own colour no shadow takes away (linear rgb). */
  shade: readonly [string, string, string];
  /** The painted crystal lit from within: how far a saturated sky-blue past the rest
   *  of its texel glows (0: no glow layer at all). */
  crystal?: number;
  /** Which painted crystal glows: the Breath's sky-blue (the default), the Quench's
   *  cyan (bright green and blue alike, well past their red) or the Heat's gold (the first
   *  flame's white-gold crystal and the molten's red-orange: red well past blue, and
   *  bright; the sooted basalt is near grey). */
  crystalHue?: 'blue' | 'cyan' | 'gold';
  /** The painted ice lit from within (the Quench's): how far the teal and cyan body of its
   *  ice shines past its own colour, so a frozen fall or a sword of ice stays luminous
   *  under the night while its rock stays dark (0 or absent: no ice layer). */
  ice?: number;
  /** The painted snow kept bright (the Quench's): how far the pale, nearly grey snow on
   *  every ledge lifts past its own colour, so the arena concept's snow caps read white
   *  under the night (0 or absent: no snow layer). */
  snow?: number;
  /** A further discard in the cut-away rock's clip (the Heat's rock opened round its hall,
   *  seen from inside it): `head` declares its uniforms and functions, `body` runs in the
   *  cutaway's block (`vEnvLocal`, slot space, and `envDither` in scope), `key` names it in
   *  the program key, `uniforms` are bound by name (cut-away looks only). */
  clip?: {
    head: string;
    body: string;
    key: string;
    uniforms: Readonly<Record<string, { value: unknown }>>;
  };
}

/** The program key of a look (every number its GLSL bakes in). */
export function envLookKey(look: EnvLook): string {
  const s = look.cutaway ? look.strokes : null;
  return [
    look.cutaway
      ? `smith-heart-env-rock|${HEART_ROCK_CUT_NEAR}|${HEART_ROCK_CUT_FAR}`
      : 'smith-heart-env-stone',
    look.shade.join(','),
    s ? `strokes:${s.tileA},${s.tileB},${s.strength},${s.mean}` : '',
    look.crystal
      ? `crystal:${look.crystal}${look.crystalHue === 'cyan' ? ':cyan' : look.crystalHue === 'gold' ? ':gold' : ''}`
      : '',
    // The ice and snow layers only when a look carries them: the kits that never do keep
    // their keys byte for byte.
    ...(look.ice ? [`ice:${look.ice}`] : []),
    ...(look.snow ? [`snow:${look.snow}`] : []),
    ...(look.cutaway && look.clip ? [`clip:${look.clip.key}`] : []),
  ].join('|');
}

/** Wire a look into a painting's material (its first layer). */
export function applyEnvLook(mat: THREE.Material, look: EnvLook): void {
  const strokes = look.cutaway ? look.strokes : null;
  const clip = look.cutaway ? look.clip : undefined;
  mat.onBeforeCompile = (shader) => {
    if (look.cutaway) {
      if (strokes) shader.uniforms.uEnvStrokes = { value: strokes.map() };
      if (clip) Object.assign(shader.uniforms, clip.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEnvCutWorld;\nvarying vec3 vEnvLocal;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 envCut = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              envCut = instanceMatrix * envCut;
            #endif
            vEnvLocal = envCut.xyz;
            vEnvCutWorld = ( modelMatrix * envCut ).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vEnvCutWorld;\nvarying vec3 vEnvLocal;${clip ? `\n${clip.head}` : ''}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            float envCut = ( distance( vEnvCutWorld, cameraPosition ) - ${HEART_ROCK_CUT_NEAR.toFixed(1)} )
              / ${(HEART_ROCK_CUT_FAR - HEART_ROCK_CUT_NEAR).toFixed(1)};
            float envDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
            if ( envCut < envDither ) discard;${clip ? `\n            ${clip.body}` : ''}
          }`,
        );
      if (strokes) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uEnvStrokes;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            {
              // Slot space: at the slot's world coordinates a derivative normal
              // quantises and turns the triplanar weights to speckle.
              vec3 envC = cross( dFdx( vEnvLocal ), dFdy( vEnvLocal ) );
              vec3 envN = dot( envC, envC ) > 1e-12 ? normalize( envC ) : vec3( 0.0, 1.0, 0.0 );
              vec3 envB = pow( abs( envN ), vec3( 4.0 ) );
              envB /= envB.x + envB.y + envB.z;
              vec3 envA = vEnvLocal / ${strokes.tileA.toFixed(1)};
              vec3 envZ = vEnvLocal.yzx / ${strokes.tileB.toFixed(1)};
              const mat2 envTurnA = mat2( 0.8, 0.6, -0.6, 0.8 );
              const mat2 envTurnB = mat2( 0.38, -0.92, 0.92, 0.38 );
              vec3 envS = ( texture2D( uEnvStrokes, envTurnA * envA.zy ).rgb * envB.x
                + texture2D( uEnvStrokes, envTurnA * envA.xz ).rgb * envB.y
                + texture2D( uEnvStrokes, envTurnA * envA.xy ).rgb * envB.z )
                * ( texture2D( uEnvStrokes, envTurnB * envZ.xy ).rgb * envB.x
                + texture2D( uEnvStrokes, envTurnB * envZ.zx ).rgb * envB.y
                + texture2D( uEnvStrokes, envTurnB * envZ.yz ).rgb * envB.z );
              float envL = dot( envS, vec3( 0.3333 ) ) / ${(strokes.mean * strokes.mean).toFixed(4)};
              diffuseColor.rgb *= mix( 1.0, envL, ${strokes.strength.toFixed(2)} );
            }`,
          );
      }
    }
    const crystal = !look.crystal
      ? ''
      : look.crystalHue === 'gold'
        ? `
      {
        // The painted fire: the first flame's white-gold crystal and the molten's
        // red-orange, its red well past its blue and bright (the sooted basalt is near grey,
        // its warm umber shade dark).
        float envWarm = ( diffuseColor.r - diffuseColor.b ) / max( diffuseColor.r, 1e-3 );
        float envFire = smoothstep( 0.45, 0.7, envWarm ) * smoothstep( 0.12, 0.3, diffuseColor.r );
        totalEmissiveRadiance += diffuseColor.rgb * envFire * ${look.crystal.toFixed(2)};
      }`
        : look.crystalHue === 'cyan'
          ? `
      {
        // The painted crystal: a bright cyan, its green and blue alike and well past its
        // red (the ice's teal body is as saturated, but darker; the snow is pale).
        float envHi = max( diffuseColor.g, diffuseColor.b );
        float envSat = ( min( diffuseColor.g, diffuseColor.b ) - diffuseColor.r ) / max( envHi, 1e-3 );
        float envCrystal = smoothstep( 0.5, 0.7, envSat ) * smoothstep( 0.4, 0.6, envHi );
        totalEmissiveRadiance += diffuseColor.rgb * envCrystal * ${look.crystal.toFixed(2)};
      }`
          : `
      {
        // The painted crystal: a bright sky-blue well past its own red and green (the
        // rock's deep shade is as blue, but dark; its body is blue-grey).
        float envSat = ( diffuseColor.b - max( diffuseColor.r, diffuseColor.g * 0.92 ) ) / max( diffuseColor.b, 1e-3 );
        float envCrystal = smoothstep( 0.5, 0.66, envSat ) * smoothstep( 0.1, 0.22, diffuseColor.b );
        totalEmissiveRadiance += diffuseColor.rgb * envCrystal * ${look.crystal.toFixed(2)};
      }`;
    const ice = look.ice
      ? `
      {
        // The painted ice's body: teal and cyan, its green and blue well past its red at
        // any value a lit face shows (the slate is grey-blue, the snow nearly grey).
        float envIceHi = max( diffuseColor.g, diffuseColor.b );
        float envIceSat = ( min( diffuseColor.g, diffuseColor.b ) - diffuseColor.r ) / max( envIceHi, 1e-3 );
        float envIce = smoothstep( 0.25, 0.55, envIceSat ) * smoothstep( 0.04, 0.2, envIceHi );
        totalEmissiveRadiance += diffuseColor.rgb * envIce * ${look.ice.toFixed(2)};
      }`
      : '';
    const snow = look.snow
      ? `
      {
        // The painted snow: pale and nearly grey (the ice is saturated, the slate dark).
        float envSnowL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
        float envSnowS = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) ) - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
        float envSnow = smoothstep( 0.18, 0.36, envSnowL ) * ( 1.0 - smoothstep( 0.12, 0.3, envSnowS / max( envSnowL, 1e-3 ) ) );
        totalEmissiveRadiance += diffuseColor.rgb * envSnow * ${look.snow.toFixed(2)};
      }`
      : '';
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * vec3( ${look.shade.join(', ')} );${crystal}${ice}${snow}`,
    );
  };
  const key = envLookKey(look);
  mat.customProgramCacheKey = () => key;
}
