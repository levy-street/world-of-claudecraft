import { describe, expect, it } from 'vitest';
import { QUALITY_COLOR } from '../src/ui/icons';
import { qualityGlowShadow } from '../src/ui/quality_glow';

describe('qualityGlowShadow', () => {
  it('derives the exact socket glow from an epic quality color (#a335ee)', () => {
    // #a335ee -> (163, 53, 238). The full string is pinned so any drift in the
    // alpha, blur, or inset shade fails here rather than silently reskinning.
    expect(qualityGlowShadow('#a335ee')).toBe(
      '0 0 9px 0 rgba(163, 53, 238, 0.45), inset 0 0 6px rgba(0, 0, 0, 0.5)',
    );
  });

  it('drives off the real QUALITY_COLOR map (rare gear reads blue)', () => {
    // #0070dd -> (0, 112, 221): the helper consumes the same hex the paperdoll
    // border uses, so socket glow and border can never disagree on the hue.
    expect(qualityGlowShadow(QUALITY_COLOR.rare)).toBe(
      '0 0 9px 0 rgba(0, 112, 221, 0.45), inset 0 0 6px rgba(0, 0, 0, 0.5)',
    );
  });

  it('supports 3-digit shorthand hex', () => {
    expect(qualityGlowShadow('#fff')).toBe(
      '0 0 9px 0 rgba(255, 255, 255, 0.45), inset 0 0 6px rgba(0, 0, 0, 0.5)',
    );
  });

  it('returns no glow for a non-hex color (an empty slot CSS var)', () => {
    expect(qualityGlowShadow('var(--color-slot-empty-border)')).toBe('');
    expect(qualityGlowShadow('')).toBe('');
  });
});
