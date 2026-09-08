// The escrow REFUSAL arm, extracted from GameServer.saveCharacter's catch
// (move-not-rewrite from server/game.ts; the host port below is the exact set
// of GameServer seams the arm used). The book half could not be replayed onto
// durable truth, so the whole transaction rolled back and this save persisted
// NOTHING: not the books, not the character. That is the invariant the
// feature rests on, stated as a rule rather than as a residue:
//
//   If the book half cannot be applied, the character half must not commit.
//
// Carrying the shortfall and recording it was the alternative, and it is a
// two-account money printer: officer A deposits without flushing, officer B
// withdraws, B's character half commits while the book half does not, then A
// gets itself fenced (an ordinary re-login) so nothing will ever make A's
// deposit durable. B keeps the copper, A's stake comes back, repeatable on
// demand. Refusing removes it: B's purse can never durably gain what the
// book never durably lost.
//
// Two outcomes:
// - RETRY, while another session still holds unflushed work for the guild:
//   their commit is what makes this replay applicable, and it lands within
//   an autosave interval. Nothing is consumed; the marks and the log are
//   exactly as they were.
// - ROLL BACK, when no other session holds unflushed work (so nothing will
//   ever make the missing value durable) or the retries ran out. This
//   session's live state is abandoned: its own book ops come back off the
//   live book, it is QUARANTINED so it can never persist again, one
//   aggregate anomaly row records the incident, and it is disconnected to
//   reload from its durable row. Everything it did since its last successful
//   save is lost, which is exactly what a lease fence-out already does, and
//   it conserves precisely because none of it was ever durable.
//
// Since the unsettled gate (server/guild_bank_settle_gate.ts) a session's
// log can no longer carry a consume of another session's not-yet-durable
// work, so an ordinary two-officer session never reaches this arm at all: it
// is the BACKSTOP for a row that became unusable, a tampered book, or a
// dependency the gate could not see. The retry bound below still matters
// because a mutual dependency, once it exists, can never resolve.

import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import { recordGuildBankEscrowRollback } from './bank_ledger';
import { deficitDependency, type GuildBookDependency } from './guild_bank_settle_gate';
import type { GuildBankWriteResult } from './guild_bank_state';
import type { GuildBankIncident } from './http/game_signals';

/** The slice of a live session the refusal arm reads and writes
 *  (structural, so GameServer's ClientSession satisfies it). */
export interface EscrowRefusalSession {
  readonly characterId: number;
  readonly accountId: number;
  escrowQuarantined: boolean;
  readonly left: boolean;
  readonly dirtyGuildBanks: Map<number, number>;
  readonly unflushedGuildBankOps: Map<number, GuildBankOpDelta[]>;
  readonly guildBankDeficitSkips: Map<number, number>;
}

export interface EscrowRefusalHostPort<S extends EscrowRefusalSession> {
  /** GameServer.GUILD_BANK_DEFICIT_MAX_SKIPS: how many consecutive refusals
   *  one session tolerates for one guild before it is rolled back. */
  readonly maxDeficitSkips: number;
  /** The OTHER live, non-departing sessions holding unflushed work on this
   *  guild's book (server/guild_book_holders.ts). */
  readonly holders: (guildId: number, except: S) => readonly S[];
  /** Flush the holders whose unflushed work FEEDS the refused dependency, so
   *  the retry lands a round trip later (bounded and coalesced by the host). */
  readonly flushHolders: (
    guildId: number,
    except: S,
    dependency: GuildBookDependency | null,
  ) => void;
  /** Undo exactly this session's own unflushed deltas on the live books. */
  readonly revertOwnGuildBookOps: (session: S, guildIds: number[]) => void;
  /** Disconnect the abandoned session so it reloads from its durable row. */
  readonly kickSession: (session: S) => void;
  readonly recordIncident: (kind: GuildBankIncident) => void;
  readonly logError: (message: string) => void;
}

