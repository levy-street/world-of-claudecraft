// What the open WOC Store remembers about charter FIT between paints.
//
// Two facts, kept together because they invalidate each other. The first is the
// set of grant sizes the SERVER has already refused as overshooting the ladder
// ceiling for this character. The second is the ladder count the store last
// painted against, which the slow-band poll compares to tell a real move from a
// repeat read (Bank Storage phase 15, ruling 21).
//
// They belong in one module because a refusal is only sound while the count it
// was derived from still holds, and that coupling is invisible when the two live
// as separate fields on the window. No DOM and no world access: the window feeds
// it the count it just read, which is what makes the invalidation rule testable
// on its own (tests/charter_fit_memory.test.ts).

export class CharterFitMemory {
  // Grant sizes the SERVER has refused as overshooting, for THIS character this
  // store visit. It USED to be the only fit answer available away from a banker;
  // since phase 15 the always-available ladder read covers that, and what this
  // still covers is the window before the first snapshot lands and any
  // disagreement between the client's arithmetic and the server's verdict. A
  // does_not_fit is the strongest fit fact a client can hold, and dropping it
  // would repaint the same guaranteed-to-fail card enabled forever.
  private readonly refused = new Set<number>();
  // The ladder position the store last PAINTED against. `undefined` means it has
  // not painted yet, which is distinct from a genuine null count.
  private painted: number | null | undefined;

  /** The refused grants, as the pure store core wants them. Live by design: the
   *  core only reads it, and copying per paint would allocate on the slow band. */
  get refusedGrants(): ReadonlySet<number> {
    return this.refused;
  }

  /** True when the count differs from the one last painted, which is the whole
   *  signature the slow-band poll gates on. */
  changedFrom(count: number | null): boolean {
    return count !== this.painted;
  }

  /** The server refused a grant of this size for this character. */
  noteRefused(grantSlots: number): void {
    this.refused.add(grantSlots);
  }

  /** Record the count a paint is about to run against, and return whether that
   *  move invalidated the refusals.
   *
   *  THE RULE, and it is the reason this class exists. The count is monotone
   *  non-decreasing for as long as one character stays resident on one realm
   *  process, but that is a NARROWER scope than one client session: a fresh join
   *  that reloads a durable row written before the last rung (an unclean realm
   *  restart inside the autosave window, or the escrow quarantine's deliberate
   *  resume refusal) legitimately brings a LOWER count back into the same open
   *  window. Every refusal was derived from the higher count, so carrying them
   *  across that would hide a charter that now FITS, and hiding capacity a player
   *  really has is the one direction the fit gate must not fail in. Dropping them
   *  costs at most one wasted click and lets the server answer again.
   *
   *  Only DOWN matters. A refusal recorded at count P says P + G overshoots the
   *  ceiling, so at any count at or above P it overshoots by at least as much and
   *  the verdict is still sound. That is why a count that GROWS, and a character
   *  change that lands a higher one, need no invalidation here. */
  observe(count: number | null): void {
    if (count !== null && typeof this.painted === 'number' && count < this.painted) {
      this.refused.clear();
    }
    this.painted = count;
  }

  /** Drop the refusals but NOT the painted signature. Called on close: server fit
   *  verdicts are scoped to the acting character, so bounding the belief to one
   *  store visit makes the worst case one wasted click after a reopen rather than
   *  a charter that DOES fit hidden from a character the verdict was never about. */
  forgetRefusals(): void {
    this.refused.clear();
  }
}
