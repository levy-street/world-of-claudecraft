import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Issue 1577 (6): on the mobile touch HUD the swing bar and cast bar must render
// directly above the bottom-centre player frame, and their width must match the
// player frame's rendered width (so the bar ends line up with the frame instead
// of floating narrower/wider). The frame is a fixed 300px box scaled down by a
// transform; each bar carries the SAME 300px times that scale as an explicit
// width (with no transform scale of its own), so the two render identically wide.
// This pins that contract against silent drift for the base (portrait) and
// landscape tiers. The painter-level behaviour is covered by
// tests/swing_timer_painter.test.ts and tests/cast_bar_painter.test.ts; this file
// only guards the mobile CSS seat + width-match.
//
// The selector-group patterns below deliberately allow the group to CONTINUE past
// #swingbar (`[^{]*` before the brace) rather than requiring the bars to be its last
// members: the pet health strip shares this same bottom-centre column and joins each
// nudge group. What is pinned is that the bars are grouped WITH the frame's nudge and
// carry its exact value, which is the contract issue 1577 (6) is about; who else rides
// along is not. tests/client_shell.test.ts pins the strip's own membership.

const mobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

/** Slice a single flat rule block ({ ... } with no nested braces) by its selector. */
function ruleBlock(selector: string, from = 0): string {
  const start = mobileCss.indexOf(selector, from);
  expect(start).toBeGreaterThan(-1);
  return mobileCss.slice(start, mobileCss.indexOf('}', start));
}

/** The frame's rendered-width scale factor from its `scale(calc(<f> * var(...)))`
 *  seat. The first `#player-frame {` block sets only ring tokens, so `[^}]` skips
 *  past it (it stops at that block's `}`) to the seat block that carries the
 *  transform. */
function playerFrameScaleFactor(from = 0): string {
  const m = mobileCss
    .slice(from)
    .match(
      /#player-frame \{[^}]*?transform: translateX\(-50%\) scale\(calc\(([0-9.]+) \* var\(--mobile-chrome-scale, 1\)\)\);/,
    );
  expect(m).not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

/** The `300px * <f>` width factor a bar block declares. */
function barWidthFactor(block: string): string {
  const m = block.match(/width: calc\(300px \* ([0-9.]+) \* var\(--mobile-chrome-scale, 1\)\);/);
  expect(m).not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

/** The px value inside a `bottom: calc(<n>px + env(safe-area-inset-bottom));`. */
function bottomPx(block: string): number {
  const m = block.match(/bottom: calc\((\d+)px \+ env\(safe-area-inset-bottom\)\);/);
  expect(m).not.toBeNull();
  return Number((m as RegExpMatchArray)[1]);
}

describe('mobile swing/cast bar anchoring (issue 1577 (6))', () => {
  it('centres both bars horizontally over the bottom-centre player frame (base tier)', () => {
    for (const sel of ['body.mobile-touch #castbar {', 'body.mobile-touch #swingbar {']) {
      const block = ruleBlock(sel);
      expect(block).toContain('position: fixed;');
      expect(block).toContain('left: 50%;');
      expect(block).toContain('transform: translateX(-50%);');
    }
  });

  it('matches each bar width to the player frame rendered width (base tier)', () => {
    const frameFactor = playerFrameScaleFactor();
    // Sanity: the frame is the fixed 300px box the bars mirror.
    expect(ruleBlock('body.mobile-touch #player-frame {').length).toBeGreaterThan(0);
    expect(mobileCss).toContain('width: 300px;');
    // A bar width of 300px * frameFactor renders exactly as wide as the scaled
    // 300px frame, so drifting the frame scale without the bars fails here.
    const castFactor = barWidthFactor(ruleBlock('body.mobile-touch #castbar {'));
    const swingFactor = barWidthFactor(ruleBlock('body.mobile-touch #swingbar {'));
    expect(castFactor).toBe(frameFactor);
    expect(swingFactor).toBe(frameFactor);
  });

  it('stacks swing above cast, both above the frame, so the three never overlap (base tier)', () => {
    // Player frame sits at bottom 14px; cast clears it, swing clears cast.
    const castBottom = bottomPx(ruleBlock('body.mobile-touch #castbar {'));
    const swingBottom = bottomPx(ruleBlock('body.mobile-touch #swingbar {'));
    expect(castBottom).toBeGreaterThan(14);
    expect(swingBottom).toBeGreaterThan(castBottom);
  });

  it('matches each bar width to the shorter player frame in landscape', () => {
    // The landscape overrides live after the base rules; scope the lookups there.
    const landscapeStart = mobileCss.indexOf('orientation: landscape');
    expect(landscapeStart).toBeGreaterThan(-1);
    const frameFactor = playerFrameScaleFactor(landscapeStart);
    const castFactor = barWidthFactor(ruleBlock('body.mobile-touch #castbar {', landscapeStart));
    const swingFactor = barWidthFactor(ruleBlock('body.mobile-touch #swingbar {', landscapeStart));
    expect(castFactor).toBe(frameFactor);
    expect(swingFactor).toBe(frameFactor);
  });

  it('keeps both bars in lockstep with the frame when it is nudged off-centre', () => {
    // On the compact tier the frame is nudged left to clear the Jump crescent;
    // both bars must share that same seat or they drift off the frame edge, so
    // they are grouped with the frame in one selector list (issue 1577 (6)).
    expect(
      /hud-mobile-compact #castbar,[\s\S]{0,80}hud-mobile-compact #swingbar[^{]*\{/.test(mobileCss),
    ).toBe(true);
  });

  it('mirrors the compact-tier frame nudge to the right in left-handed mode', () => {
    // Left-handed mode mirrors Jump (and the whole action ring) to the left side,
    // so the frame's Jump-dodging nudge must flip sign too, or it drifts into the
    // mirrored Jump crescent instead of away from it.
    expect(
      /hud-mobile-compact\.mobile-left-handed #player-frame \{\s*left: calc\(50% \+ 15px\);/.test(
        mobileCss,
      ),
    ).toBe(true);
    expect(
      /hud-mobile-compact\.mobile-left-handed #castbar,\s*body\.mobile-touch\.hud-mobile-compact\.mobile-left-handed #swingbar[^{]*\{\s*left: calc\(50% \+ 15px\);/.test(
        mobileCss,
      ),
    ).toBe(true);
  });

  it('mirrors the narrow landscape-gated frame nudge to the right in left-handed mode', () => {
    const landscapeStart = mobileCss.indexOf('max-width: 800px) and (orientation: landscape)');
    expect(landscapeStart).toBeGreaterThan(-1);
    const landscapeEnd = mobileCss.indexOf('/* Tablet:', landscapeStart);
    expect(landscapeEnd).toBeGreaterThan(landscapeStart);
    const landscapeBlock = mobileCss.slice(landscapeStart, landscapeEnd);
    expect(
      /hud-mobile-compact\.mobile-left-handed #player-frame,\s*body\.mobile-touch\.hud-mobile-compact\.mobile-left-handed #castbar,\s*body\.mobile-touch\.hud-mobile-compact\.mobile-left-handed #swingbar[^{]*\{\s*left: calc\(50% \+ 44px\);/.test(
        landscapeBlock,
      ),
    ).toBe(true);
  });
});
