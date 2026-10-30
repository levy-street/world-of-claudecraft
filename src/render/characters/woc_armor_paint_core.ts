// The painted WOC armour treatment (art bible, docs/design/art-direction.md section 3:
// "hand-painted albedo carrying the light: painted top-down key, cool painted shade,
// painted ambient occlusion in creases, crisp painted highlights on metal edges and trim",
// and section 6: one actor treatment, identical on every tier). The pure half: Three-free
// and DOM-free, so a plain Vitest pins it (RENDER_PURE_CORES).
//
// The shipped armour GLBs carry a PBR set (a colour atlas, an ORM data atlas whose blue
// channel is metal, a normal atlas) authored at metallicFactor 1: at full strength the
// metal channel reads as chrome under the sky reflection, where the shipped weapons that
// read right in the painted world are one painted albedo at metalness 0 and roughness 0.9.
// Two decisions live here:
//
// 1. The metal response (WOC_ARMOR_METALNESS and the two roughness floor knobs): armour
//    metal draws at 40 percent of full metal, never more, and the shader floors the
//    per-texel roughness into a painted, non-glossy band. One scalar cap plus the floors in
//    the patch below. The sky reflection's cap is the env sheen's metal share
//    (env_sheen_core.ts): a cap written to material.envMapIntensity never drew, since three
//    ignores it for every material lit by scene.environment.
// 2. The paint-over: ONE GLSL block inserted after three's emissivemap_fragment chunk, the
//    one point where the albedo, the normal and the metal and roughness factors are final
//    and no light has been gathered yet, so it reads the same on the Standard, Physical
//    and Lambert programs. It repaints the albedo the way the painted weapons carry their
//    light: a top-down key and a cool shade off the GEOMETRIC normal, crease darkening off
//    the AO channel and off concave geometry, crisp highlights on convex geometry (the
//    painted edges, weighted toward metal), a low brush-stroke modulation in UV space, and
//    a saturation lift (actors read first). Since the atlases were repainted with that
//    light in them (WOC_ARMOR_PAINT_DEFAULTS), every term ships low and the brush off.
//
// Why geometry and not the normal atlas for the edges (measured on the shipped files,
// 2026-10-29): the paladin's and the mage's normal atlases are flat (over 97 percent of
// the texels tilt under 0.1), and the warrior's tilts sit mostly in the island padding, so
// a highlight read off the normal map's tangent-space deviation lights the seams and
// almost nothing on the plates. The screen-space curvature of the interpolated geometric
// normal is there on every file, and it is the same on every tier: the low, medium and top
// files share one mesh.
//
// Fairness (docs/design/graphics-settings-fairness.md, art bible section 6): the block is
// ONE text for every material class and every tier, read off settings that take no tier
// input. Where a file lacks a map (the low file has no AO or metal channel), the arm that
// reads it is compiled out by three's own define, exactly as that file already draws
// without its normal and metal maps; nothing here asks which tier is running.

/** The metalness factor armour draws with, at most (the factor scales the ORM blue channel,
 *  so a full-metal texel draws at 0.4). A cap: a material authored under it keeps its own. */
export const WOC_ARMOR_METALNESS = 0.4;

/** The marker comments around the inserted block (idempotence, tests, the dry compile). */
export const WOC_ARMOR_PAINT_BEGIN = '// WOC_ARMOR_PAINT begin';
export const WOC_ARMOR_PAINT_END = '// WOC_ARMOR_PAINT end';
const PARS_MARKER = '// WOC_ARMOR_PAINT pars';

/** Every strength of the paint-over. Zero is "off" for each one, and all of them at zero
 *  insert nothing at all (the program is byte-identical to the material without the layer). */
export interface WocArmorPaintSettings {
  /** Chroma lift of the albedo: 0.1 draws it 10 percent more saturated. */
  readonly saturation: number;
  /** How far grey (steel) metal texels move toward a cool painted grey of the same value,
   *  0 to 1: the sky a painter puts into steel, which full metalness used to reflect.
   *  Saturated metal (gold, bronze trim) keeps its colour. */
  readonly metalCool: number;
  /** Albedo lift on up-facing surfaces (the painted top-down key): 0.2 is 20 percent
   *  brighter where the surface faces straight up. */
  readonly key: number;
  /** How far down-facing surfaces move toward WOC_ARMOR_SHADE_TINT (the cool painted
   *  shade), 0 to 1. */
  readonly shade: number;
  /** Darkening in creases, 0 to 1: off the AO channel where the file has one, and off
   *  concave geometry everywhere. */
  readonly cavity: number;
  /** The painted highlight on convex edges, 0 to 1 (the share of the way to white at a
   *  full edge on full metal). */
  readonly edge: number;
  /** The share of `edge` a non-metal texel takes (leather and cloth trim get a softer
   *  painted edge), 0 to 1. Also what a file with no metal channel draws everywhere. */
  readonly edgeNonMetal: number;
  /** Amplitude of the brush-stroke modulation in UV space: 0.05 is plus or minus 5 percent. */
  readonly brush: number;
  /** Roughness floor on every armour texel (0: none). */
  readonly roughnessFloor: number;
  /** Roughness floor on a full-metal texel, blended by the metal channel (0: none). */
  readonly metalRoughnessFloor: number;
}

