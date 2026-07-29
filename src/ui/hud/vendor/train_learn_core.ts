// Pending-learn tracking for the recipe-training window (issue #2342).
//
// A pure, host-agnostic core (the train_view.ts sibling): the HUD owns one
// instance and the train window consumes its two read surfaces through
// TrainViewDeps. It closes the two gaps between a Learn click and the row
// flipping to Known:
//  - a learn IN FLIGHT (clicked, trainResult not yet landed): the row must
//    disable immediately so a second activation never re-sends train_recipe
//    (the double-submit that surfaced train_already_known);
//  - a learn CONFIRMED (trainResult ok landed) whose grant the mirrored
//    knownRecipes set may not carry yet (online the event frame and the cprof
//    snapshot are separate ws messages): the row must read Known off the
//    confirmed overlay rather than wait for the mirror.
//
// Flights expire after TRAIN_PENDING_TTL_MS: a command lost to a disconnect
// never answers, and a row stuck disabled forever would be worse than the
// duplicate it guards against (resolveTrain's deny order makes a re-send
// charge-safe: train_already_known resolves before any charging arm). Time
// arrives as an explicit nowMs parameter so tests drive the clock directly.

export const TRAIN_PENDING_TTL_MS = 5000;

export class TrainLearnTracker {
  /** recipe id -> nowMs of the click that opened the flight. */
  private readonly pending = new Map<string, number>();
  /** trainResult-ok grants the knownRecipes mirror may not carry yet. */
  private readonly confirmed = new Set<string>();

  /** Open a flight for `recipeId`. False when one is already open (the
   *  caller swallows the activation instead of re-sending the command). */
  begin(recipeId: string, nowMs: number): boolean {
    this.expire(nowMs);
    if (this.pending.has(recipeId)) return false;
    this.pending.set(recipeId, nowMs);
    return true;
  }

  /** A trainResult landed for `recipeId`: the flight (if any) is over; an ok
   *  joins the confirmed overlay until the mirror carries the grant. Applies
   *  to results this tracker never saw begin (another submit path), so the
   *  overlay converges regardless of who sent the command. */
  resolve(recipeId: string, ok: boolean): void {
    this.pending.delete(recipeId);
    if (ok) this.confirmed.add(recipeId);
  }

  /** Recipe ids with a learn currently in flight, TTL-pruned against nowMs. */
  pendingIds(nowMs: number): ReadonlySet<string> {
    this.expire(nowMs);
    return new Set(this.pending.keys());
  }

  /** Confirmed grants the mirror does not carry yet. Entries the mirror now
   *  lists are dropped for good (knownRecipes only grows), so the overlay
   *  stays a short-lived bridge, never a second knownness store. */
  confirmedIds(mirrorKnown: readonly string[]): ReadonlySet<string> {
    for (const id of mirrorKnown) this.confirmed.delete(id);
    return new Set(this.confirmed);
  }

  private expire(nowMs: number): void {
    for (const [id, begunAt] of this.pending) {
      if (nowMs - begunAt >= TRAIN_PENDING_TTL_MS) this.pending.delete(id);
    }
  }
}
