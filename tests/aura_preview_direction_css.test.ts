// The edit-mode buff/debuff SAMPLE rows must lay out exactly like the LIVE
// bars, or the editing screen lies about the layout being arranged: the live
// rows are flex row-reverse by default (icons pack against the right end,
// reading right to left) and flip through the --buff-bar-direction /
// --debuff-bar-direction vars (buffsLeftToRight / debuffsLeftToRight, the
// Frames Settings toggles). The sample shell (.tf-preview) is a plain LTR
// flex, so without per-bar mirror rules the editing box showed the samples
// left to right while the live bars read right to left (owner report). The
// aurasOnPlayerFrame twin: the on-frame buff row is forced LTR by the
// stylesheet regardless of the toggle, so its sample mirrors THAT.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// Stripped so a pin can never match commented-out CSS. The shared helper fits
// this sheet: block comments (the only CSS comment form) are blanked in place,
// and its TS line-comment arm is inert here because the sheet's only '//' runs
// sit inside ':'-guarded data-URI protocol text.
const hudCss = stripComments(
  readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
);

function block(selector: string): string {
  const start = hudCss.indexOf(selector);
  expect(start, selector).toBeGreaterThan(-1);
  return hudCss.slice(start, hudCss.indexOf('}', start));
}

describe('edit-mode aura samples mirror the live bar direction', () => {
  it('the buff sample row follows --buff-bar-direction with the live row-reverse default', () => {
    expect(block('#buff-bar > .tf-preview-auras')).toContain(
      'flex-direction: var(--buff-bar-direction, row-reverse)',
    );
  });

  it('the debuff sample row follows --debuff-bar-direction the same way', () => {
    expect(block('#debuff-bar > .tf-preview-auras')).toContain(
      'flex-direction: var(--debuff-bar-direction, row-reverse)',
    );
  });

  it("the on-player-frame buff sample mirrors that placement's forced LTR row", () => {
    expect(block('#player-frame > #buff-bar > .tf-preview-auras')).toContain('flex-direction: row');
  });
});
