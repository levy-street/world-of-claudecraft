// Account cosmetics persistence: the account-wide cosmetic unlocks a player
// owns across every character. Two stores, deliberately:
//   - accounts.cosmetics (JSONB): the unpaid unlocks (quest lockouts, mech
//     chromas), replaced wholesale by older binaries.
//   - the rollback-safe paid rows: account_weapon_cosmetics (skin ids + the
//     applied loadout) and account_mount_cosmetics (skin ids), each its own
//     table so a rolling deploy or rollback can never erase an entitlement.
// Every read joins all three into one AccountCosmetics view; every writer
// returns that same merged view so the live session can be refreshed from it.
// The DDL stays in db.ts's SCHEMA (the weapon backfill is order-sensitive);
// db.ts re-exports this module so callers and test doubles keep one import.
import { pool } from './db';

export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Season 1 Armory weapon skins: owned skin ids (granted on Claudium spend,
  // reconciled from the economy service) and the applied-skin-per-weapon-type
  // loadout. Account-wide by design; characters never carry either.
  weaponSkinIds: string[];
  weaponSkinLoadout: Record<string, string>;
  // Mount skins (src/sim/content/mount_skins.ts): account-wide ownership in
  // its own rollback-safe row, like the weapon skins. The worn skin is per
  // character (characters.state) and never lives here.
  mountSkinIds: string[];
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: uniqueStrings(src.completedQuestIds),
    mechChromaIds: uniqueStrings(src.mechChromaIds),
    weaponSkinIds: uniqueStrings(src.weaponSkinIds),
    weaponSkinLoadout: stringRecord(src.weaponSkinLoadout),
    mountSkinIds: uniqueStrings(src.mountSkinIds),
  };
}

interface AccountCosmeticsRow {
  cosmetics?: unknown;
  weapon_skin_ids?: unknown;
  weapon_skin_loadout?: unknown;
  mount_skin_ids?: unknown;
}

function normalizeAccountCosmeticsRow(row: AccountCosmeticsRow | undefined): AccountCosmetics {
  const base = normalizeAccountCosmetics(row?.cosmetics);
  return {
    ...base,
    weaponSkinIds:
      row?.weapon_skin_ids === null || row?.weapon_skin_ids === undefined
        ? base.weaponSkinIds
        : uniqueStrings(row.weapon_skin_ids),
    weaponSkinLoadout:
      row?.weapon_skin_loadout === null || row?.weapon_skin_loadout === undefined
        ? base.weaponSkinLoadout
        : stringRecord(row.weapon_skin_loadout),
    mountSkinIds:
      row?.mount_skin_ids === null || row?.mount_skin_ids === undefined
        ? base.mountSkinIds
        : uniqueStrings(row.mount_skin_ids),
  };
}

