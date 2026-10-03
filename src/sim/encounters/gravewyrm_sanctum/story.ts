// The Calving Face's story (docs/design/dungeon-rework/gravewyrm_sanctum.md
// section 3): the ice round the Wyrm cracks as the run advances, driven by the
// encounter state the sim already has (deaths and pulls), never by a timer.
//
// The face itself is render only. What the sim owns is the crack STEP of each
// claim, carried in the template id of the run's story markers (inert encounter
// objects spread along the route, content/gravewyrm_sanctum_layout.ts
// STORY_MARKERS), so every client mirrors it with no wire change and a player
// who joins mid-run, or reconnects, reads the same face as everyone else.
//
//   0  arrival                 4 to 5  more of the four chains broken
//   1  the Sledge Tusker dead  6       Korgath dead (his death fills the chains)
//   2  the first chain broken  7       Velkhar dead
//   3  the second              8       Korzul pulled: he tears free
//
// The step only ever rises for the life of the claim (a wipe never re-freezes
// the face); a freed claim drops its markers with every other object. The
// chain count (steps 2 to 5) is Korgath's: every chain the group breaks in his
// pull (korgath.ts korgathChainsBroken) cracks the face one step more. Zero rng.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { claimBoss } from './claim';
import {
  KORGATH_ID,
  KORZUL_ID,
  SLEDGE_TUSKER_ID,
  sanctumStoryStepOf,
  sanctumStoryTemplate,
  VELKHAR_ID,
} from './ids';
import { korgathChainsBroken } from './korgath';

/** The crack step the claim's encounter state has earned right now (before the
 *  latch): the deepest beat reached. `chainsBroken` is phase B's count. */
export function earnedStoryStep(ctx: SimContext, inst: InstanceSlot, chainsBroken = 0): number {
  const korzul = claimBoss(ctx, inst, KORZUL_ID);
  if (korzul && (korzul.dead || korzul.inCombat)) return 8;
  if (claimBoss(ctx, inst, VELKHAR_ID)?.dead) return 7;
  if (claimBoss(ctx, inst, KORGATH_ID)?.dead) return 6;
  if (chainsBroken > 0) return 1 + Math.min(4, chainsBroken);
  if (claimBoss(ctx, inst, SLEDGE_TUSKER_ID)?.dead) return 1;
  return 0;
}

/** The claim's story markers, in roster order. */
export function storyMarkers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (e && sanctumStoryStepOf(e.templateId) !== null) out.push(e);
  }
  return out;
}

/** The claim's current crack step (the highest any marker carries). */
export function storyStep(ctx: SimContext, inst: InstanceSlot): number {
  let step = 0;
  for (const m of storyMarkers(ctx, inst))
    step = Math.max(step, sanctumStoryStepOf(m.templateId) ?? 0);
  return step;
}

/** Raise every marker of the claim to `step` (never lower). Returns the step
 *  the markers now carry. */
export function raiseStory(ctx: SimContext, inst: InstanceSlot, step: number): number {
  const markers = storyMarkers(ctx, inst);
  let now = step;
  for (const m of markers) now = Math.max(now, sanctumStoryStepOf(m.templateId) ?? 0);
  const template = sanctumStoryTemplate(now);
  for (const m of markers) if (m.templateId !== template) m.templateId = template;
  return now;
}

/** One tick of the claim's story: latch the step the run has earned. */
export function tickStory(ctx: SimContext, inst: InstanceSlot): void {
  const earned = earnedStoryStep(ctx, inst, korgathChainsBroken(ctx, inst));
  if (earned > 0 && earned > storyStep(ctx, inst)) raiseStory(ctx, inst, earned);
}
