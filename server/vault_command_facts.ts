// Only actual moved facts are fed to the existing identity grouper/differ.
// These ephemeral inputs never enter a player snapshot or a persisted field.
import type { VaultCommandFacts } from '../src/sim/materials_vault';
import type { VaultInfo } from '../src/world_api';

export function vaultCommandLedgerSnapshots(
  facts: VaultCommandFacts | undefined,
  op: 'deposit' | 'withdraw' | 'buy_slots',
): {
  before: VaultInfo | null;
  after: VaultInfo | null;
} {
  if (facts === undefined) return { before: null, after: null };
  const empty: VaultInfo = {
    stock: {},
    special: [],
    upgrades: facts.upgrades,
    perMaterialCap: 0,
    nextUpgradeCost: null,
  };
  if (facts.kind === 'upgrade') {
    if (op !== 'buy_slots') throw new Error('Unexpected vault upgrade facts');
    return {
      before: { ...empty, upgrades: facts.upgrades - 1, nextUpgradeCost: facts.price },
      after: empty,
    };
  }
  if (op === 'buy_slots') throw new Error('Unexpected vault movement facts');
  const moved = { ...empty, special: [...facts.slots] };
  return op === 'withdraw' ? { before: moved, after: empty } : { before: empty, after: moved };
}
