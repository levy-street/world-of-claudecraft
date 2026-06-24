import { describe, expect, it } from 'vitest';
import { rewardToBase, escrowCurrencyInfo, isEscrowCurrency, jobPda } from '../server/job_escrow';

describe('rewardToBase', () => {
  it('converts human reward amounts to exact base units', () => {
    expect(rewardToBase(1, 6)).toBe(1_000_000n);
    expect(rewardToBase(1.5, 6)).toBe(1_500_000n);
    expect(rewardToBase(0.000001, 6)).toBe(1n);
  });
  it('does not lose precision on large amounts', () => {
    expect(rewardToBase(12345678.123456, 6)).toBe(12_345_678_123_456n);
  });
  it('returns 0 for non-positive or invalid input (caller rejects 0)', () => {
    expect(rewardToBase(0, 6)).toBe(0n);
    expect(rewardToBase(-5, 6)).toBe(0n);
    expect(rewardToBase(NaN, 6)).toBe(0n);
  });
});

describe('escrow currency mapping', () => {
  it('maps WOC and USDC to their mints (both 6 decimals)', () => {
    expect(escrowCurrencyInfo('WOC').decimals).toBe(6);
    expect(escrowCurrencyInfo('USDC').decimals).toBe(6);
    expect(escrowCurrencyInfo('WOC').mint).not.toBe(escrowCurrencyInfo('USDC').mint);
  });
  it('only accepts the two escrowable currencies', () => {
    expect(isEscrowCurrency('WOC')).toBe(true);
    expect(isEscrowCurrency('USDC')).toBe(true);
    expect(isEscrowCurrency('SOL')).toBe(false); // SOL escrow needs wSOL — not v1
    expect(isEscrowCurrency('')).toBe(false);
    expect(isEscrowCurrency(null)).toBe(false);
  });
});

describe('jobPda', () => {
  it('derives a deterministic program address per job id', () => {
    const a = jobPda(1n).toBase58();
    const b = jobPda(1n).toBase58();
    const c = jobPda(2n).toBase58();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeGreaterThanOrEqual(32); // a real base58 pubkey
  });
});
