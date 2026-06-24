import { describe, expect, it } from 'vitest';
import {
  SponsoredAd,
  ROTATE_SECONDS,
  activeSponsor,
  safeClickUrl,
  ctaLabel,
  attribution,
} from '../src/ui/sponsored_slot';

const ad = (over: Partial<SponsoredAd>): SponsoredAd => ({
  placementId: 'daily_spin',
  advertiser: 'Aurora Wallet',
  headline: 'The fastest Solana wallet',
  cta: 'Get the app',
  clickUrl: 'https://aurora.example',
  kind: 'text',
  endSec: 10_000,
  ...over,
});

describe('activeSponsor', () => {
  it('returns null when nothing is live for the placement', () => {
    expect(activeSponsor([], 'daily_spin', 100)).toBeNull();
    expect(activeSponsor([ad({ placementId: 'newspaper' })], 'daily_spin', 100)).toBeNull();
    expect(activeSponsor([ad({ endSec: 50 })], 'daily_spin', 100)).toBeNull(); // expired
  });

  it('returns the single live booking for the placement', () => {
    const a = ad({ advertiser: 'OnlyOne' });
    expect(activeSponsor([a], 'daily_spin', 100)?.advertiser).toBe('OnlyOne');
  });

  it('rotates deterministically among co-booked live ads by wall-clock', () => {
    const a = ad({ advertiser: 'A' });
    const b = ad({ advertiser: 'B' });
    expect(activeSponsor([a, b], 'daily_spin', 0)?.advertiser).toBe('A');
    expect(activeSponsor([a, b], 'daily_spin', ROTATE_SECONDS)?.advertiser).toBe('B');
    expect(activeSponsor([a, b], 'daily_spin', ROTATE_SECONDS * 2)?.advertiser).toBe('A');
  });

  it('ignores other placements and expired bookings when rotating', () => {
    const live = ad({ advertiser: 'Live' });
    const other = ad({ advertiser: 'Other', placementId: 'billboard' });
    const dead = ad({ advertiser: 'Dead', endSec: 1 });
    expect(activeSponsor([live, other, dead], 'daily_spin', 100)?.advertiser).toBe('Live');
  });
});

describe('safeClickUrl', () => {
  it('accepts http(s) links with a host', () => {
    expect(safeClickUrl('https://aurora.example/app')).toBe('https://aurora.example/app');
    expect(safeClickUrl('  http://shop.example?code=WOC20 ')).toBe('http://shop.example/?code=WOC20');
  });

  it('rejects script, data, relative, hostless, and garbage URLs', () => {
    expect(safeClickUrl('javascript:alert(1)')).toBeNull();
    expect(safeClickUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(safeClickUrl('/relative/path')).toBeNull();
    expect(safeClickUrl('http://')).toBeNull();
    expect(safeClickUrl('not a url')).toBeNull();
    expect(safeClickUrl('')).toBeNull();
  });
});

describe('ctaLabel', () => {
  it('trims, collapses whitespace, and caps length with an ellipsis', () => {
    expect(ctaLabel('  Get   the app ')).toBe('Get the app');
    expect(ctaLabel('20% off your first order with code WOC20 today only', 16)).toBe('20% off your fi…');
    expect(ctaLabel('Short', 16)).toBe('Short');
  });
});

describe('attribution', () => {
  it('names the advertiser, falling back when unnamed', () => {
    expect(attribution(ad({ advertiser: 'Aurora Wallet' }))).toBe('Sponsored by Aurora Wallet');
    expect(attribution(ad({ advertiser: '  ' }))).toBe('Sponsored');
  });
});
