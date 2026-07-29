import { describe, expect, it } from 'vitest';
import {
  actionBarEditAllowed,
  actionBarLockMenuAction,
} from '../src/ui/hud/action_bar/action_bar_lock_core';

describe('action bar lock policy', () => {
  it('allows layout edits only while unlocked', () => {
    expect(actionBarEditAllowed(false)).toBe(true);
    expect(actionBarEditAllowed(true)).toBe(false);
  });

  it('builds the contextual toggle from the live lock state', () => {
    expect(actionBarLockMenuAction(false)).toEqual({
      nextLocked: true,
      labelKey: 'hudChrome.actionBar.lock',
    });
    expect(actionBarLockMenuAction(true)).toEqual({
      nextLocked: false,
      labelKey: 'hudChrome.actionBar.unlock',
    });
  });
});
