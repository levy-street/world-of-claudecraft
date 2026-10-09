// item_ledger: the append-only provenance ledger of tracked (epic and
// legendary) item copies, mirrored from the sim's server-only `itemTracked`
// event (src/sim/types.ts; minted in src/sim/item_tracking.ts). One row per
// lifecycle step of a copy (the guid mint, each change of hands, each change
// in place, its end, a copy derived from it), so "who looted this
// legendary, when, what happened to it, and every hand it passed through
// since" is one indexed lookup by guid, and a character's tracked
// acquisitions one lookup by character. `detail` carries the step's short
// specifics (a rank, an enchant id, what the copy became) and `related_guid`
// the other copy a swap or derivation names. The payload on the copy itself carries the same record
// (ItemInstancePayload.provenance), bounded to the most recent holders; this
// table is the unbounded audit twin an operator reads.
//
// Pure over a Pool (no game.ts import), the craft_roll_events_db.ts shape:
// schema + validated inserts + the read queries + the retention prune.
// Writes are fire-and-forget through server/item_ledger.ts, so every
// argument is validated here (a rejected row logs, it never throws into the
// game loop). Retention: registered on the retention sweep (server/main.ts)
// under ITEM_LEDGER_RETENTION_DAYS, default DEFAULT_ITEM_LEDGER_RETENTION_DAYS
// in server/http/config.ts (0 keeps forever); the intake is bounded by epic
// and legendary drop rates, far below any per-character event burst.

import type { Pool } from 'pg';
import { ITEM_TRACKED_KINDS, type ItemTrackedKind } from '../src/sim/item_provenance';

/** The closed event vocabulary, enforced by insertItemLedgerEvent below and
 *  deliberately NOT a DB CHECK constraint (CREATE TABLE IF NOT EXISTS never
 *  revises a constraint on a deployed database). It IS the sim's itemTracked
 *  `kind` list (src/sim/item_provenance.ts ITEM_TRACKED_KINDS), so the two
 *  can never drift. */
export const ITEM_LEDGER_KINDS: readonly ItemTrackedKind[] = ITEM_TRACKED_KINDS;
export type ItemLedgerKind = ItemTrackedKind;

