import { describe, expect, it } from 'vitest';
import {
  ACTION_BAR_BIND_BANNER_FALLBACK_LIFT,
  actionBarBindBannerPlacement,
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

// The banner used to hang off #actionbar-stack (bottom: 100%), which assumed the
// bars still lived in that stack. A bar moved with Interface Unlock is reparented
// to the HUD root, so the stack anchor stopped tracking it and the detached bar
// painted over the banner's Done / Reset buttons: every "Done" click became a
// slot click that armed another capture, with no way out short of a restart.
// The placement is now computed against the LIVE bar's box.
describe('actionBarBindBannerPlacement', () => {
  const banner = { width: 350, height: 100 };
  const viewport = { width: 1600, height: 900 };

  it('centres the banner above the live bar with the gap', () => {
    const bar = { left: 494, top: 720, width: 640, height: 66 };
    expect(actionBarBindBannerPlacement({ bar, banner, viewport, gap: 8 })).toEqual({
      left: 494 + 320 - 175,
      top: 720 - 8 - 100,
    });
  });

  it('drops below a bar parked against the top edge instead of leaving the screen', () => {
    const bar = { left: 500, top: 20, width: 640, height: 66 };
    expect(actionBarBindBannerPlacement({ bar, banner, viewport, gap: 8 })).toEqual({
      left: 645,
      top: 20 + 66 + 8,
    });
  });

  it('clamps a bar dragged to a side edge back inside the viewport', () => {
    const bar = { left: -200, top: 720, width: 640, height: 66 };
    const placed = actionBarBindBannerPlacement({ bar, banner, viewport, gap: 8 });
    expect(placed.left).toBe(8);
    const right = { left: 1500, top: 720, width: 640, height: 66 };
    expect(actionBarBindBannerPlacement({ bar: right, banner, viewport, gap: 8 }).left).toBe(
      1600 - 350 - 8,
    );
  });

  it('falls back to the stock bottom-centre seat when the bar has no box', () => {
    expect(actionBarBindBannerPlacement({ bar: null, banner, viewport, gap: 8 })).toEqual({
      left: 625,
      top: 900 - 100 - ACTION_BAR_BIND_BANNER_FALLBACK_LIFT,
    });
  });
});
