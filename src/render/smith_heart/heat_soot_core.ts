// Pure plan of the Heat vein's rock (phase 2I): where the mountain's granite
// in the Heat turns to the dark basalt the first flame cooled it into, and
// how it looks. The brief's line: the mountain stays calm (big masses, few
// small parts, as 2G left it); the vein's own rock gets its soot and its
// columns, never noise. So it is big value groups only:
//   - the granite itself darkened and warmed toward a sooted basalt;
//   - its faces in the columns' vertical bands (two values, broad);
//   - soot streaked up the faces above the fissure's fire, faint;
//   - ash lying pale on every ledge and upward face, in broad drifts;
//   - the field's own cliff faces (the floors' drops into the chasm) in
//     the same columnar basalt, ash along their lips.
// The weight fades in past the Ring's light and out toward the Hammer and
// the Breath, so no edge steps at a line. Three-free, DOM-free,
// deterministic; the GLSL below runs the same arithmetic in the rock's
// material (heart_rock_cutaway.ts), instance-local from the slot's origin.

import { smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { fieldNoise, type Rgb } from '../authored_field/field_mesh_core';

/** The basalt's reach (instance-local yards): fading in west of `x0` to
 *  `x1` (of -x), past the Ring from `ring0` to `ring1`, and out toward the
 *  Hammer (south past `south0` to `south1`) and the Breath (north past
 *  `north0` to `north1`). */
export const HEAT_SOOT = {
  x0: 74,
  x1: 88,
  ring0: 78,
  ring1: 92,
  south0: 66,
  south1: 92,
  north0: 66,
  north1: 92,
} as const;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The basalt's weight (0 to 1) at instance-local (x, z). */
export function heatSootWeight(x: number, z: number): number {
  const S = HEAT_SOOT;
  return (
    smooth(S.x0, S.x1, -x) *
    smooth(S.ring0, S.ring1, Math.hypot(x, z)) *
    (1 - smooth(S.south0, S.south1, -z)) *
    (1 - smooth(S.north0, S.north1, z))
  );
}

/** The basalt's GLSL (in the rock's colour pass: `vRockCutWorld` the world
 *  position, `vRockCutN` the world normal, `uHeartSlot` the slot's origin;
 *  `diffuseColor` changed; reads the frost's noise, `rockFrostNoise`). */
export function heatSootGlsl(): string {
  const S = HEAT_SOOT;
  const f = (v: number) => v.toFixed(1);
  return `{
          vec2 hL = vRockCutWorld.xz - uHeartSlot;
          float hW = smoothstep( ${f(S.x0)}, ${f(S.x1)}, -hL.x )
            * smoothstep( ${f(S.ring0)}, ${f(S.ring1)}, length( hL ) )
            * ( 1.0 - smoothstep( ${f(S.south0)}, ${f(S.south1)}, -hL.y ) )
            * ( 1.0 - smoothstep( ${f(S.north0)}, ${f(S.north1)}, hL.y ) );
          if ( hW > 0.001 ) {
            vec3 hN = normalize( vRockCutN );
            float hUp = smoothstep( 0.32, 0.72, hN.y );
            // The basalt: the granite darkened and warmed.
            vec3 hBasalt = diffuseColor.rgb * vec3( 0.56, 0.52, 0.5 ) + vec3( 0.012, 0.009, 0.006 );
            diffuseColor.rgb = mix( diffuseColor.rgb, hBasalt, hW );
            // The columns: broad vertical bands across every face, two values.
            vec2 hT = normalize( vec2( -hN.z, hN.x ) + vec2( 1e-4, 0.0 ) );
            float hCol = floor( dot( vRockCutWorld.xz, hT ) * 0.42 );
            float hColK = rockFrostNoise( vec2( hCol, 3.7 ) );
            diffuseColor.rgb *= mix( 1.0, 0.88 + 0.26 * hColK, hW * ( 1.0 - hUp ) );
            // Soot streaked up the faces, faint.
            float hRun = rockFrostNoise( vec2( dot( vRockCutWorld.xz, hT ) * 0.1, vRockCutWorld.y * 0.014 ) );
            float hSoot = smoothstep( 0.6, 0.84, hRun ) * ( 1.0 - hUp );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.068, 0.062 ), hW * hSoot * 0.45 );
            // Ash on the ledges, in broad drifts.
            vec2 hP = vRockCutWorld.xz * 0.05 + vRockCutWorld.y * 0.02;
            float hPatch = rockFrostNoise( hP + 11.0 ) * 0.7 + rockFrostNoise( hP * 2.3 + 2.0 ) * 0.3;
            float hAsh = hUp * smoothstep( 0.46, 0.7, hPatch );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.47, 0.43 ), hW * hAsh * 0.7 );
          }
        }`;
}

/** The Heat's mountain heightfield tint (the dark mass behind the rock,
 *  heart_mountain.ts): pulled toward this sooted basalt. */
export const HEAT_ROCK_TONE = 0x3e3834;
export const HEAT_ROCK_MIX = 0.65;
export const HEAT_ROCK_GAIN = 0.9;

/** The Heat's columnar basalt on the field's cliff faces (multiplied into
 *  the strata texture): a dark and a paler column, the ash along the lip. */
export const HEAT_CLIFF_DARK: Rgb = [0.2, 0.185, 0.18];
export const HEAT_CLIFF_PALE: Rgb = [0.3, 0.28, 0.265];
export const HEAT_CLIFF_ASH: Rgb = [0.5, 0.47, 0.43];
/** The darkest a Heat face gets with depth (a share of its lit tone). */
export const HEAT_CLIFF_FLOOR = 0.55;

/** Is (x, z) in the Heat's basalt (the cliff paint's switch)? */
export function inHeatSoot(x: number, z: number): boolean {
  return smithHeartAreaAt(x, z) === 'heat' && heatSootWeight(x, z) > 0.5;
}

/** The paint of a Heat cliff face at (x, y, z) under a lip at `top`: the
 *  columns' vertical bands (two values, a column every yard and a half or
 *  so along the face), darker with depth, ash ragged along the lip. */
export function heatCliffPaint(x: number, y: number, z: number, top: number): Rgb {
  const depth = Math.max(0, top - y);
  const col = Math.floor((x + z) * 0.6);
  const colK = 0.5 + 0.5 * Math.sin(col * 12.9898 + 1.7);
  const n = fieldNoise(x * 0.2 + y * 0.05, z * 0.2 - y * 0.05, 3);
  const dark = Math.max(HEAT_CLIFF_FLOOR, 1 - depth / 60);
  const k = (0.82 + n * 0.26) * dark;
  const c: Rgb = [
    (HEAT_CLIFF_DARK[0] + (HEAT_CLIFF_PALE[0] - HEAT_CLIFF_DARK[0]) * colK) * k,
    (HEAT_CLIFF_DARK[1] + (HEAT_CLIFF_PALE[1] - HEAT_CLIFF_DARK[1]) * colK) * k,
    (HEAT_CLIFF_DARK[2] + (HEAT_CLIFF_PALE[2] - HEAT_CLIFF_DARK[2]) * colK) * k,
  ];
  // The ash along the lip, ragged.
  const rim = Math.max(0, 1 - (depth - fieldNoise(x * 0.3, z * 0.3, 2) * 1.0) / 1.2);
  const w = Math.min(1, rim) * 0.6;
  return [
    c[0] + (HEAT_CLIFF_ASH[0] - c[0]) * w,
    c[1] + (HEAT_CLIFF_ASH[1] - c[1]) * w,
    c[2] + (HEAT_CLIFF_ASH[2] - c[2]) * w,
  ];
}
