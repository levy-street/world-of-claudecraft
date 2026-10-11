// Read one vault letter's durable source after an uncertain character+mail
// save. A live emptied letter is never proof that its character grant landed.

import type { Pool } from 'pg';
import type { VaultMailRecoveryLetter } from '../src/sim/mail/post_office';
import type { MailSave } from '../src/sim/sim';
import { mailRecipientKey } from './mail_partition_backfill';

export async function loadVaultMailRecovery(
  pool: Pick<Pool, 'connect'>,
  realm: string,
  characterId: number,
  custodyRef: string,
): Promise<VaultMailRecoveryLetter | null> {
  if (!Number.isSafeInteger(characterId) || characterId <= 0 || !custodyRef.startsWith('vault:'))
    throw new Error('invalid vault mail recovery reference');
  const recipientKey = String(characterId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    // The paired character+mail save updates this row before its mailbox.
    // A late COMMIT still holds the row lock; waiting here makes the two
    // subsequent reads see its final committed outcome, never a stale letter.
    const character = await client.query('SELECT id FROM characters WHERE id = $1 FOR UPDATE', [
      characterId,
    ]);
    if (character.rowCount !== 1) throw new Error('vault mail character missing during recovery');
    const partition = await client.query('SELECT data FROM world_state WHERE key = $1', [
      mailRecipientKey(realm, recipientKey),
    ]);
    const data = partition.rows[0]?.data as Partial<MailSave> | undefined;
    const saved = data?.mail?.find(
      (letter) =>
        letter.recipientKey === recipientKey &&
        letter.letterId === 'hoard_vault_reward' &&
        letter.custodyRef === custodyRef,
    );
    let source: VaultMailRecoveryLetter | null = null;
    if (saved && (saved.copper > 0 || saved.items.length > 0)) {
      source = {
        recipientName: saved.recipientName,
        copper: saved.copper,
        items: saved.items,
        read: saved.read,
        vaultRewardCredited: saved.vaultRewardCredited,
      };
    } else if (!saved) {
      const overlay = await client.query(
        `SELECT recipient_name, items, copper FROM mail_custody_parcels
         WHERE realm = $1 AND recipient_key = $2 AND custody_ref = $3`,
        [realm, recipientKey, custodyRef],
      );
      if (overlay.rowCount === 1) {
        const row = overlay.rows[0];
        source = {
          recipientName: String(row.recipient_name),
          copper: Number(row.copper),
          items: row.items as VaultMailRecoveryLetter['items'],
          read: false,
        };
      }
    }
    await client.query('COMMIT');
    return source;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
