// The WOC head tint layer: one onBeforeCompile patch per tint role that
// recolours a head (or body) material right after its map sample, driven by
// three uniforms (target colour, reference colour, strength). The GLSL is
// byte-identical across every material of a role and customProgramCacheKey
// pins it, so a face builder dragging the hair wheel only writes a uniform:
// no program ever links for a colour change, and every character of a role
// shares one program per base program.
//
// Per role, against the material's own measured reference (woc_head_look_core.ts
// WOC_HEAD_TINT_TABLE, LINEAR), all math in linear space:
//   hair, brow: target * clamp(luminance / reference luminance, 0, 3), so the
//               strand shading stays whatever colour the style was baked in. The
//               luminance is the TEXEL's alone times its colour's (HAIR_TRANSFER_GLSL),
//               so only a texel's linear luminance reaches the result: the hair, scalp
//               and beard textures ship grey (woc_head_pack_compress.mjs) and draw what
//               their colour paint drew. Where the emissive map is the colour map (the
//               low tier's readability floor) the glow scales by the same transfer;
//   eye:        only texels clearly more saturated than the eyeball's median
//               (the iris) take the colour, the sclera and pupil keep theirs;
//   skin:       only texels in the skin band (hue near the material's median,
//               some saturation, not black) take the target, at the texel's own
//               shading (luminance / the median's, capped at 1.8) and with a
//               softened share (power 0.55, clamped 0.5..2) of its colour offset
//               from the median: lips and blush stay rosy, and a darker painted
//               feature (eyeshadow, the lid rims) stays a shadow of the new tone.
//               A straight texel * target / median blew those up: Type B's baked
//               skin is dark, so a light tone multiplied its reddish eye paint
//               4 to 14 times into a bright orange ring round the eyes.
//   skin on the body's own atlas (the `suit` surface, its own layer and program):
//               the same band and transfer, gated to the texels that carry real
//               skin paint (woc_skin_tint_core.ts WOC_SUIT_SKIN_GATE), so the dark
//               suit and its brown stitching, which sit in the skin hue band, never
//               take the tone.
//
// The strength uniform is the off switch: at 0 the patch is skipped and the texel is
// left exactly as sampled (a body under a class under-armor atlas, which has no skin
// on it: woc_skin_tint_core.ts wocTintStrength), with no second program to link.
//
// A transfer converts to HSV only what changes per fragment, the texel. What the skin
// and eye transfers read of a UNIFORM colour through HSV (the reference's hue for the
// skin band, its saturation for the iris test, the eye colour's hue, saturation and
// value) is a constant of the draw: it is converted on the CPU when the uniform is
// written (woc_tint_hsv_core.ts, the GLSL helpers mirrored statement for statement) and
// rides in as `rk` and `tk`; their linear reads of the same colours are as they were.
// That took three of the five inlined conversions out of a merged head's fragment, with
// the same result to float rounding (tests/woc_tint_hsv_core.test.ts runs both forms).
//
// Materials are owned per visual (woc_head_dressing.ts clones and wraps), so
// the uniforms are per character; the layer itself allocates nothing per frame.
//
// The MERGED layer (attachWocHeadMergedTint) is the same four transfers on ONE
// material that draws a whole head: every drawn piece folded into one mesh
// (woc_head_merge.ts), each vertex carrying the SLOT of the material it came from.
// A slot's tint role and reference, its surface (the colour, emissive, roughness
// and metalness its own material would have drawn with), its sidedness and the
// texture it samples (the core atlas, the hairstyle's, its scalp cap's, the
// beard's) are small uniform tables the fragment indexes by that slot, so a face
// that cost a dozen draws costs one and still shades and tints texel for texel as
// its pieces did. Two programs for every merged head, whatever its look or its
// colours: one per sidedness variant (a head with a one sided slot carries the
// back-face drop, an all two sided head does not).
//
// The merged layer does the work of four of three's chunks itself (the map and the
// emissive map would sample the wrong texture for a hair or beard slot; roughness
// and metalness come from the slot's row) but leaves every one of their includes in
// place, switched off or fed the slot's value, because a layer attached AFTER this
// one anchors on them: the hit response (surface_response.ts) adds its emission
// after the emissive map chunk and its sheen after the roughness chunk, and found
// nothing to hold on to while the includes were replaced outright.
import * as THREE from 'three';
import type { WocHeadTintedRole, WocLinearRgb, WocTintSurface } from './woc_head_look_core';
import {
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLES,
  WOC_HEAD_MERGE_SLOT_ATTRIBUTE,
  type WocHeadMergeSlot,
} from './woc_head_merge_core';
import { WOC_SUIT_SKIN_GATE_GLSL } from './woc_skin_tint_core';
import { wocTintSrgbHsv } from './woc_tint_hsv_core';

