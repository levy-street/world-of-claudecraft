// Indexed account-local projection: Postgres folds character bags and personal
// banks to bounded mount item ids before returning anything to the main thread.
import { ITEMS } from '../src/sim/data';
import {
  type AccountMountItemsRefreshRow,
  type AccountMountItemsRow,
  MOUNT_ITEM_IDS,
} from './account_mount_items_core';
import { runWithStatementTimeout } from './db';

export const ACCOUNT_MOUNT_ITEMS_TIMEOUT_MS = 2_000;
const MOUNT_ITEMS_PROJECTION_SQL = `ARRAY(
  SELECT DISTINCT slot->>'itemId'
  FROM jsonb_to_record(jsonb_path_query_first(c.state, '$ ? (@.type() == "object")')) AS owned(inventory jsonb, bank jsonb),
  LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(owned.inventory) = 'array'
      THEN owned.inventory ELSE '[]'::jsonb END
    || CASE WHEN jsonb_typeof(owned.bank->'inventory') = 'array'
      THEN owned.bank->'inventory' ELSE '[]'::jsonb END
  ) AS slot
  WHERE slot->>'itemId' = ANY($2::text[])
    AND CASE WHEN jsonb_typeof(slot->'count') = 'number'
      THEN (slot->>'count')::numeric > 0 ELSE false END
)`;
// now() is transaction-start time, not commit order. Exact timestamp text plus
// xmin detects late commits, microsecond updates, and unchanged timestamps.
const CHARACTER_VERSION_SQL = `c.updated_at::text || ':' || c.xmin::text`;
export const ACCOUNT_MOUNT_ITEMS_SQL = `
SELECT c.id, ${CHARACTER_VERSION_SQL} AS version, ${MOUNT_ITEMS_PROJECTION_SQL} AS mount_item_ids
FROM characters c
WHERE c.account_id = $1`;

// The cheap complete manifest detects deletions. CASE short-circuits JSONB
// expansion for unchanged rows, so a quiet refresh never detoasts their saves.
export const ACCOUNT_MOUNT_ITEMS_REFRESH_SQL = `
SELECT c.id, ${CHARACTER_VERSION_SQL} AS version,
  CASE WHEN $3::jsonb->>c.id::text = ${CHARACTER_VERSION_SQL}
    THEN NULL ELSE ${MOUNT_ITEMS_PROJECTION_SQL} END AS mount_item_ids
FROM characters c
WHERE c.account_id = $1`;

function skinIds(itemIds: string[]): string[] {
  return itemIds.flatMap((id) => {
    const def = ITEMS[id];
    return def?.kind === 'mount' ? [def.mount] : [];
  });
}

export async function loadAccountMountItems(accountId: number): Promise<AccountMountItemsRow[]> {
  const result = await runWithStatementTimeout(ACCOUNT_MOUNT_ITEMS_TIMEOUT_MS, (query) =>
    query(ACCOUNT_MOUNT_ITEMS_SQL, [accountId, MOUNT_ITEM_IDS]),
  );
  return result.rows.map((row) => ({
    characterId: Number(row.id),
    version: row.version as string,
    mountSkinIds: skinIds(row.mount_item_ids as string[]),
  }));
}

export async function refreshAccountMountItems(
  accountId: number,
  knownVersions: Readonly<Record<string, string>>,
): Promise<AccountMountItemsRefreshRow[]> {
  const result = await runWithStatementTimeout(ACCOUNT_MOUNT_ITEMS_TIMEOUT_MS, (query) =>
    query(ACCOUNT_MOUNT_ITEMS_REFRESH_SQL, [accountId, MOUNT_ITEM_IDS, knownVersions]),
  );
  return result.rows.map((row) => ({
    characterId: Number(row.id),
    version: row.version as string,
    ...(row.mount_item_ids === null
      ? {}
      : { mountSkinIds: skinIds(row.mount_item_ids as string[]) }),
  }));
}
