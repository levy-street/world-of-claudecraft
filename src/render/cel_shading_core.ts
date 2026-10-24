// Cel-shading R&D look (opt-in, `?cel=on`): the pure half. Two decisions live
// here, both Three-free so a plain Vitest can pin them:
//
// 1. Which look the session runs, read once from the URL (`celShadingFromQuery`).
//    Absent or anything but on/1 means the stock look, byte for byte: no chunk is
//    patched and no pass is built, so a normal session pays nothing.
// 2. The toon light ramp, as a string patch over three's shared
//    `lights_fragment_begin` chunk (`patchCelDirectionalLightChunk`). Only the
//    DIRECTIONAL loop changes, which in the world scene is the one sun (and the
//    re-graded interior key light): its lambert falloff and its shadow factor are
//    folded into one value and stepped into flat bands, so every lit material
//    (Standard, Lambert, Phong, custom ShaderMaterials with lights) gets a hard
//    terminator and a crisp shadow edge without a per-material hook or a new
//    program variant. Point lights keep their smooth falloff (torch pools read as
//    glows, not discs), and the hemisphere and ambient fill stay smooth, so the
//    shadow side is the flat fill tone a cel look wants.
//
// The ramp is folded in by pre-scaling the light colour by band(NL * shadow) / NL,
// because the Standard, Lambert and Phong RE_Direct each multiply their own
// saturate(dot(N, L)) back in. band() is zero below its first threshold, so the
// division never sees an NL small enough to blow up. MeshToonMaterial (TOON) is
// the exception: its RE_Direct reads a gradient map instead of NL, so it keeps
// the stock shadow multiply (no toon material ships today; this keeps one
// correct if it does).

export const CEL_SHADING_PATCH_MARKER = 'WOC_CEL_DIRECTIONAL_RAMP';

/** The look the session runs. Every field is a design knob for the R&D pass. */
export interface CelShadingSettings {
  /** Whether the toon light ramp is patched in (`cellight=off` keeps the stock
   *  lighting under the ink, the A/B arm that separates the two halves). */
  readonly light: boolean;
  /** 2 (lit / shadow) or 3 (lit / mid / shadow) light bands. */
  readonly bands: 2 | 3;
  /** The 2-band terminator on NL x shadow. Low keeps nearly every sunlit face
   *  in the lit band (flat walls under a high sun); higher drops walls and
   *  slopes into the shadow tone for stronger shapes. */
  readonly edge: number;
  /** Light level of the fully lit band, as a fraction of the sun. Below 1
   *  because a flat band lights every sunlit face as if it faced the sun. */
  readonly lit: number;
  /** Light level of the middle band (3-band only). */
  readonly mid: number;
  /** Ink outline strength, 0 (none) to 1 (full ink). */
  readonly ink: number;
  /** Ink tap offset in CSS pixels (scaled by the device ratio). */
  readonly inkWidth: number;
  /** Display-space saturation multiplier applied with the ink (1 = unchanged). */
  readonly saturation: number;
}

export const CEL_SHADING_DEFAULTS: CelShadingSettings = {
  light: true,
  bands: 2,
  edge: 0.12,
  lit: 0.9,
  mid: 0.5,
  ink: 0.85,
  inkWidth: 1,
  saturation: 1.12,
};

// Terminator thresholds on NL * shadow. The default 2-band edge (in
// CEL_SHADING_DEFAULTS) sits a little past grazing so a face has to turn
// properly away before it drops to the fill; the 3-band pair puts the mid band
// on the softer half of the old falloff.
const THREE_BAND_LOW_EDGE = 0.08;
const THREE_BAND_HIGH_EDGE = 0.45;
// Half-width of the smoothstep that anti-aliases each band edge.
const BAND_EDGE_SOFTNESS = 0.025;

function readNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The session's cel look from a `location.search` string, or null for the stock
 * look. `?cel=on` (or `1`) opts in; the tuning knobs are `cellight=off`, `celbands=2|3`, `celedge`,
 * `cellit`, `celmid`, `celink`, `celinkwidth` and `celsat`.
 */
export function celShadingFromQuery(search: string, defaultOn = false): CelShadingSettings | null {
  const params = new URLSearchParams(search);
  const mode = params.get('cel');
  if (defaultOn ? mode === 'off' || mode === '0' : mode !== 'on' && mode !== '1') return null;
  const d = CEL_SHADING_DEFAULTS;
  const lit = readNumber(params, 'cellit', d.lit, 0.2, 1.5);
  return {
    light: params.get('cellight') !== 'off',
    bands: params.get('celbands') === '3' ? 3 : 2,
    edge: readNumber(params, 'celedge', d.edge, 0.05, 0.9),
    lit,
    // The mid band never outshines the lit one (that would invert the ramp).
    mid: Math.min(lit, readNumber(params, 'celmid', d.mid, 0.05, 1)),
    ink: readNumber(params, 'celink', d.ink, 0, 1),
    inkWidth: readNumber(params, 'celinkwidth', d.inkWidth, 0.5, 4),
    saturation: readNumber(params, 'celsat', d.saturation, 0, 2),
  };
}

