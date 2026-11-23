// The tracked-item end of a deleted character's WORLD STATE (docs/design/
// item-tracking.md "Lineage"): the post-delete purge (server/characters.ts
// purgeDeletedCharacterWorldState) destroys the character's World Market
// listings and collection and every Ravenpost letter with no home to fly to
// (src/sim/market.ts purgeMarketSeller, src/sim/mail/post_office.ts
// purgeMailOwner). Those copies were not in the stored character row, so the
// delete's own consume rows (character_delete_item_ledger.ts) never saw them.
// Each tracked copy among them writes its final `consume` row here, in the
// same shape: source 'characterDelete', detail the container ('market' or
// 'mail'), character_id NULL (the row is gone) and the account kept for
// attribution.
//
// Beside the delete transaction, not inside it: the books are the live sim's
// in-memory state and are only purged once the delete has committed, so the
// rows describe exactly what the purge removed. They are written after the
// purge's own awaited saves, which narrows the window in which a crash
// reloads purged listings or mail whose copies already have a consume row,
// but cannot close it: the save wrappers swallow their own write errors, so
// a failed save followed by a crash before the next autosave can still leave
// such a row (docs/design/item-tracking.md, "Crash rollback"). A rejected
// insert logs and is dropped, the audit-twin posture of server/item_ledger.ts:
// it never turns a committed delete into an error.

import type { InvSlot } from '../src/sim/types';
import { characterDeleteLedgerInsert, trackedCopiesInSlots } from './character_delete_item_ledger';
import { pool } from './db';
import { REALM } from './realm';

/** What the world-state purge destroyed, filled by the purges' sinks. */
export interface PurgedCharacterHoldings {
  /** Listing escrow and the Merchant collection (purgeMarketSeller). */
  market: InvSlot[];
  /** Attachments of the deleted letters (purgeMailOwner); returned letters
   *  fly home and are never here. */
  mail: InvSlot[];
}

export function emptyPurgedCharacterHoldings(): PurgedCharacterHoldings {
  return { market: [], mail: [] };
}

/** The one multi-row INSERT for the tracked copies among `holdings`, or null
 *  when the purge destroyed none. */
export function purgedHoldingsLedgerInsert(
  realm: string,
  accountId: number,
  characterName: string,
  holdings: PurgedCharacterHoldings,
): { text: string; values: unknown[]; count: number } | null {
  const copies = [
    ...trackedCopiesInSlots(holdings.market, 'market'),
    ...trackedCopiesInSlots(holdings.mail, 'mail'),
  ];
  const insert = characterDeleteLedgerInsert(realm, accountId, characterName, copies);
  return insert ? { ...insert, count: copies.length } : null;
}

/** The narrow query surface the write needs (the pool, or a test fake). */
export interface PurgeLedgerQueryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/** Write the purge's consume rows. Issues nothing when no tracked copy was
 *  destroyed; resolves to the number of rows written (0 on a logged
 *  failure), never rejects. */
export async function recordPurgedCharacterCopies(
  accountId: number,
  characterName: string,
  holdings: PurgedCharacterHoldings,
  db: PurgeLedgerQueryable = pool,
): Promise<number> {
  try {
    const insert = purgedHoldingsLedgerInsert(REALM, accountId, characterName, holdings);
    if (!insert) return 0;
    await db.query(insert.text, insert.values);
    return insert.count;
  } catch (error) {
    console.error('character purge item_ledger consume rows failed:', error);
    return 0;
  }
}