/** The look that ships. Tune by eye here (or per session with the query knobs below). */
// Since 2026-10-29 the armour atlases carry the painted light themselves
// (scripts/assets/painted_armor/paint_armor.mjs bakes the top-down key, the cool shade,
// tinted crease occlusion, crisp edge highlights, cool painted steel and brushwork into
// every set's colour atlas), so this layer is a light touch on top, never a second paint:
// a little key and shade off the LIVE pose (the bake is lit in the bind pose), a little
// cavity and edge, a small saturation lift, a little steel cooling (the atlases are
// cooled already), and no brush (the strokes are in the texels, where they run on across
// UV seams this UV-space noise broke at). The metal response (the metalness cap, the
// roughness floors) is unchanged. The values before the repaint, raised by eye in
// game over the unpainted atlases: key 0.3, shade 0.62, cavity 0.7, edge 0.75, brush 0.09,
// metalCool 0.7, saturation 0.1.
export const WOC_ARMOR_PAINT_DEFAULTS: WocArmorPaintSettings = {
  saturation: 0.05,
  metalCool: 0.2,
  key: 0.08,
  shade: 0.15,
  cavity: 0.15,
  edge: 0.15,
  edgeNonMetal: 0.6,
  brush: 0,
  roughnessFloor: 0.55,
  metalRoughnessFloor: 0.6,
};

/** Every knob at zero: the patch inserts nothing. */
export const WOC_ARMOR_PAINT_OFF: WocArmorPaintSettings = {
  saturation: 0,
  metalCool: 0,
  key: 0,
  shade: 0,
  cavity: 0,
  edge: 0,
  edgeNonMetal: 0,
  brush: 0,
  roughnessFloor: 0,
  metalRoughnessFloor: 0,
};

/** The cool shade's albedo multiplier (linear RGB): darker and bluer, never grey. */
export const WOC_ARMOR_SHADE_TINT: readonly [number, number, number] = [0.68, 0.76, 0.92];

/** The painted highlight's colour (linear RGB): a warm near-white, like the weapons' edges. */
export const WOC_ARMOR_EDGE_TINT: readonly [number, number, number] = [1.0, 0.95, 0.86];

/** The cool painted steel, as a multiplier on a texel's own luminance (linear RGB). */
export const WOC_ARMOR_STEEL_TINT: readonly [number, number, number] = [0.9, 0.97, 1.1];

// Saturation (of the gamma-encoded colour, the space the atlases were painted in) under
// which a metal texel counts as steel, and over which it is gold or bronze.
const STEEL_SAT_FULL = 0.2;
const STEEL_SAT_NONE = 0.38;

// Curvature (1 / radius, per yard: view space is world units) at which an edge starts and
// is full. The armour is low poly with smooth normals, so the estimate is one value per
// triangle: a helm's dome facets read 10 to 25 and light up as whole triangles under a low
// start, where the narrow bevel strips along a rim, a visor or a plate's border read 40 and
// up. Measured on the shipped warrior, paladin and rogue sets in an offline render.
const EDGE_CURVE_START = 16;
const EDGE_CURVE_FULL = 40;
// How much brighter a non-metal edge paints (its own hue, lifted), and how far toward the
// warm edge tint a full-metal one goes past that.
const EDGE_LIFT = 2.2;
const EDGE_METAL_WHITE = 0.5;
// View distance (yards) the curvature terms fade out over: past it a pixel spans several
// triangles and the screen derivatives turn to noise.
const CURVE_FADE_NEAR = 35;
const CURVE_FADE_FAR = 70;
// AO value at which a crease is full, and at which it no longer darkens.
const AO_CREASE_FULL = 0.25;
const AO_CREASE_NONE = 0.95;
// Brush cells across the atlas's U and V (an atlas is 2:1, so these are square in texels).
const BRUSH_CELLS_U = 40;
const BRUSH_CELLS_V = 20;
// Strokes are this many times longer than they are wide.
const BRUSH_STRETCH = 4;

