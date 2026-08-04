// Pure gate for the "lock action bars" option (issue #1361): src/ui/hud/action_bar/action_bar_lock.ts.
import { describe, expect, it } from 'vitest';
import {
  type ActionBarEditGesture,
  isActionBarEditAllowed,
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
