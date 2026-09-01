// The 30 s autosave's write set, extracted whole out of
// GameServer.flushPeriodicSaves (server/game.ts, the monolith ratchet) so the
// one thing that matters about it is testable: each periodic write is issued
// EXACTLY ONCE per autosave.
//
// WHY THAT NEEDED A MODULE. The flush is a handful of unawaited calls inside
// the tick body, which is precisely the shape a merge can duplicate invisibly,
// and one really did. Stated precisely, because the first draft of this comment
// got it backwards and a wrong provenance note is worse than none: the DOUBLING
// IS THE RELEASE BRANCH'S, NOT THIS BRANCH'S. A release-side revision added a
// profiler-sample argument to the market, mail and Rift writes and kept BOTH the
// sampled and the unsampled call of each, so origin/release/v0.42.0 ships six
// calls where there should be three (server/game.ts, the flushPeriodicSaves
// body): every realm there re-serializes and re-writes the whole market blob and
// the whole shared Rift state a second time every thirty seconds. This branch
// always had one call each; what the v0.42.0 merge cost US was the opposite, the
// profiler SAMPLE, so the three writes fell out of the saves phase's budget and
// their time went unattributed.
// Nothing failed, nothing logged, and no test drove the body, which is why
// neither half was noticed. Naming each write once, in a list a Vitest reads, is
// what makes a second copy impossible to add quietly, on either side.
// OWED UPSTREAM, and not fixed here: the release branch's own doubling. This
// module only settles the merged branch.
//
// FIRE AND FORGET IS THE CONTRACT, not an oversight. This runs inside the 20 Hz
// loop body, so it must return synchronously: a save that takes longer than a
// tick has to overlap the next tick rather than stall it. Every write is
// therefore launched and never awaited, and every failure lands on `onError`
// instead of becoming an unhandled rejection inside the guarded tick.
//
// PER-WRITE ISOLATION closes the second, worse defect in the body this
// replaced. There, one SYNCHRONOUS statement sat in the middle of the flush
// (the bank-vault guard prune) with nothing around it, so a throw from it did
// not merely skip the lease heartbeat behind it: it propagated out of
// flushPeriodicSaves, and flushPeriodicSaves is called near the END of the
// guarded tick body. The guard would log and abandon the rest of that body,
// including `this.lastTickCompletedAt = Date.now()`, which is deliberately the
// last statement because /livez reads it as the liveness signal. A prune bug
// could therefore make a perfectly healthy realm report itself dead. Here every
// member is launched inside its own try, so one failure costs exactly itself.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO: make the trio ATOMIC. The
// character, market and mail halves still commit as independent transactions
// here, so an unclean crash between them can still tear a Market escrow, and
// the leave path's saveCharacterAndMarketState exists precisely because that
// tear is real. Closing it for the periodic sweep is a production behavior
// call, not a refactor: saveCharacterAndMarketState carries ONE characterId, so
// the only faithful extensions are either one whole-realm market+mail
// transaction PER online character (the exact cost hazard GameServer.socketClosed
// documents at its withMarket parameter) or a new multi-character transaction
// shape. That decision belongs to the maintainer and is recorded as a Phase 19
// row rather than guessed here.

/** The writes one autosave issues, each exactly once. */
export interface PeriodicSaveWrites {
  /** Every online character's blob (the concurrency-limited sweep). */
  saveCharacters(): Promise<void>;
  /** The realm-global World Market blob. */
  saveMarket(): Promise<void>;
  /** The dirty mail partitions. */
  saveMail(): Promise<void>;
  /** The shared Rift world state. */
  saveRifts(): Promise<void>;
  /** Heartbeat this process's character load leases so none lapses under a peer. */
  heartbeatLeases(): Promise<void>;
  /** Drop idle bank-vault ledger guard state. Synchronous, and not a write. */
  pruneIdleGuards(): void;
}

/**
 * The write set, in issue order, as data. The paired test measures its
 * exactly-once claim against THIS list, so a write added to the runner without
 * joining the list would make that measurement vacuous for the new one; adding
 * a member to `PeriodicSaveWrites` without adding its name here fails the type
 * check below at compile time.
 */
export const PERIODIC_SAVE_WRITE_NAMES = [
  'saveCharacters',
  'saveMarket',
  'saveMail',
  'saveRifts',
  'pruneIdleGuards',
  'heartbeatLeases',
] as const satisfies readonly (keyof PeriodicSaveWrites)[];

// Compile-time completeness: every member of the interface is named above.
// Wrapped in tuples on purpose. A bare `MissingFromList extends never` is a
// DISTRIBUTIVE conditional, which resolves to `never` when the union is empty,
// so the satisfied case would be the one that fails to type check and the
// guard would read backwards.
type MissingFromList = Exclude<
  keyof PeriodicSaveWrites,
  (typeof PERIODIC_SAVE_WRITE_NAMES)[number]
>;
type EveryWriteIsNamed = [MissingFromList] extends [never] ? true : MissingFromList;
const _everyWriteIsNamed: EveryWriteIsNamed = true;
void _everyWriteIsNamed;

/** How a failed periodic write is reported. Must never throw. */
export type PeriodicSaveErrorSink = (write: keyof PeriodicSaveWrites, err: unknown) => void;

const defaultOnError: PeriodicSaveErrorSink = (write, err) =>
  console.error(`periodic ${write} failed:`, err);

/**
 * Launch one autosave's writes and return immediately.
 *
 * Each write is started in list order and never awaited; a rejection, or a
 * synchronous throw from the launch itself, is routed to `onError` and does not
 * stop the remaining writes. `pruneIdleGuards` is the one synchronous member
 * and is guarded the same way, so a throw there cannot cost the lease
 * heartbeat behind it.
 */
export function runPeriodicSaveFlush(
  writes: PeriodicSaveWrites,
  onError: PeriodicSaveErrorSink = defaultOnError,
): void {
  const report = (write: keyof PeriodicSaveWrites, err: unknown): void => {
    try {
      onError(write, err);
    } catch {
      // A reporting failure must never propagate into the tick body.
    }
  };
  for (const name of PERIODIC_SAVE_WRITE_NAMES) {
    try {
      // The synchronous member returns void; the rest return a promise this
      // deliberately does not await (see the header).
      const started: void | Promise<void> = writes[name]();
      if (started !== undefined) started.catch((err: unknown) => report(name, err));
    } catch (err) {
      report(name, err);
    }
  }
}
