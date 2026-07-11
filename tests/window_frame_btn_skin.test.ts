// AAA grammar vs the legacy same-layer .btn skin (components.css).
//
// The legacy quest-dialog-era .btn block (margins, a 1px black outline, a
// text-shadow, an inset+drop box-shadow, a hover brightness filter + glow, an
// :active translateY, a disabled grayscale filter, and a 3px !important focus
// ring) lives in the SAME @layer components as the .window-frame grammar, so
// every property the grammar block does not declare leaks into every framed
// button. These source pins keep the neutralizing resets in place: dropping
// any of them silently re-skins the redesigned windows' buttons with the
// legacy look. Same source-scan style as window_frame_mobile_bg.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const components = readFileSync('src/styles/components.css', 'utf8');
const clean = components.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration block whose selector list contains EXACTLY this selector. */
function ruleBlocks(selector: string): string[] {
  const want = selector.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (sels.includes(want)) out.push(m[2]);
  }
  return out;
}

const has = (blocks: string[], decl: RegExp): boolean => blocks.some((b) => decl.test(b));

describe('.window-frame .btn neutralizes the legacy same-layer .btn skin', () => {
  const base = ruleBlocks('.window-frame .btn');
  it('resets the leaked base properties: margin, outline, text-shadow, box-shadow, filter', () => {
    expect(base.length).toBeGreaterThan(0);
    expect(has(base, /margin:\s*0;/)).toBe(true);
    expect(has(base, /outline:\s*none;/)).toBe(true);
    expect(has(base, /text-shadow:\s*none;/)).toBe(true);
    expect(has(base, /box-shadow:\s*none;/)).toBe(true);
    expect(has(base, /filter:\s*none;/)).toBe(true);
  });

  it('neutralizes the legacy hover brightness filter and glow shadow', () => {
    const hover = ruleBlocks('.window-frame .btn:hover:not(:disabled)');
    expect(has(hover, /filter:\s*none;/)).toBe(true);
    expect(has(hover, /box-shadow:\s*none;/)).toBe(true);
  });

  it('neutralizes the legacy :active translateY (no transforms in the grammar)', () => {
    const active = ruleBlocks('.window-frame .btn:active:not(:disabled)');
    expect(has(active, /transform:\s*none;/)).toBe(true);
  });

  it('neutralizes the legacy disabled grayscale filter (opacity is the one disabled cue)', () => {
    const disabled = ruleBlocks('.window-frame .btn:disabled');
    expect(has(disabled, /filter:\s*none;/)).toBe(true);
    expect(has(disabled, /opacity:\s*0\.4;/)).toBe(true);
  });

  it('re-asserts the TOKEN focus ring with !important so it beats the legacy !important ring', () => {
    // The legacy .btn:focus-visible ring is !important; within one layer only
    // another !important declaration can beat it, and among important
    // declarations the higher specificity (.window-frame .btn) wins.
    const focus = ruleBlocks('.window-frame .btn:focus-visible');
    expect(
      has(
        focus,
        /outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring-color\) !important;/,
      ),
    ).toBe(true);
    expect(has(focus, /outline-offset:\s*var\(--focus-ring-offset\) !important;/)).toBe(true);
    expect(has(focus, /box-shadow:\s*none !important;/)).toBe(true);
  });
});

describe('.window-frame .bar neutralizes the legacy same-layer .bar skin', () => {
  it('resets the leaked hud.css .bar margin-top (spacing belongs to the parent layout)', () => {
    const bar = ruleBlocks('.window-frame .bar');
    expect(has(bar, /margin-top:\s*0;/)).toBe(true);
  });
});

describe('sell-junk gap survives the .window-frame .btn margin reset', () => {
  // The Sell tab stacks the sell-junk button directly above .list-rows, and the
  // gap rule sits EARLIER in the same layer than the (0,2,0) '.window-frame .btn
  // { margin: 0 }' reset above. Only the compound (0,3,0) selector keeps the
  // margin-bottom alive; a well-meaning "simplification" back to
  // '.window-frame .vendor-sell' would silently lose the cascade tie again and
  // weld the button to the first item row.
  it('declares the gap on the higher-specificity .btn.vendor-sell compound', () => {
    const gap = ruleBlocks('.window-frame .btn.vendor-sell');
    expect(gap.length).toBeGreaterThan(0);
    expect(has(gap, /margin-bottom:\s*var\(--spacing-md\);/)).toBe(true);
    expect(ruleBlocks('.window-frame .vendor-sell')).toHaveLength(0);
  });
});
