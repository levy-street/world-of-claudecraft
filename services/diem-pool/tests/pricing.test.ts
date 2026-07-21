import { describe, expect, it } from 'vitest';
import { computeCostUsd, FALLBACK_RATE, SEED_CLASS_MAP, SEED_PRICING_BY_VENDOR } from '@/lib/pricing';

describe('computeCostUsd', () => {
  it('prices per-1M-token rates exactly', () => {
    // 1M input at $0.70 + 1M output at $2.80 = $3.50
    const rate = { inputUsdPerMTokens: 0.7, outputUsdPerMTokens: 2.8 };
    expect(computeCostUsd(rate, 1_000_000, 1_000_000)).toBe(3.5);
  });

  it('handles small calls without float drift (micro-USD integer math)', () => {
    const rate = { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 };
    // 100 prompt tokens = 15 micro-USD, 20 completion = 12 micro-USD
    expect(computeCostUsd(rate, 100, 20)).toBe(0.000027);
  });

  it('rounds fractional micro-USD up (never under-meters)', () => {
    const rate = { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 };
    // 1 prompt token = 0.15 micro-USD → ceil to 1 micro-USD
    expect(computeCostUsd(rate, 1, 0)).toBe(0.000001);
  });

  it('zero tokens cost zero; negative counts throw', () => {
    expect(computeCostUsd(FALLBACK_RATE, 0, 0)).toBe(0);
    expect(() => computeCostUsd(FALLBACK_RATE, -1, 0)).toThrow();
  });

  it('fallback rate is at least as expensive as every seeded model, all vendors', () => {
    for (const models of Object.values(SEED_PRICING_BY_VENDOR)) {
      for (const rate of Object.values(models)) {
        expect(FALLBACK_RATE.inputUsdPerMTokens).toBeGreaterThanOrEqual(rate.inputUsdPerMTokens);
        expect(FALLBACK_RATE.outputUsdPerMTokens).toBeGreaterThanOrEqual(rate.outputUsdPerMTokens);
      }
    }
  });

  it('every seeded class mapping has seeded pricing for its concrete model', () => {
    for (const row of SEED_CLASS_MAP) {
      expect(
        SEED_PRICING_BY_VENDOR[row.vendor]?.[row.model],
        `${row.vendor}:${row.model} (${row.class})`,
      ).toBeDefined();
    }
  });
});
