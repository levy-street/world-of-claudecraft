// Mobile window-frame background guards.
//
// Historical bug (PR #1736 feedback round 3): every resizable framed window was
// see-through on touch because the resize grip was a SECOND background layer on
// `.window.window-resizable > .window-frame` (12px corner grip + panel gradient),
// and the mobile override swapped in a single-layer image without resetting the
// per-layer size/position/repeat lists, so the panel painted as one 12x12 tile.
//
// The grip is now ONE `::after` pseudo on the .window ROOT (layout.css), so the
// frame background is single-layer everywhere and that truncation leak is
// structurally impossible: no framed window can layer a grip over its gradient.
// These pins hold that invariant plus the touch never-see-through floor. They
// parse the shipped CSS, not a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const components = readFileSync('src/styles/components.css', 'utf8');
const layout = readFileSync('src/styles/layout.css', 'utf8');
const hudMobile = readFileSync('src/styles/hud.mobile.css', 'utf8');

/** Extract the declaration block of the rule whose selector list contains EXACTLY this selector. */
function ruleBlock(css: string, selector: string): string {
  // Strip comments first (a comment between rules would otherwise leak into the
  // next rule's selector text), then walk flat rules; selectors are compared
  // whole (comma-split, whitespace-normalized), never by substring, so
  // `body.mobile-touch .window-frame` cannot match `... .window-frame .btn`.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const want = selector.replace(/\s+/g, ' ').trim();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of clean.matchAll(re)) {
    const sels = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (sels.includes(want)) return m[2];
  }
  return '';
}

describe('mobile window-frame background layer hygiene', () => {
  it('the resize grip is a single ::after pseudo on the window root, not a frame layer', () => {
    // A grip drawn as a background layer on any element (frame or the heroic-shop
    // nested frame) is exactly what leaked the 12x12 dot on touch. The grip now
    // lives on the root pseudo, so those layered frame-grip rules must be gone.
    expect(ruleBlock(components, '.window.window-resizable > .window-frame')).toBe('');
    expect(ruleBlock(components, '.window.window-resizable > .heroic-shop > .window-frame')).toBe(
      '',
    );
    // The root pseudo carries the diagonal grip gradient.
    const grip = ruleBlock(layout, '.window.window-resizable::after');
    expect(grip, 'root grip pseudo missing').not.toBe('');
    expect(grip).toMatch(/background-image:\s*repeating-linear-gradient\(135deg/);
    expect(grip).toMatch(/content:\s*""/);
    // Hidden on touch (the dock chrome owns the corner).
    expect(ruleBlock(layout, 'body.mobile-touch .window.window-resizable::after')).toMatch(
      /display:\s*none/,
    );
  });

  it('no framed window layers a grip gradient over its panel background', () => {
    // Backstop for the whole leak class: the grip gradient must not appear in any
    // `.window-frame` background rule (only on the root pseudo above), so a
    // single-layer frame background can never truncate to a dot on touch.
    const clean = components.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].replace(/\s+/g, ' ').trim();
      if (!/\.window-frame\b/.test(sel) || /::after|::before/.test(sel)) continue;
      expect(m[2], `grip gradient must not layer on a frame background: ${sel}`).not.toMatch(
        /repeating-linear-gradient\(135deg/,
      );
    }
  });

  it('touch keeps the solid never-see-through floor under every framed window', () => {
    // The tokens L2 doctrine: a modal surface must never composite the 3D world
    // through it. On touch every window is a full/near-fullscreen sheet over the
    // live world, so the frame rides the solid L2 base under its L1 gradient
    // (generalizing the options-menu fix that predated this bug's diagnosis).
    const block = ruleBlock(hudMobile, 'body.mobile-touch .window-frame');
    expect(block, 'universal mobile .window-frame rule missing').not.toBe('');
    expect(block).toMatch(/background-color\s*:\s*var\(--color-panel-l2-base\)/);
  });
});