export async function loadAccountCosmetics(accountId: number): Promise<AccountCosmetics> {
  const res = await pool.query(
    `SELECT a.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout,
            amc.skin_ids AS mount_skin_ids
       FROM accounts a
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = a.id
       LEFT JOIN account_mount_cosmetics amc ON amc.account_id = a.id
      WHERE a.id = $1`,
    [accountId],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

async function addAccountCosmeticId(
  accountId: number,
  key: 'completedQuestIds' | 'mechChromaIds',
  value: string,
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH updated AS (
       UPDATE accounts
          SET cosmetics = jsonb_set(
            COALESCE(cosmetics, '{}'::jsonb), ARRAY[$2::text],
            (SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v), '[]'::jsonb)
               FROM (
                 SELECT DISTINCT v FROM (
                   SELECT jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(cosmetics -> $2) = 'array'
                       THEN cosmetics -> $2 ELSE '[]'::jsonb END) AS v
                   UNION ALL SELECT $3::text
                 ) merged
               ) uniq))
        WHERE id = $1
        RETURNING id, cosmetics
     )
     SELECT updated.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout,
            amc.skin_ids AS mount_skin_ids
       FROM updated
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = updated.id
       LEFT JOIN account_mount_cosmetics amc ON amc.account_id = updated.id`,
    [accountId, key, value],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

export async function markAccountQuestComplete(
  accountId: number,
  questId: string,
): Promise<AccountCosmetics> {
  return addAccountCosmeticId(accountId, 'completedQuestIds', questId);
}

export async function grantAccountMechChroma(
  accountId: number,
  chromaId: string,
): Promise<AccountCosmetics> {
  return addAccountCosmeticId(accountId, 'mechChromaIds', chromaId);
}

/** Additive union in the rollback-safe paid-entitlement row. */
export async function grantAccountWeaponSkins(
  accountId: number,
  skinIds: string[],
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH upserted AS (
       INSERT INTO account_weapon_cosmetics AS awc (account_id, skin_ids)
       VALUES ($1, to_jsonb($2::text[]))
       ON CONFLICT (account_id) DO UPDATE SET
         skin_ids = (
           SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v), '[]'::jsonb)
             FROM (
               SELECT DISTINCT value AS v
                 FROM jsonb_array_elements_text(awc.skin_ids || EXCLUDED.skin_ids)
             ) merged),
         updated_at = now()
       RETURNING account_id, skin_ids, loadout
     )
     SELECT a.cosmetics,
            upserted.skin_ids AS weapon_skin_ids,
            upserted.loadout AS weapon_skin_loadout,
            amc.skin_ids AS mount_skin_ids
       FROM upserted
       JOIN accounts a ON a.id = upserted.account_id
       LEFT JOIN account_mount_cosmetics amc ON amc.account_id = a.id`,
    [accountId, skinIds.filter((id) => id)],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

/** Replace the applied-skin-per-weapon-type loadout in the paid-state row. */
export async function setAccountWeaponSkinLoadout(
  accountId: number,
  loadout: Record<string, string>,
): Promise<AccountCosmetics> {
  const cleanLoadout = stringRecord(loadout);
  const res = await pool.query(
    `WITH upserted AS (
       INSERT INTO account_weapon_cosmetics AS awc (account_id, loadout)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET
         loadout = EXCLUDED.loadout,
         updated_at = now()
       RETURNING account_id, skin_ids, loadout
     )
     SELECT a.cosmetics,
            upserted.skin_ids AS weapon_skin_ids,
            upserted.loadout AS weapon_skin_loadout,
            amc.skin_ids AS mount_skin_ids
       FROM upserted
       JOIN accounts a ON a.id = upserted.account_id
       LEFT JOIN account_mount_cosmetics amc ON amc.account_id = a.id`,
    [accountId, JSON.stringify(cleanLoadout)],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}

/** Additive union of owned mount skins in the rollback-safe paid-entitlement
 *  row (src/sim/content/mount_skins.ts); the caller filters ids through the
 *  registry first. Returns the whole refreshed account cosmetics view. */
export async function grantAccountMountSkins(
  accountId: number,
  skinIds: string[],
): Promise<AccountCosmetics> {
  const res = await pool.query(
    `WITH upserted AS (
       INSERT INTO account_mount_cosmetics AS amc (account_id, skin_ids)
       VALUES ($1, to_jsonb($2::text[]))
       ON CONFLICT (account_id) DO UPDATE SET
         skin_ids = (
           SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v), '[]'::jsonb)
             FROM (
               SELECT DISTINCT value AS v
                 FROM jsonb_array_elements_text(amc.skin_ids || EXCLUDED.skin_ids)
             ) merged),
         updated_at = now()
       RETURNING account_id, skin_ids
     )
     SELECT a.cosmetics,
            awc.skin_ids AS weapon_skin_ids,
            awc.loadout AS weapon_skin_loadout,
            upserted.skin_ids AS mount_skin_ids
       FROM upserted
       JOIN accounts a ON a.id = upserted.account_id
       LEFT JOIN account_weapon_cosmetics awc ON awc.account_id = a.id`,
    [accountId, skinIds.filter((id) => id)],
  );
  return normalizeAccountCosmeticsRow(res.rows[0]);
}
