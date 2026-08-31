import type { Pool } from 'pg';

// Delete an account provisioned by a federated-login race only while it remains
// unreachable. Seeded characters intentionally do not block deletion: they were
// created in the same provisioning transaction and cascade with the loser row.
// A chosen password, session token, Apple link, or Discord link protects the row.
export async function deleteUnusedFederatedProvision(
  pool: Pool,
  accountId: number,
): Promise<boolean> {
  try {
    const result = await pool.query(
      `DELETE FROM accounts a
        WHERE a.id = $1 AND a.password_set = FALSE
          AND NOT EXISTS (SELECT 1 FROM auth_tokens t WHERE t.account_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM apple_auth_links l WHERE l.account_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM discord_links l WHERE l.account_id = a.id)
        RETURNING a.id`,
      [accountId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    // 55006 is storage_purchase_guard_account_delete refusing while a possibly-debited purchase is open.
    if ((error as { code?: string } | null | undefined)?.code === '55006') {
      throw new Error(
        `federated provision cleanup refused: account ${accountId} has an open storage purchase awaiting reconciliation`,
        { cause: error },
      );
    }
    throw error;
  }
}
