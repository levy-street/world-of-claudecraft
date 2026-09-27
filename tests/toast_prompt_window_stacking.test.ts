import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STORE_PROMPT_HOST_ID } from '../src/ui/store_prompt_host';

// Guard for the "deny toast / prompt renders behind an open window" bug class.
//
// hud.ts's bringWindowToFront cycles every focused .window through a 50-89
// z-index band (normalizeWindowZ resets once windowZ reaches 89), on top of
// the unfocused .window base of 20 (layout.css). Two HUD overlays that must
// always paint above any window did not clear that band:
//   - #error-msg (hud.css) carried NO z-index at all (the implicit auto tier),
//     so a deny toast (e.g. "This cannot be mailed.") rendered BEHIND any open
//     window unconditionally, invisible until the window was dragged aside
//     (it still reached the chat log via showLocalizedError's mirror, so the
//     line was not lost, only invisible on screen).
//   - #prompt-stack (hud.css) was fixed at z-index 80, INSIDE the focus band:
//     a prompt mounted there (e.g. the vendor sell-confirm prompt,
//     bags_window.ts showSellConfirmPrompt) rendered behind whichever window
//     had most recently climbed past 80, intermittently, depending on how
//     much window-focus churn the session already had.
// Both now sit at 90, the tier #ctx-menu already established for "always
// above the window band" (pinned separately by
// tests/ctx_menu_mobile_stacking.test.ts).
//
// File-based (read CSS, regex/flat-parse), the ctx_menu_mobile_stacking.test.ts
// idiom: no jsdom.
const HUD_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.css', import.meta.url)),
  'utf8',
);
const HUD_MOBILE_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.mobile.css', import.meta.url)),
  'utf8',
);
const HUD_TS = readFileSync(fileURLToPath(new URL('../src/ui/hud.ts', import.meta.url)), 'utf8');
const BASE_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/base.css', import.meta.url)),
  'utf8',
);

function zIndexOf(css: string, selectorPattern: RegExp): number {
  const block = css.match(selectorPattern);
  if (!block) throw new Error(`no block matching ${selectorPattern}`);
  const z = block[0].match(/z-index:\s*(\d+)/);
  if (!z) throw new Error(`no z-index inside the block matching ${selectorPattern}`);
  return Number(z[1]);
}

describe('window focus-band ceiling (hud.ts)', () => {
  it('bringWindowToFront normalizes once the band reaches 89', () => {
    // The overlays below must clear THIS literal, not a stale assumption of it.
    expect(HUD_TS).toContain('if (this.windowZ >= 89) this.normalizeWindowZ();');
  });
});