export const ITEM_LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS item_ledger (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  guid TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quality TEXT NOT NULL,
  kind TEXT NOT NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  source TEXT NOT NULL,
  zone TEXT,
  detail TEXT,
  related_guid TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_ledger_guid
  ON item_ledger(guid, id);
CREATE INDEX IF NOT EXISTS item_ledger_created
  ON item_ledger(created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS item_ledger_character
  ON item_ledger(character_id, id) WHERE character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS item_ledger_item
  ON item_ledger(item_id, id);
`;

export const ITEM_LEDGER_MAX_LIMIT = 200;
export const ITEM_LEDGER_DEFAULT_LIMIT = 50;
/** The per-guid history read cap: a copy's ledger is bounded by how often
 *  it changes hands, but the read stays bounded regardless. */
export const ITEM_LEDGER_HISTORY_LIMIT = 500;

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 64;

export interface ItemLedgerEventRow {
  realm: string;
  guid: string;
  itemId: string;
  quality: string;
  kind: ItemLedgerKind;
  characterId: number;
  accountId: number;
  characterName: string;
  source: string;
  zone: string | null;
  /** The step's short sim-composed note (a rank, an enchant id, what the copy became). */
  detail: string | null;
  /** The other copy a swap or derivation names (a canonical UUID). */
  relatedGuid: string | null;
  /** Host epoch ms the sim stamped on the step. */
  occurredAtMs: number;
}

export interface ItemLedgerRow {
  id: number;
  guid: string;
  itemId: string;
  quality: string;
  kind: ItemLedgerKind;
  characterId: number | null;
  accountId: number | null;
  characterName: string;
  source: string;
  zone: string | null;
  detail: string | null;
  relatedGuid: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface ItemLedgerPage {
  rows: ItemLedgerRow[];
  hasMore: boolean;
  nextBeforeId: number | null;
}

export interface ListItemLedgerOptions {
  realm: string;
  limit?: number;
  beforeId?: number;
  /** Narrow to one character's rows (its stable id). */
  characterId?: number;
  /** Narrow to one item def. */
  itemId?: string;
}

interface RawRow {
  id: string | number;
  guid: string;
  item_id: string;
  quality: string;
  kind: string;
  character_id: number | null;
  account_id: number | null;
  character_name: string;
  source: string;
  zone: string | null;
  detail: string | null;
  related_guid: string | null;
  occurred_at: Date | string;
  created_at: Date | string;
}

export function isItemLedgerGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_RE.test(value);
}

function positiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.slice(0, maxLength);
}

function nullableText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, maxLength);
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** A stored kind read back through the closed list; an unknown value (a row
 *  written by a later build) reads as a modification rather than throwing. */
function ledgerKindOf(raw: string): ItemLedgerKind {
  return (ITEM_LEDGER_KINDS as readonly string[]).includes(raw)
    ? (raw as ItemLedgerKind)
    : 'modify';
}

function rowOf(raw: RawRow): ItemLedgerRow {
  return {
    id: Number(raw.id),
    guid: raw.guid,
    itemId: raw.item_id,
    quality: raw.quality,
    kind: ledgerKindOf(raw.kind),
    characterId: raw.character_id,
    accountId: raw.account_id,
    characterName: raw.character_name,
    source: raw.source,
    zone: raw.zone,
    detail: raw.detail,
    relatedGuid: raw.related_guid,
    occurredAt: isoOf(raw.occurred_at),
    createdAt: isoOf(raw.created_at),
  };
}

/** Record one ledger event. Append-only, no conflict target on purpose: a
 *  copy legitimately produces many rows over its life. */
export async function insertItemLedgerEvent(db: Pool, row: ItemLedgerEventRow): Promise<void> {
  if (!ITEM_LEDGER_KINDS.includes(row.kind)) {
    throw new TypeError(`unknown item ledger kind: ${String(row.kind)}`);
  }
  if (!isItemLedgerGuid(row.guid)) throw new TypeError('guid must be a canonical UUID');
  if (row.relatedGuid !== null && !isItemLedgerGuid(row.relatedGuid)) {
    throw new TypeError('relatedGuid must be a canonical UUID or null');
  }
  if (!Number.isFinite(row.occurredAtMs) || row.occurredAtMs < 0) {
    throw new TypeError('occurredAtMs must be a non-negative finite number');
  }
  await db.query(
    `INSERT INTO item_ledger
       (realm, guid, item_id, quality, kind, character_id, account_id,
        character_name, source, zone, detail, related_guid, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             to_timestamp($13::double precision / 1000))`,
    [
      requiredText(row.realm, 'realm', NAME_MAX_LENGTH),
      row.guid,
      requiredText(row.itemId, 'itemId', ID_MAX_LENGTH),
      requiredText(row.quality, 'quality', NAME_MAX_LENGTH),
      row.kind,
      positiveId(row.characterId, 'characterId'),
      positiveId(row.accountId, 'accountId'),
      requiredText(row.characterName, 'characterName', NAME_MAX_LENGTH),
      requiredText(row.source, 'source', ID_MAX_LENGTH),
      nullableText(row.zone, ID_MAX_LENGTH),
      nullableText(row.detail, ID_MAX_LENGTH),
      row.relatedGuid,
      row.occurredAtMs,
    ],
  );
}

/** Every ledger row for one copy, oldest first (the mint, then each step),
 *  bounded by ITEM_LEDGER_HISTORY_LIMIT. An unknown guid reads as an empty
 *  history, never an error (anti-enumeration is not a concern here: guids
 *  are unguessable and the surface is admin-gated). */
export async function itemLedgerHistory(
  db: Pool,
  realm: string,
  guid: string,
): Promise<ItemLedgerRow[]> {
  if (!isItemLedgerGuid(guid)) return [];
  const res = await db.query<RawRow>(
    `SELECT id, guid, item_id, quality, kind, character_id, account_id,
            character_name, source, zone, detail, related_guid, occurred_at, created_at
       FROM item_ledger
      WHERE realm = $1 AND guid = $2
      ORDER BY id ASC
      LIMIT $3`,
    [requiredText(realm, 'realm', NAME_MAX_LENGTH), guid, ITEM_LEDGER_HISTORY_LIMIT],
  );
  return res.rows.map(rowOf);
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0)
    return ITEM_LEDGER_DEFAULT_LIMIT;
  return Math.min(ITEM_LEDGER_MAX_LIMIT, Math.floor(value));
}

/** Recent ledger rows, newest first, cursor-paged on id; optionally narrowed
 *  to one character or one item def. */
export async function listItemLedger(
  db: Pool,
  options: ListItemLedgerOptions,
): Promise<ItemLedgerPage> {
  const realm = requiredText(options.realm, 'realm', NAME_MAX_LENGTH);
  const limit = boundedLimit(options.limit);
  const beforeId =
    options.beforeId !== undefined && Number.isSafeInteger(options.beforeId) && options.beforeId > 0
      ? options.beforeId
      : null;
  const characterId =
    options.characterId !== undefined &&
    Number.isSafeInteger(options.characterId) &&
    options.characterId > 0
      ? options.characterId
      : null;
  const itemId = nullableText(options.itemId, ID_MAX_LENGTH);
  const res = await db.query<RawRow>(
    `SELECT id, guid, item_id, quality, kind, character_id, account_id,
            character_name, source, zone, detail, related_guid, occurred_at, created_at
       FROM item_ledger
      WHERE realm = $1
        AND ($2::bigint IS NULL OR id < $2)
        AND ($3::int IS NULL OR character_id = $3)
        AND ($4::text IS NULL OR item_id = $4)
      ORDER BY id DESC
      LIMIT $5`,
    [realm, beforeId, characterId, itemId, limit + 1],
  );
  const hasMore = res.rows.length > limit;
  const rows = res.rows.slice(0, limit).map(rowOf);
  return {
    rows,
    hasMore,
    nextBeforeId: hasMore && rows.length > 0 ? rows[rows.length - 1].id : null,
  };
}

/** Retention prune, oldest first, bounded per call (the retention sweep's
 *  contract). 0 or a negative window keeps every row. */
export async function pruneItemLedgerBatch(
  db: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(
    `DELETE FROM item_ledger
      WHERE id IN (
        SELECT id FROM item_ledger
         WHERE created_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY created_at ASC, id ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
