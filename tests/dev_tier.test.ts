import { describe, expect, it } from 'vitest';
import {
  DEV_TIER_DEFS,
  DEV_TIER_SIGNIFICANT_INDEX,
  devTierIndexForMergedPrs,
  isSignificantDevTier,
  devTierByIndex as sharedDevTierByIndex,
} from '../src/sim/dev_tier';
import { DEV_TIERS, devTierBadgeDataUrl, devTierByIndex } from '../src/ui/dev_tier';

// Mirrors the real data flow exactly (the server resolves a merged-PR count to
// an index via devTierIndexForMergedPrs and broadcasts only the index; the
// client always looks the presentation rung up by that index, never re-derives
// one from a raw count), rather than testing through a client-side count lookup
// the codebase doesn't actually have.
function tierNameForMergedPrs(mergedPrs: number | null): string | undefined {
  return devTierByIndex(devTierIndexForMergedPrs(mergedPrs))?.name;
}

describe('dev-tier ladder', () => {
  it('has five rungs with strictly increasing thresholds and 1-based indexes', () => {
    expect(DEV_TIERS.length).toBe(5);
    for (let i = 0; i < DEV_TIERS.length; i++) {
      expect(DEV_TIERS[i].index).toBe(i + 1);
      if (i > 0) expect(DEV_TIERS[i].threshold).toBeGreaterThan(DEV_TIERS[i - 1].threshold);
    }
    expect(DEV_TIERS[0].threshold).toBe(1);
    expect(DEV_TIERS[DEV_TIERS.length - 1].threshold).toBe(70);
  });

  it('keeps UI presentation rungs aligned with the shared pure tier definitions', () => {
    expect(DEV_TIERS.map(({ index, key, threshold }) => ({ index, key, threshold }))).toEqual(
      DEV_TIER_DEFS,
    );
  });

  it('resolves to no rung with no link or a sub-threshold merged-PR count', () => {
    expect(tierNameForMergedPrs(null)).toBeUndefined();
    expect(tierNameForMergedPrs(0)).toBeUndefined();
    expect(tierNameForMergedPrs(0.5)).toBeUndefined();
    expect(tierNameForMergedPrs(Number.NaN)).toBeUndefined();
  });

  it('rejects non-finite and negative merged-PR counts as no rung', () => {
    expect(tierNameForMergedPrs(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(tierNameForMergedPrs(Number.NEGATIVE_INFINITY)).toBeUndefined();
    expect(tierNameForMergedPrs(-5)).toBeUndefined();
  });

  it('treats each threshold as inclusive and just-below as the rung beneath', () => {
    expect(tierNameForMergedPrs(1)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(5)).toBe('Artificer');
    expect(tierNameForMergedPrs(30)).toBe('Architect');
    expect(tierNameForMergedPrs(0.99)).toBeUndefined();
    expect(tierNameForMergedPrs(4)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(14)).toBe('Artificer');
    expect(tierNameForMergedPrs(29)).toBe('Runesmith');
  });

  it('maps merged-PR counts to the highest qualifying rung', () => {
    expect(tierNameForMergedPrs(1)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(4)).toBe('Tinkerer');
    expect(tierNameForMergedPrs(5)).toBe('Artificer');
    expect(tierNameForMergedPrs(15)).toBe('Runesmith');
    expect(tierNameForMergedPrs(30)).toBe('Architect');
    expect(tierNameForMergedPrs(70)).toBe('Worldwright');
    expect(tierNameForMergedPrs(500)).toBe('Worldwright');
  });

  it('exposes a server-safe numeric tier lookup from the shared pure module', () => {
    expect(devTierIndexForMergedPrs(null)).toBe(0);
    expect(devTierIndexForMergedPrs(0)).toBe(0);
    expect(devTierIndexForMergedPrs(0.5)).toBe(0);
    expect(devTierIndexForMergedPrs(5)).toBe(2);
    expect(devTierIndexForMergedPrs(30)).toBe(4);
    expect(devTierIndexForMergedPrs(500)).toBe(5);
  });

  it('looks up rungs by 1-based index and returns undefined out of range', () => {
    expect(devTierByIndex(1)!.name).toBe('Tinkerer');
    expect(devTierByIndex(5)!.name).toBe('Worldwright');
    expect(devTierByIndex(0)).toBeUndefined();
    expect(devTierByIndex(6)).toBeUndefined();
    expect(devTierByIndex(-1)).toBeUndefined();
  });

  it('returns undefined for a non-integer index even within the 1-5 span', () => {
    expect(devTierByIndex(1.5)).toBeUndefined();
    expect(devTierByIndex(3.5)).toBeUndefined();
    expect(sharedDevTierByIndex(2.5)).toBeUndefined();
  });

  it('round-trips every rung through devTierByIndex by its own index', () => {
    for (const t of DEV_TIERS) {
      expect(devTierByIndex(t.index)).toBe(t);
    }
  });

  it('marks Architect and Worldwright as significant contributors, the lower rungs not', () => {
    expect(DEV_TIER_SIGNIFICANT_INDEX).toBe(4);
    expect(isSignificantDevTier(0)).toBe(false);
    expect(isSignificantDevTier(1)).toBe(false);
    expect(isSignificantDevTier(2)).toBe(false);
    expect(isSignificantDevTier(3)).toBe(false);
    expect(isSignificantDevTier(4)).toBe(true);
    expect(isSignificantDevTier(5)).toBe(true);
    expect(isSignificantDevTier(6)).toBe(false);
    expect(isSignificantDevTier(4.5)).toBe(false);
  });

  it('builds a decodable SVG badge embedding the ring colour for all five rungs', () => {
    for (const t of DEV_TIERS) {
      const url = devTierBadgeDataUrl(t);
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
      expect(svg).toContain('<svg');
      expect(svg).toContain(`stop-color="${t.ring}"`);
      expect(svg).toContain(t.glyph);
    }
  });

  it('embeds both gradient stops and the radial gradient for a tier whose glow differs from its ring', () => {
    const worldwright = DEV_TIERS[4];
    expect(worldwright.glow).not.toBe(worldwright.ring);
    const svg = decodeURIComponent(devTierBadgeDataUrl(worldwright));
    expect(svg).toContain(worldwright.ring);
    expect(svg).toContain(worldwright.glow);
    expect(svg).toContain('radialGradient');
  });
});
