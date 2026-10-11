// What a WOC head draws for a stored appearance: the pure half of the head
// builder's runtime (the three.js half is woc_head_dressing.ts). Three-free
// and DOM-free, so the creation preview, the in-world diff and a Vitest all
// read one answer.
//
// A stored ModularAppearance is untrusted (it rides the wire and a JSONB
// column an older client wrote), so it goes through normalizeAppearance
// first (modular.ts: every id and number clamped to something real), then
// its picks resolve against the worn type (resolveWocHeadLook: another type's
// id falls back to this type's default). The result is a plain value with a
// `key`, so a caller diffs looks by one string compare and only touches the
// scene graph when the answer changed.
//
// Colours come out LINEAR (the space three's fragment stage holds diffuse
// colour in after the map sample); the tint layer (woc_head_tint.ts) converts
// back to sRGB where its selectors are calibrated.
import {
  browColor,
  eyeColor,
  hairColor,
  type ModularAppearance,
  normalizeAppearance,
  skinColor,
  wocHeadLookOf,
} from './modular';
import { wocItemRecord } from './woc_armor_catalog';
import type { WocCharacterManifest } from './woc_character_manifest';
import {
  resolveWocHeadLook,
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_MORPHS,
  WOC_HEAD_TYPES,
  type WocHeadLook,
  type WocHeadTintRole,
  type WocHeadType,
  wocHeadTuckMorph,
  wocHeadTypeForGender,
} from './woc_head_catalog';
import type { WocWorn } from './woc_parts_core';

/** An RGB triple, each 0..1 (linear unless named otherwise). */
export type WocLinearRgb = readonly [number, number, number];

/** The roles the head recolours (liner_ and metal_ materials keep their authored colour). */
export type WocHeadTintedRole = Extract<WocHeadTintRole, 'skin' | 'eye' | 'hair' | 'brow'>;
export const WOC_HEAD_TINTED_ROLES: readonly WocHeadTintedRole[] = ['skin', 'eye', 'hair', 'brow'];

export interface WocHeadLookState {
  readonly type: WocHeadType;
  readonly look: WocHeadLook;
  /** Morph target name -> influence: the face controls (each inside its
   *  WOC_HEAD_MORPH_RANGE row), the bald crown (1 while the look is bald, else
   *  0) and every scalp tuck of the type (1 for the worn hairstyle, 0 for the
   *  rest). Driven BY NAME on every hung piece that carries the target, so the
   *  chin moves the head, lips, nose and worn beard together and a piece
   *  without it is simply skipped. */
  readonly morphs: Readonly<Record<string, number>>;
  /** The scalp tuck the worn hairstyle drives (null for a hairstyle with none, bald). */
  readonly tuck: string | null;
  readonly colors: Readonly<Record<WocHeadTintedRole, WocLinearRgb>>;
  /** Identity of everything above: equal keys draw the same head. */
  readonly key: string;
}

/** The sRGB transfer, decoded (three's SRGBToLinear). */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4;
}

