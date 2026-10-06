// Indexed account-local projection: Postgres folds character bags and personal
// banks to bounded mount item ids before returning anything to the main thread.
import { ITEMS } from '../src/sim/data';
import { type AccountMountItemsRow, MOUNT_ITEM_IDS } from './account_mount_items_core';
import { runWithStatementTimeout } from './db';

export const ACCOUNT_MOUNT_ITEMS_TIMEOUT_MS = 2_000;
export const ACCOUNT_MOUNT_ITEMS_SQL = `
SELECT c.id, ARRAY(
  SELECT DISTINCT slot->>'itemId'
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.state->'inventory') = 'array'
      THEN c.state->'inventory' ELSE '[]'::jsonb END
    || CASE WHEN jsonb_typeof(c.state->'bank'->'inventory') = 'array'
      THEN c.state->'bank'->'inventory' ELSE '[]'::jsonb END
  ) AS slot
  WHERE slot->>'itemId' = ANY($2::text[])
    AND CASE WHEN jsonb_typeof(slot->'count') = 'number'
      THEN (slot->>'count')::numeric > 0 ELSE false END
) AS mount_item_ids
FROM characters c
WHERE c.account_id = $1`;

export async function loadAccountMountItems(accountId: number): Promise<AccountMountItemsRow[]> {
  const result = await runWithStatementTimeout(ACCOUNT_MOUNT_ITEMS_TIMEOUT_MS, (query) =>
    query(ACCOUNT_MOUNT_ITEMS_SQL, [accountId, MOUNT_ITEM_IDS]),
  );
  return result.rows.map((row) => ({
    characterId: Number(row.id),
    mountSkinIds: (row.mount_item_ids as string[]).flatMap((id) => {
      const def = ITEMS[id];
      return def?.kind === 'mount' ? [def.mount] : [];
    }),
  }));
}