export { wocHeadMergeOneSided } from './woc_head_merge_core';

export interface WocHeadTintUniforms {
  readonly role: WocHeadTintedRole;
  /** Set on the body's own atlas (the `suit` skin layer); absent on a head piece. */
  readonly surface?: WocTintSurface;
  readonly tint: { value: THREE.Vector3 };
  readonly ref: { value: THREE.Vector3 };
  readonly mix: { value: number };
  /** The reference's sRGB hue and saturation (woc_tint_hsv_core.ts): what the skin band
   *  and the iris test read of it, converted when the layer is attached. */
  readonly refHs: { value: THREE.Vector2 };
  /** The target's sRGB hue, saturation and value, which is all the eye transfer reads of
   *  it: written with the colour, for the eye role alone. */
  readonly tintHsv: { value: THREE.Vector3 };
}

/** One shader variant of the patch: a role's own, or the body atlas's skin key. */
type WocTintLayer = WocHeadTintedRole | 'skin_suit';

function layerOf(role: WocHeadTintedRole, surface: WocTintSurface | undefined): WocTintLayer {
  return role === 'skin' && surface === 'suit' ? 'skin_suit' : role;
}

/** The merged head material's uniforms: the role colours, then one row per slot. */
export interface WocHeadMergedTintUniforms {
  readonly merged: true;
  /** Target colour per role, in WOC_HEAD_MERGE_ROLES order (LINEAR). */
  readonly tints: { value: THREE.Vector3[] };
  readonly mix: { value: number };
  /** Per slot: the tint reference (rgb) and the role code (w, 0 = untinted). */
  readonly ref: { value: THREE.Vector4[] };
  /** Per slot: the piece's colour over the merged material's own (rgb) and the texture
   *  layer it samples (w: WOC_HEAD_MERGE_LAYER). */
  readonly col: { value: THREE.Vector4[] };
  /** Per slot: the piece's emissive less the merged material's own (rgb), and its
   *  roughness (w). */
  readonly emi: { value: THREE.Vector4[] };
  /** Per slot: metalness (x), whether the slot draws its front faces only (y), and the
   *  sRGB hue (z) and saturation (w) of its tint reference (woc_tint_hsv_core.ts: what the
   *  skin band and the iris test read of it, converted when the row is written). */
  readonly surf: { value: THREE.Vector4[] };
  /** The eye colour's sRGB hue, saturation and value: all the eye transfer reads of it. */
  readonly eye: { value: THREE.Vector3 };
  /** Whether any slot is one sided: the program then carries the back-face drop. */
  readonly oneSided: boolean;
  /** The hairstyle's, the beard's and the scalp cap's textures (the core atlas rides
   *  `map`). */
  readonly hair: { value: THREE.Texture | null };
  readonly beard: { value: THREE.Texture | null };
  readonly scalp: { value: THREE.Texture | null };
}

const uniformsOf = new WeakMap<THREE.Material, WocHeadTintUniforms>();
const mergedUniformsOf = new WeakMap<THREE.Material, WocHeadMergedTintUniforms>();

/** The per-role layer's uniforms (the merged layer declares its own tables). */
const HELPERS = `uniform vec3 uWocHtTint;
uniform vec3 uWocHtRef;
uniform float uWocHtMix;
uniform vec2 uWocHtRefHs;
uniform vec3 uWocHtTintHsv;
`;

/** The colour-space helpers both layers share. */
const HELPER_FUNCTIONS = `vec3 wocHtRgb2Hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 wocHtHsv2Rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 wocHtLin2Srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 wocHtSrgb2Lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
`;

