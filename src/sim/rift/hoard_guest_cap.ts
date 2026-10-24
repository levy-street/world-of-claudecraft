// Reconcile a live guest with the durable payout reservation made at boss clear.
// Mail and direct chest collection are both already counted in that ledger.

import { VAULT_GUEST_PAYOUTS_PER_CYCLE } from '../content/treasure_maps';

export interface VaultGuestCounter {
  worldQuestCycle: string;
  vaultGuestCycle: string;
  vaultGuestPayouts: number;
}

export function applyDurableVaultGuestPayouts(
  meta: VaultGuestCounter,
  cycle: string,
  payouts: number,
  currentCycle = meta.worldQuestCycle,
): void {
  if (!cycle || cycle !== currentCycle || !Number.isFinite(payouts)) return;
  const count = Math.min(VAULT_GUEST_PAYOUTS_PER_CYCLE, Math.max(0, Math.floor(payouts)));
  meta.vaultGuestPayouts =
    meta.vaultGuestCycle === cycle ? Math.max(meta.vaultGuestPayouts, count) : count;
  meta.vaultGuestCycle = cycle;
}
