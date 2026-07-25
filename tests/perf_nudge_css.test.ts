import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Load-bearing CSS pins for the performance nudge toast (the phase 05 sibling
// of #gpu-notice in src/styles/shell.css). Pinned against a
// WHITESPACE-NORMALIZED view so a biome re-wrap never breaks a pin, only a
// real value change does (the charscreen_css.test.ts convention).
const norm = (css: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

const shell = norm(readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8'));
const rawShell = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');

describe('performance nudge toast CSS', () => {
  it('owns a ten-dash section banner so the corpus guard sees it', () => {
    // css_corpus.test.ts treats ONLY ten-dash fences as section boundaries; a
    // four-dash banner would silently drop the section from the corpus.
    expect(rawShell).toContain('/* ---------- performance nudge toast ---------- */');
  });

  it('sits one fixed slot below the gpu-notice slot with the safe-area term', () => {
    // 112px clears the update-toast slot (56px) plus the gpu-notice slot, so
    // the three toasts can never overlap even if all were visible.
    expect(shell).toContain(
      '#perf-nudge { position: fixed; top: calc(var(--spacing-md) + 112px + env(safe-area-inset-top, 0px)); right: calc(var(--spacing-md) + env(safe-area-inset-right, 0px)); z-index: 260;',
    );
  });

  it('caps its width against small viewports like its sibling', () => {
    expect(shell).toContain('max-width: min(440px, calc(100vw - 2 * var(--spacing-md)));');
  });

  it('honors the hidden attribute the toast toggles', () => {
    expect(shell).toContain('#perf-nudge[hidden] { display: none; }');
  });

  it('keeps the dismiss button focus-visible ring and the coarse-pointer touch floor', () => {
    expect(shell).toContain(
      '#perf-nudge button:focus-visible { outline: 3px solid var(--color-border-focus); outline-offset: 2px; }',
    );
    // The 40x40 mobile floor: this toast can surface in a mobile browser
    // mid-session, unlike the desktop update toast.
    expect(shell).toContain(
      '@media (pointer: coarse) { #perf-nudge button { min-height: 40px; min-width: 40px; } }',
    );
  });
});
