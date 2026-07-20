import { describe, expect, it } from 'vitest';
import {
  ALL_VENDORS,
  DEFAULT_VENDOR_POLICIES,
  effectiveCapacityUsd,
  keyShapeError,
  tierFromStreak,
} from '@/lib/vendors/config';

const CAPS = { newUsd: 2, establishedUsd: 25 };

describe('trust tiers', () => {
  it('is a pure function of the healthy-day streak', () => {
    expect(tierFromStreak(0)).toBe('NEW');
    expect(tierFromStreak(6)).toBe('NEW');
    expect(tierFromStreak(7)).toBe('ESTABLISHED');
    expect(tierFromStreak(29)).toBe('ESTABLISHED');
    expect(tierFromStreak(30)).toBe('TRUSTED');
  });

  it('caps routable budget by tier when the ramp is enabled', () => {
    expect(effectiveCapacityUsd(1000, 'NEW', true, CAPS)).toBe(2);
    expect(effectiveCapacityUsd(1000, 'ESTABLISHED', true, CAPS)).toBe(25);
    expect(effectiveCapacityUsd(1000, 'TRUSTED', true, CAPS)).toBe(1000);
    // Declared below the cap: declared wins.
    expect(effectiveCapacityUsd(0.5, 'NEW', true, CAPS)).toBe(0.5);
  });

  it('ramp-exempt vendors (stake-backed) always route their declared capacity', () => {
    expect(effectiveCapacityUsd(1000, 'NEW', false, CAPS)).toBe(1000);
  });
});

describe('vendor policy defaults (economic invariants)', () => {
  it('only stake-backed Venice earns standby on unused capacity', () => {
    expect(DEFAULT_VENDOR_POLICIES.venice.standbyEligible).toBe(true);
    for (const vendor of ALL_VENDORS.filter((v) => v !== 'venice')) {
      // A free-to-declare BYOK budget must never mint standby Claudium.
      expect(DEFAULT_VENDOR_POLICIES[vendor].standbyEligible).toBe(false);
    }
  });

  it('BYOK rewards vest (fraud window); Venice vests instantly', () => {
    expect(DEFAULT_VENDOR_POLICIES.venice.vestingDays).toBe(0);
    for (const vendor of ALL_VENDORS.filter((v) => v !== 'venice')) {
      expect(DEFAULT_VENDOR_POLICIES[vendor].vestingDays).toBeGreaterThan(0);
    }
  });

  it('the trust ramp applies exactly to real-money vendors', () => {
    expect(DEFAULT_VENDOR_POLICIES.venice.trustRampEnabled).toBe(false);
    for (const vendor of ALL_VENDORS.filter((v) => v !== 'venice')) {
      expect(DEFAULT_VENDOR_POLICIES[vendor].trustRampEnabled).toBe(true);
    }
  });
});

describe('key shape sanity', () => {
  it('routes obvious cross-vendor paste mistakes to a clear error', () => {
    expect(keyShapeError('anthropic', 'sk-ant-abc123')).toBeNull();
    expect(keyShapeError('anthropic', 'sk-abc123')).toMatch(/sk-ant-/);
    expect(keyShapeError('openai', 'sk-abc123')).toBeNull();
    expect(keyShapeError('openai', 'sk-ant-abc123')).toMatch(/Anthropic key/);
    expect(keyShapeError('openai', 'vn_abc')).toMatch(/sk-/);
    expect(keyShapeError('kimi', 'sk-abc123')).toBeNull();
    expect(keyShapeError('kimi', 'nope')).toMatch(/sk-/);
    expect(keyShapeError('venice', 'anything-goes-here')).toBeNull();
  });
});
