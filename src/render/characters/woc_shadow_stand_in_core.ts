// The head of a WOC key's shadow stand-in (woc_shadow_stand_in.ts): a WOC base file ends at
// the neck (its head is a streamed pack, woc_head_packs.ts), so the key's own silhouette
// has no head to cast, and a headless shadow is about a seventh short. The stand-in is the
// bare body with an ELLIPSOID where the head sits, sized from the two heights the body is
// already normalized by: the top of its neck and the crown of its canonical anatomy
// (woc_armor_core.ts WOC_ANATOMY_TOP).
//
// The proportions are the shipped bald heads' (both head types, measured against that same
// span) and tests/woc_shadow_stand_in_assets.test.ts holds them to the shipped files, so a
// re-sculpted head that outgrows its stand-in fails there. It is a shadow, read through a
// blurred shadow map from the articulated shadow range outwards. On paper (2026-10-05, the
// 2560 map over its 210 unit box, about 12 texels a yard, never measured on a screen): the
// ellipsoid is within half a texel of the head it stands for, where no head at all leaves
// the shadow about nine texels short.
//
// Pure: no three, no DOM (RENDER_PURE_CORES, tests/architecture.test.ts).

/** The stand-in head's proportions, as shares of the neck-to-crown span: how far it
 *  reaches down into the neck and up to the crown (its full height), its width, its depth,
 *  and how far forward of the head bone its centre sits. */
export const WOC_STAND_IN_HEAD = {
  height: 1.2,
  width: 0.6,
  depth: 0.8,
  forward: 0.18,
} as const;

/** An axis-aligned ellipsoid, in the base file's units at the rest pose. */
export interface WocStandInHead {
  readonly center: readonly [number, number, number];
  readonly radii: readonly [number, number, number];
}

/**
 * The stand-in head of a body whose neck tops out at `neckTop` and whose canonical crown
 * is `crown` (both heights at rest), on a head bone at `bone`: it ends exactly at the
 * crown, reaches a little into the neck so the two shadows join, and sits a little forward
 * of the bone, as a face does. Null when the crown is not above the neck (a rig with no
 * head to stand in for).
 */
export function wocStandInHead(
  neckTop: number,
  crown: number,
  bone: readonly [number, number, number],
): WocStandInHead | null {
  const span = crown - neckTop;
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const ry = (span * WOC_STAND_IN_HEAD.height) / 2;
  return {
    center: [bone[0], crown - ry, bone[2] + span * WOC_STAND_IN_HEAD.forward],
    radii: [(span * WOC_STAND_IN_HEAD.width) / 2, ry, (span * WOC_STAND_IN_HEAD.depth) / 2],
  };
}
