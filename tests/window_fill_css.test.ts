import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Load-bearing CSS pins for the resized-window fill contract: the half of the
// leaderboard resize fix that lives in the stylesheet. Dragging a window taller
// used to leave a dead band under the board while the board itself stayed
// truncated, because .lb-body kept its authored 56vh cap inside the now-taller
// window. The contract is: window_resize.ts stamps .window-sized, the window is a
// flex column, and the one child marked .window-fill absorbs the leftover height.
//
// Pinned against a WHITESPACE-NORMALIZED view so a biome re-wrap never breaks a
// pin, only a real value change does (the perf_nudge_css.test.ts convention).
const norm = (css: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

const rawComponents = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const components = norm(rawComponents);

describe('resized-window fill CSS', () => {
  it('owns a ten-dash section banner so the corpus guard sees it', () => {
    // css_corpus.test.ts treats ONLY ten-dash fences as section boundaries; a
    // four-dash banner would silently drop the section from the corpus.
    expect(rawComponents).toContain('/* ---------- resized-window fill ---------- */');
  });

  it('lets the marked child absorb the leftover height of a sized window', () => {
    expect(components).toContain(
      '.window.window-sized > .window-fill { flex: 1 1 auto; min-height: 48px; max-height: none; }',
    );
  });

  it('drops the authored viewport cap ONLY once the window carries an explicit size', () => {
    // max-height: none is the whole point (without it the body stops at 56vh
    // inside a taller window and the dead band comes back), but it must not apply
    // to an unsized window, whose height is still content-driven: a bare
    // `.window-fill { max-height: none }` would let the board run to the shell's
    // 85vh clamp the moment the window opens.
    expect(components).not.toMatch(/(?<!\.window-sized > )\.window-fill \{[^}]*max-height: none/);
  });

  it('keeps the board capped at 56vh until then', () => {
    expect(components).toContain(
      '.lb-body { margin-top: 8px; max-height: 56vh; overflow-y: auto; }',
    );
  });

  it('makes the leaderboard window a flex column so the fill has a column to fill', () => {
    // The painter opens it with an inline display:flex (pinned in
    // leaderboard_window.test.ts); with the shell default (row) the header, tabs
    // and board would lay out side by side instead.
    expect(components).toContain('#leaderboard-window { flex-direction: column; }');
  });

  it('drops the tab strip margin that block-flow used to collapse', () => {
    // Under block flow .panel-title's 8px margin-bottom collapsed with .lb-tabs'
    // 8px margin-top into one 8px gap. Flex does not collapse margins, so keeping
    // both would double the gap under the header.
    expect(components).toContain('.lb-tabs { display: flex; gap: 6px; }');
    expect(components).not.toMatch(/\.lb-tabs \{[^}]*margin-top/);
  });
});
