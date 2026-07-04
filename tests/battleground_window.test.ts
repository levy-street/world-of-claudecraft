// WCAG-chrome + no-magic source guard for the battleground window DOM painter
// (the arena_window.test.ts pattern for the family it was cloned from).
//
// The painter's DOM methods need a document, so they are not exercised in this
// Node suite; the pure decisions it renders are covered by
// tests/battleground_window_view.test.ts. This guard pins the a11y-bearing
// markup (focusable controls + aria labels + focus-return), the no-magic-values
// contract (no literal colors in TS), and the Hud call sites that keep the
// window fresh and focus-safe.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/battleground_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('battleground_window: WCAG chrome (focusable controls + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildBgWindowView(');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('hudChrome.bg.window.close')");
  });

  it('routes every close path through close() so focus returns to the opener', () => {
    expect(code).toContain("data-close]')?.addEventListener('click', () => this.close())");
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
  });

  it('marks the dialog root once on open (never inside render)', () => {
    expect(code).toContain("markDialogRoot(root, { labelledBy: 'bg-title' })");
  });

  it('keeps the offline / not-yet-synced unavailable note', () => {
    expect(code).toContain("t('hudChrome.bg.window.offlineNote')");
  });

  it('labels the Watch buttons for screen readers', () => {
    expect(code).toContain("t('hudChrome.bg.window.watchAria'");
  });
});

describe('battleground_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });
});

describe('battleground_window: mediumHud redraw call site', () => {
  it("redraws the open window from hud.update()'s mediumHud band", () => {
    expect(hud).toContain(
      "if ($('#battleground-window').style.display === 'block') this.battlegroundWindow.render();",
    );
  });

  it('routes the match-start auto-close through close() (focus-return), never a raw hide', () => {
    expect(hud).toContain(
      "if (inBgMatch && !this.bgMatchSeen && $('#battleground-window').style.display === 'block') {",
    );
    expect(hud).not.toContain("'#battleground-window').style.display = 'none'");
  });
});

describe('battleground_window: offline skip-rebuild sentinel (collision-proof)', () => {
  it('uses a named offline sentinel sig the live JSON sig can never collide with', () => {
    const m = code.match(/BG_OFFLINE_SIG\s*=\s*'([^']*)'/);
    expect(m, 'BG_OFFLINE_SIG literal').not.toBeNull();
    const sentinel = m ? m[1] : '';
    expect(sentinel.length).toBeGreaterThan(0);
    expect(sentinel.startsWith('[')).toBe(false);
    expect(code).toContain('this.lastSig === BG_OFFLINE_SIG');
    expect(code).toContain('this.lastSig = BG_OFFLINE_SIG');
  });
});

describe('battleground indicator + match hud painters: no magic values', () => {
  // The QA coverage gap: the window painter above was source-guarded but the
  // sibling DOM painters were not. Same contract: colors live in the
  // stylesheet behind tokens, never as TS literals.
  for (const file of ['battleground_indicator.ts', 'battleground_hud.ts']) {
    it(`${file} carries no literal hex or rgb color in TS`, () => {
      const src = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
      const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgb = src.match(/rgba?\(/g) ?? [];
      expect(hex, `hex colors in ${file}: ${hex.join(', ')}`).toEqual([]);
      expect(rgb, `rgb colors in ${file}`).toEqual([]);
    });
  }
});
