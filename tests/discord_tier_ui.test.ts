import { describe, expect, it } from 'vitest';
import {
  discordStatusBadgeDataUrl,
  discordStatusDisplayName,
  discordStatusTierByIndex,
  discordStatusTierForPoints,
} from '../src/ui/discord_tier';

// Exercising the presentation layer also exercises t(), which THROWS on an
// untracked key in dev/test — so this is the guard that every hudChrome.discord
// tier key actually exists in the catalog.
describe('discord tier presentation', () => {
  it('resolves a localized name for every rung (i18n keys exist)', () => {
    expect(discordStatusDisplayName(0)).toBe('Unranked');
    expect(discordStatusDisplayName(1)).toBe('Initiate');
    expect(discordStatusDisplayName(4)).toBe('Knight');
    expect(discordStatusDisplayName(8)).toBe('Mythic');
    // out-of-range falls back to the "none" key, not a throw
    expect(discordStatusDisplayName(99)).toBe('Unranked');
  });

  it('builds an SVG data-url badge for a rung', () => {
    expect(discordStatusBadgeDataUrl(5)).toMatch(/^data:image\/svg\+xml,/);
  });

  it('maps points to the presentation rung and looks up by index', () => {
    expect(discordStatusTierForPoints(5_000).key).toBe('champion');
    expect(discordStatusTierByIndex(8)?.key).toBe('mythic');
    expect(discordStatusTierByIndex(0)).toBeUndefined();
  });
});
