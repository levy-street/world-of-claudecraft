import { describe, expect, it } from 'vitest';
import { FocusTargetSlots, focusTargetAction } from '../src/ui/focus_targets_core';

describe('focus target slots', () => {
  it('keeps assigned slots stable when entities leave and return', () => {
    const slots = new FocusTargetSlots();
    slots.assign(0, 7);
    slots.assign(1, 9);
    expect(slots.target(0, () => false)).toBeNull();
    expect(slots.target(0, (id) => id === 7)).toBe(7);
    expect(slots.target(1, () => true)).toBe(9);
    slots.assign(0, null);
    expect(slots.target(0, () => true)).toBeNull();
    expect(slots.assign(3, 8)).toBe(false);
  });
  it('routes only the declared focus actions and preserves their slot numbers', () => {
    expect(focusTargetAction('targetFocus2')).toEqual({ slot: 1, assign: false });
    expect(focusTargetAction('setFocus3')).toEqual({ slot: 2, assign: true });
    expect(focusTargetAction('targetFocus4')).toBeNull();
    expect(focusTargetAction('targetParty1')).toBeNull();
  });
});
