// WCAG-chrome + no-magic source guard for the quest-log window DOM painter.
//
// The painter's DOM methods need a document, so they are not exercised in this Node
// suite; the pure decisions it renders are covered by tests/questlog_view.test.ts.
// This guard pins the a11y-bearing markup (dialog role + labelledby, real close +
// quest-row buttons with aria-pressed, focus-return) and the no-magic-values contract
// (no literal colors in TS; the reward-color fallback is a named token).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(
  new URL('../src/ui/hud/quest/questlog_window.ts', import.meta.url),
  'utf8',
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('questlog_window: WCAG chrome (dialog + rows + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildQuestLogView(');
  });

  it('renders the dialog role + labelledby for the window', () => {
    // The dialog identity is set via the shared markDialogRoot helper (role=dialog +
    // aria-labelledby + aria-modal + tabindex); the helper's own writes are unit-tested in
    // dialog_root.test.ts.
    expect(code).toContain("markDialogRoot(el, { labelledBy: 'quest-log-title' })");
    expect(code).toContain('id="quest-log-title"');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('questUi.log.close')");
  });

  it('renders quest rows as real buttons with aria-pressed selection state', () => {
    expect(code).toMatch(/button\.className = [`']ql-item/);
    expect(code).toContain("button.setAttribute('aria-pressed'");
  });

  it('keeps the abandon flow behind a confirm dialog', () => {
    expect(code).toContain("t('questUi.log.abandon')");
    expect(code).toContain('this.deps.confirmDialog(');
    expect(code).toContain('this.deps.world().abandonQuest(questId)');
  });

  it('returns focus to the first interactive element + the opener on close', () => {
    expect(code).toContain('this.deps.focusFirstInteractive(el)');
    expect(code).toContain('this.deps.restoreFocus(target)');
  });
});

describe('questlog_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (the reward fallback is a token)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('names the reward-color fallback token instead of an inline hex', () => {
    expect(code).toContain("QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)'");
    expect(code).toContain('?? QUALITY_DEFAULT_COLOR');
  });

  it('carries no literal em dash in source', () => {
    expect(src.includes('—'), 'em dash found').toBe(false);
  });
});