function glslFloat(value: number): string {
  const text = String(Number(value.toFixed(4)));
  return text.includes('.') ? text : `${text}.0`;
}

function bandEdge(edge: number): string {
  return `smoothstep( ${glslFloat(edge - BAND_EDGE_SOFTNESS)}, ${glslFloat(edge + BAND_EDGE_SOFTNESS)}, x )`;
}

/** The GLSL band expression of `x` (NL times the shadow factor, 0 to 1). */
export function celBandExpression(settings: CelShadingSettings): string {
  if (settings.bands === 3) {
    const low = `${glslFloat(settings.mid)} * ${bandEdge(THREE_BAND_LOW_EDGE)}`;
    const high = `${glslFloat(settings.lit - settings.mid)} * ${bandEdge(THREE_BAND_HIGH_EDGE)}`;
    return `( ${low} + ${high} )`;
  }
  return `( ${glslFloat(settings.lit)} * ${bandEdge(settings.edge)} )`;
}

/**
 * Whether the cel look turns the output grade on for a profile that has none.
 * The depth-based ink rides the grade, so Low takes the grade-only chain: the
 * material ink alone barely shows on this art's hard-edged low-poly models and
 * dark outfits, and a three-way bench (stock / material ink / grade) on an M4
 * Pro could not separate either from stock. iOS keeps its no-grade profile:
 * that one is a memory decision (the extra full-size target), not a speed one,
 * so it keeps the material ink instead.
 */
export function celNeedsGradePass(
  look: CelShadingSettings | null,
  gradePass: boolean,
  platform: 'ios' | 'android' | 'other' | undefined,
): boolean {
  return look !== null && !gradePass && platform !== 'ios';
}

// Material ink: the outline for chains with no output grade to carry the post
// ink (Low, and every iPhone/iPad preset). It darkens a surface where it turns
// away from the camera, inside the material itself: no pass, no draw, no
// target. Two gates keep it on silhouettes. The surface must be CURVED: the
// GEOMETRIC normal (never the normal-mapped one, which would speckle flat
// walls) turning fast per yard of surface, measured as the normal's screen
// change over the surface position's screen change, so the test means the
// same thing near and far. A limb or trunk (radius under a yard) passes; ground
// that curves over tens of yards never does, however glancing the view. And it
// fades out with distance, where a rim would shrink below a pixel and shimmer.
export const CEL_MATERIAL_INK_BEGIN = '// WOC_CEL_MATERIAL_INK begin';
export const CEL_MATERIAL_INK_END = '// WOC_CEL_MATERIAL_INK end';
const OPAQUE_WRITE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
// N.V at which the rim is full ink / starts (1 faces the camera, 0 is edge-on).
const MATERIAL_INK_FACING_FULL = 0.2;
const MATERIAL_INK_FACING_START = 0.45;
// Normal turn per yard of surface (radians-ish) that counts as curved:
// 1 / radius, so these bracket radii from about 2.5 yards down to 0.8.
const MATERIAL_INK_CURVE_START = 0.4;
const MATERIAL_INK_CURVE_FULL = 1.2;
// View distance (yards) the material ink fades out over.
const MATERIAL_INK_FADE_NEAR = 40;
const MATERIAL_INK_FADE_FAR = 90;
// The fraction of the colour the ink keeps (matches the post ink's tone).
const MATERIAL_INK_TONE = 0.18;

/** The GLSL block the material ink inserts before the opaque write. */
export function celMaterialInkGlsl(settings: CelShadingSettings): string {
  return `${CEL_MATERIAL_INK_BEGIN}
#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON )
{
	vec3 wocInkN = normalize( nonPerturbedNormal );
	float wocInkFacing = saturate( dot( wocInkN, geometryViewDir ) );
	float wocInkCurve = smoothstep( ${glslFloat(MATERIAL_INK_CURVE_START)}, ${glslFloat(MATERIAL_INK_CURVE_FULL)}, length( fwidth( wocInkN ) ) / max( length( fwidth( vViewPosition ) ), 1e-4 ) );
	float wocInkNear = 1.0 - smoothstep( ${glslFloat(MATERIAL_INK_FADE_NEAR)}, ${glslFloat(MATERIAL_INK_FADE_FAR)}, length( vViewPosition ) );
	float wocInk = ( 1.0 - smoothstep( ${glslFloat(MATERIAL_INK_FACING_FULL)}, ${glslFloat(MATERIAL_INK_FACING_START)}, wocInkFacing ) ) * wocInkCurve * wocInkNear * ${glslFloat(settings.ink)};
	float wocInkLuma = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
	outgoingLight = max( mix( vec3( wocInkLuma ), outgoingLight, ${glslFloat(settings.saturation)} ), vec3( 0.0 ) );
	outgoingLight *= 1.0 - wocInk * ${glslFloat(1 - MATERIAL_INK_TONE)};
}
#endif
${CEL_MATERIAL_INK_END}
`;
}

