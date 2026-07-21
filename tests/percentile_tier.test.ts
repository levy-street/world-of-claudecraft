import { describe, expect, it } from 'vitest';
import {
  PERCENTILE_TIERS, PERCENTILE_TIER_MAX, percentileTierForPercent,
  percentileTierBadgeDataUrl, percentileRarityStyle,
} from '../src/ui/percentile_tier';

describe('percentile-tier ladder', () => {
  it('has one rung per whole percent from Top 1% to Top 10%', () => {
    expect(PERCENTILE_TIERS).toHaveLength(10);
    expect(PERCENTILE_TIER_MAX).toBe(10);
    PERCENTILE_TIERS.forEach((tier, i) => {
      expect(tier.percent).toBe(i + 1);
      expect(tier.key).toBe(`top${i + 1}`);
      expect(tier.ring).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tier.glow).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('gives every rung a distinct key and ring colour (ten readable medals)', () => {
    expect(new Set(PERCENTILE_TIERS.map((t) => t.key)).size).toBe(10);
    expect(new Set(PERCENTILE_TIERS.map((t) => t.ring)).size).toBe(10);
  });

  it('grades rarity from legendary at the apex down to common at the floor', () => {
    const byPercent = (p: number) => PERCENTILE_TIERS.find((t) => t.percent === p)!.rarity;
    expect(byPercent(1)).toBe('legendary');
    expect(byPercent(2)).toBe('epic');
    expect(byPercent(3)).toBe('epic');
    expect([4, 5, 6].map(byPercent)).toEqual(['rare', 'rare', 'rare']);
    expect([7, 8].map(byPercent)).toEqual(['uncommon', 'uncommon']);
    expect([9, 10].map(byPercent)).toEqual(['common', 'common']);
  });
});

describe('percentileRarityStyle', () => {
  it('glows only for the rarer grades, with the sunburst reserved for the legendary apex', () => {
    expect(percentileRarityStyle('legendary').halo).toBeGreaterThan(0);
    expect(percentileRarityStyle('legendary').rays).toBe(true);
    expect(percentileRarityStyle('epic').halo).toBeGreaterThan(0);
    expect(percentileRarityStyle('epic').rays).toBe(false);
    expect(percentileRarityStyle('rare').halo).toBeGreaterThan(0);
    expect(percentileRarityStyle('rare').rays).toBe(false);
    // Uncommon/common are plain medals — no halo, no rays.
    expect(percentileRarityStyle('uncommon').halo).toBe(0);
    expect(percentileRarityStyle('common').halo).toBe(0);
  });
});

describe('percentileTierForPercent', () => {
  it('returns null when there is no standing or the input is not a usable number', () => {
    expect(percentileTierForPercent(null)).toBeNull();
    expect(percentileTierForPercent(0)).toBeNull();
    expect(percentileTierForPercent(-3)).toBeNull();
    expect(percentileTierForPercent(Number.NaN)).toBeNull();
    expect(percentileTierForPercent(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('buckets a raw percentile up to the ceiling whole percent', () => {
    // 3.2% sits in the Top 4% bucket; 2.0% exactly is Top 2%.
    expect(percentileTierForPercent(3.2)?.percent).toBe(4);
    expect(percentileTierForPercent(2)?.percent).toBe(2);
    expect(percentileTierForPercent(5.99)?.percent).toBe(6);
    expect(percentileTierForPercent(9.01)?.percent).toBe(10); // now within range — Top 10%
  });

  it('maps a sub-1% rank to the apex Top 1% rung', () => {
    expect(percentileTierForPercent(0.4)?.percent).toBe(1);
    expect(percentileTierForPercent(0.99)?.percent).toBe(1);
    expect(percentileTierForPercent(1)?.percent).toBe(1);
  });

  it('returns each whole-percent rung 1..10 for its exact value', () => {
    for (let p = 1; p <= 10; p++) {
      const tier = percentileTierForPercent(p);
      expect(tier?.percent).toBe(p);
      expect(tier?.key).toBe(`top${p}`);
    }
  });

  it('pins the inclusive Top 10% edge — 10 earns top10, 10.01 falls off', () => {
    expect(percentileTierForPercent(10)?.percent).toBe(10);
    expect(percentileTierForPercent(10)?.key).toBe('top10');
    expect(percentileTierForPercent(10.01)).toBeNull();
    expect(percentileTierForPercent(11)).toBeNull();
    expect(percentileTierForPercent(42)).toBeNull();
  });
});

describe('percentileTierBadgeDataUrl', () => {
  it('builds an SVG data URL embedding each rung ring colour + the laurel glyph', () => {
    for (const tier of PERCENTILE_TIERS) {
      const url = percentileTierBadgeDataUrl(tier);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url);
      expect(svg).toContain('<svg');
      expect(svg).toContain(tier.ring);
      expect(svg).toContain(tier.glow);
      expect(svg).toContain('radialGradient');
      // The disc gradient must be both defined and actually referenced by the fill,
      // or the medal renders as an unfilled/black circle while the test stays green.
      // The id is per-tier so inlined medals don't collide.
      expect(svg).toContain(`id="g${tier.key}"`);
      expect(svg).toContain(`fill="url(#g${tier.key})"`);
      expect(svg).toContain('<circle');
    }
  });

  it('gives each tier a DISTINCT gradient id so inlined medals never collide', () => {
    const ids = PERCENTILE_TIERS.map((t) => {
      const svg = decodeURIComponent(percentileTierBadgeDataUrl(t));
      return svg.match(/id="(g[^"]+)"/)?.[1];
    });
    expect(new Set(ids).size).toBe(PERCENTILE_TIERS.length);
  });

  it('embeds a static halo + apex sunburst for legendary, halo-only for epic, plain for common', () => {
    const svgFor = (p: number) => decodeURIComponent(
      percentileTierBadgeDataUrl(PERCENTILE_TIERS.find((t) => t.percent === p)!),
    );
    const legendary = svgFor(1);
    expect(legendary).toContain('id="htop1"'); // halo gradient present
    expect((legendary.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(12); // sunburst rays

    const epic = svgFor(2);
    expect(epic).toContain('id="htop2"'); // epic glows
    expect(epic).not.toContain('<rect'); // but has no sunburst

    const common = svgFor(10);
    expect(common).not.toContain('id="htop10"'); // common is a plain static medal — no halo
    expect(common).not.toContain('<rect');
  });

  it('emits no SMIL animation — the medal is only ever drawn onto the static card canvas', () => {
    for (const tier of PERCENTILE_TIERS) {
      const svg = decodeURIComponent(percentileTierBadgeDataUrl(tier));
      expect(svg).not.toContain('<animate');
    }
  });

  it('honours the requested pixel size while keeping the 0 0 64 64 viewBox', () => {
    const url = percentileTierBadgeDataUrl(PERCENTILE_TIERS[0], 256);
    const svg = decodeURIComponent(url);
    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain('viewBox="0 0 64 64"');
  });
});
