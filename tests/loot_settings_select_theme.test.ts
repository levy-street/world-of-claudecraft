// Regression for #1646: the Loot Settings dropdowns (#ls-method, #ls-threshold)
// rendered as unstyled native OS selects (white bg, black system font) that clashed
// with the dark gold HUD. A shared `.hud-select` class themes them with tokens (dark
// panel, gold border/caret) while keeping real <select> keyboard semantics. Pin that
// the class is defined with the load-bearing token-driven rules and applied to both
// selects, so a regression to raw native selects (or hard-coded hex) reddens.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
const win = readFileSync(new URL('../src/ui/loot_settings_window.ts', import.meta.url), 'utf8');

// Isolate the .hud-select base rule body.
const base = css.match(/\.hud-select\s*\{([\s\S]*?)\}/);

describe('loot-settings dropdowns use the themed .hud-select class (#1646)', () => {
  it('defines .hud-select with token-driven theme rules (not raw hex, not native)', () => {
    expect(base).not.toBeNull();
    const body = base![1];
    // Strips the native OS chrome so it can be themed.
    expect(body).toMatch(/appearance:\s*none/);
    // Themed from tokens, not literals. Background pairs the THEME-AWARE
    // --color-bg-dark with the theme-aware --color-text-light so the pair stays
    // readable on light presets (Parchment), not just the dark default.
    expect(body).toContain('var(--color-bg-dark)');
    expect(body).toContain('var(--color-border-default)');
    expect(body).toContain('var(--color-text-light)');
    expect(body).not.toContain('var(--color-bg-input)'); // fixed dark token would break light themes
  });

  it('draws the caret from the theme-aware --gold accent, not a fixed hex fill', () => {
    const body = base![1];
    expect(body).toContain('var(--gold)'); // caret gradients tint by the theme accent
    expect(body).not.toContain('%23ffd100'); // no fixed-yellow data-URI (breaks light themes)
  });

  it('holds the 40px mobile tap-target floor on coarse pointers', () => {
    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.hud-select[\s\S]*?min-height:\s*40px/,
    );
  });

  it('gives .hud-select a steady token-drawn focus-visible ring', () => {
    expect(css).toMatch(
      /\.hud-select:focus-visible\s*\{[\s\S]*?var\(--color-border-focus\)[\s\S]*?\}/,
    );
  });

  it('restores a usable native control under forced-colors (high contrast)', () => {
    expect(css).toMatch(
      /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*?\.hud-select[\s\S]*?appearance:\s*auto/,
    );
  });

  it('applies .hud-select to both loot-settings selects', () => {
    expect(win).toMatch(/id="ls-method"[^>]*class="hud-select"/);
    expect(win).toMatch(/id="ls-threshold"[^>]*class="hud-select"/);
  });
});