/** The knobs a `location.search` string may override, and the range each is clamped to. */
const QUERY_KNOBS: Readonly<
  Record<keyof WocArmorPaintSettings, readonly [string, number, number]>
> = {
  saturation: ['apsat', 0, 1],
  metalCool: ['apsteel', 0, 1],
  key: ['apkey', 0, 1],
  shade: ['apshade', 0, 1],
  cavity: ['apcavity', 0, 1],
  edge: ['apedge', 0, 1],
  edgeNonMetal: ['apedgenm', 0, 1],
  brush: ['apbrush', 0, 0.5],
  roughnessFloor: ['aprough', 0, 1],
  metalRoughnessFloor: ['apmetalrough', 0, 1],
};

/** The query key of each knob (`?apkey=0.3`), for docs and tests. */
export function wocArmorPaintQueryKey(knob: keyof WocArmorPaintSettings): string {
  return QUERY_KNOBS[knob][0];
}

/**
 * The session's treatment from a `location.search` string: null for the stock armour
 * (`?armorpaint=off` or `0`: no metal cap, no env cap, no patch, the before arm of a
 * screenshot pair), else the defaults with any `ap*` knob overrides, each clamped to its
 * range. A dev surface only: the options menu owns the supported settings, and nothing
 * here varies by graphics tier.
 */
