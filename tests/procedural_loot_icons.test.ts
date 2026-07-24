import { describe, expect, it } from 'vitest';
import {
  LEGENDARY_POWER_RUNE_MARKUP,
  legendaryPowerRuneSvg,
} from '../src/ui/procedural_loot_icons';

describe('procedural loot icons', () => {
  it('renders the original legendary rune in the shared 512 viewBox', () => {
    const svg = legendaryPowerRuneSvg();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('class="item-power-rune"');
    expect(svg).toContain(LEGENDARY_POWER_RUNE_MARKUP);
  });

  it('is decorative and cannot become the only accessible power label', () => {
    const svg = legendaryPowerRuneSvg('fixture');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).toContain('class="item-power-rune fixture"');
    expect(svg).not.toContain('<title');
  });

  it('contains no external reference, embedded raster, or hard-coded color', () => {
    expect(LEGENDARY_POWER_RUNE_MARKUP).not.toMatch(/https?:|data:|<image|#[0-9a-f]{3,8}/i);
  });

  it('uses a hollow even-odd outer diamond plus an independent knot', () => {
    expect(LEGENDARY_POWER_RUNE_MARKUP).toContain('fill-rule="evenodd"');
    expect(LEGENDARY_POWER_RUNE_MARKUP.match(/<path/g)).toHaveLength(2);
  });
});
