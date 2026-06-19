import { describe, expect, it } from 'vitest';
import {
  HOLDER_TIERS, WOC_MAX_SUPPLY, holderTierForBalance, holderTierByIndex,
  tierSupplyShare, holderTierBadgeDataUrl,
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

  it('rejects non-finite and negative balances as null', () => {
    expect(holderTierForBalance(Number.POSITIVE_INFINITY)).toBeNull();
    expect(holderTierForBalance(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(holderTierForBalance(-5)).toBeNull();
  });

  it('treats each threshold as inclusive and just-below as the rung beneath', () => {
    // Exactly at a threshold maps up to that rung…
    expect(holderTierForBalance(1)!.name).toBe('Ember');
    expect(holderTierForBalance(10)!.name).toBe('Coinbearer');
    expect(holderTierForBalance(1_000)!.name).toBe('Silverbound');
    // …and a hair below stays on the rung beneath (or null below the first).
    expect(holderTierForBalance(0.99)).toBeNull();
    expect(holderTierForBalance(9.99)!.name).toBe('Ember');
    expect(holderTierForBalance(999.99)!.name).toBe('Coppercrest');
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

  it('looks up rungs by 1-based index and returns undefined out of range', () => {
    // In range: index n returns the rung whose .index === n.
    const ember = holderTierByIndex(1);
    expect(ember).toBeDefined();
    expect(ember!.name).toBe('Ember');
    expect(ember!.index).toBe(1);

    const gilded = holderTierByIndex(5);
    expect(gilded!.name).toBe('Gilded');
    expect(gilded!.index).toBe(5);

    const sovereign = holderTierByIndex(10);
    expect(sovereign!.name).toBe('Sovereign');
    expect(sovereign!.index).toBe(10);

    // Out of range / zero / negative.
    expect(holderTierByIndex(0)).toBeUndefined();
    expect(holderTierByIndex(11)).toBeUndefined();
    expect(holderTierByIndex(-1)).toBeUndefined();
  });

  it('returns undefined for a non-integer index even within the 1-10 span', () => {
    // 1.5 sits inside the inclusive bounds but addresses no rung.
    expect(holderTierByIndex(1.5)).toBeUndefined();
    expect(holderTierByIndex(9.5)).toBeUndefined();
  });

  it('round-trips every rung through holderTierByIndex by its own index', () => {
    for (const t of HOLDER_TIERS) {
      expect(holderTierByIndex(t.index)).toBe(t);
    }
  });

  it('builds a decodable SVG badge embedding the ring colour for all ten rungs', () => {
    expect(HOLDER_TIERS.length).toBe(10);
    for (const t of HOLDER_TIERS) {
      const url = holderTierBadgeDataUrl(t);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg');
      expect(svg).toContain(`stop-color="${t.ring}"`);
    }
  });
});