/** A packed 0xRRGGBB sRGB colour as 0..1 sRGB channels. */
export function hexToSrgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** A packed 0xRRGGBB sRGB colour as linear RGB. */
export function hexToLinear(hex: number): WocLinearRgb {
  const [r, g, b] = hexToSrgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

const clampShape = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0;
const round = (n: number): string => n.toFixed(4);

/**
 * The head a stored appearance draws: its type (the body pick), its resolved
 * variant ids, its morph influences and its four tint colours. `app` may be a
 * normalized ModularAppearance, a raw wire record, or nothing (the type's
 * defaults). `typeOverride` pins the type a built body wears (a visual never
 * changes body type in place: the other type is another body), so a stale
 * pick of the other type resolves to this type's defaults.
 */
/** What a head look is read from: a normalized appearance, a raw wire record, or nothing. */
export type WocHeadAppearanceInput =
  | Partial<ModularAppearance>
  | Readonly<Record<string, unknown>>
  | null
  | undefined;

export function wocHeadLookFromAppearance(
  app: WocHeadAppearanceInput,
  typeOverride?: WocHeadType,
): WocHeadLookState {
  const norm = normalizeAppearance((app ?? null) as Partial<ModularAppearance> | null);
  const type = typeOverride ?? wocHeadTypeForGender(norm.gender);
  // a record with no head picks at all (null, a pre-builder look) wears the type's defaults
  const look = resolveWocHeadLook(type, app ? wocHeadLookOf(norm) : null);
  const morphs: Record<string, number> = {};
  for (const k of WOC_HEAD_MORPH_KEYS) {
    // normalizeAppearance already clamped it; the range read keeps this total
    // for a caller that hands a hand-built record straight through
    const { min, max, def } = WOC_HEAD_MORPH_RANGE[k];
    const v = (norm.headShape as Record<string, unknown> | undefined)?.[k];
    morphs[WOC_HEAD_MORPHS[k]] =
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  }
  // the base's shorter bald scalp: full weight while no hairstyle is worn (a
  // helm or hood hiding the hair raises it too: the dressing's call, it knows)
  morphs[WOC_HEAD_BALD_CROWN_MORPH] = wocHeadBaldCrownWeight(look, false);
  const tuck = look.hair === 'bald' ? null : wocHeadTuckMorph(look.hair);
  for (const v of WOC_HEAD_TYPES[type].slots.hair) {
    if (v.id === 'bald') continue;
    const name = wocHeadTuckMorph(v.id);
    morphs[name] = name === tuck ? 1 : 0;
  }
  const colors = {
    skin: hexToLinear(skinColor(norm)),
    eye: hexToLinear(eyeColor(norm)),
    hair: hexToLinear(hairColor(norm)),
    brow: hexToLinear(browColor(norm)),
  };
  // (the bald crown and the tucks follow look.hair, so the key needs no more)
  const key = [
    type,
    look.hair,
    look.beard,
    look.nose,
    look.mouth,
    look.brows,
    look.ears,
    look.eyes,
    look.piercing,
    ...WOC_HEAD_MORPH_KEYS.map((k) => round(morphs[WOC_HEAD_MORPHS[k]])),
    ...WOC_HEAD_TINTED_ROLES.flatMap((r) => colors[r].map(round)),
  ].join('|');
  return { type, look, morphs, tuck, colors, key };
}

/** The bald crown's weight (WOC_HEAD_BALD_CROWN_MORPH): full while the look is
 *  bald, and ALSO whenever a worn helm or hood hides the hair, because the fitted
 *  scalp a hairstyle wears is taller than the bald one and pokes a vertex through
 *  a close hood (the female mage's). Off otherwise. */
export function wocHeadBaldCrownWeight(look: WocHeadLook, hairHidden: boolean): number {
  return look.hair === 'bald' || hairHidden ? 1 : 0;
}

/** Face-control steps a portrait signature keeps across 0..1 (0.05 each, finer
 *  than a headshot thumbnail can show). */
export const WOC_HEAD_SIG_MORPH_STEPS = 20;
/** Levels a portrait signature keeps per sRGB channel (5 bits). */
export const WOC_HEAD_SIG_CHANNEL_LEVELS = 32;

const sigMorph = (v: unknown): string =>
  String(Math.round(clampShape(v) * WOC_HEAD_SIG_MORPH_STEPS) || 0);

const sigColor = (hex: number): string => {
  const q = (shift: number): number =>
    Math.round((((hex >> shift) & 0xff) / 255) * (WOC_HEAD_SIG_CHANNEL_LEVELS - 1));
  return ((q(16) << 10) | (q(8) << 5) | q(0)).toString(36);
};

function headSignatureOf(type: WocHeadType, look: WocHeadLook, norm: ModularAppearance): string {
  const shape = norm.headShape as Readonly<Record<string, unknown>> | undefined;
  return [
    type,
    look.hair,
    // facial hair is its own piece (a long beard reaches the collar)
    look.beard,
    look.nose,
    look.mouth,
    look.brows,
    look.ears,
    look.eyes,
    look.piercing,
    WOC_HEAD_MORPH_KEYS.map((k) => sigMorph(shape?.[k])).join(','),
    [skinColor(norm), eyeColor(norm), hairColor(norm), browColor(norm)].map(sigColor).join(','),
  ].join('.');
}

const defaultHeadSignatures = new Map<WocHeadType, string>();

/**
 * A compact, deterministic identity for the head a stored appearance draws on a
 * `type` body, for a cache that has to tell two players' heads apart (the live
 * portraits, portrait.ts). The look ids, facial hair included, resolve exactly as
 * {@link wocHeadLookFromAppearance} resolves them (another type's pick falls
 * back to this type's default), every face control (the chin width too, read
 * inside its own 0..1 range) quantizes to steps of
 * 1/{@link WOC_HEAD_SIG_MORPH_STEPS} and the four tint colours to
 * {@link WOC_HEAD_SIG_CHANNEL_LEVELS} levels a channel, so two heads that share
 * a signature are indistinguishable at portrait size and the key space stays
 * finite. The type's DEFAULT head, the one a body with no stored look wears,
 * answers '' (so does no appearance at all), which lets a caller keep the key a
 * default character had before heads existed. The body size (bodyScale) is left
 * out on purpose: a headshot frames the face off the drawn head
 * (portrait_framing.ts headshotAimForHead), the same at every body scale.
 */
export function wocHeadPortraitSignature(app: WocHeadAppearanceInput, type: WocHeadType): string {
  if (!app) return '';
  const norm = normalizeAppearance(app as Partial<ModularAppearance>);
  const sig = headSignatureOf(type, resolveWocHeadLook(type, wocHeadLookOf(norm)), norm);
  let def = defaultHeadSignatures.get(type);
  if (def === undefined) {
    def = headSignatureOf(type, resolveWocHeadLook(type, null), normalizeAppearance(null));
    defaultHeadSignatures.set(type, def);
  }
  return sig === def ? '' : sig;
}

/** What a tinted material paints besides its role's own pieces: `suit` is the BODY's
 *  own atlas, a dark suit with skin painted only on the hands and the neck base. Its
 *  skin tint keys tighter than a head piece's and is off while the body draws a class
 *  under-armor atlas instead (woc_skin_tint_core.ts owns both rules). */
export type WocTintSurface = 'suit';

/** What one tinted material's texels are measured against: its tint role and its
 *  reference, LINEAR RGB (hair and brow read only the first channel, a luminance),
 *  and for the body's own atlas its `surface`. */
export interface WocHeadTintRef {
  readonly role: WocHeadTintedRole;
  readonly ref: WocLinearRgb;
  readonly surface?: WocTintSurface;
}

const lum = (l: number): WocLinearRgb => [l, l, l];

/**
 * The measured texture statistics each tinted head material is recoloured
 * against, keyed by head type and PACK material name. LINEAR, medians over each
 * material's opaque texels, measured on the raw (pre-KTX2) export's UN-recoloured
 * source paint, the paint the pack ships (the export's report,
 * scripts/assets/woc_character/woc_head_pack.report.json `tint_table_rows`,
 * the way tmp/woc_heads/hairlum.mjs measures):
 *   hair, brow: the strands' median luminance. Every hairstyle, scalp cap and
 *     beard carries its own baked colour (Type A's swept is near-black, Type B's
 *     crown a light brown), so the tint is the chosen colour times the texel's
 *     luminance OVER this median (woc_head_tint.ts), never a plain multiply. A
 *     2026-09-29 hairstyle is two materials, the strands (hair_<id>) and its
 *     fitted scalp cap (hair_<id>_scalp, grain painted in the style's colour),
 *     each against its own median. The seven beards cut from one source share
 *     one image and so one row value; the handlebar has its own.
 *   skin: the material's own median colour, so every piece (a Type B nose paints
 *     a third lighter than its head) lands on the one chosen tone. Eyelid shells
 *     are the exception, and deliberately have NO row: their median is the lid
 *     and crease paint, not skin (Type B's is a dark red at 40% of the head's
 *     luminance), so tinting against it would drive the lid's skin-coloured
 *     texels to the transfer's cap, the bright ring round the eyes. They fall
 *     back to their head's base (wocHeadTintRef), whose median IS their skin.
 *   eye: the eyeball's median, which is mostly sclera: the iris is keyed off
 *     saturation above it, never the median itself.
 * `brow` and `eye` are the shared rows an unmeasured brow_ or eye_ material
 * falls back to (each type's measured left piece). liner_ and metal_ materials
 * keep their authored colour (no entry).
 */
export const WOC_HEAD_TINT_TABLE: Readonly<
  Record<WocHeadType, Readonly<Record<string, WocHeadTintRef>>>
> = {
  a: {
    hair_long: { role: 'hair', ref: lum(0.0406) },
    hair_mohawk: { role: 'hair', ref: lum(0.0297) },
    hair_quiff: { role: 'hair', ref: lum(0.1095) },
    hair_quiff_scalp: { role: 'hair', ref: lum(0.0796) },
    hair_shoulder: { role: 'hair', ref: lum(0.0972) },
    hair_shoulder_scalp: { role: 'hair', ref: lum(0.0735) },
    hair_swept: { role: 'hair', ref: lum(0.0184) },
    hair_topknot: { role: 'hair', ref: lum(0.1282) },
    hair_topknot_scalp: { role: 'hair', ref: lum(0.0907) },
    hair_undercut: { role: 'hair', ref: lum(0.0705) },
    hair_undercut_scalp: { role: 'hair', ref: lum(0.0489) },
    // Type B's styles worn on Type A: the same paint, so the Type B reference
    hair_braid: { role: 'hair', ref: lum(0.0376) },
    hair_ponytail: { role: 'hair', ref: lum(0.0493) },
    hair_waves: { role: 'hair', ref: lum(0.0354) },
    hair_beard_boxed: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chin: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chinstrap: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chops: { role: 'hair', ref: lum(0.0603) },
    hair_beard_goatee: { role: 'hair', ref: lum(0.0603) },
    hair_beard_handlebar: { role: 'hair', ref: lum(0.0957) },
    hair_beard_long: { role: 'hair', ref: lum(0.0603) },
    hair_beard_moustache: { role: 'hair', ref: lum(0.0603) },
    brow: { role: 'brow', ref: lum(0.023) },
    brow_L: { role: 'brow', ref: lum(0.023) },
    brow_R: { role: 'brow', ref: lum(0.023) },
    skin_head: { role: 'skin', ref: [0.2346, 0.1195, 0.0865] },
    skin_ear_L: { role: 'skin', ref: [0.227, 0.1144, 0.0865] },
    skin_ear_R: { role: 'skin', ref: [0.227, 0.1144, 0.0865] },
    skin_nose: { role: 'skin', ref: [0.2384, 0.1195, 0.0823] },
    skin_mouth: { role: 'skin', ref: [0.227, 0.1144, 0.0865] },
    eye: { role: 'eye', ref: [0.227, 0.1845, 0.1651] },
    eye_L: { role: 'eye', ref: [0.227, 0.1845, 0.1651] },
    eye_R: { role: 'eye', ref: [0.2307, 0.1878, 0.1779] },
  },
  b: {
    hair_bob: { role: 'hair', ref: lum(0.1014) },
    hair_bob_scalp: { role: 'hair', ref: lum(0.0795) },
    hair_braid: { role: 'hair', ref: lum(0.0376) },
    hair_crown: { role: 'hair', ref: lum(0.1585) },
    hair_crown_scalp: { role: 'hair', ref: lum(0.1145) },
    hair_curls: { role: 'hair', ref: lum(0.121) },
    hair_curls_scalp: { role: 'hair', ref: lum(0.0929) },
    hair_ponytail: { role: 'hair', ref: lum(0.0493) },
    hair_twins: { role: 'hair', ref: lum(0.1517) },
    hair_twins_scalp: { role: 'hair', ref: lum(0.1113) },
    hair_waves: { role: 'hair', ref: lum(0.0354) },
    // Type A's styles worn on Type B: the same paint, so the Type A reference
    hair_shoulder: { role: 'hair', ref: lum(0.0972) },
    hair_shoulder_scalp: { role: 'hair', ref: lum(0.0735) },
    hair_topknot: { role: 'hair', ref: lum(0.1282) },
    hair_topknot_scalp: { role: 'hair', ref: lum(0.0907) },
    hair_undercut: { role: 'hair', ref: lum(0.0705) },
    hair_undercut_scalp: { role: 'hair', ref: lum(0.0489) },
    hair_beard_boxed: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chin: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chinstrap: { role: 'hair', ref: lum(0.0603) },
    hair_beard_chops: { role: 'hair', ref: lum(0.0603) },
    hair_beard_goatee: { role: 'hair', ref: lum(0.0603) },
    hair_beard_handlebar: { role: 'hair', ref: lum(0.0957) },
    hair_beard_long: { role: 'hair', ref: lum(0.0603) },
    hair_beard_moustache: { role: 'hair', ref: lum(0.0603) },
    brow: { role: 'brow', ref: lum(0.0534) },
    brow_L: { role: 'brow', ref: lum(0.0534) },
    brow_R: { role: 'brow', ref: lum(0.0552) },
    skin_head: { role: 'skin', ref: [0.3419, 0.1878, 0.1301] },
    skin_ear_L: { role: 'skin', ref: [0.4452, 0.2747, 0.2016] },
    skin_ear_R: { role: 'skin', ref: [0.4342, 0.2664, 0.1981] },
    skin_nose: { role: 'skin', ref: [0.4564, 0.2664, 0.1981] },
    skin_mouth: { role: 'skin', ref: [0.4125, 0.2307, 0.1714] },
    eye: { role: 'eye', ref: [0.4179, 0.4342, 0.4179] },
    eye_L: { role: 'eye', ref: [0.4179, 0.4342, 0.4179] },
    eye_R: { role: 'eye', ref: [0.4179, 0.4342, 0.4179] },
  },
};

/**
 * The skin reference each body fit's OWN skin texels map from, LINEAR: the median
 * of the skin band of the raw base export's body texture (the PNG/JPEG the base
 * GLB's KTX2 is encoded from), where the band is every opaque texel within 20
 * degrees of hue of its head's skin_head row, saturation 0.12 to 0.86 and value
 * over 0.3: the peach islands of the arms and hands, never the suit around them.
 * Its own median, not the head's: the skin transfer lands a material's median
 * texel exactly on the chosen tone, so a body mapped through the head's median
 * drew its hands lighter than its face whenever the two paints differed (Type
 * A's body skin is 40% brighter than its head's), and a head repaint moved the
 * body with it. Re-measure it when the base export's body texture changes.
 * Its surface is the `suit`: only that atlas's skin paint takes the tone, and
 * nothing of the body does under a class under-armor atlas (woc_skin_tint_core.ts).
 */
export const WOC_BODY_SKIN_REF: Readonly<Record<WocHeadType, WocHeadTintRef>> = {
  a: { role: 'skin', surface: 'suit', ref: [0.3185, 0.1714, 0.0999] },
  b: { role: 'skin', surface: 'suit', ref: [0.4342, 0.2051, 0.1356] },
};

/**
 * The tint a head pack material takes, or null for an untinted one (liner_,
 * metal_, an unknown prefix). An exact name wins; otherwise the role's shared
 * row: brow_L/R -> brow, eye_L/R -> eye, an eyelid shell or any other skin_
 * piece -> the head's base, an unmeasured hairstyle or beard -> the type's
 * median hair reference (wocHeadHairFallbackRef), so a new export still
 * recolours (re-measure it for an exact match).
 */
export function wocHeadTintRef(type: WocHeadType, materialName: string): WocHeadTintRef | null {
  const table = WOC_HEAD_TINT_TABLE[type];
  const exact = table[materialName];
  if (exact) return exact;
  const lower = materialName.toLowerCase();
  if (lower.startsWith('brow_')) return table.brow;
  if (lower.startsWith('eye_')) return table.eye;
  if (lower.startsWith('skin_')) return table.skin_head;
  if (lower.startsWith('hair_')) return wocHeadHairFallbackRef(type);
  return null;
}

const hairFallbacks = new Map<WocHeadType, WocHeadTintRef | null>();

/**
 * What an UNMEASURED hair_ material (a hairstyle or beard exported after the
 * table was last measured) is tinted against: the median of its type's
 * measured hair references. The baked hair textures run from near-black to
 * mid-brown, a tenfold spread of median luminance, so any ONE style can sit at
 * either end, and the tint (the chosen colour times the texel's luminance over
 * the reference, clamped at 3x) would render a style measured against the
 * wrong end three times too bright or a third as dark. The median is the
 * least-wrong single guess, never zero, so nothing tints black. Null only for
 * a type with no measured hair at all (the material then keeps its baked
 * colour rather than taking a guess).
 */
export function wocHeadHairFallbackRef(type: WocHeadType): WocHeadTintRef | null {
  if (hairFallbacks.has(type)) return hairFallbacks.get(type) ?? null;
  const lums = Object.values(WOC_HEAD_TINT_TABLE[type])
    .filter((r) => r.role === 'hair' && r.ref[0] > 0)
    .map((r) => r.ref[0])
    .sort((x, y) => x - y);
  const out: WocHeadTintRef | null =
    lums.length > 0 ? { role: 'hair', ref: lum(lums[Math.floor((lums.length - 1) / 2)]) } : null;
  hairFallbacks.set(type, out);
  return out;
}

/** The skin reference the BODY's own atlas maps its skin paint from
 *  (WOC_BODY_SKIN_REF): its own measured skin, so the hands and the neck base land
 *  on the same chosen tone as the face. */
export function wocBodySkinRef(type: WocHeadType): WocHeadTintRef {
  return WOC_BODY_SKIN_REF[type];
}

/** Whether a worn set hides the hair (a helm or hood whose manifest item hides the
 *  `hair` appearance slot): the rule the modular head's hairstyle follows, the same
 *  one a part cut into a base follows (woc_parts_core.ts wocVisibleParts). */
export function wocWornHidesHair(manifest: WocCharacterManifest, worn: WocWorn): boolean {
  for (const [slot, id] of Object.entries(worn)) {
    if (id === null || id === undefined) continue;
    const item = wocItemRecord(manifest, id);
    if (item && item.slot === slot && (item.hidesAppearance ?? []).includes('hair')) return true;
  }
  return false;
}
