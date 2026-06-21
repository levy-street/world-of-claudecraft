import { describe, expect, it } from 'vitest';
import { TIER_BPS, minStakeBase, tierForStake, tierName, tierThreshold } from '../server/realm_tiers';

// 1e9 tokens at 6 decimals = 1e15 base units.
const SUPPLY = 1_000_000_000n * 1_000_000n;

describe('realm stake tiers', () => {
  it('defaults to 1 / 5 / 10 percent of supply', () => {
    expect(TIER_BPS).toEqual({ bronze: 100, silver: 500, gold: 1000 });
    expect(tierThreshold(TIER_BPS.bronze, SUPPLY)).toBe(SUPPLY / 100n); // 1%
    expect(tierThreshold(TIER_BPS.silver, SUPPLY)).toBe(SUPPLY / 20n); // 5%
    expect(tierThreshold(TIER_BPS.gold, SUPPLY)).toBe(SUPPLY / 10n); // 10%
    expect(minStakeBase(SUPPLY)).toBe(SUPPLY / 100n);
  });

  it('maps a locked amount to the tier it qualifies for, at the boundaries', () => {
    const onePct = SUPPLY / 100n;
    expect(tierForStake(onePct - 1n, SUPPLY)).toBe(0); // just below bronze: cannot provision
    expect(tierForStake(onePct, SUPPLY)).toBe(1); // exactly bronze
    expect(tierForStake(SUPPLY / 20n - 1n, SUPPLY)).toBe(1); // between bronze and silver
    expect(tierForStake(SUPPLY / 20n, SUPPLY)).toBe(2); // silver
    expect(tierForStake(SUPPLY / 10n - 1n, SUPPLY)).toBe(2); // between silver and gold
    expect(tierForStake(SUPPLY / 10n, SUPPLY)).toBe(3); // gold
    expect(tierForStake(SUPPLY, SUPPLY)).toBe(3); // the whole supply is still gold (capped tier)
  });

  it('treats zero or nonpositive supply or amount as tier 0', () => {
    expect(tierForStake(100n, 0n)).toBe(0);
    expect(tierForStake(0n, SUPPLY)).toBe(0);
    expect(tierForStake(-5n, SUPPLY)).toBe(0);
  });

  it('names the tiers', () => {
    expect(tierName(0)).toBe('none');
    expect(tierName(1)).toBe('bronze');
    expect(tierName(2)).toBe('silver');
    expect(tierName(3)).toBe('gold');
  });

  it('handles whale-scale base units beyond Number.MAX_SAFE_INTEGER', () => {
    const bigSupply = 1_000_000_000_000n * 1_000_000n; // 1e12 tokens -> 1e18 base units
    expect(bigSupply).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(tierForStake(bigSupply / 10n, bigSupply)).toBe(3);
    expect(tierForStake(bigSupply / 100n, bigSupply)).toBe(1);
  });
});
