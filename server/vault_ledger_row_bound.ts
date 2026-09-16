// Pre-mutation ledger row bounds for the Materials Vault commands.
//
// A vault command reserves its worst-case bank_ledger row count BEFORE the Sim
// mutates (server/vault_wire.ts reserveLedgerRows), and the exact rows are
// derived afterwards by diffing vaultInfoFor. A commit whose rows exceed the
// reservation is a post-mutation projection failure, which the live host
// treats as terminal: the session is quarantined and disconnected (game.ts
// quarantineBankLedgerProjection). So the reservation MUST be a true upper
// bound on the rows the diff can produce, or a legal command kicks its player.
//
// The count ledger keys a vault row per (itemId, identity), where the identity
// is the EFFECTIVE payload of one source bucket: the row's instance payload
// plus that bucket's legacy premium `signer` (bank_ledger.ts
// vaultCountGroups). Since carried material stacks combine while preserving
// their per-unit sources, ONE stack can hold units signed by several crafters
// beside unsigned units, and a single deposit or withdrawal of that stack
// diffs into one row per distinct identity. The fixed one-row table entry
// (bank_vault_ledger_guard.ts COMMAND_MAX_ROWS) was written when a stack could
// carry at most one payload; these bounds restore the invariant by counting
// the distinct ledger keys the command's own stack (or, for the sweep, the
// whole carried inventory) can touch, read from the SAME grouping the diff
// uses so the two cannot drift.
//
// THE BOUND RESTS ON LOSSLESS BUCKET MERGING. A deposit that joins an existing
// identity row can only change the keys the arriving stack itself carries
// because src/sim/material_sources.ts coalesces buckets by identical descriptor
// and refuses (count-overflow) rather than collapsing distinct buckets into
// the unattributed one. A future bucket CAP that spilled a signer bucket into
// the null identity would add an unbudgeted row on deposit and re-open the
// kick; tests/server/vault_ledger_row_bound.test.ts pins rows <= bound over
// randomized stacks so such a change reds there first.
//
// Every function here is a pure read over boundary snapshots: nothing is
// mutated and no rng is drawn.

import {
  isVaultDepositableSlot,
  resolveVaultSpecialIndex,
  vaultMaterialIds,
} from '../src/sim/materials_vault';
import type { InvSlot } from '../src/sim/types';
import type { VaultInfo, VaultSpecialRef } from '../src/world_api';
import { vaultCountGroups } from './bank_ledger';
import { BANK_VAULT_LEDGER_ROW_BURST } from './bank_vault_ledger_guard';

/** A carried or stored material row as the ledger diff sees it: the InvSlot
 *  fields minus the advisory bag cell. */
type LedgerSlot = VaultInfo['special'][number];

/** The most rows a vault command may ever reserve: the account row burst,
 *  above which the guard refuses to reserve at all. A command whose bound
 *  exceeds this is refused BEFORE mutation (the "You are busy." line) rather
 *  than allowed to mutate and then fail its commit. */
export const VAULT_LEDGER_ROW_BOUND_MAX = BANK_VAULT_LEDGER_ROW_BURST;

/** Distinct (itemId, identity) ledger keys across `slots`: exactly the key
 *  space bank_ledger.ts vaultMultiset builds for a diff, so the row count a
 *  diff over these slots can produce is at most this number. */
export function vaultLedgerKeyCount(slots: readonly LedgerSlot[]): number {
  const keys = new Set<string>();
  for (const slot of slots) {
    for (const group of vaultCountGroups(slot)) {
      keys.add(JSON.stringify([slot.itemId, group.identity]));
    }
  }
  return keys.size;
}

function atLeastOne(count: number): number {
  return Math.max(1, count);
}

/** Rows one targeted deposit of `slot` can write: one per distinct identity
 *  the carried stack holds. A missing slot (an out-of-range index the Sim will
 *  refuse) bounds to the single row the table always reserved. The fold of
 *  compact stock into an identity row moves unrecorded units between two
 *  representations that share the null identity, so it never adds a row. */
export function vaultDepositLedgerRowBound(slot: InvSlot | undefined): number {
  if (!slot) return 1;
  return atLeastOne(vaultLedgerKeyCount([slot]));
}

/** Rows the deposit-all sweep can write: one per distinct (itemId, identity)
 *  key across every carried stack the sweep would consider. Two stacks of the
 *  same material signed by the same crafter share one key, so this is usually
 *  far below the slot count. */
export function vaultDepositAllLedgerRowBound(inventory: readonly InvSlot[]): number {
  const materials = vaultMaterialIds();
  return atLeastOne(
    vaultLedgerKeyCount(inventory.filter((slot) => isVaultDepositableSlot(slot, materials))),
  );
}

/** Rows one withdrawal can write. A compact (pooled) withdrawal moves the one
 *  null-identity key. An identity-row withdrawal resolves its target row on
 *  the pre-mutation snapshot with the SAME selector rule the Sim applies and
 *  bounds to that row's distinct identities; a selector the Sim will not
 *  resolve is a no-op that writes nothing, so it bounds to one. */
export function vaultWithdrawLedgerRowBound(
  before: VaultInfo | null,
  itemId: string,
  special: VaultSpecialRef | undefined,
): number {
  if (special === undefined || before === null) return 1;
  const index = resolveVaultSpecialIndex(before.special, itemId, special);
  if (index < 0) return 1;
  return atLeastOne(vaultLedgerKeyCount([before.special[index]]));
}
