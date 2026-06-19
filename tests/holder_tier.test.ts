import { describe, expect, it } from 'vitest';
import {
  HOLDER_TIERS, WOC_MAX_SUPPLY, holderTierForBalance, tierSupplyShare, holderTierBadgeDataUrl,
} from '../src/ui/holder_tier';

describe('holder-tier ladder', () => {
  it('has ten rungs with strictly increasing 10× thresholds and 1-based indexes', () => {
    expect(HOLDER_TIERS.length).toBe(10);
    expect(WOC_MAX_SUPPLY).toBe(1_000_000_000);
    for (let i = 0; i < HOLDER_TIERS.length; i++) {
      expect(HOLDER_TIERS[i].index).toBe(i + 1);
      if (i > 0) expect(HOLDER_TIERS[i].threshold).toBeGreaterThan(HOLDER_TIERS[i - 1].threshold);
    }
    expect(HOLDER_TIERS[0].threshold).toBe(1);
    expect(HOLDER_TIERS[9].threshold).toBe(WOC_MAX_SUPPLY);
  });

  it('returns null with no wallet or a sub-threshold balance', () => {
    expect(holderTierForBalance(null)).toBeNull();
    expect(holderTierForBalance(0)).toBeNull();
    expect(holderTierForBalance(0.99)).toBeNull();
    expect(holderTierForBalance(Number.NaN)).toBeNull();
  });

  it('maps balances to the highest qualifying rung', () => {
    expect(holderTierForBalance(1)!.name).toBe('Ember');
    expect(holderTierForBalance(9)!.name).toBe('Ember');
    expect(holderTierForBalance(10)!.name).toBe('Coinbearer');
    expect(holderTierForBalance(100)!.name).toBe('Coppercrest');
    expect(holderTierForBalance(1_000)!.name).toBe('Silverbound');
    expect(holderTierForBalance(10_000)!.name).toBe('Gilded');
    expect(holderTierForBalance(100_000)!.name).toBe('Vaultwarden');
    expect(holderTierForBalance(1_000_000)!.name).toBe('Whale');
    expect(holderTierForBalance(10_000_000)!.name).toBe('Leviathan');
    expect(holderTierForBalance(100_000_000)!.name).toBe('Worldbearer');
    expect(holderTierForBalance(1_000_000_000)!.name).toBe('Sovereign');
  });

  it('clamps balances above max supply to the top rung', () => {
    expect(holderTierForBalance(5_000_000_000)!.name).toBe('Sovereign');
  });

  it('reports supply share', () => {
    const sovereign = HOLDER_TIERS[9];
    const vaultwarden = HOLDER_TIERS[5];
    expect(tierSupplyShare(sovereign)).toBe(1);
    expect(tierSupplyShare(vaultwarden)).toBeCloseTo(0.0001, 10);
  });

  it('builds an SVG data URL embedding the rung ring colour', () => {
    const ember = HOLDER_TIERS[0];
    const url = holderTierBadgeDataUrl(ember);
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain(ember.ring);
    expect(decodeURIComponent(url)).toContain('<svg');
  });

  it('embeds both gradient stops, the radial gradient, and the glyph for a tier whose glow differs from its ring', () => {
    const sovereign = HOLDER_TIERS[9];
    // Guard the premise: this assertion only proves the glow stop is present
    // if glow is a distinct colour from ring.
    expect(sovereign.glow).not.toBe(sovereign.ring);
    const svg = decodeURIComponent(holderTierBadgeDataUrl(sovereign));
    expect(svg).toContain(sovereign.ring);
    expect(svg).toContain(sovereign.glow);
    expect(svg).toContain('radialGradient');
    expect(svg).toContain(sovereign.glyph);
  });

  it('computes each rung supply share as its own threshold over 1e9', () => {
    for (const t of HOLDER_TIERS) {
      expect(tierSupplyShare(t)).toBeCloseTo(t.threshold / 1_000_000_000);
    }
  });
});
