// The tracked-item end of a character delete (docs/design/item-tracking.md
// "Lineage"): deleting a character is HARD (server/character_delete_db.ts
// `DELETE FROM characters`, no archive and no restore path), so every tracked
// (epic or legendary) copy the character held stops existing at that
// statement. Each one writes its final `consume` row (source
// 'characterDelete', detail the container it was in) so the ledger can say
// what happened to it, and a guid seen afterwards reads as a duplicate.
//
// The holdings come from the DELETE itself (`RETURNING` the item containers of
// the stored state), so the rows describe exactly the copies that statement
// destroyed, and they are inserted inside the same transaction: they commit
// iff the delete commits, which also covers the ambiguous-commit verify path.
// The insert sits behind a SAVEPOINT: the ledger is an audit twin, so a
// rejected audit insert logs and the delete still lands (the fire-and-forget
// posture of server/item_ledger.ts), rather than making deletion impossible.
//
// Cycle-free on purpose: character_delete_db.ts must not reach server/db.ts,
// so this writes through the delete's own transaction, never the shared pool
// or server/item_ledger.ts.

import { ITEMS } from '../src/sim/data';
import { effectiveQuality } from '../src/sim/equipment_rules';
import type { ItemInstancePayload } from '../src/sim/types';
import { isItemLedgerGuid } from './item_ledger_db';

/** The ledger source id every delete-time row carries. */
export const CHARACTER_DELETE_ITEM_SOURCE = 'characterDelete';

/** The RETURNING projection the delete statement appends: only the
 *  payload-bearing containers of the stored state (character_state.ts), never
 *  the whole blob. */
export const DELETED_CHARACTER_HOLDINGS_RETURNING = `name,
  state->'inventory' AS inventory,
  state->'bank'->'inventory' AS bank,
  state->'vault'->'special' AS vault_special,
  state->'vendorBuyback' AS vendor_buyback,
  state->'equipment' AS equipment,
  state->'equipmentInstance' AS equipment_instance,
  state->'equipmentInstances' AS equipment_instances`;

/** One row of that projection, as pg hands it back (JSONB parsed). */
export interface DeletedCharacterHoldingsRow {
  name?: unknown;
  inventory?: unknown;
  bank?: unknown;
  vault_special?: unknown;
  vendor_buyback?: unknown;
  equipment?: unknown;
  equipment_instance?: unknown;
  equipment_instances?: unknown;
}

/** One tracked copy found in the deleted character's containers. */
export interface DeletedTrackedCopy {
  guid: string;
  itemId: string;
  quality: string;
  /** The container: bags, bank, vault, buyback, or equipped:<slot>. */
  container: string;
}

const ID_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trackedCopy(
  itemId: unknown,
  instance: unknown,
  container: string,
): DeletedTrackedCopy | null {
  if (typeof itemId !== 'string' || itemId.length === 0 || !isRecord(instance)) return null;
  const guid = instance.guid;
  if (!isItemLedgerGuid(guid)) return null;
  const def = ITEMS[itemId];
  const quality =
    (def ? effectiveQuality(def, instance as ItemInstancePayload) : undefined) ?? 'unknown';
  return { guid, itemId: itemId.slice(0, ID_MAX_LENGTH), quality, container };
}

function slotsIn(value: unknown, container: string, out: DeletedTrackedCopy[]): void {
  if (!Array.isArray(value)) return;
  for (const slot of value) {
    if (!isRecord(slot)) continue;
    const copy = trackedCopy(slot.itemId, slot.instance, container);
    if (copy) out.push(copy);
  }
}

/** Every tracked copy in the deleted character's stored containers (a copy
 *  carrying a canonical guid), in a stable order: bags, bank, vault, buyback,
 *  then equipment. Pure and tolerant: a malformed container is skipped, never
 *  thrown on. The equipped payload map pairs with the equipment id map; the
 *  legacy plural key is read only for a slot the current key does not carry. */
