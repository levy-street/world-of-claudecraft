// How big the realms' great trees stand.
//
// Every great tree is a clone of the twisted elder (foliage/twisted_1): a model about
// sixteen yards tall that leans a long way off its foot, with a root flare a yard and a half
// wide. The zones used to blow it up six to nine times: a hundred-yard trunk as wide as a
// house that crossed a town square as one diagonal slab, hid the sky from every view round
// it and loomed over the next zone.
//
// At these scales it is a grand old tree instead: two to three times the height of the oaks
// round it, with its whole crown in view from the ground, and its ROOT FLARE lands on the
// trunk collider the sim builds from the same record (colliders.ts: 1.45 times r), so a
// player still stops at the roots.
//
// Pure: the four zone modules that draw the giants and the editor's world-prop conversion
// all read these, so the drawn tree and its editable placement cannot drift apart.

/** Raw model scale of a zone's great tree per yard of its record's radius: the root flare
 *  (1.5 model yards) then stands on the collider ring (1.45 times r). */
export const GREAT_TREE_SCALE_BASE = 0.9;
/** How much taller the tallest of a zone's giants stands, as a share of r. */
export const GREAT_TREE_SCALE_SPREAD = 0.1;
/** The Palmreach banyans stand a touch broader under their vine curtains. */
export const BANYAN_SCALE_BASE = 0.94;

/** The Eldershine great tree is hand-set: the one giant in a town square. */
export const REALM_GREAT_TREE_SCALE = 2.4;
export const REALM_GREAT_TREE_ROT = 0.8;

/** Raw model scale for a great tree of record radius `r`; `jitter` is the tree's own
 *  hash in [0, 1). */
export function greatTreeScale(r: number, jitter: number, base = GREAT_TREE_SCALE_BASE): number {
  return r * (base + jitter * GREAT_TREE_SCALE_SPREAD);
}