export function handleGuildBankEscrowRefusal<S extends EscrowRefusalSession>(
  host: EscrowRefusalHostPort<S>,
  session: S,
  results: readonly GuildBankWriteResult[],
  // True when this is the LAST save this session will ever get (the leave
  // flush, or the shutdown flush's second pass). There is no later retry to
  // wait for, so the refusal is resolved now rather than left to a save that
  // will never come: otherwise the session would tear down with its progress
  // discarded and no log line and no ledger row to say why.
  final = false,
): void {
  let quarantine = false;
  for (const result of results) {
    if (result.written) continue;
    const guildId = result.guildId;
    // A quarantined or departing session's marks are NOT a reason to wait:
    // it will never commit them, so counting it would burn every retry
    // (blocking this session's character saves the whole time) before
    // reaching the same rollback.
    const anotherSessionDirty = host.holders(guildId, session).length > 0;
    const skips = (session.guildBankDeficitSkips.get(guildId) ?? 0) + 1;
    const canResolve =
      !final && anotherSessionDirty && !result.rowUnusable && skips < host.maxDeficitSkips;
    if (canResolve) {
      // ORDINARY CONCURRENCY, not a failure: another officer of this guild
      // holds unflushed work, their commit is what makes this replay
      // applicable, and the flush below makes that a round trip rather than
      // an autosave interval. Nothing was consumed and nothing is lost, so
      // it gets its own counter kind: sharing escrow_save_failed made that
      // counter unusable for `> 0` alerting. Counted per GUILD, the unit the
      // retry applies to.
      host.recordIncident('escrow_refused_retry');
      session.guildBankDeficitSkips.set(guildId, skips);
      // Do not wait out an autosave interval: FLUSH the sessions whose
      // unflushed work this replay is waiting on, so the retry lands a round
      // trip later rather than 30 seconds later. This is what keeps the
      // blocked window (during which THIS character persists nothing at all,
      // including progress that has nothing to do with the guild bank) to
      // the shortest it can be, and it is why the skip bound is small.
      //
      // Only on the FIRST refusal: if that flush is itself refused it will
      // flush back, and an unbounded ping-pong of fire-and-forget saves
      // between two mutually-stuck sessions is worse than the wait it saves.
      if (skips > 1) continue;
      host.flushHolders(guildId, session, deficitDependency(result.deficit));
      continue;
    }
    const log = session.unflushedGuildBankOps.get(guildId) ?? [];
    recordGuildBankEscrowRollback(session, guildId, log, result.deficit);
    host.logError(
      `guild bank escrow rolled back for guild ${guildId} (character ${session.characterId}): ${
        result.rowUnusable
          ? 'the stored row is oversized or malformed, its live shadow vanished, or the merged book would cross the size bound, so it is preserved untouched'
          : `${result.deficit?.kind} shortfall ${result.deficit?.shortfall} on ${result.deficit?.op}${result.deficit?.itemId ? ` (${result.deficit.itemId})` : ''}, and ${
              anotherSessionDirty
                ? `it did not resolve within ${skips} escrow saves`
                : 'no other session holds unflushed work for this guild, so it never can'
            }`
      }. The session is quarantined and disconnected; nothing it did since its last save was durable, so nothing is lost that was.`,
    );
    quarantine = true;
  }
  if (!quarantine) return;
  // TERMINAL: this refusal will never resolve, so the save really did fail
  // for good (character half included, nothing durable). That is what
  // escrow_save_failed means, and it is booked here rather than at the throw
  // site so a refusal that merely RETRIES never reaches it. Counted once per
  // SAVE, matching the db-threw arm in saveCharacter.
  host.recordIncident('escrow_save_failed');
  // The terminal arm of the escrow design and the one an operator should
  // alert on: a live session is being abandoned because its book half can
  // never be replayed onto durable truth. Counted once per SESSION (the unit
  // the remedy applies to; the per-guild reverts it triggers are counted as
  // 'reconcile' inside revertOwnGuildBookOps), beside the loud log that
  // carries the guild id and the deficit.
  host.recordIncident('escrow_quarantined');
  // The character half is the half that would carry the value the book half
  // could not, so this session must never save again.
  session.escrowQuarantined = true;
  // Undo EVERY book this session dirtied, not only the refused one: the
  // session as a whole is abandoned, so its deltas in a second guild's book
  // are live value nobody will ever make durable, and another officer
  // withdrawing that phantom value would be refused in turn.
  host.revertOwnGuildBookOps(session, [...session.dirtyGuildBanks.keys()]);
  if (!session.left) host.kickSession(session);
}
