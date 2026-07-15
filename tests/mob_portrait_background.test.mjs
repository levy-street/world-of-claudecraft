import { describe, expect, it } from 'vitest';
import { mobPortraitBackgroundSvg } from '../scripts/lib/mob_portrait_background.mjs';

describe('mobPortraitBackgroundSvg', () => {
  it('builds a bounded opaque vignette with a family-specific center color', () => {
    const undead = mobPortraitBackgroundSvg('undead', 128);
    const beast = mobPortraitBackgroundSvg('beast', 128);

    expect(undead).toContain('width="128" height="128"');
    expect(undead).toContain('#65527a');
    expect(undead).toContain('#11131a');
    expect(undead).not.toBe(beast);
  });

  it('uses the neutral palette for an unknown family without leaking input into SVG', () => {
    const svg = mobPortraitBackgroundSvg('<script>', 64);

    expect(svg).toContain('#59636b');
    expect(svg).not.toContain('<script>');
  });
});
