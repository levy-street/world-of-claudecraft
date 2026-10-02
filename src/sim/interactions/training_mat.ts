// The Blossom Temple training mat (content/blossom_temple.ts): stepping onto
// it plays the kata on the player before the ordinary interact-object quest
// credit runs. Cosmetic only, draws NO rng.
import { BLOSSOM_TRAINING_MAT_ITEM } from '../content/blossom_temple';
import type { SimContext } from '../sim_context';
import { playEmote } from '../social/chat';

/** Plays the kata when `objectItemId` is the training mat; returns whether it was. */
export function practiceOnTrainingMat(
  ctx: SimContext,
  objectItemId: string | null | undefined,
  pid: number,
): boolean {
  if (objectItemId !== BLOSSOM_TRAINING_MAT_ITEM) return false;
  playEmote(ctx, 'kata', pid);
  return true;
}
