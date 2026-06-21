// server/sns.ts label handling — the pure, chain-free parts: turning a chosen
// display name into a valid, squat-resistant SNS subdomain label, and composing
// the full subdomain string. (The on-chain mint/resolve paths need a funded
// execution wallet + live RPC and are exercised via the devnet e2e, not here.)
import { describe, it, expect } from 'vitest';
import { slugifyLabel, fullSubdomain } from '../server/sns';

describe('slugifyLabel', () => {
  it('lowercases and hyphenates a display name', () => {
    expect(slugifyLabel('Aragorn')).toBe('aragorn');
    expect(slugifyLabel("O'Brien The Bold")).toBe('o-brien-the-bold');
    expect(slugifyLabel('Mc Coy')).toBe('mc-coy');
  });

  it('strips accents to ASCII', () => {
    expect(slugifyLabel('Légolas')).toBe('legolas');
    expect(slugifyLabel('Renée')).toBe('renee');
  });

  it('returns null when nothing valid remains', () => {
    expect(slugifyLabel('???')).toBeNull();
    expect(slugifyLabel('   ')).toBeNull();
    expect(slugifyLabel('')).toBeNull();
  });

  it('caps the label at 63 characters with no trailing hyphen', () => {
    const slug = slugifyLabel('a'.repeat(80))!;
    expect(slug.length).toBe(63);
    expect(slug.endsWith('-')).toBe(false);
    // A name that would slice to a trailing hyphen is trimmed, not left dangling.
    const trimmed = slugifyLabel(`${'b'.repeat(62)} tail`)!;
    expect(trimmed.endsWith('-')).toBe(false);
  });

  it('composes the full subdomain under the parent domain', () => {
    expect(fullSubdomain('aragorn')).toBe('aragorn.worldofclaudecraft.sol');
  });
});
