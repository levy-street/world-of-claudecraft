import type { Pool } from 'pg';
import { parentDeleteGuardOf } from './character_delete_db';

/** Typed refusal (D88): the provision loser still has an OPEN housing operation
 * intent, so its account cannot be deleted until that intent applies or closes.
 * There is no HTTP surface on this path (the federated login caller handles
 * it); the character DELETE route's `character.freehold_operation_open` code is
 * not this refusal's. */
export class FederatedProvisionFreeholdOperationOpen extends Error {
  readonly code = 'FEDERATED_PROVISION_FREEHOLD_OPERATION_OPEN' as const;

  constructor(
    readonly accountId: number,
    options?: ErrorOptions,
  ) {
    // The id rides the typed field only: a message is what a log line prints.
    super(
      'federated provision cleanup refused: the account has an open housing operation awaiting its close',
      options,
    );
    this.name = 'FederatedProvisionFreeholdOperationOpen';
  }
}

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
    // A 55006 is one of the two parent-delete guards refusing, told apart by
    // its CONSTRAINT field matched exactly (PostgreSQL puts no trigger name on
    // the error; parentDeleteGuardOf matches STORAGE_PURCHASE_OPEN_CONSTRAINT
    // and FREEHOLD_OPERATION_OPEN_CONSTRAINT): the storage value is raised by
    // the storage_purchase_guard_account_delete trigger while a possibly-debited
    // purchase is open, the housing value by the
    // freehold_operation_guard_account_delete trigger while a housing intent is
    // open (directly, or through the characters cascade's own guard). Any other
    // 55006 is not a guard this code knows, so it surfaces raw.
    const guard = parentDeleteGuardOf(error);
    if (guard === 'storage_purchase') {
      throw new Error(
        `federated provision cleanup refused: account ${accountId} has an open storage purchase awaiting reconciliation`,
        { cause: error },
      );
    }
    if (guard === 'freehold_operation') {
      throw new FederatedProvisionFreeholdOperationOpen(accountId, { cause: error });
    }
    throw error;
  }
}