/** The skin band: the weight `w` of a texel `c` against the reference `r`, with both
 *  luminances (`lc`, `lr`) left in scope for the transfer and the suit gate. The band is
 *  centred on the reference's hue, `rk.x` (off the CPU: woc_tint_hsv_core.ts). */
const SKIN_BAND_GLSL = `vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));
  float dh = mod((hs.x - rk.x) * 360.0 + 540.0, 360.0) - 180.0;
  float w = 1.0 - smoothstep(14.0, 26.0, abs(dh));
  w *= smoothstep(0.08, 0.16, hs.y) * (1.0 - smoothstep(0.8, 0.92, hs.y));
  w *= smoothstep(0.08, 0.16, hs.z);
  vec3 lw = vec3(0.2126, 0.7152, 0.0722);
  float lc = max(dot(c, lw), 1.0e-5);
  float lr = max(dot(r, lw), 1.0e-4);`;

/** The skin transfer at weight `w`. The clamp already holds `f` at 0.5 or more; the
 *  max() states that floor in the form tests/shader_pow_domain.test.ts can prove. */
const SKIN_TRANSFER_GLSL = `float k = min(lc / lr, 1.8);
  vec3 f = clamp((c / lc) / max(r / lr, vec3(1.0e-4)), vec3(0.5), vec3(2.0));
  o = mix(c, t * k * pow(max(f, vec3(0.0)), vec3(0.55)), w);`;

/** The luminance weights (Rec. 709, linear) the hair and brow transfer reads with. */
const LUMA_GLSL = 'vec3(0.2126, 0.7152, 0.0722)';

/** hair, brow: the target at the strands' luminance `l` over the reference's. `l` is the
 *  luminance of the TEXEL ALONE times the luminance of the colour it is drawn with (each
 *  layer reads them where its shader keeps them: ROLE_HAIR_LUMINANCE_GLSL,
 *  MERGED_HAIR_LUMINANCE_GLSL), never the luminance of their product, so a texel's hue
 *  cannot reach the result: a grey texel holding a coloured one's linear luminance draws
 *  exactly what it drew. That is what lets the build ship every hair, scalp and beard
 *  texture grey (woc_head_pack_compress.mjs). Under a grey colour (every normal draw: the
 *  packs' hair materials are white) the two products are one number, the weights summing
 *  to 1; only a coloured effect overlay (Shadowform, Moonkin, Soul Rend, a buff or rune
 *  tint) tells them apart, and it now darkens the strands by its luminance rather than by
 *  its hue against the paint's. */
const HAIR_TRANSFER_GLSL = 'o = t * clamp(l / max(r.x, 1.0e-4), 0.0, 3.0);';

/** The per-role layer's `l`: three's map chunk leaves the texel in `sampledDiffuseColor` (a
 *  material without a map draws a texel of 1), and `diffuse` is the material's colour. */
const ROLE_HAIR_LUMINANCE_GLSL = `#ifdef USE_MAP
  float l = dot(sampledDiffuseColor.rgb, ${LUMA_GLSL});
#else
  float l = 1.0;
#endif
  l *= dot(diffuse, ${LUMA_GLSL});`;

/** The merged layer's `l`: the slot's own texel (1 for a mapless material) and the colour the
 *  slot draws it with, the material's colour times the slot's own over it. */
const MERGED_HAIR_LUMINANCE_GLSL = `float l = dot(wocTexel.rgb, ${LUMA_GLSL}) * dot(diffuse * wocCol.rgb, ${LUMA_GLSL});`;

/** The hair and brow glow: where a material's emissive map is its colour map (the low tier's
 *  readability floor and a def's self illumination: assets.ts), three scales the glow by the
 *  RAW texel, whose colour a grey hair texture no longer carries. This scales it by the
 *  texel the transfer draws instead, the target at the texel's luminance over the reference,
 *  so the glow follows the chosen colour as the albedo does (on the low tier a blond's floor
 *  is blond, not the auburn of the paint). Reads `wocGlow` (the texel), `t` and `r`; leaves
 *  the transferred texel in `o`. */
const HAIR_GLOW_GLSL = `float l = dot(wocGlow, ${LUMA_GLSL});
    vec3 o = wocGlow;
    ${HAIR_TRANSFER_GLSL}`;

