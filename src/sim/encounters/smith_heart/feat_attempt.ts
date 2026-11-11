// Leaf: one pull's watch on its encounter feat (content/smith_heart_rewards.ts), carried on
// the fight state as `feat` so it is born with the pull and dies with a wipe's reset. Pure:
// imports nothing; the encounter modules mark it, feats.ts reads it at the fall.

/** One pull's feat watch. `broken` once the feat's rule was broken this pull; `count` the
 *  times its proving mechanic happened (the council's shattering Rushes). */
export interface SmithHeartFeatAttempt {
  broken: boolean;
  count: number;
}

/** The pull's watch, created on first touch. */
export function featAttempt(st: { feat?: SmithHeartFeatAttempt }): SmithHeartFeatAttempt {
  if (!st.feat) st.feat = { broken: false, count: 0 };
  return st.feat;
}

/** The feat's rule was broken this pull (a fight already over is never touched). */
export function breakFeat(st: { feat?: SmithHeartFeatAttempt; finished: boolean }): void {
  if (st.finished) return;
  featAttempt(st).broken = true;
}

/** The feat's proving mechanic happened once more this pull. */
export function countFeat(st: { feat?: SmithHeartFeatAttempt; finished: boolean }): void {
  if (st.finished) return;
  featAttempt(st).count++;
}
