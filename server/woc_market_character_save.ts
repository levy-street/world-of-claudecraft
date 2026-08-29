import type { CharacterState } from '../src/sim/sim';
import type { BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import type { StorageAppliedEffect } from './storage_purchase_db';

/** The character half carried through a marketplace custody transaction. */
export interface CharacterSaveArgs {
  characterId: number;
  level: number;
  state: CharacterState;
  leaseNonce: string | undefined;
  storageEffects?: readonly StorageAppliedEffect[];
  /** The exact immutable outbox prefix captured with this state. Never clone,
   *  rebuild, or filter this object: its identity is the acknowledgement key
   *  that leaves concurrent appends queued after COMMIT. */
  bankLedgerSnapshot?: BankLedgerOutboxSnapshot;
}