export function wocArmorPaintFromQuery(search: string): WocArmorPaintSettings | null {
  const params = new URLSearchParams(search);
  const mode = params.get('armorpaint');
  if (mode === 'off' || mode === '0') return null;
  const out: Record<string, number> = { ...WOC_ARMOR_PAINT_DEFAULTS };
  for (const [knob, [key, min, max]] of Object.entries(QUERY_KNOBS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out[knob] = Math.min(max, Math.max(min, value));
  }
  return out as unknown as WocArmorPaintSettings;
}

/** Whether any knob does anything: false means the patch inserts nothing. `edgeNonMetal` is
 *  a share of `edge`, so it does nothing on its own. */
export function wocArmorPaintActive(settings: WocArmorPaintSettings): boolean {
  return (Object.keys(QUERY_KNOBS) as (keyof WocArmorPaintSettings)[]).some(
    (knob) => knob !== 'edgeNonMetal' && settings[knob] > 0,
  );
}

/** The scalar half of the metal response: what an armour material's metalness becomes (a
 *  cap, so a second application changes nothing). The sky reflection takes no scalar here:
 *  three uploads scene.environmentIntensity in place of material.envMapIntensity for a
 *  material lit by scene.environment, so its cap is the env sheen's metal share instead. */
export function wocArmorSurfaceFactors(material: { readonly metalness: number }): {
  metalness: number;
} {
  return { metalness: Math.min(material.metalness, WOC_ARMOR_METALNESS) };
}

function glslFloat(value: number): string {
  const text = String(Number(value.toFixed(4)));
  return text.includes('.') ? text : `${text}.0`;
}

function glslVec3(rgb: readonly [number, number, number]): string {
  return `vec3( ${rgb.map(glslFloat).join(', ')} )`;
}

/** The program-key fragment for a settings value: one string per distinct look, the same
 *  string for every armour material of a session (so every one shares one program per
 *  base program). */
export function wocArmorPaintProgramKey(settings: WocArmorPaintSettings): string {
  const knobs = (Object.keys(QUERY_KNOBS) as (keyof WocArmorPaintSettings)[])
    .map((knob) => glslFloat(settings[knob]))
    .join(',');
  return `woc-armor-paint:v1:${glslFloat(WOC_ARMOR_METALNESS)}:${knobs}`;
}

/** The helpers the block calls, declared ahead of `void main()` (only when the brush is on). */
function parsGlsl(): string {
  return `${PARS_MARKER}
float wocArmorPaintHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float wocArmorPaintNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = wocArmorPaintHash( i );
	float b = wocArmorPaintHash( i + vec2( 1.0, 0.0 ) );
	float c = wocArmorPaintHash( i + vec2( 0.0, 1.0 ) );
	float d = wocArmorPaintHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
`;
}

/**
 * The GLSL block, for a settings value that is active (an inactive one inserts nothing:
 * patchWocArmorPaintFragment). Each knob's term is emitted only when the knob is above
 * zero, with its value baked in, so the block a session compiles is a pure function of
 * its settings: one program per base program, whatever the material.
 */
export function wocArmorPaintGlsl(settings: WocArmorPaintSettings): string {
  const s = settings;
  const lines: string[] = [];
  const curveTerms = s.edge > 0 || s.cavity > 0;
  lines.push(
    '{',
    '\t// the painted key comes from above: world up, in view space',
    '\tvec3 wocApUp = normalize( viewMatrix[ 1 ].xyz );',
    '\tvec3 wocApN = normalize( nonPerturbedNormal );',
    '\tfloat wocApFacing = dot( wocApN, wocApUp );',
    '\t#ifdef STANDARD',
    `\t\tfloat wocApMetal = saturate( metalnessFactor * ${glslFloat(1 / WOC_ARMOR_METALNESS)} );`,
    '\t#else',
    '\t\tfloat wocApMetal = 0.0;',
    '\t#endif',
    '\tvec3 wocApColor = diffuseColor.rgb;',
  );
  if (s.saturation > 0 || s.metalCool > 0) {
    lines.push('\tfloat wocApLuma = dot( wocApColor, vec3( 0.2126, 0.7152, 0.0722 ) );');
  }
  if (s.metalCool > 0) {
    lines.push(
      '\tvec3 wocApGamma = sqrt( max( wocApColor, vec3( 0.0 ) ) );',
      '\tfloat wocApTop = max( max( wocApGamma.r, wocApGamma.g ), wocApGamma.b );',
      '\tfloat wocApSat = ( wocApTop - min( min( wocApGamma.r, wocApGamma.g ), wocApGamma.b ) ) / max( wocApTop, 1e-4 );',
      `\tfloat wocApSteel = wocApMetal * ( 1.0 - smoothstep( ${glslFloat(STEEL_SAT_FULL)}, ${glslFloat(STEEL_SAT_NONE)}, wocApSat ) );`,
      `\twocApColor = mix( wocApColor, wocApLuma * ${glslVec3(WOC_ARMOR_STEEL_TINT)}, ${glslFloat(s.metalCool)} * wocApSteel );`,
    );
  }
  if (s.saturation > 0) {
    lines.push(
      `\twocApColor = max( mix( vec3( wocApLuma ), wocApColor, ${glslFloat(1 + s.saturation)} ), vec3( 0.0 ) );`,
    );
  }
  if (s.key > 0) {
    lines.push(`\twocApColor *= 1.0 + ${glslFloat(s.key)} * smoothstep( -0.2, 1.0, wocApFacing );`);
  }
  if (s.shade > 0) {
    lines.push(
      `\twocApColor *= mix( vec3( 1.0 ), ${glslVec3(WOC_ARMOR_SHADE_TINT)}, ${glslFloat(s.shade)} * smoothstep( 0.1, -0.9, wocApFacing ) );`,
    );
  }
  if (curveTerms) {
    // mean curvature off the screen derivatives of the interpolated normal: positive on
    // convex geometry (a rim, an edge), negative in a crease
    lines.push(
      '\tvec3 wocApP = - vViewPosition;',
      '\tvec3 wocApPx = dFdx( wocApP );',
      '\tvec3 wocApPy = dFdy( wocApP );',
      '\tfloat wocApCurve = ( dot( dFdx( wocApN ), wocApPx ) + dot( dFdy( wocApN ), wocApPy ) ) / max( dot( wocApPx, wocApPx ) + dot( wocApPy, wocApPy ), 1e-10 );',
      `\tfloat wocApNear = 1.0 - smoothstep( ${glslFloat(CURVE_FADE_NEAR)}, ${glslFloat(CURVE_FADE_FAR)}, length( vViewPosition ) );`,
    );
  }
  if (s.cavity > 0) {
    lines.push(
      `\tfloat wocApCrease = smoothstep( ${glslFloat(EDGE_CURVE_START)}, ${glslFloat(EDGE_CURVE_FULL)}, - wocApCurve ) * wocApNear;`,
      '\t#ifdef USE_AOMAP',
      `\t\twocApCrease = max( wocApCrease, 1.0 - smoothstep( ${glslFloat(AO_CREASE_FULL)}, ${glslFloat(AO_CREASE_NONE)}, texture2D( aoMap, vAoMapUv ).r ) );`,
      '\t#endif',
      `\twocApColor *= 1.0 - ${glslFloat(s.cavity)} * wocApCrease;`,
    );
  }
  if (s.edge > 0) {
    lines.push(
      `\tfloat wocApEdge = smoothstep( ${glslFloat(EDGE_CURVE_START)}, ${glslFloat(EDGE_CURVE_FULL)}, wocApCurve ) * wocApNear;`,
      // an edge facing the painted key catches more of it, one facing the ground less
      '\twocApEdge *= 0.55 + 0.45 * smoothstep( -0.6, 0.8, wocApFacing );',
      `\twocApEdge *= ${glslFloat(s.edge)} * mix( ${glslFloat(s.edgeNonMetal)}, 1.0, wocApMetal );`,
      // leather and cloth lift in their own hue; metal goes on toward the warm white
      `\tvec3 wocApEdgeLit = min( wocApColor * ${glslFloat(EDGE_LIFT)} + 0.015, vec3( 1.0 ) );`,
      `\twocApEdgeLit = mix( wocApEdgeLit, ${glslVec3(WOC_ARMOR_EDGE_TINT)}, ${glslFloat(EDGE_METAL_WHITE)} * wocApMetal );`,
      '\twocApColor = mix( wocApColor, max( wocApColor, wocApEdgeLit ), wocApEdge );',
    );
  }
  if (s.brush > 0) {
    // two crossed layers of stretched value noise, faded out before a stroke shrinks under
    // a pixel (procedural noise has no mip chain to do it)
    lines.push(
      '\t#ifdef USE_MAP',
      `\t\tvec2 wocApBrushUv = vMapUv * vec2( ${glslFloat(BRUSH_CELLS_U)}, ${glslFloat(BRUSH_CELLS_V)} );`,
      `\t\tfloat wocApStrokeA = wocArmorPaintNoise( vec2( dot( wocApBrushUv, vec2( 0.8, 0.6 ) ), dot( wocApBrushUv, vec2( -0.6, 0.8 ) ) * ${glslFloat(BRUSH_STRETCH)} ) );`,
      `\t\tfloat wocApStrokeB = wocArmorPaintNoise( vec2( dot( wocApBrushUv, vec2( 0.31, -0.95 ) ), dot( wocApBrushUv, vec2( 0.95, 0.31 ) ) * ${glslFloat(BRUSH_STRETCH)} ) * 1.7 + 19.0 );`,
      `\t\tfloat wocApBrushAa = 1.0 - smoothstep( 0.2, 0.6, length( fwidth( wocApBrushUv ) ) * ${glslFloat(BRUSH_STRETCH)} );`,
      `\t\twocApColor *= 1.0 + ${glslFloat(s.brush)} * ( ( wocApStrokeA * 0.6 + wocApStrokeB * 0.4 ) * 2.0 - 1.0 ) * wocApBrushAa;`,
      '\t#endif',
    );
  }
  lines.push('\tdiffuseColor.rgb = min( wocApColor, vec3( 1.0 ) );');
  if (s.roughnessFloor > 0 || s.metalRoughnessFloor > 0) {
    lines.push(
      '\t#ifdef STANDARD',
      `\t\troughnessFactor = max( roughnessFactor, mix( ${glslFloat(s.roughnessFloor)}, ${glslFloat(s.metalRoughnessFloor)}, wocApMetal ) );`,
      '\t#endif',
    );
  }
  lines.push('}');
  return `${WOC_ARMOR_PAINT_BEGIN}\n${lines.join('\n')}\n${WOC_ARMOR_PAINT_END}\n`;
}

const ANCHOR = '#include <emissivemap_fragment>';
const MAIN = 'void main() {';

/**
 * Insert the paint-over right after the emissivemap_fragment chunk (the anchor stays, so a
 * later layer still finds it), and its helpers ahead of `void main()`. Idempotent; returns
 * the source unchanged for an inactive settings value and for a program without the anchor
 * (nothing three ships for a lit material lacks it).
 */
export function patchWocArmorPaintFragment(
  source: string,
  settings: WocArmorPaintSettings,
): string {
  if (!wocArmorPaintActive(settings) || source.includes(WOC_ARMOR_PAINT_BEGIN)) return source;
  const at = source.indexOf(ANCHOR);
  if (at < 0) return source;
  const end = at + ANCHOR.length;
  let out = `${source.slice(0, end)}\n${wocArmorPaintGlsl(settings)}${source.slice(end)}`;
  if (settings.brush > 0) {
    const main = out.indexOf(MAIN);
    if (main < 0) return source;
    out = `${out.slice(0, main)}${parsGlsl()}${out.slice(main)}`;
  }
  return out;
}

/** The inserted block of a patched source (empty when there is none): what the tier
 *  fairness pin compares across material classes. */
export function wocArmorPaintBlockOf(source: string): string {
  const begin = source.indexOf(WOC_ARMOR_PAINT_BEGIN);
  if (begin < 0) return '';
  const end = source.indexOf(WOC_ARMOR_PAINT_END, begin);
  return end < 0 ? '' : source.slice(begin, end + WOC_ARMOR_PAINT_END.length);
}
