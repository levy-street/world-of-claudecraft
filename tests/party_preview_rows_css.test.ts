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
import { partyFrameGrid } from '../src/ui/hud_frame_registry';
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

  it('the party mover delegates to the shared live grid reader', () => {
    expect(hudTs).toContain(
      "partyFrameGrid(this.partyFramesEl, this.numericSetting('partyFrameColumns'))",
    );
  });

  it.each([
    { live: 3, preview: 10, columns: 4, expected: { cols: 4, rows: 3 } },
    { live: 3, preview: null, columns: 4, expected: { cols: 3, rows: 1 } },
    { live: 0, preview: null, columns: 4, expected: { cols: 1, rows: 1 } },
    { live: 4, preview: 10, columns: 1.6, expected: { cols: 2, rows: 5 } },
  ])(
    'counts the visible stack with $live live and $preview preview rows',
    ({ live, preview, columns, expected }) => {
      const rows = (count: number) => ({
        querySelectorAll: (selector: string) => {
          expect(selector).toBe('.party-frame');
          return { length: count };
        },
      });
      const frame = {
        ...rows(live),
        querySelector: (selector: string) => {
          expect(selector).toBe('.tf-preview-party');
          return preview === null ? null : rows(preview);
        },
      } as unknown as HTMLElement;
      expect(partyFrameGrid(frame, columns)).toEqual(expected);
    },
  );
});
