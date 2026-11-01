// Pure plan of the Heart's crown of rock (phase 2J): the mountain round the
// separate final room, open to the ember night. The 2E rock and heightfield
// came into the Heart in the Ring's pale quarry granite, lit as a cool storm
// grey; the Heart is a chamber deep in the mountain over the Smith's own
// heart. So, big value groups only (the mountain stays calm):
//   - the granite darkened and warmed, a breath of violet in its shade;
//   - each quarter's colour washed low over the rock behind it (the north
//     quarter the Breath's, the east the Quench's, the south the Hammer's, the
//     west the Heat's: each altar's own quarter), fading as it climbs;
//   - the heart's light from below on every face turned down toward it.
// The weight fades in past the chasm's open air and out at the Heart's edge,
// so the main map never takes it. Three-free, DOM-free, deterministic; the
// GLSL runs the same arithmetic in the rock's material
// (heart_rock_cutaway.ts), instance-local from the slot's origin.

import { HEART_ROOM, SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';

/** The crown's reach (yards from the Heart's centre). */
export const HEART_CROWN = { in0: 76, in1: 92, out0: 115, out1: 127 } as const;

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

/** The crown's weight in the shader: the rock's place, and only for a camera
 *  in the Heart (`uHeartCore`, the sky's own area blend): the walls it covers are
 *  also the far walls of the Quench and of the Cornice's long view, and those
 *  keep their own paint. */
const WEIGHT_GLSL = `vec2 cL = vRockCutWorld.xz - uHeartSlot - vec2( ${HEART_ROOM.x.toFixed(1)}, ${HEART_ROOM.z.toFixed(1)} );
          float cR = length( cL );
          float cW = smoothstep( ${HEART_CROWN.in0.toFixed(1)}, ${HEART_CROWN.in1.toFixed(1)}, cR )
            * ( 1.0 - smoothstep( ${HEART_CROWN.out0.toFixed(1)}, ${HEART_CROWN.out1.toFixed(1)}, cR ) )
            * uHeartCore;`;

/** The crown's granite (the rock's colour pass: `diffuseColor` changed):
 *  painted in big value groups on the room's own round coordinates (the arc
 *  round the room, the height), never on anything read off a normal: broad
 *  masses drifting warm umber to cool slate, long strokes along the beds, the
 *  ledges a value paler. */
export function heartCrownColorGlsl(): string {
  return `{
          ${WEIGHT_GLSL}
          if ( cW > 0.001 ) {
            float cU = atan( cL.x, cL.y ) * cR;
            float cY = vRockCutWorld.y;
            float cMass = rockFrostNoise( vec2( cU * 0.021, cY * 0.027 ) + 3.0 ) * 0.65
              + rockFrostNoise( vec2( cU * 0.052 + cY * 0.012, cY * 0.066 ) + 9.0 ) * 0.35;
            float cStroke = rockFrostNoise( vec2( cU * 0.035 + cY * 0.03, cY * 0.42 ) + 17.0 );
            float cUp = smoothstep( 0.3, 0.75, normalize( vRockCutN ).y );
            vec3 cRock = diffuseColor.rgb * vec3( 0.66, 0.6, 0.6 );
            cRock *= mix( vec3( 0.56, 0.58, 0.7 ), vec3( 1.36, 1.16, 1.0 ), smoothstep( 0.32, 0.68, cMass ) );
            cRock *= 0.82 + 0.36 * smoothstep( 0.35, 0.65, cStroke );
            cRock = mix( cRock, cRock * 1.35 + vec3( 0.02, 0.016, 0.014 ), cUp * smoothstep( 0.4, 0.62, cMass ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, cRock, cW );
          }
        }`;
}

/** The crown's faces lit from their own plain normal (most of the way): the
 *  rock's fracture layer turns grazing faces to hard black marble, and the
 *  crown's paint carries the surface instead (before the rock's lights:
 *  `normal` changed; the standard tier). */
export function heartCrownCalmGlsl(): string {
  return `{
          ${WEIGHT_GLSL}
          if ( cW > 0.001 ) normal = normalize( mix( normal, nonPerturbedNormal, cW * 0.85 ) );
        }`;
}

/** The heart's light from below on the faces turned down to it, and each
 *  quarter's own colour low on the rock behind its landmark (a broad wash,
 *  never a line: the thin crystal veins this drew until the AAA pass were read
 *  off a face's normal at this slot's huge world coordinates, a hundred
 *  thousand yards out, and broke into thousands of dots). The rock's emissive
 *  pass: `totalEmissiveRadiance` added to. */
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
            vec3 cVein = mix( cA0, cA1, smoothstep( 0.6, 1.0, cF ) );
            float cLow = 1.0 - smoothstep( -30.0, 46.0, vRockCutWorld.y );
            totalEmissiveRadiance += cVein * diffuseColor.rgb * cW * cLow * cLow * 0.34;
            float cDown = max( 0.0, -cN.y );
            totalEmissiveRadiance += vec3( 0.5, 0.27, 0.1 ) * diffuseColor.rgb * cDown * cW * cLow * 1.3;
          }
        }`;
}

/** The Heart's mountain heightfield tint (the dark mass behind the rock,
 *  heart_mountain.ts): pulled toward the crown's dark warm granite. */
export const HEART_CROWN_TONE = 0x332c31;
export const HEART_CROWN_MIX = 0.7;
export const HEART_CROWN_GAIN = 0.85;
