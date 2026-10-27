// Pure plan of the Heart's crown of rock (phase 2J): the mountain round the
// separate final room, open to the ember night. The 2E rock and heightfield
// came into the Heart in the Ring's pale quarry granite, lit as a cool storm
// grey; the Heart is a chamber deep in the mountain over the Smith's own
// heart. So, big value groups only (the mountain stays calm):
//   - the granite darkened and warmed, a breath of violet in its shade;
//   - thin veins of crystal wandering through the faces in the four veins'
//     colours (the north quarter the Breath's, the east the Quench's, the
//     south the Hammer's, the west the Heat's: each altar's own quarter),
//     sparse, thicker low over the chasm;
//   - the heart's light from below on every face turned down toward it.
// The weight fades in past the chasm's open air and out at the Heart's edge,
// so the main map never takes it. Three-free, DOM-free, deterministic; the
// GLSL runs the same arithmetic in the rock's material
// (heart_rock_cutaway.ts), instance-local from the slot's origin.

import { HEART_ROOM, SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';

/** The crown's reach (yards from the Heart's centre). */
export const HEART_CROWN = { in0: 58, in1: 74, out0: 112, out1: 124 } as const;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The crown's weight (0 to 1) at instance-local (x, z). */
export function heartCrownWeight(x: number, z: number): number {
  const C = HEART_CROWN;
  const r = Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);
  return smooth(C.in0, C.in1, r) * (1 - smooth(C.out0, C.out1, r));
}

/** The vein whose quarter a bearing (radians, clockwise from north) lies
 *  in: north the Breath, east the Quench, south the Hammer, west the Heat. */
export function heartCrownQuarter(bearing: number): 'breath' | 'quench' | 'hammer' | 'heat' {
  const a = ((bearing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) % 4;
  return (['breath', 'quench', 'hammer', 'heat'] as const)[q];
}

function vec3(hex: number): string {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return `vec3( ${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)} )`;
}

const WEIGHT_GLSL = `vec2 cL = vRockCutWorld.xz - uHeartSlot - vec2( ${HEART_ROOM.x.toFixed(1)}, ${HEART_ROOM.z.toFixed(1)} );
          float cR = length( cL );
          float cW = smoothstep( ${HEART_CROWN.in0.toFixed(1)}, ${HEART_CROWN.in1.toFixed(1)}, cR )
            * ( 1.0 - smoothstep( ${HEART_CROWN.out0.toFixed(1)}, ${HEART_CROWN.out1.toFixed(1)}, cR ) );`;

/** The crown's granite (the rock's colour pass: `diffuseColor` changed). */
export function heartCrownColorGlsl(): string {
  return `{
          ${WEIGHT_GLSL}
          if ( cW > 0.001 ) {
            vec3 cRock = diffuseColor.rgb * vec3( 0.6, 0.53, 0.55 ) + vec3( 0.01, 0.006, 0.012 );
            diffuseColor.rgb = mix( diffuseColor.rgb, cRock, cW );
          }
        }`;
}

/** The crown's crystal veins and the heart's light from below (the rock's
 *  emissive pass: `totalEmissiveRadiance` added to; reads the frost's noise,
 *  `rockFrostNoise`). */
export function heartCrownEmissiveGlsl(): string {
  const C = SMITH_HEART_VEIN_COLORS;
  return `{
          ${WEIGHT_GLSL}
          if ( cW > 0.001 ) {
            vec3 cN = normalize( vRockCutN );
            float cA = atan( cL.x, cL.y );
            // Each quarter its vein's colour, blended at the diagonals.
            float cQ = ( cA < 0.0 ? cA + 6.2831853 : cA ) / 1.5707963;
            float cI = floor( cQ + 0.5 );
            float cF = cQ + 0.5 - cI;
            vec3 cv0 = ${vec3(C.breath)};
            vec3 cv1 = ${vec3(C.quench)};
            vec3 cv2 = ${vec3(C.hammer)};
            vec3 cv3 = ${vec3(C.heat)};
            int ci = int( mod( cI, 4.0 ) );
            int cj = int( mod( cI + 1.0, 4.0 ) );
            vec3 cA0 = ci == 0 ? cv0 : ci == 1 ? cv1 : ci == 2 ? cv2 : cv3;
            vec3 cA1 = cj == 0 ? cv0 : cj == 1 ? cv1 : cj == 2 ? cv2 : cv3;
            vec3 cVein = mix( cA0, cA1, smoothstep( 0.8, 1.0, cF ) );
            vec2 cT = normalize( vec2( -cN.z, cN.x ) + vec2( 1e-4, 0.0 ) );
            float cU = dot( vRockCutWorld.xz, cT );
            float cLine = rockFrostNoise( vec2( cU * 0.045, vRockCutWorld.y * 0.03 ) );
            float cV = 1.0 - smoothstep( 0.0, 0.02, abs( cLine - 0.5 ) );
            float cMask = smoothstep( 0.56, 0.76, rockFrostNoise( vec2( cU * 0.012 + 7.0, vRockCutWorld.y * 0.011 ) ) );
            float cLow = 1.0 - smoothstep( -20.0, 70.0, vRockCutWorld.y );
            totalEmissiveRadiance += cVein * cV * cMask * cW * ( 0.3 + 0.7 * cLow ) * 0.85;
            // The heart's light from below on the faces turned down to it.
            float cDown = max( 0.0, -cN.y );
            totalEmissiveRadiance += vec3( 0.5, 0.27, 0.1 ) * diffuseColor.rgb * cDown * cW
              * ( 1.0 - smoothstep( -30.0, 40.0, vRockCutWorld.y ) ) * 1.3;
          }
        }`;
}

/** The Heart's mountain heightfield tint (the dark mass behind the rock,
 *  heart_mountain.ts): pulled toward the crown's dark warm granite. */
export const HEART_CROWN_TONE = 0x332c31;
export const HEART_CROWN_MIX = 0.7;
export const HEART_CROWN_GAIN = 0.85;
