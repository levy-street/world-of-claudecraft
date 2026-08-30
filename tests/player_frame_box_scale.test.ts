import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// The desktop player frame is a fixed-width box whose CHILDREN zoom with the
// Player Frame Scale slider (--player-frame-scale), so the box must carry the
// same factor or box and content disagree: at scale 0.75 the 612px box held a
// 432px content row, the yellow unlock outline overhung the bars by 90px per
// side, and a drag could not bring the visible frame within 188px of the
// screen edge (the clamp stops the BOX at the edge, not the content). The
// detached seat must also keep the docked centring: pf-detached used to flip
// justify-content to flex-start, so the first grab of a docked frame slid the
// visible content to the box's left edge (85px at scale 0.75, 18px even at the
// default scale 1), which read as the frame jumping sideways under the cursor.
// This pins the width factor on both seats, their agreement, and the centring.

// Stripped so a pin can never match commented-out CSS. The shared helper fits
// this sheet: block comments (the only CSS comment form) are blanked in place,
// and its TS line-comment arm is inert here because the sheet's only '//' runs
// sit inside ':'-guarded data-URI protocol text.
const hudCss = stripComments(
  readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
);

/** Slice a single flat rule block ({ ... } with no nested braces) by its selector. */
function ruleBlock(selector: string, from = 0): string {
  const start = hudCss.indexOf(selector, from);
  expect(start).toBeGreaterThan(-1);
  return hudCss.slice(start, hudCss.indexOf('}', start));
}

/** The `var(--player-frame-width, <n>px) * var(--player-frame-scale, 1)` width
 *  a block declares: the playerFrameWidth setting (the interface editor's
 *  dimension drags) times the children zoom, with the stock fallback px. */
function boxWidthPx(block: string): number {
  const m = block.match(
    /width: calc\(var\(--player-frame-width, (\d+)px\) \* var\(--player-frame-scale, 1\)\);/,
  );
  expect(m).not.toBeNull();
  return Number((m as RegExpMatchArray)[1]);
}

describe('player frame box tracks the Player Frame Scale zoom', () => {
  it('zooms the children by --player-frame-scale (the premise the box width mirrors)', () => {
    expect(ruleBlock('#player-frame > :not(.tf-move-btn) {')).toContain(
      'zoom: var(--player-frame-scale, 1);',
    );
  });

  it('scales the docked box by the same factor the children zoom by', () => {
    const docked = ruleBlock('#player-frame {');
    expect(boxWidthPx(docked)).toBe(612);
    expect(docked).toContain('justify-content: center;');
  });

  it('keeps the detached seat the same width and centring as the docked one', () => {
    const detached = ruleBlock('#player-frame.pf-detached {');
    // Same width on both seats, or the box resizes the moment a drag starts.
    expect(boxWidthPx(detached)).toBe(boxWidthPx(ruleBlock('#player-frame {')));
    // Same centring, or the content jumps to the box edge on the first grab.
    expect(detached).toContain('justify-content: center;');
  });
});
