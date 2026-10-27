// Pure plan of the Quench vein's frost on the mountain (phase 2H): where the
// mountain's granite in the Quench turns pale and cold, and how it looks.
// The brief's line: the mountain stays calm (big masses, few small parts, as
// 2G left it); the vein's own rock gets frost, not noise. So the frost is
// big value groups only:
//   - the granite itself a value paler and bluer (a cold film over it);
//   - rime and old snow lying on every ledge and upward face, in broad drifts;
//   - pale glaze streaks run down the faces under the ledges (meltwater
//     frozen as it ran), faint;
//   - the field's own cliff faces (the landings' and the shelf's drops)
//     painted in the same frost granite, snow along their lips.
// The weight fades in past the Ring's light and out toward the Breath and
// the Heart, so no edge steps at a line. Three-free, DOM-free,
// deterministic; the GLSL below runs the same arithmetic in the rock's
// material (heart_rock_cutaway.ts), instance-local from the slot's origin.

import { smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { fieldNoise, type Rgb } from '../authored_field/field_mesh_core';

/** The frost's reach (instance-local yards): fading in east of `x0` to `x1`,
 *  past the Ring from `ring0` to `ring1`, out toward the Heart between
 *  `heart1` and `heart0` from its centre, and out of the Breath's corner
 *  (north of `breathZ0` to `breathZ1`, west of `breathX1` to `breathX0`). */
export const QUENCH_FROST = {
  x0: 78,
  x1: 96,
  ring0: 84,
  ring1: 100,
  heartX: 188,
  heartZ: 172,
  heart0: 122,
  heart1: 138,
  breathZ0: 74,
  breathZ1: 88,
  breathX0: 84,
  breathX1: 100,
} as const;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The frost's weight (0 to 1) at instance-local (x, z). */
export function quenchFrostWeight(x: number, z: number): number {
  const F = QUENCH_FROST;
  const ring = Math.hypot(x, z);
  const heart = Math.hypot(x - F.heartX, z - F.heartZ);
  const breath = smooth(F.breathZ0, F.breathZ1, z) * (1 - smooth(F.breathX0, F.breathX1, x));
  return (
    smooth(F.x0, F.x1, x) *
    smooth(F.ring0, F.ring1, ring) *
    smooth(F.heart0, F.heart1, heart) *
    (1 - breath)
  );
}

/** The frost's GLSL (in the rock's colour pass: `vRockCutWorld` the world
 *  position, `vRockCutN` the world normal, `uHeartSlot` the slot's origin;
 *  `diffuseColor` changed). */
export function quenchFrostGlsl(): string {
  const F = QUENCH_FROST;
  const f = (v: number) => v.toFixed(1);
  return `{
          vec2 qL = vRockCutWorld.xz - uHeartSlot;
          float qW = smoothstep( ${f(F.x0)}, ${f(F.x1)}, qL.x )
            * smoothstep( ${f(F.ring0)}, ${f(F.ring1)}, length( qL ) )
            * smoothstep( ${f(F.heart0)}, ${f(F.heart1)}, length( qL - vec2( ${f(F.heartX)}, ${f(F.heartZ)} ) ) );
          qW *= 1.0 - smoothstep( ${f(F.breathZ0)}, ${f(F.breathZ1)}, qL.y )
            * ( 1.0 - smoothstep( ${f(F.breathX0)}, ${f(F.breathX1)}, qL.x ) );
          if ( qW > 0.001 ) {
            vec3 qN = normalize( vRockCutN );
            float qUp = smoothstep( 0.32, 0.72, qN.y );
            vec2 qP = vRockCutWorld.xz * 0.045 + vRockCutWorld.y * 0.02;
            float qPatch = rockFrostNoise( qP ) * 0.7 + rockFrostNoise( qP * 2.3 + 5.0 ) * 0.3;
            // The cold film: the granite a value paler and bluer.
            vec3 qCold = diffuseColor.rgb * vec3( 0.84, 0.92, 1.06 ) + vec3( 0.012, 0.022, 0.04 );
            diffuseColor.rgb = mix( diffuseColor.rgb, qCold, qW );
            // Rime and old snow on the ledges, in broad drifts.
            float qRime = qUp * smoothstep( 0.42, 0.66, qPatch );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.74, 0.8, 0.87 ), qW * qRime * 0.85 );
            // Pale glaze streaks down the faces, faint.
            float qRun = rockFrostNoise( vec2( ( vRockCutWorld.x + vRockCutWorld.z ) * 0.12, vRockCutWorld.y * 0.02 ) );
            float qGlaze = smoothstep( 0.66, 0.84, qRun ) * ( 1.0 - qUp );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.56, 0.68, 0.79 ), qW * qGlaze * 0.3 );
          }
        }`;
}

/** The noise the frost's GLSL reads (declared once in the rock's shader). */
export const QUENCH_FROST_NOISE_GLSL = `
float rockFrostHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float rockFrostNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( rockFrostHash( i ), rockFrostHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( rockFrostHash( i + vec2( 0.0, 1.0 ) ), rockFrostHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

/** The Quench's mountain heightfield tint (the dark mass behind the rock,
 *  heart_mountain.ts): pulled toward this pale cold granite, lifted. */
export const QUENCH_ROCK_TONE = 0x7a8494;
export const QUENCH_ROCK_MIX = 0.5;
export const QUENCH_ROCK_GAIN = 1.1;

/** The Quench's frost granite on the field's cliff faces (sRGB-ish linear,
 *  multiplied into the strata texture): a cool and a paler bed, the rime
 *  along the lip. */
export const QUENCH_CLIFF_COOL: Rgb = [0.46, 0.5, 0.57];
export const QUENCH_CLIFF_PALE: Rgb = [0.56, 0.6, 0.66];
export const QUENCH_CLIFF_RIME: Rgb = [0.78, 0.84, 0.9];
/** The darkest a Quench face gets with depth (a share of its lit tone). */
export const QUENCH_CLIFF_FLOOR = 0.55;

/** Is (x, z) in the Quench's frost (the cliff paint's switch)? */
export function inQuenchFrost(x: number, z: number): boolean {
  return smithHeartAreaAt(x, z) === 'quench' && quenchFrostWeight(x, z) > 0.5;
}

/** The paint of a Quench cliff face at (x, y, z) under a lip at `top`. */
export function quenchCliffPaint(x: number, y: number, z: number, top: number): Rgb {
  const depth = Math.max(0, top - y);
  const bed = 0.5 + 0.5 * Math.sin(y * 0.8 + fieldNoise(x * 0.05, z * 0.05, 2) * 5);
  const n = fieldNoise(x * 0.22 + y * 0.12, z * 0.22 - y * 0.1, 3);
  const dark = Math.max(QUENCH_CLIFF_FLOOR, 1 - depth / 70);
  const k = (0.8 + n * 0.3) * dark;
  const c: Rgb = [
    (QUENCH_CLIFF_COOL[0] + (QUENCH_CLIFF_PALE[0] - QUENCH_CLIFF_COOL[0]) * bed) * k,
    (QUENCH_CLIFF_COOL[1] + (QUENCH_CLIFF_PALE[1] - QUENCH_CLIFF_COOL[1]) * bed) * k,
    (QUENCH_CLIFF_COOL[2] + (QUENCH_CLIFF_PALE[2] - QUENCH_CLIFF_COOL[2]) * bed) * k,
  ];
  // The rime along the lip, ragged.
  const rim = Math.max(0, 1 - (depth - fieldNoise(x * 0.3, z * 0.3, 2) * 1.2) / 1.4);
  const w = Math.min(1, rim) * 0.8;
  return [
    c[0] + (QUENCH_CLIFF_RIME[0] - c[0]) * w,
    c[1] + (QUENCH_CLIFF_RIME[1] - c[1]) * w,
    c[2] + (QUENCH_CLIFF_RIME[2] - c[2]) * w,
  ];
}
