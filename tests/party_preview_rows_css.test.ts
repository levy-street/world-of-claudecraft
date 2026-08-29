// While the interface is unlocked, the edit preview owns the party box: it
// re-renders the player's REAL party members itself (through the same
// selectPartyFrameMembers pipeline the live frames use) and pads the roster
// with dummy members to the 10-slot sample. The LIVE painter keeps syncing its
// own rows into the box meanwhile, so without a fold-away rule a player in a
// party saw N + 10 stacked frames while editing (owner report). These pin the
// two halves of the fix: the stylesheet folds the live rows wrapper away while
// editing (direct child only, so the preview's own nested rows keep showing),
// and the party mover's drag factors count the PREVIEW stack while it exists,
// never the hidden live rows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// Both sources are stripped so a pin can never match commented-out code. The
// shared helper fits the CSS too: block comments (the only CSS comment form)
// are blanked in place, and its TS line-comment arm is inert here because the
// sheet's only '//' runs sit inside ':'-guarded data-URI protocol text.
const hudCss = stripComments(
  readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
);
const hudTs = stripComments(readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'));

describe('edit-mode party preview replaces the live rows (no N + 10 stack)', () => {
  it('folds the LIVE rows wrapper away while the interface is unlocked, direct child only', () => {
    const start = hudCss.indexOf('body.interface-unlocked #party-frames > .party-rows');
    expect(start).toBeGreaterThan(-1);
    const block = hudCss.slice(start, hudCss.indexOf('}', start));
    expect(block).toContain('display: none');
    // The DIRECT-child combinator is load-bearing: the preview's own rows sit
    // in .tf-preview-party > .party-rows (the throwaway painter mints its own
    // wrapper) and a descendant selector would hide the preview too, leaving
    // an empty dashed box while editing.
    expect(hudCss).not.toMatch(/body\.interface-unlocked #party-frames\s+\.party-rows/);
  });

  it('the party mover drag factors count the preview stack while it exists', () => {
    const start = hudTs.indexOf('private partyFrameGrid()');
    expect(start).toBeGreaterThan(-1);
    const body = hudTs.slice(start, hudTs.indexOf('return { cols', start));
    // Scoped to the preview host first (the visible stack while editing);
    // the container fallback covers a gesture with no preview mounted.
    expect(body).toContain(".querySelector('.tf-preview-party')");
    expect(body).toContain('?? this.partyFramesEl');
  });
});
