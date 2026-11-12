// Leaf: one pull's watch on its encounter feat (content/smith_heart_rewards.ts), carried on
// the fight state as `feat` so it is born with the pull and dies with a wipe's reset. Pure:
// imports nothing; the encounter modules mark it, feats.ts reads it at the fall.

/** One pull's feat watch. `broken` once the feat's rule was broken this pull; `count` the
 *  times its proving mechanic happened (the council's shattering Rushes); `alive` the players
 *  seen alive in the fight (watchFeatDeaths: only a death of one of them breaks it). */
export interface SmithHeartFeatAttempt {
  broken: boolean;
  count: number;
  alive?: number[];
}

/** Seconds the Hammer Council's two members may fall apart and still earn its feat. */
export const COUNCIL_FEAT_FALL_WINDOW = 15;

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

/** A raider's death breaks the feat: every player seen alive in the fight is remembered, and
 *  one of them seen dead afterwards breaks it (a body already dead when first seen, a ghost
 *  walking back, is no death of this fight). One remembered but gone from `players` (a death
 *  late in the tick, then a release that carried the ghost out of the room) is looked up by
 *  `entityOf`: dead, it breaks the feat; alive elsewhere or logged out, it is forgotten.
 *  Draws no rng; `players` in any order. */
export function watchFeatDeaths(
  st: { feat?: SmithHeartFeatAttempt; finished: boolean },
  players: readonly { id: number; dead: boolean }[],
  entityOf: (id: number) => { dead: boolean } | undefined = () => undefined,
): void {
  if (st.finished) return;
  const feat = featAttempt(st);
  if (!feat.alive) feat.alive = [];
  const alive = feat.alive;
  for (let i = alive.length - 1; i >= 0; i--) {
    const id = alive[i];
    let here = false;
    for (const p of players) if (p.id === id) here = true;
    if (here) continue;
    alive.splice(i, 1);
    if (entityOf(id)?.dead) feat.broken = true;
  }
  for (const p of players) {
    const at = alive.indexOf(p.id);
    if (!p.dead) {
      if (at < 0) alive.push(p.id);
      continue;
    }
    if (at < 0) continue;
    alive.splice(at, 1);
    feat.broken = true;
  }
}
