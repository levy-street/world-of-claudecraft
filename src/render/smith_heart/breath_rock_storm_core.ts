// The Breath vein's storm granite on the mountain's rock kit (the AAA pass's
// third round, 2026-11-04). The first round painted the field's cliff faces
// and the mountain mass round the Breath's mouth as wind-scoured slate
// (breath_stone_core.ts, vertex paint); the rock kit's sculpted faces kept
// the Hammer's warm granite, so the hung faces under the Cornice and the
// bands round the mouth read as one sand-coloured wall from the Ring. Here
// the rock's own material takes the same slate where the Breath's stone
// holds: a cool blue-grey at the granite's own value, thin beds slanting with
// the gale, the ledges and crests scoured pale, every face turned down
// falling to a blue-violet (the painted world's shadows: never black, never
// a warm brown). Faded in from the Ring's mouth, out at the Quench and the
// Heart (the crown's paint takes its walls).
//
// PURE: three-free, DOM-free, deterministic. GLSL composed into the rock's
// one program (heart_rock_cutaway.ts), no new program.

import { HEART_ROOM, HEART_ROOM_AREA_R, RING } from '../../sim/content/smith_heart_layout';
import { BREATH_STONE } from './breath_stone_core';

/** Where the storm holds (instance-local yards; the first round's
 *  `BREATH_STONE` bounds), and how it fades out before the Heart's crown. */
export const BREATH_ROCK_STORM = {
  ...BREATH_STONE,
  heart0: HEART_ROOM_AREA_R - 18,
  heart1: HEART_ROOM_AREA_R + 4,
} as const;

/** The slate's tint on the granite's own value, its scoured pale, its
 *  shadow (linear rgb). */
export const BREATH_ROCK_SLATE = [0.9, 0.97, 1.12] as const;
export const BREATH_ROCK_SCOUR = [0.7, 0.73, 0.78] as const;
export const BREATH_ROCK_SHADOW = [0.74, 0.77, 0.98] as const;

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** How much of the storm granite the rock takes at instance-local (x, z)
 *  (0 to 1, the GLSL's own arithmetic). */
export function breathRockStormWeight(x: number, z: number): number {
  const B = BREATH_ROCK_STORM;
  const ring = Math.hypot(x - RING.x, z - RING.z) - RING.outerR;
  const heart = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  return (
    smooth(B.z0, B.z1, z) *
    (1 - smooth(B.x0, B.x1, x)) *
    smooth(B.ring0, B.ring1, ring) *
    smooth(B.heart0, B.heart1, heart)
  );
}

const f = (v: number) => v.toFixed(2);
const v3 = (c: readonly number[]) => `vec3( ${c.map(f).join(', ')} )`;

/** The storm's GLSL for the rock material (`vRockCutWorld`, `vRockCutN`,
 *  `uHeartSlot`, `uHeartCore` and `rockFrostNoise` in; `diffuseColor`
 *  changed). After the beds, before the frost and the soot (their weights
 *  are nil where the storm holds). */
export function breathRockStormGlsl(): string {
  const B = BREATH_ROCK_STORM;
  return `{
          vec2 bL = vRockCutWorld.xz - uHeartSlot;
          float bW = smoothstep( ${f(B.z0)}, ${f(B.z1)}, bL.y )
            * ( 1.0 - smoothstep( ${f(B.x0)}, ${f(B.x1)}, bL.x ) )
            * smoothstep( ${f(B.ring0)}, ${f(B.ring1)}, length( bL - vec2( ${f(RING.x)}, ${f(RING.z)} ) ) - ${f(RING.outerR)} )
            * smoothstep( ${f(B.heart0)}, ${f(B.heart1)}, length( bL - vec2( ${f(HEART_ROOM.x)}, ${f(HEART_ROOM.z)} ) ) )
            * ( 1.0 - uHeartCore );
          if ( bW > 0.001 ) {
            vec3 bN = normalize( vRockCutN );
            float bLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
            // The slate at the granite's own value (its sculpted joints and
            // worn crests keep their paint), a breath bluer.
            vec3 bSlate = vec3( bLum ) * ${v3(BREATH_ROCK_SLATE)};
            // Thin beds slanting with the gale, warped so none runs ruler straight.
            float bWarp = rockFrostNoise( vRockCutWorld.xz * 0.03 ) * 4.0;
            float bU = ( vRockCutWorld.y + vRockCutWorld.x * 0.08 + bWarp ) * 0.75;
            float bBed = sin( bU ) + 0.4 * sin( bU * 2.2 + 1.3 );
            bSlate *= 1.0 + 0.1 * clamp( bBed * 1.6, -1.0, 1.0 );
            // Broad value groups across the face (a lit buttress, a recess in shade).
            float bGroup = rockFrostNoise( vec2( ( vRockCutWorld.x + vRockCutWorld.z ) * 0.03, vRockCutWorld.y * 0.022 ) );
            bSlate *= 0.86 + 0.28 * bGroup;
            // The ledges and crests scoured pale by the wind.
            float bUp = smoothstep( 0.6, 0.92, bN.y );
            bSlate = mix( bSlate, ${v3(BREATH_ROCK_SCOUR)} * ( 0.8 + 0.3 * bGroup ), bUp * 0.32 );
            // A face turned down falls to the blue-violet shadow.
            float bDown = smoothstep( -0.15, -0.7, bN.y );
            bSlate = mix( bSlate, bSlate * ${v3(BREATH_ROCK_SHADOW)}, bDown * 0.45 );
            diffuseColor.rgb = mix( diffuseColor.rgb, bSlate, bW );
          }
        }`;
}
