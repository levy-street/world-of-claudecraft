// Skin colour changes ONLY skin: which meshes of a WOC body take a look's tint,
// how strongly, and which texels of the body's own atlas count as skin. The one
// rule the near rig (woc_head_dressing.ts), the far LOD (woc_far_bake.ts resolves
// its baked groups through it, woc_far_tint.ts wears it) and the wiki viewer
// (guide/viewer/woc_head.ts, through the same dressing) all read. Three-free and
// DOM-free, so a Vitest reads the same answer the shader draws.
//
// The body mesh is CLOTH with a little skin painted on it, and which of the two it
// draws depends on its atlas:
//   - its own base atlas (the `suit`): a dark suit with brown stitching, and skin
//     only where the hands and the neck base are painted. It takes the skin tone
//     through the `suit` key (WOC_SUIT_SKIN_GATE), which only that skin paint
//     passes: never the suit, its stitching or its seam highlights;
//   - a class under-armor atlas, swapped in over the same UVs while the chest slot
//     is worn (woc_parts_core.ts wocUnderArmorAtlas): cloth, leather or chainmail
//     edge to edge, with no skin anywhere. The body's tint is then OFF
//     (wocTintStrength 0), so nothing of it follows the skin tone. The priest's
//     cream cloth sits in the skin hue band; keyed like skin it went brown with a
//     dark tone.
// A hung head piece tints by its own role against its own measured reference, at
// full strength, whatever the body wears. An armor part never tints.
import type { WocHeadType } from './woc_head_catalog';
import {
  type WocHeadTintedRole,
  type WocHeadTintRef,
  type WocLinearRgb,
  wocBodySkinRef,
} from './woc_head_look_core';

/** What a WOC body's own mesh draws: its base atlas (the dark `suit` with skin
 *  painted on the hands and the neck base) or a class under-armor atlas (no skin). */
export type WocBodyAtlas = 'suit' | 'underArmor';

/** The atlas kind a body draws, from the under-armor atlas url it has swapped in
 *  (null, or nothing: the base file's own suit). */
export function wocBodyAtlasOf(underArmorUrl: string | null | undefined): WocBodyAtlas {
  return underArmorUrl ? 'underArmor' : 'suit';
}

/** Body nodes that carry the body's skin paint (the base node, and the merged mesh
 *  rig_merge.ts mints from it). */
export const WOC_SKIN_BODY_NODES: ReadonlySet<string> = new Set([
  'Character_Body',
  'Character_Body_bodymerged',
]);

/** What the tint rule reads off one model mesh. */
export interface WocTintMeshFacts {
  /** The mesh's node name. */
  readonly name: string;
  /** A hung head piece's tint role and measured reference (woc_head_packs.ts reads
   *  both off its file material's name at hang time); absent on any other mesh. */
  readonly role?: WocHeadTintedRole | null;
  readonly ref?: WocLinearRgb | null;
  /** An armor part bound to the body (never skin, whatever it is named). */
  readonly armorPart?: boolean;
}

/**
 * The tint one model mesh takes: a hung head piece's own role and reference (none
 * for a piece with a role but no measured reference), else the body's skin key on
 * the skin-bearing body nodes (never an armor part), else none. Whether a body tint
 * DRAWS is the body atlas's call: {@link wocTintStrength}.
 */
export function wocMeshTint(facts: WocTintMeshFacts, type: WocHeadType): WocHeadTintRef | null {
  if (facts.role) return facts.ref ? { role: facts.role, ref: facts.ref } : null;
  return WOC_SKIN_BODY_NODES.has(facts.name) && !facts.armorPart ? wocBodySkinRef(type) : null;
}

/**
 * How strongly a tint draws on a character whose body mesh draws `bodyAtlas`. A
 * `suit` tint is the body's own skin paint, which only its base atlas carries, so
 * under a class under-armor atlas it is 0: the layer leaves every texel exactly as
 * sampled. Every other tint (each head piece) is always full.
 */
export function wocTintStrength(
  tint: Pick<WocHeadTintRef, 'surface'>,
  bodyAtlas: WocBodyAtlas,
): number {
  return tint.surface === 'suit' && bodyAtlas !== 'suit' ? 0 : 1;
}

/**
 * The `suit` key's gate, on top of the skin band every skin tint keys (hue near the
 * reference, some saturation, not black): a texel takes the tone only when it
 * carries at least about half the reference skin's luminance AND half its red over
 * blue pigment (the lesser of the two shares, smoothstepped from `lo` to `hi`).
 * Measured on both shipped base atlases (the KTX2's own texels, each attributed to
 * the bone that draws it): the suit's brown stitching sits in the skin HUE band,
 * so the plain band tinted it all over the legs, hips and spine, but at under a
 * third of the skin's luminance; a light seam highlight (the female thigh seam)
 * does reach the luminance, at under a third of the pigment. Neither passes the
 * lesser share, and the window sits where no suit texel of either fit reaches full
 * weight while the hands' lit skin keeps all of it. What it also leaves as painted
 * is skin too dim to tell from stitching by colour (the hollow of a closed fist).
 * tests/woc_skin_tint_core.test.ts pins the measured texels of each kind;
 * re-measure when a base export's body texture changes.
 */
export const WOC_SUIT_SKIN_GATE = { lo: 0.45, hi: 0.6 } as const;

const LUMA: WocLinearRgb = [0.2126, 0.7152, 0.0722];
const luminance = (c: WocLinearRgb): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** How much of the reference skin a LINEAR texel carries: the lesser of its
 *  luminance and its red-over-blue pigment, each as a share of the reference's. */
export function wocSuitSkinShare(texel: WocLinearRgb, ref: WocLinearRgb): number {
  const lc = Math.max(luminance(texel), 1e-5);
  const lr = Math.max(luminance(ref), 1e-4);
  return Math.min(lc / lr, (texel[0] - texel[2]) / Math.max(ref[0] - ref[2], 1e-4));
}

/** The gate's weight for a LINEAR texel, 0 (suit, stitching) to 1 (skin paint): what
 *  {@link WOC_SUIT_SKIN_GATE_GLSL} multiplies the skin band's weight by. */
export function wocSuitSkinGate(texel: WocLinearRgb, ref: WocLinearRgb): number {
  const { lo, hi } = WOC_SUIT_SKIN_GATE;
  const x = Math.min(1, Math.max(0, (wocSuitSkinShare(texel, ref) - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

/** The gate as the shader runs it (woc_head_tint.ts, the `suit` skin layer): reads
 *  the texel `c` and the reference `r` (linear) with their luminances `lc` and `lr`,
 *  and scales the skin band's weight `w`. Minted from the same numbers as
 *  {@link wocSuitSkinGate}, so the two cannot drift. */
export const WOC_SUIT_SKIN_GATE_GLSL = `w *= smoothstep(${glslFloat(WOC_SUIT_SKIN_GATE.lo)}, ${glslFloat(WOC_SUIT_SKIN_GATE.hi)}, min(lc / lr, (c.r - c.b) / max(r.r - r.b, 1.0e-4)));`;
