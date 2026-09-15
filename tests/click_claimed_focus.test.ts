// The "Enter to confirm stopped working" repair: a click handler that opens a
// modal confirm and focuses its OK button must keep that focus through the
// input layer's post-click focus drop. Pure rule in src/game/click_claimed_focus.ts;
// tests/input.test.ts pins the Input wiring on top of it.
import { describe, expect, it } from 'vitest';
import { clickClaimedModalFocus, MODAL_DIALOG_SELECTOR } from '../src/game/click_claimed_focus';

function node(modal: object | null): { closest: (selector: string) => unknown } {
  return { closest: (selector) => (selector === MODAL_DIALOG_SELECTOR ? modal : null) };
}

describe('clickClaimedModalFocus', () => {
  const modal = { id: 'confirm-dialog' };

  it('keeps focus the handler parked inside a modal the click target is outside of', () => {
    // A context-menu row (outside every modal) opened the destroy confirm and
    // focused its OK button.
    expect(clickClaimedModalFocus(node(modal), node(null))).toBe(true);
  });

  it('keeps it when the target is inside a DIFFERENT modal (a nested confirm)', () => {
    expect(clickClaimedModalFocus(node(modal), node({ id: 'options' }))).toBe(true);
  });

  it('still drops a button the mouse clicked INSIDE that same modal', () => {
    expect(clickClaimedModalFocus(node(modal), node(modal))).toBe(false);
  });

  it('never claims focus that is outside every modal', () => {
    expect(clickClaimedModalFocus(node(null), node(null))).toBe(false);
    expect(clickClaimedModalFocus(node(null), node(modal))).toBe(false);
  });

  it('degrades to "not claimed" for a fake or detached node with no closest()', () => {
    expect(clickClaimedModalFocus({}, null)).toBe(false);
    expect(clickClaimedModalFocus({}, undefined)).toBe(false);
  });

  it('a null/undefined click target (a non-primary release) counts as outside every modal', () => {
    expect(clickClaimedModalFocus(node(modal), null)).toBe(true);
  });
});
