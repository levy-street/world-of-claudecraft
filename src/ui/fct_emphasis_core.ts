// Pure emphasis model for OUTGOING floating combat text: which of the player's hits read
// as a BIG hit (where a number rises lives in fct_layout_core.ts). Host-agnostic and
// DETERMINISTIC (NO Math.random, NO clock, NO DOM; registered in UI_PURE_CORES), so a Node
// test drives it directly and the FCT painter stays a thin consumer.
//
// Why a running average and not a fixed number: a hit is only "big" relative to what the
// player usually deals. A fixed threshold would flag every level-60 hit and no level-10
// one, and a threshold against the TARGET's max HP would never fire on a boss. Measuring
// against the player's own recent hits self-normalises across level, gear, class and
// target, so a big nuke among filler casts, or a heavy strike between white swings, pops
// on every character. The idea is the effective-hit highlight of the hunting games
// (a strong hit reads in a hotter colour than a routine one), mapped onto the player's own
// output because WoC has no per-part weak points.
//
// Presentation only: nothing here feeds the sim, and a hit that is not flagged still shows
// its full number, so the graphics-fairness rule is untouched.

/** A hit at least this many times the running average reads as a big hit. */
export const FCT_BIG_HIT_RATIO = 1.8;
/**
 * Hits observed before any hit may be flagged: the first few swings of a session have no
 * meaningful average to beat, and flagging the opener of every login would be noise.
 */
export const FCT_BIG_HIT_WARMUP = 4;
/**
 * Exponential-moving-average weight of each new hit. Small enough that one huge crit does
 * not drag the baseline up and mute the next several hits, large enough that a new fight at
 * a different gear level re-baselines within a handful of swings.
 */
export const FCT_BIG_HIT_EMA_ALPHA = 0.15;

/** The per-player running baseline the big-hit test compares each outgoing hit against. */
export class FctHitScale {
  private mean = 0;
  private samples = 0;

  /**
   * Record `amount` and report whether it is a big hit against the average BEFORE it
   * (a hit is never compared with itself). A non-positive or non-finite amount is
   * ignored and never flagged, so a fully absorbed or malformed event cannot skew the
   * baseline.
   */
  observe(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const big = this.samples >= FCT_BIG_HIT_WARMUP && amount >= this.mean * FCT_BIG_HIT_RATIO;
    this.mean =
      this.samples === 0 ? amount : this.mean + FCT_BIG_HIT_EMA_ALPHA * (amount - this.mean);
    this.samples++;
    return big;
  }

  /** The current baseline (0 before the first hit); exposed for tests and tuning. */
  average(): number {
    return this.mean;
  }

  /** Forget the baseline (a painter teardown). */
  reset(): void {
    this.mean = 0;
    this.samples = 0;
  }
}

// The fan-out lane a number rises in is no longer dealt here by a fixed rotation: the
// collision-aware placement in fct_layout_core.ts picks it against what is on screen.
