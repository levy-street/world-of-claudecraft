import { describe, expect, it } from 'vitest';
import {
  actionBarBindEnter,
  actionBarBindResolveCapture,
  actionBarBindSelectSlot,
  actionBarBindStatus,
} from '../src/ui/hud/action_bar/action_bar_bind_core';

describe('actionBarBindEnter', () => {
  it('starts with no slot selected and no feedback', () => {
    const state = actionBarBindEnter();
    expect(state).toEqual({ selectedSlot: null, lastBoundKeyLabel: null });
    expect(actionBarBindStatus(state)).toBe('idle');
  });
});

describe('actionBarBindSelectSlot', () => {
  it('selects the clicked slot and carries no feedback', () => {
    const state = actionBarBindSelectSlot(5);
    expect(state).toEqual({ selectedSlot: 5, lastBoundKeyLabel: null });
    expect(actionBarBindStatus(state)).toBe('capturing');
  });

  it('replaces an earlier selection when a different slot is clicked mid-capture', () => {
    const first = actionBarBindSelectSlot(2);
    const second = actionBarBindSelectSlot(9);
    expect(first.selectedSlot).toBe(2);
    expect(second.selectedSlot).toBe(9);
  });

  it('clears any leftover bound-key feedback from a prior capture', () => {
    const bound = actionBarBindResolveCapture('R');
    expect(actionBarBindStatus(bound)).toBe('bound');
    const reselected = actionBarBindSelectSlot(bound.selectedSlot ?? 0);
    expect(reselected.lastBoundKeyLabel).toBeNull();
  });
});

describe('actionBarBindResolveCapture', () => {
  it('records the bound key label and clears the selection', () => {
    const state = actionBarBindResolveCapture('Shift+R');
    expect(state).toEqual({ selectedSlot: null, lastBoundKeyLabel: 'Shift+R' });
    expect(actionBarBindStatus(state)).toBe('bound');
  });

  it('a null label (cancelled or rejected capture) falls back to idle', () => {
    const state = actionBarBindResolveCapture(null);
    expect(state).toEqual({ selectedSlot: null, lastBoundKeyLabel: null });
    expect(actionBarBindStatus(state)).toBe('idle');
  });
});
