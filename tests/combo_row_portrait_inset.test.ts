import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The player frame's bar stack (.uf-bars) deliberately tucks 14px under the
// portrait medallion, and the portrait then overhangs the stack by a further
// 18px (64px disc, -4px margin, -14px stack margin). The HP and power bars
// read fine under that overhang (classic medallion-over-bar look) and the name
// plaque pads past it, but the combo row has no such inset, so its FIRST pip
// (12px wide at x 0..12 of the stack) sat fully under the disc: a rogue at five
// combo points saw five pips over the target and only four beside their name.
// The row pays the overhang once, as padding on the row itself, so every pip
// starts clear of the disc on desktop and on the touch layout, which inherits
// the same tuck.
const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

function comboRowRule(): string {
  const m = hudCss.match(/\n\s*\.combo-row\s*\{([^}]*)\}/);
  if (!m) throw new Error('.combo-row rule missing from hud.css');
  return m[1];
}

describe('combo row clears the player portrait overhang', () => {
  it('insets the row past the portrait disc so the first pip is never covered', () => {
    const rule = comboRowRule();
    const inset = rule.match(/padding-left:\s*(\d+)px/);
    expect(inset, 'combo-row needs a padding-left inset').not.toBeNull();
    // 18px is the overhang (64 - 4 - 14 = 46 stack offset vs the 64px disc);
    // anything less leaves part of pip 1 under the disc edge.
    expect(Number(inset?.[1])).toBeGreaterThanOrEqual(18);
  });

  it('does not let a pip shrink to fit the narrower row', () => {
    const pip = hudCss.match(/\n\s*\.combo-pip\s*\{([^}]*)\}/);
    expect(pip).not.toBeNull();
    expect(pip?.[1]).toMatch(/flex-shrink:\s*0/);
  });
});
