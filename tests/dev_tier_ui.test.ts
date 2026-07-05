import { describe, expect, it } from 'vitest';
import {
  DEV_TIERS,
  devTierBadgeDataUrl,
  devTierByIndex,
  devTierDisplayName,
  devTierFlavorText,
  devTierNameOutlineColor,
} from '../src/ui/dev_tier';

// Exercising the presentation layer also exercises t(), which THROWS on an
// untracked key in dev/test, so this is the guard that every hudChrome.devBadge
// tier/flavor key actually exists in the catalog.
describe('dev tier presentation', () => {
  it('resolves a localized name and flavor for every rung (i18n keys exist)', () => {
    for (const tier of DEV_TIERS) {
      expect(typeof devTierDisplayName(tier)).toBe('string');
      expect(devTierDisplayName(tier).length).toBeGreaterThan(0);
      expect(typeof devTierFlavorText(tier)).toBe('string');
      expect(devTierFlavorText(tier).length).toBeGreaterThan(0);
    }
    expect(devTierDisplayName(DEV_TIERS[0])).toBe('Tinkerer');
    expect(devTierDisplayName(DEV_TIERS[4])).toBe('Worldwright');
  });

  it('builds an SVG data-url badge for a rung', () => {
    expect(devTierBadgeDataUrl(DEV_TIERS[2])).toMatch(/^data:image\/svg\+xml,/);
  });

  it('looks up the presentation rung by index, undefined for 0/out-of-range', () => {
    expect(devTierByIndex(4)?.key).toBe('architect');
    expect(devTierByIndex(0)).toBeUndefined();
  });

  it('returns the nameplate outline colour only for significant rungs', () => {
    expect(devTierNameOutlineColor(0)).toBeNull();
    expect(devTierNameOutlineColor(1)).toBeNull();
    expect(devTierNameOutlineColor(3)).toBeNull();
    expect(devTierNameOutlineColor(4)).toBe(DEV_TIERS[3].ring);
    expect(devTierNameOutlineColor(5)).toBe(DEV_TIERS[4].ring);
    expect(devTierNameOutlineColor(6)).toBeNull();
  });
});
