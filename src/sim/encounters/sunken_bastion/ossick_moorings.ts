// The Drowning Yard's four Mooring Posts in Gaoler Ossick's fight (ossick.ts):
// a player hooked by the Drowned Anchor who comes within reach of a LIT post
// moors the chain to it: the haul stops, they are freed, and that post's lamp
// dies for 30 s (re-lighting over its last 5) while the others burn on.
// Breaking the chain by hits frees them as before; the group picks.
//
// The lamp's state rides each post's encounter object template id (lit, dark,
// kindling: MOORING_TEMPLATES in ids.ts), so every client mirrors it with the
// entity and draws the lamp, the safe ring and the re-ignite from it alone; the
// countdown itself lives on the fight (OssickFightState.postDark). The moment a
// post takes a chain is one spellfx (OSSICK_MOORED, from the post to the freed
// player) for the renderer's beat. Zero rng: the posts are walked in their
// fixed order and the nearest lit one in reach wins, ties to the lower index.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type OssickFightState } from '../../types';
import { claimObjectAt, localOf } from './claim';
import {
  MOORING_POST_SPOTS,
  MOORING_TEMPLATES,
  type MooringState,
  mooringPostInReach,
  mooringStateFor,
  mooringStateOf,
  OSSICK_MOORED,
  OSSICK_TUNING,
} from './ids';

/** Scratch: which posts burn this tick (no allocation on the 20 Hz path). */
const LIT: boolean[] = MOORING_POST_SPOTS.map(() => true);

/** Every post lit: the dark countdowns of a fresh fight. */
export function freshPostDark(): number[] {
  return MOORING_POST_SPOTS.map(() => 0);
}

/** The claim's encounter object for post `i`, or null. */
function postObject(ctx: SimContext, inst: InstanceSlot, i: number): Entity | null {
  const spot = MOORING_POST_SPOTS[i];
  const e = claimObjectAt(ctx, inst, spot.x, spot.z);
  return e && mooringStateOf(e.templateId) !== null ? e : null;
}

/** Show post `i` in `state` (written only on a change). */
function showPost(ctx: SimContext, inst: InstanceSlot, i: number, state: MooringState): void {
  const e = postObject(ctx, inst, i);
  if (e && e.templateId !== MOORING_TEMPLATES[state]) e.templateId = MOORING_TEMPLATES[state];
}

/** One tick of the dark posts: the countdown, the kindling, the relight. */
export function stepMooringPosts(ctx: SimContext, inst: InstanceSlot, st: OssickFightState): void {
  for (let i = 0; i < st.postDark.length; i++) {
    if (st.postDark[i] <= 0) continue;
    st.postDark[i] = Math.max(0, st.postDark[i] - DT);
    showPost(ctx, inst, i, mooringStateFor(st.postDark[i]));
  }
}

/** A hooked player within reach of a lit post: the post takes the chain and
 *  its lamp dies. Returns the post's index, or -1 when none is in reach. */
export function tryMoor(
  ctx: SimContext,
  inst: InstanceSlot,
  st: OssickFightState,
  p: Entity,
  hookX: number,
  hookZ: number,
): number {
  const at = localOf(ctx, inst, p);
  for (let k = 0; k < st.postDark.length; k++) LIT[k] = st.postDark[k] <= 0;
  const i = mooringPostInReach(at.x, at.z, LIT, hookX, hookZ);
  if (i < 0) return -1;
  const post = postObject(ctx, inst, i);
  if (!post) return -1;
  st.postDark[i] = OSSICK_TUNING.postDarkSeconds;
  post.templateId = MOORING_TEMPLATES.dark;
  ctx.emit({
    type: 'spellfx',
    sourceId: post.id,
    targetId: p.id,
    school: 'physical',
    fx: 'beam',
    ability: OSSICK_MOORED,
  });
  return i;
}

/** The fight ended (a wipe, an evade, his death): every lamp burns again. */
export function relightMooringPosts(
  ctx: SimContext,
  inst: InstanceSlot,
  st: OssickFightState | null,
): void {
  for (let i = 0; i < MOORING_POST_SPOTS.length; i++) showPost(ctx, inst, i, 'lit');
  if (st) st.postDark = freshPostDark();
}
