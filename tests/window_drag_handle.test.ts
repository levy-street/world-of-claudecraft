import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWindowDragHandle, STATIC_DIALOG_WINDOW_IDS } from '../src/ui/window_drag_handle';

// Fake-DOM harness (this repo deliberately has no jsdom; tests/CLAUDE.md: model
// only the contract under test). isWindowDragHandle touches exactly: the target
// ownerDocument.body.classList, target.closest(sel), and win.id / win.contains.
function scenario(
  winId: string,
  opts: { mobile?: boolean; targetIsControl?: boolean; headerless?: boolean } = {},
) {
  const body = { classList: { contains: (c: string) => c === 'mobile-touch' && !!opts.mobile } };
  const ownerDocument = { body };
  const titlebar = { ownerDocument } as unknown as HTMLElement;
  // The headerless window (map) is its own drag target: its body carries closest
  // (returning null for both selectors) so the id + target === win rule fires.
  const win = {
    id: winId,
    ownerDocument,
    contains: (el: unknown) => el === titlebar || el === win,
    closest: () => null,
  } as unknown as HTMLElement & { contains(el: unknown): boolean };
  const target = {
    ownerDocument,
    closest: (sel: string): unknown => {
      if (sel.includes('.window-titlebar')) return titlebar;
      // The excluded-controls selector (button/input/.x-btn/...) resolves to the
      // target only when it is itself such a control.
      return opts.targetIsControl ? target : null;
    },
  } as unknown as HTMLElement;
  return { target: opts.headerless ? (win as unknown as HTMLElement) : target, win };
}

describe('isWindowDragHandle: grammar-window titlebar drag', () => {
  it('a titlebar drag on a normal framed window begins a move', () => {
    const { target, win } = scenario('vendor-window');
    expect(isWindowDragHandle(target, win)).toBe(true);
  });

  it('the Esc options menu NOW drags from its titlebar (maintainer drag/resize direction)', () => {
    // Supersedes the P2 fixed-window ruling: the Codex drags like every grammar window.
    const { target, win } = scenario('options-menu');
    expect(isWindowDragHandle(target, win)).toBe(true);
  });

  it('still bails the options menu on the mobile touch HUD (full-screen layout)', () => {
    const { target, win } = scenario('options-menu', { mobile: true });
    expect(isWindowDragHandle(target, win)).toBe(false);
  });

  it('an interactive control inside a draggable titlebar never starts a drag', () => {
    const { target, win } = scenario('vendor-window', { targetIsControl: true });
    expect(isWindowDragHandle(target, win)).toBe(false);
  });

  it('the headerless world map still drags from its body (regression: exclusion is scoped)', () => {
    const { target, win } = scenario('map-window', { headerless: true });
    expect(isWindowDragHandle(target, win)).toBe(true);
  });

  it('static centered dialogs never drag, even from a real titlebar', () => {
    // Quest/gossip, modal confirm + input prompts, the delve board / rite /
    // lockpick popups, the cursor-anchored loot window, and the report form all
    // share a header grammar with the movable windows but are transient
    // question-and-answer surfaces: dragging them bakes a session-sticky
    // windowMoved position for a dialog the player never expects to manage.
    for (const id of [
      'quest-dialog',
      'confirm-dialog',
      'delve-board',
      'lockpick-panel',
      'delve-rite-panel',
      'loot-window',
      'report-window',
    ]) {
      const { target, win } = scenario(id);
      expect(isWindowDragHandle(target, win), `${id} must not drag`).toBe(false);
    }
  });

  it('the deliberately movable windows keep dragging (exclusion list is scoped)', () => {
    for (const id of ['bags', 'char-window', 'market-window', 'quest-log-window']) {
      const { target, win } = scenario(id);
      expect(isWindowDragHandle(target, win), `${id} must drag`).toBe(true);
    }
  });

  it('placeNewWindow honors the same static ruling (no cascade offset either)', () => {
    // A never-moves dialog must not be cascade-offset on open: the 28px cascade
    // bakes a session-sticky windowMoved position the player now has no drag
    // to recover from. The Hud's skip must consume THIS set (not a hand-copied
    // id pair) so the two rulings cannot drift.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toContain(
      "if (el.dataset.windowMoved === '1' || STATIC_DIALOG_WINDOW_IDS.has(el.id)) return;",
    );
    // The set still covers the two ids the old inline skip named.
    expect(STATIC_DIALOG_WINDOW_IDS.has('loot-window')).toBe(true);
    expect(STATIC_DIALOG_WINDOW_IDS.has('confirm-dialog')).toBe(true);
  });
});
