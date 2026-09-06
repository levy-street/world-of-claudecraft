// The in-flight command-outcome tracker `cmdWithOutcome` uses (loot, pickup,
// harvest_node, enter_dungeon, leave_dungeon, delve_interact, resurrect_healer):
// a small per-request rid -> {resolve, timeout} map, extracted off ClientWorld
// (src/net/online.ts) so the class stays under its monolith ceiling. A MOVE,
// not a rewrite: the 5s timeout, the close-resolves-false contract, the
// unknown-rid-is-a-silent-no-op behavior, and the safe MAX_SAFE_INTEGER
// rollover are all unchanged; no generic retry/framework semantics were added.
// PRESERVED FAILURE CONTRACT: `register`'s `send` callback runs INSIDE the
// returned Promise's executor (exactly where the pre-extraction inline
// `rawCmd` call used to run), so a synchronous throw from it (a `ws.send`/
// `JSON.stringify` failure) is caught by the Promise machinery itself and
// REJECTS the returned promise with that exact error, never a silent `false`
// and never a throw out of the caller. On that path the pending entry and its
// timeout are cleared here (never left to fire later against a rid nothing
// is waiting on).
//
// LAZY HOLDER, the bareClient idiom (tests/CLAUDE.md): a bare ClientWorld
// fixture is built via `Object.create(ClientWorld.prototype)`, which skips
// every class field initializer, so a tracker instantiated at class-field
// time would be undefined on such a fixture. ClientWorld therefore creates
// its `CommandOutcomeTracker` lazily, on first use, exactly as the prior
// inline code lazily created the bare `pendingCommandOutcomes` Map.

const COMMAND_OUTCOME_TIMEOUT_MS = 5000;

interface PendingOutcome {
  resolve: (succeeded: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CommandOutcomeTracker {
  private nextId = 1;
  private readonly pending = new Map<number, PendingOutcome>();

  /**
   * Allocates the next request id (wrapping before `Number.MAX_SAFE_INTEGER`
   * rather than overflowing), registers a pending resolver that times out to
   * `false` after 5s unless `resolve`/`failAll` settles it first, then calls
   * `send(rid)` to actually transmit the request. `send` runs INSIDE this
   * executor on purpose: a synchronous throw from it rejects the returned
   * promise (after this tracker forgets the rid and clears its timeout)
   * instead of escaping to the caller or being swallowed into `false`.
   */
  register(send: (rid: number) => void): Promise<boolean> {
    const rid = this.nextId;
    this.nextId = rid >= Number.MAX_SAFE_INTEGER ? 1 : rid + 1;
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(rid);
        if (!pending) return;
        this.pending.delete(rid);
        pending.resolve(false);
      }, COMMAND_OUTCOME_TIMEOUT_MS);
      this.pending.set(rid, { resolve, timeout });
      try {
        send(rid);
      } catch (err) {
        this.pending.delete(rid);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /** Settles a pending outcome by rid. An unknown rid (already timed out,
   *  already failed, or never registered) is a silent no-op. */
  resolve(rid: number, succeeded: boolean): void {
    const pending = this.pending.get(rid);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(rid);
    pending.resolve(succeeded);
  }

  /** Resolves every still-pending outcome to `false` (the socket closed, or a
   *  reconnect began, so no server answer will ever arrive for them) and
   *  clears the map. */
  failAll(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.pending.clear();
  }
}