/** Insert the material ink right before opaque_fragment's write. Idempotent;
 *  throws when three's anchor moved. */
export function patchCelMaterialInk(source: string, settings: CelShadingSettings): string {
  if (source.includes(CEL_MATERIAL_INK_BEGIN)) return source;
  const write = source.indexOf(OPAQUE_WRITE);
  if (write < 0) throw new Error('pinned three opaque_fragment write anchor changed');
  return source.slice(0, write) + celMaterialInkGlsl(settings) + source.slice(write);
}

/** Remove the material ink block, leaving every other patch in place. */
export function unpatchCelMaterialInk(source: string): string {
  const begin = source.indexOf(CEL_MATERIAL_INK_BEGIN);
  if (begin < 0) return source;
  const end = source.indexOf(CEL_MATERIAL_INK_END, begin);
  if (end < 0) throw new Error('cel material ink block has no end marker');
  return source.slice(0, begin) + source.slice(end + CEL_MATERIAL_INK_END.length + 1);
}

const DIR_SECTION_ANCHOR = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIR_DECL_ANCHOR = '\tDirectionalLight directionalLight;\n';
const DIR_INFO_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
const DIR_SHADOW_ANCHOR =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const DIR_DIRECT_ANCHOR =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

function findAfter(source: string, anchor: string, from: number, label: string): number {
  const index = source.indexOf(anchor, from);
  if (index < 0) throw new Error(`pinned three directional-light ${label} anchor changed`);
  return index;
}

/**
 * Fold the cel ramp into the directional loop of `lights_fragment_begin`.
 * Idempotent (a marked chunk comes back unchanged). Throws when a pinned anchor
 * moved, so a three bump cannot silently ship the stock lighting under `?cel=on`.
 */
export function patchCelDirectionalLightChunk(
  source: string,
  settings: CelShadingSettings,
): string {
  if (source.includes(CEL_SHADING_PATCH_MARKER)) return source;
  const section = source.indexOf(DIR_SECTION_ANCHOR);
  if (section < 0 || source.indexOf(DIR_SECTION_ANCHOR, section + 1) >= 0) {
    throw new Error('pinned three directional-light section anchor changed');
  }
  const decl = findAfter(source, DIR_DECL_ANCHOR, section, 'declaration');
  const info = findAfter(source, DIR_INFO_ANCHOR, decl, 'info');
  const shadow = findAfter(source, DIR_SHADOW_ANCHOR, info, 'shadow');
  const direct = findAfter(source, DIR_DIRECT_ANCHOR, shadow, 'direct');

  // Declarations sit above `#pragma unroll_loop_start`: three unrolls the loop
  // body without braces, so a declaration inside it would repeat per light.
  const header = `${DIR_DECL_ANCHOR}\t// ${CEL_SHADING_PATCH_MARKER}
\t#define WOC_CEL_BAND( x ) ${celBandExpression(settings)}
\tfloat wocCelShadow;
\tfloat wocCelNL;
`;
  const afterInfo = `${DIR_INFO_ANCHOR}
\t\twocCelShadow = 1.0;`;
  const shadowStore = DIR_SHADOW_ANCHOR.replace('directLight.color *=', 'wocCelShadow =');
  const beforeDirect = `#ifdef TOON
\t\tdirectLight.color *= wocCelShadow;
\t\t#else
\t\twocCelNL = saturate( dot( geometryNormal, directLight.direction ) );
\t\tdirectLight.color *= WOC_CEL_BAND( wocCelNL * wocCelShadow ) / max( wocCelNL, 1e-4 );
\t\t#endif

\t\t${DIR_DIRECT_ANCHOR}`;

  return (
    source.slice(0, decl) +
    header +
    source.slice(decl + DIR_DECL_ANCHOR.length, info) +
    afterInfo +
    source.slice(info + DIR_INFO_ANCHOR.length, shadow) +
    shadowStore +
    source.slice(shadow + DIR_SHADOW_ANCHOR.length, direct) +
    beforeDirect +
    source.slice(direct + DIR_DIRECT_ANCHOR.length)
  );
}
