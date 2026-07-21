// Live focus-indicator check: the companion to the OUTLINE-scoped Node guard
// (tests/focus_visible_guard.test.ts). That source scan can only see :focus-visible rules
// that DRAW an outline; a focus indicator carried by a box-shadow glow (several pre-game
// shell controls use outline:none + box-shadow) is invisible to it. This opt-in browser test
// keyboard-focuses each shell control and reads its REAL computed style, confirming a present,
// steady focus indicator that never animates to nothing on focus.
//
// :focus-visible matches only under the keyboard heuristic, so each control is reached with a
// real Tab keypress (userEvent.tab); a programmatic .focus() would set :focus but not
// :focus-visible, and the glow would never apply. The ring fades IN over --transition-speed
// and lands steady (it is never transitioned TO removal on focus), so each assertion polls
// until the steady indicator is present.
//
// The eight controls the focus_visible_guard header named do NOT all use a box-shadow:
//   - six draw a box-shadow glow (asserted: box-shadow !== 'none');
//   - .header-logo-btn draws an OUTLINE ring (already Node-guard-covered; asserted here too);
//   - .wallet-mini carries a border-color shift only (outline:none, no box-shadow), which
//     neither the Node guard nor a box-shadow check sees, so it is asserted by its border.
// Each is asserted by its ACTUAL indicator type, so a real missing-indicator regression fails
// loudly rather than passing a vacuous or wrong-typed check.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup } from './_harness';

afterEach(cleanup);

// Mount one shell control as the ONLY focusable element, then Tab to it (keyboard modality so
// :focus-visible matches). Returns the focused node; throws if the Tab does not land on it.
async function keyboardFocus(className: string): Promise<HTMLElement> {
  const node = document.createElement('button');
  node.className = className;
  node.textContent = 'shell control';
  document.body.appendChild(node);
  await userEvent.tab();
  if (document.activeElement !== node) {
    throw new Error(
      `keyboard Tab did not focus .${className}; landed on ${document.activeElement?.nodeName}`,
    );
  }
  return node;
}

// The six pre-game shell controls whose :focus-visible indicator is a box-shadow glow (under
// outline:none, or alongside an outline). The outline-scoped Node guard cannot see these.
const BOX_SHADOW_CONTROLS = [
  'mobile-menu-toggle',
  'nav-link',
  'lang-select-dropdown',
  'homepage-music-btn',
  'donate-cta',
  'wallet-cta',
];

describe('pre-game shell focus indicators are present and steady (the box-shadow gap)', () => {
  for (const cls of BOX_SHADOW_CONTROLS) {
    it(`.${cls} shows a box-shadow focus ring on keyboard focus`, async () => {
      const node = await keyboardFocus(cls);
      await vi.waitFor(() =>
        expect(getComputedStyle(node).boxShadow, `.${cls} :focus-visible box-shadow`).not.toBe(
          'none',
        ),
      );
    });
  }

  it('.header-logo-btn draws a steady outline ring (outline-scoped, complements the Node guard)', async () => {
    const node = await keyboardFocus('header-logo-btn');
    const cs = getComputedStyle(node);
    expect(cs.outlineStyle, '.header-logo-btn :focus-visible outline-style').not.toBe('none');
    expect(
      Number.parseFloat(cs.outlineWidth),
      '.header-logo-btn :focus-visible outline-width',
    ).toBeGreaterThan(0);
  });

  it('.wallet-mini shows a border-color focus indicator distinct from its resting border', async () => {
    // .wallet-mini uses neither box-shadow nor outline; its indicator is a border-color (and
    // text-color) shift, transitioned in. Capture the resting border, then assert the focused
    // border differs (a present, distinct focus indicator the other two checks cannot see).
    const node = document.createElement('button');
    node.className = 'wallet-mini';
    node.textContent = 'wallet';
    document.body.appendChild(node);
    const restingBorderColor = getComputedStyle(node).borderColor;
    await userEvent.tab();
    if (document.activeElement !== node) {
      throw new Error('keyboard Tab did not focus .wallet-mini');
    }
    await vi.waitFor(() =>
      expect(getComputedStyle(node).borderColor, '.wallet-mini focus border-color').not.toBe(
        restingBorderColor,
      ),
    );
  });
});