export function trackedCopiesInDeletedCharacter(
  row: DeletedCharacterHoldingsRow | undefined,
): DeletedTrackedCopy[] {
  const out: DeletedTrackedCopy[] = [];
  if (!row) return out;
  slotsIn(row.inventory, 'bags', out);
  slotsIn(row.bank, 'bank', out);
  slotsIn(row.vault_special, 'vault', out);
  slotsIn(row.vendor_buyback, 'buyback', out);
  if (isRecord(row.equipment)) {
    const current = isRecord(row.equipment_instance) ? row.equipment_instance : {};
    const legacy = isRecord(row.equipment_instances) ? row.equipment_instances : {};
    for (const [slot, itemId] of Object.entries(row.equipment)) {
      const instance = current[slot] ?? legacy[slot];
      const copy = trackedCopy(itemId, instance, `equipped:${slot}`.slice(0, ID_MAX_LENGTH));
      if (copy) out.push(copy);
    }
  }
  return out;
}

/** The one multi-row INSERT for `copies`, or null when there are none.
 *  character_id is NULL: the row it would reference is gone (the FK is ON
 *  DELETE SET NULL, so every earlier row of this character reads NULL too);
 *  account_id and character_name keep the attribution. */
export function characterDeleteLedgerInsert(
  realm: string,
  accountId: number,
  characterName: string,
  copies: readonly DeletedTrackedCopy[],
): { text: string; values: unknown[] } | null {
  if (copies.length === 0) return null;
  return {
    text: `INSERT INTO item_ledger
       (realm, guid, item_id, quality, kind, character_id, account_id,
        character_name, source, zone, detail, related_guid, occurred_at)
     SELECT $1, t.guid, t.item_id, t.quality, 'consume', NULL, $2,
            $3, $4, NULL, t.detail, NULL, now()
       FROM unnest($5::text[], $6::text[], $7::text[], $8::text[])
         AS t(guid, item_id, quality, detail)`,
    values: [
      realm.slice(0, NAME_MAX_LENGTH),
      accountId,
      characterName.slice(0, NAME_MAX_LENGTH),
      CHARACTER_DELETE_ITEM_SOURCE,
      copies.map((c) => c.guid),
      copies.map((c) => c.itemId),
      copies.map((c) => c.quality.slice(0, NAME_MAX_LENGTH)),
      copies.map((c) => c.container),
    ],
  };
}

/** The narrow transaction surface this needs (the delete's deadline client). */
export interface CharacterDeleteLedgerTransaction {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const SAVEPOINT = 'character_delete_item_ledger';

function hasSqlState(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === 'string';
}

/**
 * Write the `consume` rows for the deleted character's tracked copies inside
 * the delete transaction, after the DELETE and before COMMIT. Issues nothing
 * when the character held no tracked copy. A database refusal of the insert
 * (it carries a SQLSTATE) rolls back to the savepoint and logs, so the delete
 * proceeds; a dead connection or an expired deadline (no SQLSTATE) propagates,
 * since the transaction cannot commit anyway.
 */
export async function recordDeletedCharacterCopies(
  transaction: CharacterDeleteLedgerTransaction,
  realm: string,
  accountId: number,
  row: DeletedCharacterHoldingsRow | undefined,
): Promise<number> {
  const copies = trackedCopiesInDeletedCharacter(row);
  const name = typeof row?.name === 'string' && row.name.length > 0 ? row.name : 'unknown';
  const insert = characterDeleteLedgerInsert(realm, accountId, name, copies);
  if (!insert) return 0;
  await transaction.query(`SAVEPOINT ${SAVEPOINT}`);
  try {
    await transaction.query(insert.text, insert.values);
    await transaction.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return copies.length;
  } catch (error) {
    if (!hasSqlState(error)) throw error;
    console.error('character delete item_ledger consume rows failed:', error);
    await transaction.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    return 0;
  }
}
