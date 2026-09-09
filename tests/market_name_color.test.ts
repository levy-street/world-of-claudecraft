import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { tooltipEffectiveQuality } from '../src/ui/item_instance_tooltip';
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

  it('composed with the effective-quality rule, a promoted listing colors legendary (phase 13)', () => {
    // The browse-row wiring (market_window.ts, pinned at source in
    // tests/market_window.test.ts) resolves the listing's instance view
    // through tooltipEffectiveQuality before this resolver; this is the
    // behavioral half: instance-driven case plus the def-only negative.
    const def = { id: 'mkt_cmp_test', name: 'T', kind: 'armor', quality: 'epic' } as ItemDef;
    expect(
      marketNameColor(tooltipEffectiveQuality(def, { rolled: { quality: 'legendary' } })),
    ).toBe('var(--mkt-name-legendary)');
    expect(marketNameColor(tooltipEffectiveQuality(def, undefined))).toBe('var(--mkt-name-epic)');
  });
});
