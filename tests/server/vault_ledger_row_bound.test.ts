// The pre-mutation ledger row bounds for the Materials Vault commands
// (server/vault_ledger_row_bound.ts). Every bound must be a TRUE upper bound
// on the rows diffVaultOp can produce for that command, because a commit whose
// rows exceed its reservation is a post-mutation failure that quarantines and
// disconnects the live session. Each case here pins the bound against the real
// diff over a fixture snapshot, so the two cannot drift apart silently.
import { describe, expect, it } from 'vitest';
import { diffVaultOp } from '../../server/bank_ledger';
import { BANK_VAULT_LEDGER_ROW_BURST } from '../../server/bank_vault_ledger_guard';
import {
  VAULT_LEDGER_ROW_BOUND_MAX,
  vaultDepositAllLedgerRowBound,
  vaultDepositLedgerRowBound,
  vaultLedgerKeyCount,
  vaultWithdrawLedgerRowBound,
} from '../../server/vault_ledger_row_bound';
import {
  canonicalMaterialComposition,
  type MaterialComposition,
  type MaterialSource,
} from '../../src/sim/material_sources';
import type { InvSlot } from '../../src/sim/types';
import type { VaultInfo } from '../../src/world_api';

const ana: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const bob: MaterialSource = { gatherer: { kind: 'character', id: 12, name: 'Bob' } };
const signedAna: MaterialSource = { signer: 'Ana' };
const signedBob: MaterialSource = { signer: 'Bob' };

function composition(rows: readonly { source: MaterialSource; count: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const built = canonicalMaterialComposition(rows, total);
  if (!built.ok) throw new Error(`bad fixture composition: ${built.error}`);
  return built.value;
}

function slot(itemId: string, sources: MaterialComposition): InvSlot {
  return {
    itemId,
    count: sources.reduce((sum, row) => sum + row.count, 0),
    materialSources: sources,
  };
}

function info(stock: Record<string, number>, special: InvSlot[]): VaultInfo {
  return { stock, special, upgrades: 2, perMaterialCap: 80, nextUpgradeCost: 100_000 };
}

describe('vaultLedgerKeyCount', () => {
  it('counts unsigned and gatherer-only units as ONE pooled identity', () => {
    expect(vaultLedgerKeyCount([{ itemId: 'copper_ore', count: 5 }])).toBe(1);
    expect(
      vaultLedgerKeyCount([
        slot(
          'copper_ore',
          composition([
            { source: ana, count: 6 },
            { source: bob, count: 4 },
          ]),
        ),
      ]),
    ).toBe(1);
  });

  it('counts one identity per distinct premium signer beside the pooled one', () => {
    const mixed = slot(
      'copper_ore',
      composition([
        { source: ana, count: 3 },
        { source: signedAna, count: 2 },
        { source: signedBob, count: 1 },
      ]),
    );
    expect(vaultLedgerKeyCount([mixed])).toBe(3);
  });

  it('merges the same identity across stacks and separates materials', () => {
    const a = slot('copper_ore', composition([{ source: signedAna, count: 2 }]));
    const b = slot('copper_ore', composition([{ source: signedAna, count: 7 }]));
    const c = slot('iron_ore', composition([{ source: signedAna, count: 7 }]));
    expect(vaultLedgerKeyCount([a, b])).toBe(1);
    expect(vaultLedgerKeyCount([a, b, c])).toBe(2);
  });
});

describe('vaultDepositLedgerRowBound', () => {
  it('bounds a missing slot to the one row the table reserves', () => {
    expect(vaultDepositLedgerRowBound(undefined)).toBe(1);
  });

  it('is never below the rows the deposit diff really writes', () => {
    const mixed = slot(
      'copper_ore',
      composition([
        { source: ana, count: 6 },
        { source: signedAna, count: 4 },
      ]),
    );
    const before = info({ copper_ore: 10 }, []);
    // The deposit folds the compact 10 into the identity row beside the arriving
    // buckets: pooled 16 (null identity) and signed 4.
    const after = info({}, [
      slot(
        'copper_ore',
        composition([
          { source: {}, count: 10 },
          { source: ana, count: 6 },
          { source: signedAna, count: 4 },
        ]),
      ),
    ]);
    const rows = diffVaultOp('deposit', before, after);
    expect(rows).toHaveLength(2);
    expect(vaultDepositLedgerRowBound(mixed)).toBe(2);
    expect(vaultDepositLedgerRowBound(mixed)).toBeGreaterThanOrEqual(rows.length);
  });
});

describe('vaultWithdrawLedgerRowBound', () => {
  const row = slot(
    'copper_ore',
    composition([
      { source: {}, count: 10 },
      { source: signedAna, count: 4 },
      { source: signedBob, count: 6 },
    ]),
  );
  const before = info({ iron_ore: 3 }, [row]);

  it('bounds a compact withdrawal to one row', () => {
    expect(vaultWithdrawLedgerRowBound(before, 'iron_ore', undefined)).toBe(1);
    expect(vaultWithdrawLedgerRowBound(null, 'iron_ore', { index: 0 })).toBe(1);
  });

  it('bounds an identity-row withdrawal to the distinct identities of that row', () => {
    const after = info({ iron_ore: 3 }, []);
    const rows = diffVaultOp('withdraw', before, after);
    expect(rows).toHaveLength(3);
    expect(vaultWithdrawLedgerRowBound(before, 'copper_ore', { index: 0 })).toBe(3);
  });

  it('recovers a stale index by fingerprint and bounds a miss to one', () => {
    const shifted = info({}, [{ itemId: 'iron_ore', count: 1, craftedRecipeId: 'r' }, row]);
    expect(vaultWithdrawLedgerRowBound(shifted, 'copper_ore', { index: 0 })).toBe(3);
    expect(
      vaultWithdrawLedgerRowBound(shifted, 'copper_ore', { index: 5, craftedRecipeId: 'x' }),
    ).toBe(1);
  });
});

describe('vaultDepositAllLedgerRowBound', () => {
  it('counts distinct keys over depositable material stacks only', () => {
    const inventory: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'copper_ore', count: 20 },
      slot('copper_ore', composition([{ source: signedAna, count: 5 }])),
      slot(
        'copper_ore',
        composition([
          { source: signedAna, count: 5 },
          { source: ana, count: 5 },
        ]),
      ),
      slot('iron_ore', composition([{ source: signedBob, count: 5 }])),
    ];
    // copper pooled, copper/Ana, iron/Bob.
    expect(vaultDepositAllLedgerRowBound(inventory)).toBe(3);
    expect(vaultDepositAllLedgerRowBound([])).toBe(1);
  });
});

describe('VAULT_LEDGER_ROW_BOUND_MAX', () => {
  it('is the account row burst the guard can reserve at most', () => {
    expect(VAULT_LEDGER_ROW_BOUND_MAX).toBe(BANK_VAULT_LEDGER_ROW_BURST);
    expect(VAULT_LEDGER_ROW_BOUND_MAX).toBe(121);
  });
});
