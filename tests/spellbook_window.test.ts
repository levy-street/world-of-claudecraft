// WCAG-chrome + no-magic source guard for the spellbook window DOM painter.
//
// The painter's DOM methods need a document, so they are not exercised in this Node
// suite; the pure decisions it renders are covered by tests/spellbook_view.test.ts.
// This guard pins the a11y-bearing markup (real close button + listitem rows +
// toggle aria-pressed + focus-return) and the no-magic-values contract (no literal
// colors in TS), plus the hud.update() refresh call site.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/spellbook_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('spellbook_window: WCAG chrome (rows + toggles + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildSpellbookView(');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('abilityUi.spellbook.close')");
  });

  it('renders the dialog role + the spell list role', () => {
    // the dialog identity is set via the shared markDialogRoot helper (its own writes
    // are unit-tested in dialog_root.test.ts); the spell list/listitem roles stay inline.
    expect(code).toContain("markDialogRoot(el, { label: t('abilityUi.spellbook.title') })");
    expect(code).toContain("list.setAttribute('role', 'list')");
    expect(code).toContain("setAttribute('role', 'listitem')");
  });

  it('renders the hotbar toggle as a button with aria-pressed state', () => {
    expect(code).toMatch(/toggle\.className = [`']spell-hotbar-toggle/);
    expect(code).toContain("toggle.setAttribute('aria-pressed'");
    expect(code).toContain('this.deps.removeFromBar(id)');
    expect(code).toContain('this.deps.addToBar(id)');
  });

  it('keeps the reset-bar button gated on the form-bars flag', () => {
    expect(code).toContain('const resetBtnHtml = view.hasFormBars');
    expect(code).toContain('data-reset-bar');
    expect(code).toContain("t('abilityUi.spellbook.resetBar')");
  });

  it('captures + restores the opener focus on open/close (WCAG 2.2 AA focus-return)', () => {
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('captures the opener BEFORE closing other windows (order is load-bearing)', () => {
    // A sibling window's own focus-return on close must not clobber the opener we
    // restore to, so the capture has to happen before closeOthers(). Both calls
    // appear exactly once (in toggle()), so the order check is unambiguous.
    expect(code.indexOf('this.openerFocus = this.deps.captureFocus()')).toBeLessThan(
      code.indexOf('this.deps.closeOthers()'),
    );
  });
});

describe('spellbook_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('carries no literal em dash in source', () => {
    expect(src.includes('—'), 'em dash found').toBe(false);
  });
});

describe('spellbook_window: hud.update() refresh call site', () => {
  it("refreshes the open spellbook's +/- toggles from hud.update() while displayed", () => {
    // Pin the hud.ts call site so a refactor cannot silently stop the open
    // spellbook's hotbar toggles from tracking action-bar changes.
    expect(hud).toContain(
      'if (this.spellbookWindow.isOpen) this.spellbookWindow.refreshHotbarControls();',
    );
  });

  it('keeps the in-place refresh updating the aria-pressed + disabled state per toggle', () => {
    // The call-site guard above proves the refresh fires; this pins what it WRITES.
    // refreshHotbarControls keys off `btn` (vs appendRow's `toggle`), so the row
    // guard does not cover this path: without these, the open spellbook's toggles
    // would stop tracking the bar (the whole reason this path is not-cold).
    expect(code).toContain("btn.setAttribute('aria-pressed'");
    expect(code).toContain('btn.disabled = !onBar && !hasFree');
  });

  it('elides the per-frame toggle writes to on-bar flips only (this runs every frame)', () => {
    // refreshHotbarControls fires on EVERY animation frame while the window is open, so
    // the +/- text, the remove class, the aria-pressed, and the i18n-backed aria-label
    // are gated on an actual on-bar membership flip (read from aria-pressed, which
    // appendRow seeds), not rewritten unconditionally. Only `disabled` stays per-frame
    // (it depends on hasFree). A revert to unconditional writes drops this guard.
    expect(code).toContain("(btn.getAttribute('aria-pressed') === 'true') !== onBar");
  });
});
