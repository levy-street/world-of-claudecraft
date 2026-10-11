// How many derived WOC builds each cache keeps with NOBODY drawing them (PR 4360 review,
// N20). A far bake, a merged head and a merged kit are each built once per look and leased
// to the bodies that draw it; when the last one lets go the build is kept, idle, for a look
// that comes back, up to a cap, and the oldest idle one is dropped past it.
//
// The cap is a memory-for-rebuild trade, so it reads the static memory class and nothing
// else. On a roomy profile it is generous: a town crowd turns over and the same looks
// return. On a constrained one (every phone, every iOS host) the page runs near its
// ceiling and the crowd that just left is the last thing worth holding: the caps are small
// there, enough for the look that walks back into view and no more. What draws is never
// trimmed, so a cap changes memory and rebuild work only, never what a player sees.
//
// Three-free and DOM-free (RENDER_PURE_CORES, tests/architecture.test.ts).

/** Idle builds kept per cache. */
export interface WocIdleCacheCaps {
  /** far bakes (woc_far_bake.ts): a body's far mesh, its materials' geometry only */
  readonly farBakes: number;
  /** merged heads (woc_head_merge.ts): about 0.35 MB each */
  readonly mergedHeads: number;
  /** merged kits (woc_armor_merge.ts): a few hundred KB each, about 0.8 MB at most */
  readonly mergedArmor: number;
}

const ROOMY: WocIdleCacheCaps = { farBakes: 32, mergedHeads: 12, mergedArmor: 16 };
const CONSTRAINED: WocIdleCacheCaps = { farBakes: 8, mergedHeads: 4, mergedArmor: 4 };

/** The idle caps of a memory class. Reads only the static profile (GFX.constrainedMemory),
 *  never the frame-rate governor. */
export function wocIdleCacheCaps(constrainedMemory: boolean): WocIdleCacheCaps {
  return constrainedMemory ? CONSTRAINED : ROOMY;
}
