// Pure gates for the action-bar slot edit gestures: src/ui/hud/action_bar/action_bar_lock.ts.
// The lock option (issue #1361) plus the Shift-to-move drag rule.
import { describe, expect, it } from 'vitest';
import {
  type ActionBarEditGesture,
  isActionBarEditAllowed,
  isSlotMoveDragAllowed,
  isSlotMoveModifierHeld,
} from '../src/ui/hud/action_bar/action_bar_lock';

describe('isActionBarEditAllowed', () => {
  const gestures: ActionBarEditGesture[] = ['drag', 'drop', 'clear'];

  it('allows every edit gesture when the bars are unlocked (default)', () => {
    for (const gesture of gestures) {
      expect(isActionBarEditAllowed(false, gesture)).toBe(true);
    }
  });

  it('blocks every edit gesture when the bars are locked', () => {
    for (const gesture of gestures) {
      expect(isActionBarEditAllowed(true, gesture)).toBe(false);
    }
  });
});

describe('isSlotMoveModifierHeld', () => {
  it('is exactly the Shift key state of the event', () => {
    expect(isSlotMoveModifierHeld({ shiftKey: true })).toBe(true);
    expect(isSlotMoveModifierHeld({ shiftKey: false })).toBe(false);
  });
});

describe('isSlotMoveDragAllowed', () => {
  it('starts a slot drag only when unlocked AND Shift is held', () => {
    expect(isSlotMoveDragAllowed(false, { shiftKey: true })).toBe(true);
  });

  it('refuses a plain (no Shift) drag so a press-and-drag stays a cast gesture', () => {
    expect(isSlotMoveDragAllowed(false, { shiftKey: false })).toBe(false);
  });

  it('refuses a Shift drag while the bars are locked', () => {
    expect(isSlotMoveDragAllowed(true, { shiftKey: true })).toBe(false);
    expect(isSlotMoveDragAllowed(true, { shiftKey: false })).toBe(false);
  });
});
