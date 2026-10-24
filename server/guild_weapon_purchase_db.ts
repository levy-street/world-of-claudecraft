// One transaction owns the earned account unlock and its character seal cost.
// No retries: a lost COMMIT response is resolved by reloading durable state.
import type { PoolClient } from 'pg';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { lockCharacterSaveAccountParentOnClient } from './bank_ledger_save_effects_db';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import { beginCharacterSaveTx, prepareCharacterSaveEffects } from './character_save_transaction';
import { pool, saveCharacterStateOnClient } from './db';
import { cancelDetachedBackend } from './db_backend_cancel';
import { acquirePaidGuildCreateClient, type PaidGuildCreateDeps } from './guild_create_db';
import type { CharacterSaveArgs } from './woc_market_character_save';

export interface GuildWeaponPurchaseSave extends CharacterSaveArgs {
  accountId: number;
  skinId: string;
  leaseNonce: string;
}

export async function purchaseGuildWeaponAtomic(
  save: GuildWeaponPurchaseSave,
  signal: AbortSignal,
  deps: PaidGuildCreateDeps = {
    pool,
    cancelBackend: cancelDetachedBackend,
    bustGuildRoster: () => {},
  },
): Promise<string[]> {
  if (
    !Object.hasOwn(WEAPON_SKINS, save.skinId) ||
    WEAPON_SKINS[save.skinId].earnedFrom !== 'lantern_hall' ||
    !save.leaseNonce
  ) {
    throw new Error('Invalid earned weapon purchase');
  }
  const state = structuredClone(save.state);
  const storage = save.storageEffects ?? [];
  const ledger = save.bankLedgerSnapshot
    ? bankLedgerSaveEffects(save.bankLedgerSnapshot)
    : undefined;
  prepareCharacterSaveEffects(save.characterId, storage, ledger);
  const client = await acquirePaidGuildCreateClient(deps, signal, 'guild weapon purchase');
  const tx = await beginCharacterSaveTx(
    client,
    'guild weapon purchase',
    signal,
    deps.cancelBackend,
  );
  try {
    const accountLock = await lockCharacterSaveAccountParentOnClient(tx, save.accountId);
    // Verify the authenticated account binding as well as the character lease.
    const owner = await tx.query('SELECT account_id FROM characters WHERE id = $1 FOR UPDATE', [
      save.characterId,
    ]);
    if (Number(owner.rows[0]?.account_id) !== save.accountId)
      throw new Error('Purchase owner changed');
    const saved = await saveCharacterStateOnClient(
      tx as unknown as PoolClient,
      save.characterId,
      save.level,
      state,
      save.leaseNonce,
      storage,
      ledger,
      accountLock,
    );
    if (!saved) throw new Error('Purchase character lease lost');
    // First purchases need a real row to lock. Seed legacy ownership just as
    // the account loader does when no rollback-safe row exists yet.
    await tx.query(
      `INSERT INTO account_weapon_cosmetics (account_id, skin_ids)
      SELECT id, CASE WHEN jsonb_typeof(cosmetics->'weaponSkinIds') = 'array'
        THEN cosmetics->'weaponSkinIds' ELSE '[]'::jsonb END
      FROM accounts WHERE id = $1 ON CONFLICT (account_id) DO NOTHING`,
      [save.accountId],
    );
    // UPDATE's row lock also serializes ordinary account grants. Under READ
    // COMMITTED its predicate is rechecked after a concurrent updater commits.
    const grant = await tx.query(
      `UPDATE account_weapon_cosmetics
      SET skin_ids = skin_ids || to_jsonb($2::text), updated_at = now()
      WHERE account_id = $1 AND NOT (skin_ids ? $2::text)
      RETURNING skin_ids`,
      [save.accountId, save.skinId],
    );
    if (!grant.rows[0]) throw new Error('Guild weapon already owned');
    await tx.commit();
    return grant.rows[0].skin_ids as string[];
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