describe('#error-msg always paints above any open window', () => {
  it('the desktop base carries an explicit z-index above the 50-89 focus band', () => {
    const z = zIndexOf(HUD_CSS, /#error-msg\s*\{[^}]*\}/);
    expect(z).toBe(90);
    expect(z).toBeGreaterThan(89);
  });

  it('the mobile override clears the Bags sheet forced z-index (95)', () => {
    const sheetZ = zIndexOf(HUD_MOBILE_CSS, /z-index:\s*95\s*!important/);
    const mobileErrorZ = zIndexOf(HUD_MOBILE_CSS, /body\.mobile-touch #error-msg\s*\{[^}]*\}/);
    expect(sheetZ).toBe(95);
    expect(mobileErrorZ).toBeGreaterThan(sheetZ);
  });
});

describe('#prompt-stack always paints above any open window', () => {
  it('the desktop base moved off the 80 mid-band value, above the 50-89 focus band', () => {
    // Anchored: "#store-prompt-stack {" (below) contains "#prompt-stack {" as a
    // substring, and String.match takes the first hit in file order.
    const z = zIndexOf(HUD_CSS, /(?<![-\w])#prompt-stack\s*\{[^}]*\}/);
    expect(z).toBe(90);
    expect(z).toBeGreaterThan(89);
  });

  it('the mobile override already clears every known tier (unchanged by this fix)', () => {
    const mobilePromptZ = zIndexOf(HUD_MOBILE_CSS, /body\.mobile-touch #prompt-stack\s*\{[^}]*\}/);
    expect(mobilePromptZ).toBe(120);
  });
});

// The store purchase confirm's own stacking bug: #prompt-stack lives INSIDE
// #ui, a position:fixed z-index:10 stacking context (base.css), while the
// Armory and mount inspect overlays mount on <body> at 90. A z-index inside
// #ui ranks against other #ui children only, so the store decision (96 in
// #prompt-stack) painted UNDER the body-level inspector: the player clicked
// Purchase and saw nothing, while the hidden prompt's focused Confirm still
// took Enter. src/ui/store_prompt_host.ts moves that decision to a body-level
// host, #store-prompt-stack, which must itself clear the inspector.
const COMPONENTS_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/components.css', import.meta.url)),
  'utf8',
);

// Every selector below is built from the TS constant, so renaming the host id
// cannot leave the CSS orphaned with green Node suites.
const HOST = `#${STORE_PROMPT_HOST_ID}`;
const HOST_BLOCK_RE = new RegExp(`${HOST}\\s*\\{[^}]*\\}`);
const MOBILE_HOST_BLOCK_RE = new RegExp(`body\\.mobile-touch ${HOST}\\s*\\{[^}]*\\}`);
const INSPECTOR_BLOCK_RE = /\.armory-inspect-overlay\s*\{[^}]*\}/;

describe(`${HOST} paints above the body-level inspect overlays`, () => {
  it('the desktop host is fixed against the viewport and outranks .armory-inspect-overlay (90)', () => {
    const hostBlock = HUD_CSS.match(HOST_BLOCK_RE);
    expect(hostBlock).not.toBeNull();
    expect(hostBlock?.[0]).toMatch(/position:\s*fixed;/);
    const hostZ = zIndexOf(HUD_CSS, HOST_BLOCK_RE);
    const inspectorZ = zIndexOf(COMPONENTS_CSS, INSPECTOR_BLOCK_RE);
    const uiZ = zIndexOf(BASE_CSS, /#ui\s*\{[^}]*\}/);
    expect(inspectorZ).toBe(90);
    // The premise: a #prompt-stack z-index cannot help, because #ui as a whole
    // sits below the inspector.
    expect(uiZ).toBeLessThan(inspectorZ);
    expect(hostZ).toBeGreaterThan(inspectorZ);
  });

  it('the mobile host clears the inspector and the raised mobile-controls tiers (96)', () => {
    const mobileHostZ = zIndexOf(HUD_MOBILE_CSS, MOBILE_HOST_BLOCK_RE);
    // The inspector carries no mobile z-index override (hud.mobile.css only
    // re-pads it), so its desktop 90 is the value in force on touch too; read
    // it rather than assume it, and pin that no override has appeared.
    const inspectorZ = zIndexOf(COMPONENTS_CSS, INSPECTOR_BLOCK_RE);
    const mobileInspector = HUD_MOBILE_CSS.match(
      /body\.mobile-touch \.armory-inspect-overlay\s*\{[^}]*\}/,
    );
    expect(mobileInspector).not.toBeNull();
    expect(mobileInspector?.[0]).not.toMatch(/z-index/);
    expect(mobileHostZ).toBeGreaterThan(inspectorZ);
    // The raised mobile-controls tiers (the open menu strip, a touch item drag).
    const raisedControls = HUD_MOBILE_CSS.match(/#mobile-controls[^{]*\{[^}]*z-index:\s*96/);
    expect(raisedControls).not.toBeNull();
    expect(mobileHostZ).toBeGreaterThan(96);
  });

  it('the store prompt geometry reset and the mobile result hit shield apply in either host', () => {
    const either = `:is\\(#prompt-stack, ${HOST}\\)`;
    expect(COMPONENTS_CSS).toMatch(
      new RegExp(`${either} \\.woc-store-prompt\\s*\\{[^}]*position:\\s*relative;`),
    );
    expect(COMPONENTS_CSS).toMatch(
      new RegExp(
        `body\\.mobile-touch ${either} \\.woc-store-global-result\\s*\\{[^}]*pointer-events:\\s*auto;`,
      ),
    );
  });
});

// The inverse bug: #proc-overlay (the Rising Phoenix / Warlock soul-fragment
// bank) is appended straight to <body> (hud.ts), a SIBLING of #ui rather than
// a descendant, so its own position:fixed z-index competes with #ui's AS A
// WHOLE, not with any window's internal focus band. #ui's desktop base is 10
// (base.css); the proc overlay's old 30 painted it ABOVE every window, so a
// Hot Streak proc (or the soul-fragment meter) drew over an open Bags/
// Spellbook/etc. window instead of sitting behind it. 5 keeps it above the 3D
// world layers (#game-canvas 0, #nameplates 1) while sitting below #ui.
describe('#proc-overlay paints behind every window (the inverse stacking bug)', () => {
  it('#ui (10, base.css) outranks the proc overlay, so it renders under any open window', () => {
    const uiZ = zIndexOf(BASE_CSS, /#ui\s*\{[^}]*\}/);
    const procZ = zIndexOf(HUD_CSS, /#proc-overlay\s*\{[^}]*\}/);
    expect(uiZ).toBe(10);
    expect(procZ).toBe(5);
    expect(procZ).toBeLessThan(uiZ);
  });

  it('still paints above the 3D world layers (#game-canvas, #nameplates)', () => {
    const canvasZ = zIndexOf(BASE_CSS, /#game-canvas\s*\{[^}]*\}/);
    const nameplatesZ = zIndexOf(BASE_CSS, /#nameplates\s*\{[^}]*\}/);
    const procZ = zIndexOf(HUD_CSS, /#proc-overlay\s*\{[^}]*\}/);
    expect(procZ).toBeGreaterThan(canvasZ);
    expect(procZ).toBeGreaterThan(nameplatesZ);
  });
});
