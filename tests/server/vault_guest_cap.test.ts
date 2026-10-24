import { describe, expect, it } from 'vitest';
import { applyDurableVaultGuestPayouts } from '../../src/sim/rift/hoard_guest_cap';

describe('durable vault guest allowance', () => {
  it('adopts mail-backed payouts without double-counting saved direct claims', () => {
    const guest = { worldQuestCycle: 'wq1_10', vaultGuestCycle: 'wq1_10', vaultGuestPayouts: 1 };
    applyDurableVaultGuestPayouts(guest, 'wq1_10', 3);
    expect(guest.vaultGuestPayouts).toBe(3);
    applyDurableVaultGuestPayouts(guest, 'wq1_10', 2);
    expect(guest.vaultGuestPayouts).toBe(3);
  });

  it('keeps a new cycle separate from yesterday and caps malformed usage', () => {
    const guest = { worldQuestCycle: 'wq1_11', vaultGuestCycle: 'wq1_10', vaultGuestPayouts: 3 };
    applyDurableVaultGuestPayouts(guest, 'wq1_11', 1);
    expect(guest).toMatchObject({ vaultGuestCycle: 'wq1_11', vaultGuestPayouts: 1 });
    applyDurableVaultGuestPayouts(guest, 'wq1_10', 3);
    expect(guest.vaultGuestPayouts).toBe(1);
    applyDurableVaultGuestPayouts(guest, 'wq1_11', 500);
    expect(guest.vaultGuestPayouts).toBe(3);
  });
});
