// A targeted bank move can change at most the effective maker identities in
// its source slot. Partial transfers reserve the whole slot and refund unused
// rows after the exact diff commits. No per-unit expansion or database read.
import type { InvSlot } from '../src/sim/types';
import { personalBankSourceProjection } from './personal_bank_source_projection';

export function personalBankLedgerRowBound(slot: InvSlot | undefined): number {
  return slot ? Math.max(1, personalBankSourceProjection(slot).length) : 1;
}
