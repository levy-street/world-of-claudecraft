import { describe, expect, it } from 'vitest';
import {
  parseEngagementConfig,
  spinSettleReady,
  policyPermits,
  solToLamports,
  LAMPORTS_PER_SOL,
  PACK_POWER_POLICIES,
} from '../server/engagement_config';

describe('parseEngagementConfig', () => {
  it('applies safe defaults for an empty environment', () => {
    const c = parseEngagementConfig({});
    expect(c.spinEnabled).toBe(false);
    expect(c.packsEnabled).toBe(false);
    expect(c.spinMinWoc).toBe(1000);
    expect(c.packPowerPolicy).toBe('cosmetic');
    expect(c.spinVaultProgramId).toBe('');
    expect(c.spinSettlerSecret).toBe('');
    expect(c.spinMaxPayoutLamports).toBe(100_000_000n);
    expect(c.spinDailyBudgetLamports).toBe(5_000_000_000n);
  });

  it('parses the documented boolean spellings (1/true/yes/on, case-insensitive)', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'On', ' on ']) {
      expect(parseEngagementConfig({ SPIN_ENABLED: truthy }).spinEnabled).toBe(true);
    }
    for (const falsy of ['0', 'false', 'no', 'off', '', 'banana']) {
      expect(parseEngagementConfig({ SPIN_ENABLED: falsy }).spinEnabled).toBe(false);
    }
  });

  it('parses SPIN_MIN_WOC and rejects negatives / non-numbers back to default', () => {
    expect(parseEngagementConfig({ SPIN_MIN_WOC: '2500' }).spinMinWoc).toBe(2500);
    expect(parseEngagementConfig({ SPIN_MIN_WOC: '0' }).spinMinWoc).toBe(0);
    expect(parseEngagementConfig({ SPIN_MIN_WOC: '-5' }).spinMinWoc).toBe(1000);
    expect(parseEngagementConfig({ SPIN_MIN_WOC: 'abc' }).spinMinWoc).toBe(1000);
  });

  it('accepts every valid PACK_POWER_POLICY and falls back on garbage', () => {
    for (const p of PACK_POWER_POLICIES) {
      expect(parseEngagementConfig({ PACK_POWER_POLICY: p }).packPowerPolicy).toBe(p);
    }
    expect(parseEngagementConfig({ PACK_POWER_POLICY: 'OPEN' }).packPowerPolicy).toBe('open');
    expect(parseEngagementConfig({ PACK_POWER_POLICY: '  Seasonal ' }).packPowerPolicy).toBe('seasonal');
    expect(parseEngagementConfig({ PACK_POWER_POLICY: 'wildwest' }).packPowerPolicy).toBe('cosmetic');
  });

  it('parses lamport bigints and rejects non-digits back to default', () => {
    expect(parseEngagementConfig({ SPIN_MAX_PAYOUT_LAMPORTS: '250000000' }).spinMaxPayoutLamports).toBe(250_000_000n);
    expect(parseEngagementConfig({ SPIN_MAX_PAYOUT_LAMPORTS: '0' }).spinMaxPayoutLamports).toBe(0n);
    expect(parseEngagementConfig({ SPIN_MAX_PAYOUT_LAMPORTS: '0.5' }).spinMaxPayoutLamports).toBe(100_000_000n);
    expect(parseEngagementConfig({ SPIN_MAX_PAYOUT_LAMPORTS: '-1' }).spinMaxPayoutLamports).toBe(100_000_000n);
    expect(parseEngagementConfig({ SPIN_MAX_PAYOUT_LAMPORTS: 'lots' }).spinMaxPayoutLamports).toBe(100_000_000n);
  });

  it('trims whitespace from the program id and settler secret', () => {
    const c = parseEngagementConfig({ SPIN_VAULT_PROGRAM_ID: '  Prog111  ', SPIN_SETTLER_SECRET: ' sk \n' });
    expect(c.spinVaultProgramId).toBe('Prog111');
    expect(c.spinSettlerSecret).toBe('sk');
  });
});

describe('spinSettleReady', () => {
  it('requires the flag, a program id, and a settler secret', () => {
    const base = parseEngagementConfig({});
    expect(spinSettleReady(base)).toBe(false);
    expect(spinSettleReady({ ...base, spinEnabled: true })).toBe(false);
    expect(spinSettleReady({ ...base, spinEnabled: true, spinVaultProgramId: 'P' })).toBe(false);
    expect(spinSettleReady({ ...base, spinEnabled: true, spinVaultProgramId: 'P', spinSettlerSecret: 'S' })).toBe(true);
    // Flag off blocks settle even when fully provisioned.
    expect(spinSettleReady({ ...base, spinVaultProgramId: 'P', spinSettlerSecret: 'S' })).toBe(false);
  });
});

describe('policyPermits', () => {
  it('a stricter realm forbids more permissive rewards; a looser realm permits all below it', () => {
    expect(policyPermits('cosmetic', 'cosmetic')).toBe(true);
    expect(policyPermits('cosmetic', 'seasonal')).toBe(false);
    expect(policyPermits('cosmetic', 'open')).toBe(false);
    expect(policyPermits('seasonal', 'cosmetic')).toBe(true);
    expect(policyPermits('seasonal', 'seasonal')).toBe(true);
    expect(policyPermits('seasonal', 'open')).toBe(false);
    expect(policyPermits('open', 'cosmetic')).toBe(true);
    expect(policyPermits('open', 'seasonal')).toBe(true);
    expect(policyPermits('open', 'open')).toBe(true);
  });
});

describe('solToLamports', () => {
  it('converts whole and fractional SOL exactly at lamport resolution', () => {
    expect(solToLamports(1)).toBe(LAMPORTS_PER_SOL);
    expect(solToLamports(0)).toBe(0n);
    expect(solToLamports(0.001)).toBe(1_000_000n);
    expect(solToLamports(0.1)).toBe(100_000_000n);
    expect(solToLamports(2.5)).toBe(2_500_000_000n);
  });

  it('clamps invalid input to zero rather than throwing', () => {
    expect(solToLamports(-1)).toBe(0n);
    expect(solToLamports(Number.NaN)).toBe(0n);
    expect(solToLamports(Number.POSITIVE_INFINITY)).toBe(0n);
  });
});
