// The guild book's two source-audit seams, both thin adapters over the shared
// ledger core (material_source_ledger.ts) and its one batched statement
// (material_source_journal_db.ts):
//
//   * READ: the exact per-payload movement between a book's before and after
//     slot lists, which is what the dispatch observer turns into the sidecar
//     legs a receipt-new guild delta carries.
//   * WRITE: the durable container journal for every guild book a save actually
//     moved, on the CALLER'S OPEN TRANSACTION, after the guild row itself has
//     been written.
//
// Neither adapter invents anything. Identity, ordering, the count-0
// re-attribution row and every refusal code come from the core; what lives here
// is only the guild binding: container kind `guild`, owner id = guild id, realm
// from the process, and the ascending-guild-id order the caller already locked
// its rows in.
//
// Contracts the caller owes, and this module relies on:
//   * The client is TRANSACTION SCOPED and already holds the guild_banks row
//     locks, in ascending guild id order. This module issues no BEGIN, COMMIT or
//     ROLLBACK and takes no lock of its own beyond the anchor rows the one
//     statement upserts, in the SAME order the changes arrive in.
//   * `before` is the normalized persisted before-state (the locked read's own
//     row through the one load path) and `after` is the merged book that the
//     receipt gate just wrote. Anything else would journal a movement the row
//     does not carry.
//   * One call per save transaction, carrying every affected guild: the write is
//     ONE statement for all of them, never one per guild and never one per
//     gatherer.
//
// A refusal is an explicit THROW, not a return value: the audit and the book it
// describes commit together or not at all, so a book the source model cannot
// read must take its own transaction down rather than commit unaudited. The
// message is a static operator diagnostic plus the core's error code; it is
// never player-facing and never carries book contents.

import { materialItemIds } from '../src/sim/material_ids';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import type { InvSlot } from '../src/sim/types';
import {
  type MaterialSourceContainerChange,
  type MaterialSourceJournalClient,
  type MaterialSourceJournalWriteResult,
  writeMaterialSourceJournal,
} from './material_source_journal_db';
import { diffMaterialContainers, type MaterialMovementRow } from './material_source_ledger';
import { REALM } from './realm';

/** The container kind every guild book journals under. Guild anchors carry NO
 *  owning character, which is what lets a surviving guild's source history
 *  outlive every contributor that ever deposited into it. */
export const GUILD_SOURCE_CONTAINER = 'guild' as const;

/** Static operator diagnostic; the core's error CODE is appended, never book
 *  contents and never player-facing text. */
export const GUILD_SOURCE_JOURNAL_REFUSED = 'guild bank material source journal refused the save';

/** One guild book's before and after material state for THIS transaction. */
export interface GuildBookSourceChange {
  readonly guildId: number;
  /** The normalized persisted before-state the merge replayed onto. */
  readonly before: readonly InvSlot[];
  /** The merged book actually written by this transaction. */
  readonly after: readonly InvSlot[];
}

/**
 * The exact per-payload movement between two book states, or `null` when the
 * shared model cannot read one of them.
 *
 * Null is deliberately not an empty answer: an empty array means "this book's
 * material stock did not move", while null means "this book's material stock
 * could not be read at all", and a caller must never treat the second as the
 * first. A book that reaches this state is either tampered or was written by
 * something outside the source model; the load path
 * (`sanitizeGuildBankMaterialSlot`) exists so that cannot happen normally.
 */
export function guildBookMaterialMovements(
  before: readonly InvSlot[],
  after: readonly InvSlot[],
): readonly MaterialMovementRow[] | null {
  const rows = diffMaterialContainers(
    before as readonly MaterialStackSlot[],
    after as readonly MaterialStackSlot[],
    materialItemIds(),
  );
  return rows.ok ? rows.value : null;
}

/**
 * Journal every guild book this save actually moved, in ONE statement, on the
 * caller's open transaction.
 *
 * Returns null when there is nothing to journal at all, and in that case sends
 * NO query: an empty receipt retry pays exactly zero source queries, the same
 * way it pays zero guild queries. A book whose before and after carry no
 * movement is dropped by the core with no anchor and no revision, so a retry
 * that re-merges to the same stock also writes nothing.
 *
 * @throws when the core refuses the batch, which aborts the caller's whole
 *   transaction: state, book, ledger rows and audit commit together or not
 *   at all.
 */
export async function journalGuildBookSources(
  client: MaterialSourceJournalClient,
  changes: readonly GuildBookSourceChange[],
): Promise<MaterialSourceJournalWriteResult | null> {
  if (changes.length === 0) return null;
  const containers: MaterialSourceContainerChange[] = changes.map((change) => ({
    realm: REALM,
    container: GUILD_SOURCE_CONTAINER,
    ownerId: change.guildId,
    before: change.before as readonly MaterialStackSlot[],
    after: change.after as readonly MaterialStackSlot[],
  }));
  const written = await writeMaterialSourceJournal(client, containers, materialItemIds());
  if (!written.ok) throw new Error(`${GUILD_SOURCE_JOURNAL_REFUSED}: ${written.error}`);
  return written.value;
}
