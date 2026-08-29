// The shared tap-mode decision core: the one table the action radial, the
// consumables row and the menu strip all ask, so tap mode cannot mean three
// different things. Node-only, no DOM (UI_PURE_CORES).
//
// Both settings states are covered for every target, because the whole promise of
// the setting is that turning it OFF leaves the gesture layer exactly as it was.
//
// The anchorRole arm covers the second thing the table has to answer: a control
// with no default action of its own (Quick Actions) toggles its row instead of
// running one, and must reach the same row from a bare tap in EITHER mode.

import { describe, expect, it } from 'vitest';
import { resolveTapMenuPress } from '../src/ui/hud/tap_menu_core';

describe('resolveTapMenuPress: tap mode ON', () => {
  it('opens the menu on the first press of the control, casting nothing', () => {
    expect(resolveTapMenuPress({ tapMenus: true, open: false, target: 'anchor' })).toEqual({
      kind: 'open',
    });
  });

  it('runs the default action when the control is pressed again with the menu open', () => {
    expect(resolveTapMenuPress({ tapMenus: true, open: true, target: 'anchor' })).toEqual({
      kind: 'default',
    });
  });

  it('chooses the item that was pressed, carrying its row position', () => {
    expect(resolveTapMenuPress({ tapMenus: true, open: true, target: 'item', index: 3 })).toEqual({
      kind: 'choose',
      index: 3,
    });
  });

  it('dismisses on a press outside the open menu', () => {
    expect(resolveTapMenuPress({ tapMenus: true, open: true, target: 'outside' })).toEqual({
      kind: 'dismiss',
    });
  });

  it('does nothing for an item or an outside press while the menu is closed', () => {
    // Neither can happen through the UI (a closed row paints nothing and arms no
    // outside listener), so the answer is silence rather than a stray cast.
    expect(resolveTapMenuPress({ tapMenus: true, open: false, target: 'item', index: 0 })).toEqual({
      kind: 'none',
    });
    expect(resolveTapMenuPress({ tapMenus: true, open: false, target: 'outside' })).toEqual({
      kind: 'none',
    });
  });

  it('does not choose an item with no row position', () => {
    expect(resolveTapMenuPress({ tapMenus: true, open: true, target: 'item' })).toEqual({
      kind: 'none',
    });
  });
});

describe('resolveTapMenuPress: tap mode OFF', () => {
  it('hands every press of the control to the gesture layer, open or not', () => {
    // Including while a menu IS open: that is the assistive path, where the
    // gesture layer's own guard already ignores the press. Answering 'default'
    // there would change what the setting being off does.
    expect(resolveTapMenuPress({ tapMenus: false, open: false, target: 'anchor' })).toEqual({
      kind: 'gesture',
    });
    expect(resolveTapMenuPress({ tapMenus: false, open: true, target: 'anchor' })).toEqual({
      kind: 'gesture',
    });
  });

  it('still chooses an item of a menu opened by assistive activation', () => {
    expect(resolveTapMenuPress({ tapMenus: false, open: true, target: 'item', index: 1 })).toEqual({
      kind: 'choose',
      index: 1,
    });
  });

  it('never dismisses on an outside press, which only tap mode listens for', () => {
    expect(resolveTapMenuPress({ tapMenus: false, open: true, target: 'outside' })).toEqual({
      kind: 'none',
    });
  });
});

// Quick Actions has no default action of its own, so its own press only opens or
// closes the row. Every assertion below is paired with the 'action' answer for
// the same input, since the point of the role is that it changes those and only
// those.
describe("resolveTapMenuPress: anchorRole 'toggle'", () => {
  it('closes the row on the press after the one that opened it, in tap mode', () => {
    expect(
      resolveTapMenuPress({ tapMenus: true, open: true, target: 'anchor', anchorRole: 'toggle' }),
    ).toEqual({ kind: 'dismiss' });
    // The same press on an 'action' control still runs its default action.
    expect(
      resolveTapMenuPress({ tapMenus: true, open: true, target: 'anchor', anchorRole: 'action' }),
    ).toEqual({ kind: 'default' });
  });

  it('opens on the first tap-mode press, exactly like every other control', () => {
    expect(
      resolveTapMenuPress({ tapMenus: true, open: false, target: 'anchor', anchorRole: 'toggle' }),
    ).toEqual({ kind: 'open' });
  });

  it('leaves the press to the gesture layer while the row is DOWN and the setting is off', () => {
    // Load-bearing: the gesture layer resolves a bare tap at RELEASE, so
    // answering anything else here would trade the swipe for the tap.
    expect(
      resolveTapMenuPress({ tapMenus: false, open: false, target: 'anchor', anchorRole: 'toggle' }),
    ).toEqual({ kind: 'gesture' });
  });

  it('closes the row on the next press with the setting OFF too', () => {
    // A plain tap can open this row without tap mode, so it needs a tap-driven
    // way back out; an 'action' control keeps the assistive-path answer.
    expect(
      resolveTapMenuPress({ tapMenus: false, open: true, target: 'anchor', anchorRole: 'toggle' }),
    ).toEqual({ kind: 'dismiss' });
    expect(
      resolveTapMenuPress({ tapMenus: false, open: true, target: 'anchor', anchorRole: 'action' }),
    ).toEqual({ kind: 'gesture' });
  });

  it('dismisses on an outside press in EITHER mode', () => {
    for (const tapMenus of [true, false]) {
      expect(
        resolveTapMenuPress({ tapMenus, open: true, target: 'outside', anchorRole: 'toggle' }),
      ).toEqual({ kind: 'dismiss' });
    }
    // Still silence while the row is down: nothing arms the listener there.
    expect(
      resolveTapMenuPress({
        tapMenus: false,
        open: false,
        target: 'outside',
        anchorRole: 'toggle',
      }),
    ).toEqual({ kind: 'none' });
  });

  it('leaves the item rule alone: a role is about the ANCHOR', () => {
    expect(
      resolveTapMenuPress({
        tapMenus: false,
        open: true,
        target: 'item',
        index: 2,
        anchorRole: 'toggle',
      }),
    ).toEqual({ kind: 'choose', index: 2 });
  });

  it("defaults to 'action', so an omitted role changes nothing", () => {
    for (const tapMenus of [true, false]) {
      for (const open of [true, false]) {
        for (const target of ['anchor', 'item', 'outside'] as const) {
          expect(resolveTapMenuPress({ tapMenus, open, target, index: 1 })).toEqual(
            resolveTapMenuPress({ tapMenus, open, target, index: 1, anchorRole: 'action' }),
          );
        }
      }
    }
  });
});
