import { describe, expect, it } from 'vitest';
import { MARKET_NAME_DEFAULT_COLOR, marketNameColor } from '../src/ui/market_name_color';

describe('marketNameColor', () => {
  it('returns a CSS custom-property reference for every quality, never a raw hex', () => {
    for (const q of ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      const c = marketNameColor(q);
      expect(c).toMatch(/^var\(--mkt-name-[a-z]+\)$/);
      expect(c).not.toMatch(/#[0-9a-fA-F]/);
    }
  });

  it('maps rare and epic to their own (lifted) tokens, distinct from the others', () => {
    expect(marketNameColor('rare')).toBe('var(--mkt-name-rare)');
    expect(marketNameColor('epic')).toBe('var(--mkt-name-epic)');
  });

  it('falls back to the common token when quality is missing', () => {
    expect(marketNameColor(undefined)).toBe(MARKET_NAME_DEFAULT_COLOR);
    expect(MARKET_NAME_DEFAULT_COLOR).toBe('var(--mkt-name-common)');
  });

  it('is deterministic', () => {
    expect(marketNameColor('epic')).toBe(marketNameColor('epic'));
  });
});
