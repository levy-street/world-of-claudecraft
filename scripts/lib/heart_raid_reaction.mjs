// A human-ish reaction model for the Smith's Heart raid bots: a bot does not
// see a new floor hazard the instant the server sends it, it notices it a
// reaction time later, and now and then it notices one late (a slip). Pure:
// no clock and no randomness of its own (the caller passes the time and the
// script's seeded roll), so a seed replays the same reactions in the same
// order. Used by scripts/lib/heart_raid_final.mjs; pinned by
// tests/heart_raid_reaction.test.ts.
//
// The defaults are a competent raider, not a perfect one: 250 to 650 ms to
// react to a fresh telegraph, and one hazard in 25 caught a further 0.9 to
// 1.8 s late, which is enough to eat a short telegraph (a 1.9 s Basalt Fist,
// a 2.2 s Sky Strike) and not enough to miss a long one (the 6 s Anvil bar).

/** The model's knobs (milliseconds and a chance). */
export const REACTION_DEFAULTS = Object.freeze({
  minMs: 250,
  maxMs: 650,
  slipChance: 0.04,
  slipMinMs: 900,
  slipMaxMs: 1800,
});

/**
 * A reaction tracker over (viewer, hazard) pairs.
 * @param {() => number} roll a seeded uniform roll in [0, 1)
 * @param {Partial<typeof REACTION_DEFAULTS>} [opts]
 */
export function createReaction(roll, opts = {}) {
  const k = { ...REACTION_DEFAULTS, ...opts };
  /** viewer -> hazard id -> the time it is noticed */
  const seen = new Map();
  let slips = 0;
  return {
    /** The knobs in use. */
    opts: k,
    /** True once `viewer` has noticed `hazardId` (first asked at `now`). A
     *  hazard without an id (a lane drawn from two points, a ring rule) is
     *  always seen. */
    noticed(viewer, hazardId, now) {
      if (hazardId === undefined || hazardId === null) return true;
      let mine = seen.get(viewer);
      if (!mine) {
        mine = new Map();
        seen.set(viewer, mine);
      }
      let at = mine.get(hazardId);
      if (at === undefined) {
        let delay = k.minMs + roll() * (k.maxMs - k.minMs);
        if (roll() < k.slipChance) {
          delay += k.slipMinMs + roll() * (k.slipMaxMs - k.slipMinMs);
          slips++;
        }
        at = now + delay;
        mine.set(hazardId, at);
      }
      return now >= at;
    },
    /** Forget hazards no longer on the floor (keeps the maps small). */
    prune(liveIds) {
      for (const mine of seen.values())
        for (const id of mine.keys()) if (!liveIds.has(id)) mine.delete(id);
    },
    /** How many reactions were rolled late so far. */
    slips() {
      return slips;
    },
  };
}
