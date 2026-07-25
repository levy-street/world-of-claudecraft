// The Claudium launcher's balance: the number the HUD holds, the throttled read
// that keeps it fresh, and the changed-only edge that converges whatever surface
// displays it. Extracted from the Hud coordinator (issues #2411, #2414).
//
// Host-agnostic on purpose: it owns no DOM, no hooks and no clock of its own. The
// read, the wall clock and the converge callback all ride in as deps, so the
// throttle arithmetic, the in-flight and stale-response guards, and above all the
// changed-only converge are executed by unit tests instead of being pattern-matched
// as source text inside the Hud coordinator.
//
// Why the converge lives HERE rather than at each call site: four separate paths
// write a balance (the launcher's own read, the WOC Store snapshot, a store spend,
// and the Claudium window's snapshot) and only one of them ever repainted. That
// asymmetry is both bugs at once. Routing every write through set() gives the
// display exactly one convergence seam (#2414), and comparing before the overwrite
// gives it the elision key the sibling purse latch in BagsWindow already had
// (#2411): a read that lands on the value already on screen costs nothing.

/** Floor between two unforced balance reads. Interactions bypass it via force. */
export const CLAUDIUM_BALANCE_THROTTLE_MS = 30_000;

export interface ClaudiumLauncherBalanceDeps {
  /** Whether the economy hooks are attached at all (online, and the service up).
   *  Checked BEFORE read(), so a disabled launcher never starts a request. */
  enabled: () => boolean;
  /** The authoritative read. Called only once every gate below has passed, so it
   *  is never invoked speculatively. */
  read: () => Promise<number | null>;
  /** Converge every surface that displays the balance. Called ONLY when the value
   *  actually moved, and always AFTER the new value is readable, so the repaint it
   *  triggers renders the fresh number. */
  onChanged: () => void;
  /** Wall clock, injected rather than read here: the module stays deterministic
   *  given its deps (the src/ui pure-core rule the architecture guard enforces), and
   *  the throttle is driven by a test-owned clock instead of fake timers over a
   *  captured Date.now. */
  now: () => number;
}

export class ClaudiumLauncherBalance {
  /** The balance as last written. null means unknown, which the launcher renders
   *  as '--' (the same glyph the Claudium window uses for an unknown amount). */
  private value: number | null = null;
  /** A read is in flight. Doubles as the re-entry guard: the converge callback
   *  repaints a surface that reads the launcher label, and reading the label calls
   *  refresh() again, so a resolve must not be able to start a second read. */
  private pending = false;
  /** When the value was last written, by a read OR by a store/window write. Both
   *  defer the next unforced read: a balance that just arrived is fresh whatever
   *  delivered it. */
  private lastWriteAt = 0;
  /** Monotonic read id. A response whose id is no longer current lost a race (a
   *  forced read overtook it, or reset() invalidated it) and is dropped. */
  private seq = 0;
  /** Monotonic write count, the second half of that drop rule. A read that was
   *  already in the air when a store spend or a window snapshot wrote a balance is
   *  answering an older question, so its response must not overwrite (and visibly
   *  revert) the fresher number. Counted rather than folded into seq: seq gates the
   *  in-flight release in finally, and bumping that from a write would leave pending
   *  latched true for good. */
  private writes = 0;

  constructor(private readonly deps: ClaudiumLauncherBalanceDeps) {}

  /** The current balance, or null when it is unknown. */
  get balance(): number | null {
    return this.value;
  }

  /**
   * Record a balance from any source and converge the display when it MOVED.
   *
   * The changed compare is the whole point (#2411): a poll that returns the number
   * already on screen must not rewrite it. The bag money footer is a cold window,
   * not a per-frame painter, but the rewrite is not free either: it replaces the
   * row's innerHTML and re-binds both launchers, which drops focus off whichever
   * one had it, so a byte-identical repaint is pure cost.
   */
  set(next: number | null): void {
    this.writes++;
    const changed = next !== this.value;
    this.value = next;
    // Stamp BEFORE the callback, never after. onChanged repaints a surface that
    // re-enters refresh() (painting the footer reads the launcher label), and on
    // the write paths that are not a read resolve (a store snapshot, a store
    // spend, the Claudium window) there is no in-flight flag to stop that nested
    // read. The fresh stamp is what makes it a no-op, so the ordering here is
    // load-bearing rather than cosmetic.
    this.lastWriteAt = this.deps.now();
    if (changed) this.deps.onChanged();
  }

  /**
   * Back to unknown, with any in-flight read invalidated: a fresh set of economy
   * hooks (a new session or character) must not be told the previous one's number
   * by a response still in the air. Deliberately does NOT converge: the caller
   * follows it with a forced read, and the surfaces this feeds are rebuilt on the
   * way in anyway.
   */
  reset(): void {
    this.value = null;
    this.lastWriteAt = 0;
    this.seq++;
    this.pending = false;
  }

  /**
   * Start a balance read, unless one is already in flight or the last write is
   * still inside the throttle window. `force` bypasses only the throttle: a read
   * in flight is always left to finish, since its resolve is as fresh as a
   * duplicate would be.
   */
  refresh(force = false): void {
    if (!this.deps.enabled() || this.pending) return;
    if (!force && this.deps.now() - this.lastWriteAt < CLAUDIUM_BALANCE_THROTTLE_MS) return;
    this.pending = true;
    const seq = ++this.seq;
    const writes = this.writes;
    void this.deps
      .read()
      .then(
        (balance) => {
          if (this.overtaken(seq, writes)) return;
          this.set(balance);
        },
        // The rejection arm is the SECOND argument of .then rather than a chained
        // .catch, so an exception thrown by the converge callback above cannot land
        // here and be reported as an unknown balance: a broken repaint is a
        // programming error and must surface as one, not be laundered into '--'.
        //
        // What actually produces an unknown balance in the shipping client is the
        // arm ABOVE, not this one: the economy SDK resolves its own fallback
        // (available: false, balance: null) on a missing token, a non-2xx or a
        // thrown fetch, so a failed read arrives as a resolved null. This arm is
        // for a hooks implementation that really does reject.
        () => {
          if (this.overtaken(seq, writes)) return;
          this.set(null);
        },
      )
      .finally(() => {
        // Cleared here and only here. Clearing it inside the resolve arm (before
        // the converge callback) would re-open the self-feeding read this guard
        // exists to stop, with every behavior test still green. Gated on seq alone:
        // a read overtaken by a WRITE still has to release the flag it took.
        if (seq === this.seq) this.pending = false;
      });
  }

  /** Whether a settling read has been overtaken and must be dropped: by reset() or
   *  a newer read (seq), or by a direct write that landed while it was in the air
   *  (writes). Either way its answer is older than what the display already shows. */
  private overtaken(seq: number, writes: number): boolean {
    return seq !== this.seq || writes !== this.writes;
  }
}
