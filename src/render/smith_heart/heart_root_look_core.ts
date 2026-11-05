// The roots of the mountain readable again (the AAA pass's third round,
// 2026-11-04). Once anchored at both ends (phase 2M: out of each landmark,
// into the crown) the roots stood dark on the dark crown and all but
// vanished: their hand-painted stone (heart_pieces.py `heart_root`, painted
// by landmark_paint.py) drew through the kit's shared fracture stone, which
// sank its paint to near black in the Heart's ember night, and a dim vein's
// crystal fell to black too. Here the root's stone draws in its own painted
// colours with a shade floor of that colour (the painted world's shadows
// keep their hue, never black) and a warm rim from the heart's light below,
// so its silhouette reads against the crown; a dim vein keeps a low glow of
// its colour (a lit one still burns several times brighter, so which veins
// are lit reads as before).
//
// PURE: three-free, DOM-free. GLSL for the root's material
// (heart_room_kit.ts) and the vein glow's dim colour.

/** The root's shade floor (a share of its own paint that no shadow takes)
 *  and its rim from the heart's light below (warm, at the silhouette). */
export const HEART_ROOT_LOOK = {
  shadeFloor: 0.26,
  rim: [0.42, 0.24, 0.12] as const,
} as const;

/** A dim vein's crystal: this share of its colour (lit, its colour times the
 *  facets at full strength and more). */
export const HEART_VEIN_DIM = 0.3;

const f = (v: number) => v.toFixed(2);

/** The root's emissive (after `emissivemap_fragment`: `diffuseColor`,
 *  `normal` and `vViewPosition` in, `totalEmissiveRadiance` raised). */
export function heartRootEmissiveGlsl(): string {
  const L = HEART_ROOT_LOOK;
  return `{
          totalEmissiveRadiance += diffuseColor.rgb * ${f(L.shadeFloor)};
          float rootRim = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
          // The heart's light from below: faces turned down take more of it.
          float rootLow = 0.55 + 0.45 * smoothstep( 0.3, -0.6, ( transpose( mat3( viewMatrix ) ) * normal ).y );
          totalEmissiveRadiance += vec3( ${L.rim.map(f).join(', ')} ) * rootRim * rootRim * rootLow;
        }`;
}

/** The dim crystal's colour in the vein glow (`uColor`, `vShade` in). */
export function heartVeinDimGlsl(): string {
  return `mix( vec3( 0.07, 0.065, 0.07 ), uColor * ${f(HEART_VEIN_DIM)}, 0.65 ) * ( 0.55 + 0.6 * vShade.r )`;
}