/** The per-role hair and brow emissive map stage: three's lookup, then the transfer (at the
 *  layer's strength) before the multiply. Spliced ahead of the chunk's switched-off include. */
const ROLE_HAIR_EMISSIVE_GLSL = `#ifdef USE_EMISSIVEMAP
  vec3 wocGlow = texture2D( emissiveMap, vEmissiveMapUv ).rgb;
  if (uWocHtMix > 0.0) {
    vec3 t = uWocHtTint;
    vec3 r = uWocHtRef;
    ${HAIR_GLOW_GLSL}
    wocGlow = mix(wocGlow, max(o, vec3(0.0)), uWocHtMix);
  }
  totalEmissiveRadiance *= wocGlow;
#endif`;

/** The per-layer body of the patch: reads `c` (the texel times the colour, linear), `t` (the
 *  target, linear) and `r` (the reference, linear) and writes `o` (linear). Of the two
 *  uniform colours the skin and eye bodies also read `rk` (the reference's sRGB hue and
 *  saturation) and the eye body `tk` (the target's sRGB hue, saturation and value), each
 *  converted on the CPU (woc_tint_hsv_core.ts): the iris test starts above the
 *  reference's saturation, and the iris takes the target's hue and saturation, with its
 *  value as a gain on the texel's. */
const LAYER_GLSL: Readonly<Record<WocTintLayer, string>> = {
  hair: `${ROLE_HAIR_LUMINANCE_GLSL}
  ${HAIR_TRANSFER_GLSL}`,
  brow: `${ROLE_HAIR_LUMINANCE_GLSL}
  ${HAIR_TRANSFER_GLSL}`,
  eye: `vec3 hs = wocHtRgb2Hsv(wocHtLin2Srgb(c));
  float w = smoothstep(rk.y + 0.08, rk.y + 0.22, hs.y) * smoothstep(0.03, 0.1, hs.z);
  vec3 iris = wocHtSrgb2Lin(wocHtHsv2Rgb(vec3(tk.x, tk.y, clamp(hs.z * (0.4 + tk.z), 0.0, 1.0))));
  o = mix(c, iris, w);`,
  skin: `${SKIN_BAND_GLSL}
  ${SKIN_TRANSFER_GLSL}`,
  skin_suit: `${SKIN_BAND_GLSL}
  ${WOC_SUIT_SKIN_GATE_GLSL}
  ${SKIN_TRANSFER_GLSL}`,
};

/** What a per-role layer's body reads off the CPU, declared beside `t` and `r`. */
const LAYER_CONSTANTS_GLSL: Readonly<Record<WocTintLayer, string>> = {
  hair: '',
  brow: '',
  eye: '\n  vec2 rk = uWocHtRefHs;\n  vec3 tk = uWocHtTintHsv;',
  skin: '\n  vec2 rk = uWocHtRefHs;',
  skin_suit: '\n  vec2 rk = uWocHtRefHs;',
};

/** The role a material was wrapped for, or null. */
export function wocHeadTintOf(mat: THREE.Material): WocHeadTintUniforms | null {
  return uniformsOf.get(mat) ?? null;
}

/**
 * Attach the tint layer for `role` to a material IN PLACE (call it on a clone the
 * caller owns: the uniforms are per material). `surface` picks the body atlas's own
 * skin layer (WocTintSurface). Composes with any hook the material already carries
 * and folds its program key in, exactly like the armour dye.
 */
export function attachWocHeadTint(
  mat: THREE.Material,
  role: WocHeadTintedRole,
  ref: WocLinearRgb,
  surface?: WocTintSurface,
): WocHeadTintUniforms {
  const existing = uniformsOf.get(mat);
  if (existing) return existing;
  const [hue, saturation] = wocTintSrgbHsv(ref);
  const u: WocHeadTintUniforms = {
    role,
    ...(surface ? { surface } : null),
    tint: { value: new THREE.Vector3(1, 1, 1) },
    ref: { value: new THREE.Vector3(ref[0], ref[1], ref[2]) },
    mix: { value: 0 },
    refHs: { value: new THREE.Vector2(hue, saturation) },
    // the white the layer is born pointed at
    tintHsv: { value: new THREE.Vector3(0, 0, 1) },
  };
  hookWocHeadTint(mat, u);
  return u;
}

