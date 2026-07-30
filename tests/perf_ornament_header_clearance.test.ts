// Regression: the Performance Overlay's gilded corner motif (perf_ornament_svg.ts)
// reaches roughly 50px in from each corner along the top/bottom edges. The base
// `.window > .panel-title` rule (layout.css) starts the title content at just
// --window-pad (12px) and pins the close button 8px from the inline end, and the
// base `.window` padding is 12px on every side -- all squarely inside the
// ornament's footprint, so the title text, the back/close buttons, and the footer
// buttons sat under the gold on every corner. #options-menu.perf-wide widens all
// three (components.css) to clear it; pin the values so a future edit cannot
// shrink them back under the ornament without this test catching it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERF_CORNER_SIZE } from '../src/ui/perf_ornament_svg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentsCss = readFileSync(join(root, 'src/styles/components.css'), 'utf8');

// The same selector can (legitimately) appear as more than one rule block in
// this file (e.g. `#options-menu.perf-wide` sets `width` in one block and the
// ornament's own `padding-bottom` in another); every declaration across all of
// them applies cumulatively, so collect every block's body rather than just the
// first match.
function ruleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const needle = `${selector} {`;
  let from = 0;
  for (;;) {
    const start = css.indexOf(needle, from);
    if (start < 0) break;
    const body = css.slice(start);
    bodies.push(body.slice(0, body.indexOf('}')));
    from = start + needle.length;
  }
  expect(bodies.length, `could not find rule "${selector}"`).toBeGreaterThan(0);
  return bodies;
}

// The px value of `prop` from whichever of the selector's rule blocks declares
// it (there must be exactly one, since a later duplicate would silently win and
// is worth flagging on its own).
function pxValue(bodies: string[], prop: string): number {
  const matches = bodies
    .map((b) => b.match(new RegExp(`\\b${prop}:\\s*(\\d+)px`)))
    .filter((m): m is RegExpMatchArray => m !== null);
  expect(matches, `no rule block declares "${prop}"`).toHaveLength(1);
  return Number(matches[0][1]);
}

// A leaf/tendril reaching a full corner-radius out from the pivot would clear at
// most PERF_CORNER_SIZE px; treat anything past half of that as "clears the
// ornament's typical ink", the same margin the hand-tuned values above target.
const MIN_CLEARANCE = PERF_CORNER_SIZE / 2;

describe('perf overlay header/footer clear the corner ornament (padding)', () => {
  it('the title text and back button start well clear of the top-left ornament', () => {
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide .panel-title');
    expect(pxValue(bodies, 'padding-left')).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });

  it('the title reserves enough right-side room for the close button past the top-right ornament', () => {
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide .panel-title');
    const closeBodies = ruleBodies(
      componentsCss,
      '#options-menu.perf-wide .panel-title > .x-btn:not(.back-btn)',
    );
    const closeInset = pxValue(closeBodies, 'inset-inline-end');
    expect(closeInset).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    // The title's own right padding must reach at least as far as the close
    // button's inset, or the title text can still run underneath it.
    expect(pxValue(bodies, 'padding-right')).toBeGreaterThanOrEqual(closeInset);
  });

  it('the close button (never the back button) is the one pulled in from the corner', () => {
    // .back-btn stays in normal flex flow at the inline start (layout.css); only
    // the absolutely-positioned close control needs its own inset override.
    expect(componentsCss).not.toContain('#options-menu.perf-wide .panel-title > .x-btn.back-btn');
  });

  it('the window bottom padding clears the bottom-corner ornament for the footer buttons', () => {
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide');
    expect(pxValue(bodies, 'padding-bottom')).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });
});
