import { describe, expect, it } from 'vitest';
import { courierLedgerRowBound } from '../server/courier_ledger_row_bound';
import { courierSlotFingerprint } from '../src/sim/courier/identity';
import type { InvSlot } from '../src/sim/types';

function mixed(count: number): InvSlot {
  return {
    itemId: 'minor_healing_potion',
    count,
    materialSources: Array.from({ length: count }, (_, i) => ({
      source: { signer: `Maker${String(i).padStart(3, '0')}` },
      count: 1,
    })),
  };
}

describe('courier ledger admission bound', () => {
  it('retains the historical floor for simple cargo', () => {
    expect(
      courierLedgerRowBound({
        bank: { inventory: [] },
        courier: { cargo: [mixed(2)], withdrawals: [] },
      }),
    ).toBe(24);
  });
  it('counts both legs and visits only selected bank slots', () => {
    const slot = mixed(20);
    const inventory = new Proxy([] as InvSlot[], {
      get: (_target, key) => {
        expect(key).toBe('9999');
        return slot;
      },
    });
    expect(
      courierLedgerRowBound({
        bank: { inventory },
        courier: {
          cargo: [slot],
          withdrawals: [{ index: 9999, fingerprint: courierSlotFingerprint(slot) }],
        },
      }),
    ).toBe(40);
  });
  it('ignores a stale withdrawal and reports trips exceeding the burst', () => {
    expect(
      courierLedgerRowBound({
        bank: { inventory: [mixed(20)] },
        courier: {
          cargo: [],
          withdrawals: [{ index: 0, fingerprint: 'stale' }],
        },
      }),
    ).toBe(24);
    expect(
      courierLedgerRowBound({
        bank: { inventory: [] },
        courier: {
          cargo: Array.from({ length: 7 }, () => mixed(18)),
          withdrawals: [],
        },
      }),
    ).toBe(126);
  });
});
