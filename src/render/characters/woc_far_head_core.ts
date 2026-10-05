// What a WOC character's baked far mesh freezes of its modular head: the face
// morph influences (woc_head_look_core.ts WocHeadLookState.morphs), QUANTIZED,
// plus the identity key the far bake cache (woc_far_bake.ts) shares geometry by.
// Colours are never part of it: they ride tint uniforms on the far materials
// (woc_far_tint.ts), so a colour change never re-bakes anything.
//
// Why quantized. The far bake is geometry keyed by what it froze, and the face
// controls are continuous: an exact key would mint a bake per slider value.
// The largest face morph on either head moves a vertex 1.5 cm at full weight
// in the pack's own units (Type A's long beard under FS_Chin_Softness; the
// bald crown, 2 cm, is discrete), so half a WOC_FAR_MORPH_STEP of error is
// under 2 mm: well under a pixel from the far band's nearest edge (the
// crowd-pulled ~35 yd). Each side of a control's default is cut into equal
// steps no wider than that, so the default (the look most players keep) and
// both ends of the range bake exactly. The discrete morphs (the bald crown,
// every scalp tuck) are 0 or 1 by construction, on-grid, and so carried exactly.
//
// The bake's group partition lives here too: the tint key that keeps a tinted
// and an untinted mesh out of one group, the one key every folded head piece
// answers instead (the merged head is ONE group), and the per-vertex slot that
// tells the merged material which piece each of that group's vertices came from.
//
// Three-free and deterministic, so the key the visual diffs and the pose the
// bake applies are one Vitest-pinned answer.
import { WOC_HEAD_MORPH_RANGE, WOC_HEAD_MORPHS, type WocHeadMorph } from './woc_head_catalog';

/** The widest influence step a far bake keeps, a quarter of the unit range. */
export const WOC_FAR_MORPH_STEP = 0.25;

/** The far bake's frozen face: morph target name to the influence it bakes. */
export interface WocFarHeadPose {
  /** Morph target name -> quantized influence (every name the look drives). */
  readonly morphs: Readonly<Record<string, number>>;
  /** Identity of `morphs`: equal keys bake the same face. */
  readonly key: string;
}

/** Morph target name -> its face control's range row (the discrete ones have none). */
const CONTROL_RANGE: ReadonlyMap<string, { min: number; max: number; def: number }> = new Map(
  (Object.keys(WOC_HEAD_MORPHS) as WocHeadMorph[]).map((k) => [
    WOC_HEAD_MORPHS[k],
    WOC_HEAD_MORPH_RANGE[k],
  ]),
);

/** A discrete morph's row: off by default, full weight at most. */
const DISCRETE_RANGE = { min: 0, max: 1, def: 0 } as const;

/** One influence on the far grid: clamped into its range (junk reads as the
 *  default), then the nearest point of its side's grid, which cuts the span
 *  from the default to that end into the fewest equal steps no wider than
 *  WOC_FAR_MORPH_STEP. */
export function wocFarMorphInfluence(
  value: unknown,
  range: { readonly min: number; readonly max: number; readonly def: number },
): number {
  const { min, max, def } = range;
  const v =
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : def;
  const span = v >= def ? max - def : def - min;
  if (!(span > 0)) return def;
  const step = span / Math.ceil(span / WOC_FAR_MORPH_STEP - 1e-9);
  const q = def + Math.round((v - def) / step) * step;
  // six places: the grid arithmetic stays one exact string per step
  return Math.round(Math.min(max, Math.max(min, q)) * 1e6) / 1e6;
}

/**
 * The far pose of a head look's morphs (null for no look: a body whose modular
 * head is not drawn bakes the pack's own influences). Every name the look
 * drives is carried, so the pose always writes the same set of targets.
 */
export function wocFarHeadPose(
  morphs: Readonly<Record<string, number>> | null | undefined,
): WocFarHeadPose | null {
  if (!morphs) return null;
  const out: Record<string, number> = {};
  const names = Object.keys(morphs).sort();
  for (const name of names) {
    out[name] = wocFarMorphInfluence(morphs[name], CONTROL_RANGE.get(name) ?? DISCRETE_RANGE);
  }
  return { morphs: out, key: names.map((n) => `${n}=${out[n]}`).join(',') };
}

/** What one baked mesh's tint is, as far as the bake's group partition cares: its
 *  role, measured reference and surface (woc_head_look_core.ts WocHeadTintRef), or
 *  none. */
export interface WocFarTintFacts {
  readonly role: string;
  readonly ref: readonly number[];
  readonly surface?: string;
}

/**
 * The far-group partition a tint adds (woc_far_bake.ts): meshes that share a
 * material but not a tint must not share a baked group, since a group draws
 * ONE material (two parts on one material where only one of them is skin, or
 * the body's own atlas beside a head piece: its layer is another program).
 */
export function wocFarTintKey(tint: WocFarTintFacts | null): string {
  if (!tint) return '-';
  return `${tint.role}${tint.surface ? `@${tint.surface}` : ''}:${tint.ref.join(',')}`;
}

/**
 * The far-group key of the MERGED head (woc_far_bake.ts): every head piece one
 * material can draw (woc_head_merge.ts wocHeadMergeFold, the near merge's own
 * rule) answers this one key, so the whole face is ONE baked group, drawn by
 * the merged tint layer, instead of a group per piece material. It can never
 * meet a per-material key: those are `<material uuid>|<body flag>|<tint key>`.
 */
export const WOC_FAR_HEAD_GROUP_KEY = 'woc_head_merged';

/**
 * The per-vertex SLOT values of a far bake with a merged head: every vertex of
 * a folded head piece carries its slot in the merged material's tables
 * (woc_head_merge_core.ts), every other vertex 0, which only the head group's
 * material ever reads. `slotOf[i]` is source mesh i's slot (null: not a folded
 * head piece) and `vertexCounts[i]` its vertex count; `mergeOrder` is the order
 * the bake laid the sources' vertices out in (far_bake_groups_core.ts), which
 * is NOT the source order once groups coalesce.
 */
export function wocFarHeadVertexSlots(
  mergeOrder: readonly number[],
  vertexCounts: readonly number[],
  slotOf: readonly (number | null)[],
): Uint8Array {
  let total = 0;
  for (const i of mergeOrder) total += vertexCounts[i] ?? 0;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const i of mergeOrder) {
    const count = vertexCounts[i] ?? 0;
    const slot = slotOf[i];
    if (slot) out.fill(slot, offset, offset + count);
    offset += count;
  }
  return out;
}