/**
 * Re-attach a tinted source's layer to its clone (material_clone_hooks.ts): clone()
 * drops onBeforeCompile and the pinned program key but copies userData, so an effect
 * clone (the buff glow, a form tint) would draw the baked colours and link a new
 * program mid-fight. The clone SHARES the source's uniforms, so its key comes out
 * byte-identical and a colour change keeps reaching it. Call it LAST, after the
 * other clone hooks: the tint is the last layer the dressing puts on a material.
 */
export function reapplyWocHeadTintToClone(source: THREE.Material, clone: THREE.Material): void {
  const merged = mergedUniformsOf.get(source);
  if (merged) {
    if (!mergedUniformsOf.has(clone)) hookWocHeadMergedTint(clone, merged);
    return;
  }
  const u = uniformsOf.get(source);
  if (!u || uniformsOf.has(clone)) return;
  hookWocHeadTint(clone, u);
}

function hookWocHeadTint(mat: THREE.Material, u: WocHeadTintUniforms): void {
  const layer = layerOf(u.role, u.surface);
  uniformsOf.set(mat, u);
  mat.userData.wocHeadTint = layer;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uWocHtTint = u.tint;
    shader.uniforms.uWocHtRef = u.ref;
    shader.uniforms.uWocHtMix = u.mix;
    shader.uniforms.uWocHtRefHs = u.refHs;
    shader.uniforms.uWocHtTintHsv = u.tintHsv;
    const fragment = shader.fragmentShader
      .replace('void main() {', `${HELPERS}${HELPER_FUNCTIONS}void main() {`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
if (uWocHtMix > 0.0) {
  vec3 c = diffuseColor.rgb;
  vec3 t = uWocHtTint;
  vec3 r = uWocHtRef;${LAYER_CONSTANTS_GLSL[layer]}
  vec3 o = c;
  ${LAYER_GLSL[layer]}
  diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHtMix);
}`,
      );
    // hair and brow glow by the transferred texel (ROLE_HAIR_EMISSIVE_GLSL); three's chunk
    // stays included, switched off, where a later layer (the hit response) anchors on it
    shader.fragmentShader =
      layer === 'hair' || layer === 'brow'
        ? fragment.replace(
            '#include <emissivemap_fragment>',
            `${ROLE_HAIR_EMISSIVE_GLSL}\n${switchedOff('USE_EMISSIVEMAP', '#include <emissivemap_fragment>')}`,
          )
        : fragment;
  };
  mat.customProgramCacheKey = () => `woc_head_tint|${layer}|${prevKey}`;
}

/** Point a wrapped material at a colour (linear RGB), at full strength unless told
 *  otherwise; strength 0 switches the layer off (the texel draws as sampled). */
export function setWocHeadTint(u: WocHeadTintUniforms, color: WocLinearRgb, strength = 1): void {
  u.tint.value.set(color[0], color[1], color[2]);
  u.mix.value = strength;
  if (u.role !== 'eye') return;
  const [hue, saturation, value] = wocTintSrgbHsv(color);
  u.tintHsv.value.set(hue, saturation, value);
}

// ---------------------------------------------------------------------------
// The merged layer: one material for a whole head
// ---------------------------------------------------------------------------

const N = WOC_HEAD_MERGE_MAX_SLOTS;

// No `flat` on the varying: the three vertices of a triangle carry the same slot, so
// the interpolated value is that slot (the fragment rounds it), and flat shading costs
// a provoking-vertex emulation on the ANGLE backends.
const MERGED_VERTEX_DECL = `attribute float ${WOC_HEAD_MERGE_SLOT_ATTRIBUTE};
varying float vWocHmSlot;
`;

const MERGED_FRAGMENT_DECL = `uniform vec3 uWocHmTint[${WOC_HEAD_MERGE_ROLES.length}];
uniform float uWocHmMix;
uniform vec4 uWocHmRef[${N}];
uniform vec4 uWocHmCol[${N}];
uniform vec4 uWocHmEmi[${N}];
uniform vec4 uWocHmSurf[${N}];
uniform vec3 uWocHmEyeHsv;
uniform sampler2D uWocHmHair;
uniform sampler2D uWocHmBeard;
uniform sampler2D uWocHmScalp;
varying float vWocHmSlot;
`;

/** The slot's rows, the layered texel, the slot's colour and emissive, then the tint.
 *  The gradients are taken before any branch, so each sampler filters exactly as its
 *  own material's map did.
 *
 *  Sidedness: the pieces do not agree on it (a Type A head, its eyelids and eyeballs and
 *  the handlebar moustache are one sided; brows, ears, hair and every other beard two
 *  sided), and one material has one \`side\`. The merged head is drawn two sided and the
 *  back of a one sided slot is dropped here, which is what culling did for its own
 *  mesh (the facing and the slot are both constant over a triangle, so the drop never
 *  splits a derivative quad). Only a head that HAS a one sided slot compiles the drop
 *  (WOC_HM_ONE_SIDED): an all two sided head (Type B) keeps a program without it.
 *  Under a translucent effect three draws a two sided material twice, backs then
 *  fronts, and flips the winding for the backs pass (FLIP_SIDED), where every
 *  fragment therefore reads as front facing: there a one sided slot draws nothing.
 *  (The near stand-in is dropped under such an effect; the far head group is not.) */
const MERGED_MAP_GLSL = `int wocSlot = int(vWocHmSlot + 0.5);
vec4 wocRef = uWocHmRef[wocSlot];
vec4 wocCol = uWocHmCol[wocSlot];
vec4 wocEmi = uWocHmEmi[wocSlot];
vec4 wocTexel = vec4( 1.0 );
#ifdef USE_MAP
  vec2 wocDx = dFdx( vMapUv );
  vec2 wocDy = dFdy( vMapUv );
#endif
#ifdef WOC_HM_ONE_SIDED
  #ifdef FLIP_SIDED
    if (uWocHmSurf[wocSlot].y > 0.5) discard;
  #else
    if (uWocHmSurf[wocSlot].y > 0.5 && !gl_FrontFacing) discard;
  #endif
#endif
#ifdef USE_MAP
  vec4 sampledDiffuseColor;
  if (wocCol.a < 0.5) sampledDiffuseColor = textureGrad( map, vMapUv, wocDx, wocDy );
  else if (wocCol.a < 1.5) sampledDiffuseColor = textureGrad( uWocHmHair, vMapUv, wocDx, wocDy );
  else if (wocCol.a < 2.5) sampledDiffuseColor = textureGrad( uWocHmBeard, vMapUv, wocDx, wocDy );
  else sampledDiffuseColor = textureGrad( uWocHmScalp, vMapUv, wocDx, wocDy );
  wocTexel = sampledDiffuseColor;
  diffuseColor *= sampledDiffuseColor;
#endif
diffuseColor.rgb *= wocCol.rgb;
totalEmissiveRadiance += wocEmi.rgb;
if (uWocHmMix > 0.0 && wocRef.a > 0.5) {
  vec3 c = diffuseColor.rgb;
  vec3 r = wocRef.rgb;
  vec2 rk = uWocHmSurf[wocSlot].zw;
  vec3 o = c;
  if (wocRef.a < 1.5) {
    vec3 t = uWocHmTint[0];
    ${LAYER_GLSL.skin}
  } else if (wocRef.a < 2.5) {
    vec3 tk = uWocHmEyeHsv;
    ${LAYER_GLSL.eye}
  } else {
    vec3 t = wocRef.a < 3.5 ? uWocHmTint[2] : uWocHmTint[3];
    ${MERGED_HAIR_LUMINANCE_GLSL}
    ${HAIR_TRANSFER_GLSL}
  }
  diffuseColor.rgb = mix(c, max(o, vec3(0.0)), uWocHmMix);
}`;

/** A head material's emissive map is only ever its own colour map (the low tier's
 *  readability floor and a def's self illumination both scale the glow by the albedo:
 *  assets.ts), so the slot's own texel stands in for it: sampling the merged material's
 *  emissive map would light a hair or beard slot with the core atlas's texels. A
 *  flat-coloured slot's texel is the atlas's white cell, as its own material had no map.
 *  A hair or brow slot (role code 3 or 4) glows by its texel as the transfer draws it, as
 *  its own piece does (HAIR_GLOW_GLSL). */
const MERGED_EMISSIVE_GLSL = `#ifdef USE_EMISSIVEMAP
  vec3 wocGlow = wocTexel.rgb;
  if (uWocHmMix > 0.0 && wocRef.a > 2.5) {
    vec3 t = wocRef.a < 3.5 ? uWocHmTint[2] : uWocHmTint[3];
    vec3 r = wocRef.rgb;
    ${HAIR_GLOW_GLSL}
    wocGlow = mix(wocGlow, max(o, vec3(0.0)), uWocHmMix);
  }
  totalEmissiveRadiance *= wocGlow;
#endif`;

/** A chunk's include with its define lifted for the length of it: the chunk compiles to
 *  nothing (this layer already did its work) and its include stays where a later layer
 *  looks for it, so what that layer adds lands after this one's, as on any material. (The
 *  per-role hair and brow layer switches off the emissive map chunk the same way.) */
function switchedOff(define: string, include: string): string {
  return `#ifdef ${define}
  #define WOC_HM_${define}
  #undef ${define}
#endif
${include}
#ifdef WOC_HM_${define}
  #define ${define}
  #undef WOC_HM_${define}
#endif`;
}

/** A chunk that opens with \`float <name>Factor = <name>;\` reading the material's
 *  uniform: for the length of it the name means the slot's own value, so the factor
 *  starts there and a later layer's edit after the include (the hit response's sheen)
 *  still applies on top. */
function fedFrom(uniform: string, value: string, include: string): string {
  return `#define ${uniform} ${value}
${include}
#undef ${uniform}`;
}

/** The merged layer's uniforms on a material, or null. */
export function wocHeadMergedTintOf(mat: THREE.Material): WocHeadMergedTintUniforms | null {
  return mergedUniformsOf.get(mat) ?? null;
}

/**
 * Attach the merged head layer to a material IN PLACE (a clone the caller owns), with
 * its tables sized for every slot the shader carries. `oneSided` says whether the head
 * folds a one sided slot (wocHeadMergeOneSided): its program carries the back-face
 * drop. Composes with the hooks the material already wears and folds its program key
 * in, like the per-role layer.
 */
export function attachWocHeadMergedTint(
  mat: THREE.Material,
  oneSided = false,
): WocHeadMergedTintUniforms {
  const existing = mergedUniformsOf.get(mat);
  if (existing) return existing;
  const rows = (): THREE.Vector4[] =>
    Array.from({ length: N }, () => new THREE.Vector4(0, 0, 0, 0));
  const u: WocHeadMergedTintUniforms = {
    merged: true,
    tints: { value: WOC_HEAD_MERGE_ROLES.map(() => new THREE.Vector3(1, 1, 1)) },
    mix: { value: 0 },
    ref: { value: rows() },
    col: { value: Array.from({ length: N }, () => new THREE.Vector4(1, 1, 1, 0)) },
    emi: { value: rows() },
    surf: { value: rows() },
    // the white the role colours are born at
    eye: { value: new THREE.Vector3(0, 0, 1) },
    oneSided,
    hair: { value: null },
    beard: { value: null },
    scalp: { value: null },
  };
  hookWocHeadMergedTint(mat, u);
  return u;
}

function hookWocHeadMergedTint(mat: THREE.Material, u: WocHeadMergedTintUniforms): void {
  mergedUniformsOf.set(mat, u);
  mat.userData.wocHeadTint = 'merged';
  // a define, so three keys the variant and prefixes it (Material.clone drops defines:
  // an effect clone gets it back here, through reapplyWocHeadTintToClone)
  if (u.oneSided) mat.defines = { ...mat.defines, WOC_HM_ONE_SIDED: '' };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uWocHmTint = u.tints;
    shader.uniforms.uWocHmMix = u.mix;
    shader.uniforms.uWocHmRef = u.ref;
    shader.uniforms.uWocHmCol = u.col;
    shader.uniforms.uWocHmEmi = u.emi;
    shader.uniforms.uWocHmSurf = u.surf;
    shader.uniforms.uWocHmEyeHsv = u.eye;
    shader.uniforms.uWocHmHair = u.hair;
    shader.uniforms.uWocHmBeard = u.beard;
    shader.uniforms.uWocHmScalp = u.scalp;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${MERGED_VERTEX_DECL}void main() {`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWocHmSlot = ${WOC_HEAD_MERGE_SLOT_ATTRIBUTE};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${MERGED_FRAGMENT_DECL}${HELPER_FUNCTIONS}void main() {`)
      .replace(
        '#include <map_fragment>',
        `${MERGED_MAP_GLSL}\n${switchedOff('USE_MAP', '#include <map_fragment>')}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `${MERGED_EMISSIVE_GLSL}\n${switchedOff('USE_EMISSIVEMAP', '#include <emissivemap_fragment>')}`,
      )
      // the slot's own roughness and metalness (a merged head carries neither map)
      .replace(
        '#include <roughnessmap_fragment>',
        fedFrom('roughness', 'wocEmi.a', '#include <roughnessmap_fragment>'),
      )
      .replace(
        '#include <metalnessmap_fragment>',
        fedFrom('metalness', 'uWocHmSurf[wocSlot].x', '#include <metalnessmap_fragment>'),
      );
  };
  mat.customProgramCacheKey = () => `woc_head_tint|merged|${prevKey}`;
}

/** One slot's surface as its own material would have drawn it. */
export interface WocHeadMergeSurface {
  readonly color: readonly [number, number, number];
  readonly emissive: readonly [number, number, number];
  readonly roughness: number;
  readonly metalness: number;
}

/**
 * Write a merged material's slot rows: each slot's reference and role, and its surface
 * RELATIVE to the merged material's own (`base`), so the material's colour and emissive
 * uniforms keep working for everything that writes them later (a form tint, a buff
 * glow) while every slot still draws its own colour underneath. Exact for a textured
 * slot, whose colour and emissive ARE the material's own (a ratio of one, a delta of
 * zero); a flat coloured slot (the eyeliner) follows a later colour effect in
 * proportion to its own colour instead of taking the effect's colour outright.
 */
export function setWocHeadMergedSlots(
  u: WocHeadMergedTintUniforms,
  slots: readonly WocHeadMergeSlot[],
  surfaces: readonly WocHeadMergeSurface[],
  base: Pick<WocHeadMergeSurface, 'color' | 'emissive'>,
): void {
  for (let i = 0; i < N; i++) {
    const slot = slots[i];
    const surface = surfaces[i];
    if (!slot || !surface) {
      u.ref.value[i].set(0, 0, 0, 0);
      u.col.value[i].set(1, 1, 1, 0);
      u.emi.value[i].set(0, 0, 0, 1);
      u.surf.value[i].set(0, 0, 0, 0);
      continue;
    }
    u.ref.value[i].set(slot.ref[0], slot.ref[1], slot.ref[2], slot.roleCode);
    u.col.value[i].set(
      surface.color[0] / Math.max(base.color[0], 1e-6),
      surface.color[1] / Math.max(base.color[1], 1e-6),
      surface.color[2] / Math.max(base.color[2], 1e-6),
      slot.layer,
    );
    u.emi.value[i].set(
      surface.emissive[0] - base.emissive[0],
      surface.emissive[1] - base.emissive[1],
      surface.emissive[2] - base.emissive[2],
      surface.roughness,
    );
    // (an untinted slot's reference is black: hue and saturation 0, read by no branch)
    const [hue, saturation] = wocTintSrgbHsv(slot.ref);
    u.surf.value[i].set(surface.metalness, slot.oneSided ? 1 : 0, hue, saturation);
  }
}

/** Point a merged material at a look's colours (linear RGB per role). A head piece is
 *  always tinted at full strength (woc_skin_tint_core.ts wocTintStrength). */
export function setWocHeadMergedColors(
  u: WocHeadMergedTintUniforms,
  colors: Readonly<Record<WocHeadTintedRole, WocLinearRgb>>,
): void {
  WOC_HEAD_MERGE_ROLES.forEach((role, i) => {
    const c = colors[role];
    u.tints.value[i].set(c[0], c[1], c[2]);
  });
  const [hue, saturation, value] = wocTintSrgbHsv(colors.eye);
  u.eye.value.set(hue, saturation, value);
  u.mix.value = 1;
}
