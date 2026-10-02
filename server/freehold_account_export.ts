// THE ACCOUNT EXPORT'S HOUSING SECTION (exportAccountData in server/db.ts), as
// ONE loader so db.ts carries one line for every housing table there is.
// Housing lives in its own normalized tables that the characters.state
// projector cannot reach, and most of them are keep-forever, so this export is
// the only readback an owner has.
//
// EVERY READ IS AN ALLOWLIST AND EVERY KEEP-FOREVER READ IS BOUNDED (the
// touch-set manifest's section 9): the claim holder (a per-boot process id), the
// fencing generation, the write and advance tokens, the operation fingerprint
// and the fence generation are server internals and never leave the server;
// operation ids appear here, and only here, because they are the owner's own
// records. The keys keep 07's `freeholds` and `freeholdHearth` and add three.
import type { Pool } from 'pg';
import { freeholdClaimsForExport } from './freehold_claim_db';
import { freeholdsForExport } from './freehold_db';
import { freeholdHearthForExport } from './freehold_hearth_db';
import { freeholdOperationsForExport } from './freehold_operation_db';

export interface FreeholdAccountExport {
  readonly freeholds: Awaited<ReturnType<typeof freeholdsForExport>>;
  readonly freeholdHearth: Awaited<ReturnType<typeof freeholdHearthForExport>>;
  readonly freeholdClaims: unknown[];
  readonly freeholdOperations: unknown[];
  readonly freeholdOperationReceipts: unknown[];
}

/** Every read on ONE checked-out client, in sequence: an export in a brownout
 *  queues for a pool client once, not once per read. No transaction: each read
 *  is its own bounded allowlist, as before. */
export async function freeholdAccountExport(
  pool: Pick<Pool, 'connect'>,
  accountId: number,
): Promise<FreeholdAccountExport> {
  const client = await pool.connect();
  try {
    const freeholds = await freeholdsForExport(client, accountId);
    const freeholdHearth = await freeholdHearthForExport(client, accountId);
    const freeholdClaims = await freeholdClaimsForExport(client, accountId);
    const operations = await freeholdOperationsForExport(client, accountId);
    return {
      freeholds,
      freeholdHearth,
      freeholdClaims,
      freeholdOperations: operations.intents,
      freeholdOperationReceipts: operations.receipts,
    };
  } finally {
    client.release();
  }
}
