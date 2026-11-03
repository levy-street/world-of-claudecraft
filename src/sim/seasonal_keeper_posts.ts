// Where the seasonal keeper actually stands in each city, and her stall round her:
// resolved against the LIVE world like the rest of the city dressing.
//
// Each post (content/gourdlight_eve.ts GOURDLIGHT_KEEPER_POSTS) names the spot she
// PREFERS. Her stall's whole footprint is checked there first (seasonal_decor_stall.ts:
// clear of colliders, roads, other NPCs and water, with its own small slides and turns).
// When a city rework has built over that spot, the search walks out from it in rings and
// takes the first spot where the stall fits, so the keeper moves with her stall instead
// of standing in a wall. If no spot within reach takes a stall, she stands at her
// preferred spot with no stall (the decor resolver piles gourds round her instead).
//
// The sim spawns her at the resolved spot (seasonal/seasonal_tick.ts) and the renderer
// draws the stall from the same answer, so the NPC and her counter can never drift apart.
// Pure and deterministic: no rng, no clock, no Three. Memoized per world and seed.
import {
  GOURDLIGHT_KEEPER_NPC_ID,
  GOURDLIGHT_KEEPER_POSTS,
  type GourdlightKeeperPost,
} from './content/gourdlight_eve';
import { getActiveWorldContent, NPCS } from './data';
import { resolveSeasonalStall, type SeasonalStall } from './seasonal_decor_stall';

export interface ResolvedKeeperPost {
  post: GourdlightKeeperPost;
  /** Where she stands (behind her counter when there is a stall). */
  pos: { x: number; z: number };
  facing: number;
  stall: SeasonalStall | null;
  /** True when her preferred spot did not take the stall and the ring search moved her. */
  moved: boolean;
}

/** The ring search round a preferred spot that will not take the stall (yards). */
export const KEEPER_POST_RINGS: readonly number[] = [2, 4, 6, 8, 10, 12];
const KEEPER_POST_BEARINGS = 16;

/** Every placed NPC's standing spot except the keeper's own template. */
function otherNpcSpots(): { x: number; z: number }[] {
  return Object.values(NPCS)
    .filter((n) => n.id !== GOURDLIGHT_KEEPER_NPC_ID)
    .map((n) => ({ x: n.pos.x, z: n.pos.z }));
}

export function resolveKeeperPost(
  seed: number,
  post: GourdlightKeeperPost,
  others: readonly { x: number; z: number }[] = otherNpcSpots(),
): ResolvedKeeperPost {
  const anchor = { id: post.id, pos: post.pos, facing: post.facing };
  const first = resolveSeasonalStall(seed, anchor, others);
  if (first) return { post, pos: { ...post.pos }, facing: post.facing, stall: first, moved: false };
  for (const r of KEEPER_POST_RINGS) {
    for (let k = 0; k < KEEPER_POST_BEARINGS; k++) {
      const a = (k / KEEPER_POST_BEARINGS) * Math.PI * 2;
      const pos = { x: post.pos.x + Math.sin(a) * r, z: post.pos.z + Math.cos(a) * r };
      const stall = resolveSeasonalStall(seed, { id: post.id, pos, facing: post.facing }, others);
      if (stall) return { post, pos, facing: post.facing, stall, moved: true };
    }
  }
  return { post, pos: { ...post.pos }, facing: post.facing, stall: null, moved: false };
}

const memo = new WeakMap<object, Map<number, readonly ResolvedKeeperPost[]>>();

/** Every keeper post of the event, resolved for the active world at `seed` (memoized:
 *  the colliders it reads are fixed once the world is built). */
export function resolvedKeeperPosts(seed: number): readonly ResolvedKeeperPost[] {
  const content = getActiveWorldContent();
  let bySeed = memo.get(content);
  if (!bySeed) {
    bySeed = new Map();
    memo.set(content, bySeed);
  }
  let posts = bySeed.get(seed);
  if (!posts) {
    const others = otherNpcSpots();
    posts = GOURDLIGHT_KEEPER_POSTS.map((post) => resolveKeeperPost(seed, post, others));
    bySeed.set(seed, posts);
  }
  return posts;
}
