// @vitest-environment happy-dom
// Pointer-level regressions for the consumables seat's gesture controller, the
// DOM twin of the radial ring's. The RULES have their own suite
// (consumable_strip_core.test.ts); this covers the two defects the twin shared:
// no release path other than the seat's own (a setPointerCapture throw plus a
// finger that left the seat stranded the drag and left the row painted), and a
// row clamped against window.innerWidth while the overlay is sized from the
// shared --app-vw box and never widened for the device's safe area.
//
// The seat is ONE element, so the radial's per-pointer drag map has no twin
// here: a second pointer on the same seat is correctly ignored.
//
// ConsumableStripGesture is a thin instantiation of the shared StripGesture
// (src/ui/hud/strip_gesture_controller.ts), so every pin here drives that shared
// layer through the parameters this row supplies (a resolved direction, the
// carried count, and the tap-uses-the-first-consumable default).

import { beforeEach, describe, expect, it } from 'vitest';
import { CONSUMABLE_BAR_SLOTS } from '../src/ui/hud/action_bar/consumable_bar_view';
import {
  ConsumableStripGesture,
  type ConsumableStripGestureDeps,
} from '../src/ui/hud/action_bar/consumable_strip_gesture_controller';
import { closeOpenTouchMenu } from '../src/ui/hud/tap_menu';
import { makeWriterFacet } from '../src/ui/painter_host';

/** A private facet per rig: the class takes Hud's shared one in production, and
 *  a test only needs the elision behaviour, not the shared skip counters. */
function writers() {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
}

const SEAT_SIZE_PX = 40;
/** Past STRIP_DEADZONE_PX (22), so a move commits to an item and pulls the row
 *  up without waiting out the reveal timer. */
const SWIPE_PX = 30;

interface Rig {
  seat: HTMLButtonElement;
  items: HTMLButtonElement[];
  cancel: HTMLButtonElement;
  gesture: ConsumableStripGesture;
  used: number[];
  cancels: number;
  /** settings.touchTapMenus, flipped per test. */
  tapMenus: boolean;
  /** Every repaint the gesture asked for, in order, each recording whether the
   *  row was open at that moment: a sticky open must paint BEFORE it moves focus
   *  onto the first item. */
  repaints: boolean[];
  /** The element focus landed on at each repaint, so the ORDER of the two is
   *  pinned rather than only their occurrence. */
  focusedAtRepaint: (Element | null)[];
}

function makeRig(options: { appVw?: string; safeAreaPx?: string; tapMenus?: boolean } = {}): Rig {
  const host = document.createElement('div');
  host.style.setProperty('--strip-gap', '8px');
  host.style.setProperty('--strip-margin', '6px');
  host.style.setProperty('--app-vw', options.appVw ?? '380px');
  for (const side of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    host.style.setProperty(side, options.safeAreaPx ?? '0px');
  }
  document.body.append(host);

  const seat = document.createElement('button');
  seat.type = 'button';
  document.body.append(seat);
  // Hard against the LEFT edge, so the row has to grow right and the far end
  // runs into the clamp: the one placement the viewport box actually decides.
  seat.getBoundingClientRect = () =>
    ({
      x: 60,
      y: 180,
      left: 60,
      top: 180,
      width: SEAT_SIZE_PX,
      height: SEAT_SIZE_PX,
      right: 60 + SEAT_SIZE_PX,
      bottom: 180 + SEAT_SIZE_PX,
    }) as DOMRect;

  const items = Array.from({ length: CONSUMABLE_BAR_SLOTS }, () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    document.body.append(btn);
    return btn;
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  document.body.append(cancel);

  const rig: Rig = {
    seat,
    items,
    cancel,
    used: [],
    cancels: 0,
    repaints: [],
    focusedAtRepaint: [],
    tapMenus: options.tapMenus ?? false,
    gesture: null as unknown as ConsumableStripGesture,
  };
  const deps: ConsumableStripGestureDeps = {
    seat,
    writers: writers(),
    metricsHost: host,
    items,
    cancel,
    tapMenus: () => rig.tapMenus,
    count: () => CONSUMABLE_BAR_SLOTS,
    use: (index) => rig.used.push(index),
    onCancel: () => {
      rig.cancels++;
    },
    repaint: () => {
      rig.repaints.push(rig.gesture.isOpen());
      rig.focusedAtRepaint.push(document.activeElement);
    },
  };
  rig.gesture = new ConsumableStripGesture(deps);
  rig.gesture.attach();
  return rig;
}

function pointer(type: string, pointerId: number, clientX: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 200 }), {
    pointerId,
    pointerType: 'touch',
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('ConsumableStripGesture: the window release backstop', () => {
  it('drops a drag whose release never reaches the seat', () => {
    const rig = makeRig();
    rig.seat.setPointerCapture = () => {
      throw new Error('no capture for a synthetic pointer id');
    };
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);

    window.dispatchEvent(Object.assign(new MouseEvent('pointerup'), { pointerId: 1 }));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.openState()).toBeNull();
    // Dropping is not resolving: a release the gesture never saw uses nothing.
    expect(rig.used).toEqual([]);

    // And the seat is alive again, rather than dead under a painted row.
    rig.seat.dispatchEvent(pointer('pointerdown', 2, 100));
    rig.seat.dispatchEvent(pointer('pointerup', 2, 100));
    expect(rig.used).toEqual([0]);
  });

  it('leaves an ordinary release to the seat, which resolves it first', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    // Bubbles to window, so the backstop runs on the same event and must find
    // nothing left to drop rather than eating the use.
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.used).toEqual([0]);
  });

  it('ignores a stray window release for a pointer it never armed', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    window.dispatchEvent(Object.assign(new MouseEvent('pointerup'), { pointerId: 9 }));
    expect(rig.gesture.isOpen()).toBe(true);
  });
});

describe('ConsumableStripGesture: the clamp box', () => {
  it('clamps the row against the shared --app-vw box, not the window', () => {
    const rig = makeRig({ appVw: '380px' });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    // itemSize 40 + gap 8 = pitch 48 from an anchor at 80, so the far item's
    // right edge lands at 388 and the 380px app box shifts the whole row 14px
    // left. happy-dom's 1024px window would not have clamped at all.
    expect(window.innerWidth).toBeGreaterThan(380);
    expect(open?.placement.clamped).toBe(true);
    expect(open?.placement.centers[0]).toBe(114);
  });

  // The overlay carries the device safe area as PADDING, and its items are
  // absolutely positioned children, so what the painter writes is resolved
  // against the PADDING box rather than the viewport. The gesture layer
  // therefore measures in that frame. NOT coverable by the real-browser suite:
  // env(safe-area-inset-*) resolves to 0 on a headless desktop viewport, so only
  // a stubbed computed style can drive the nonzero arm at all.
  it('seats the row in the overlay padding-box frame, counting the safe area once', () => {
    const rig = makeRig({ appVw: '380px', safeAreaPx: '30px' });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    // The seat's viewport centre is 80, so in the padding box it is 50, and the
    // clamp box is the app box minus BOTH insets. The margin stays the
    // stylesheet's own 6px literal rather than absorbing the inset a second time.
    expect(open?.anchorX).toBe(50);
    expect(open?.viewportWidth).toBe(320);
    expect(open?.margin).toBe(6);
    // Unclamped the row runs 98..338, so its far edge (358) overruns 320 - 6 by
    // 44 and the whole row shifts left by that. Rendered, the last item's right
    // edge lands at 294 + 20 + 30 = 344, exactly 6px inside the safe area.
    expect(open?.placement.centers[0]).toBe(54);
    expect(open?.placement.centers[CONSUMABLE_BAR_SLOTS - 1]).toBe(294);
  });
});

// The touchTapMenus setting: the same sticky path VoiceOver already used, now a
// player option. The RULES are tap_menu_core.ts's (its own suite); what is pinned
// here is that the seat's pointer path routes to them and arms no drag.
describe('ConsumableStripGesture: tap mode', () => {
  it('opens the row on a press and uses NOTHING', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.used).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    // No drag armed, so the release resolves nothing and the row stays up.
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.used).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    // Chosen by focus, not by travel: no item is live and the cancel X is not
    // the live target either.
    expect(rig.gesture.openState()?.live).toBe(-1);
    expect(rig.gesture.openState()?.cancelLive).toBe(false);
    expect(rig.items.map((btn) => btn.tabIndex)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('uses the item that is tapped, then closes', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.items[2].click();
    expect(rig.used).toEqual([2]);
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.items.map((btn) => btn.tabIndex)).toEqual([-1, -1, -1, -1, -1, -1]);
  });

  it('uses the FIRST consumable when the seat is pressed again', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100));
    rig.seat.dispatchEvent(pointer('pointerdown', 2, 100));
    expect(rig.used).toEqual([0]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('dismisses on a press outside the row, using nothing', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);

    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    elsewhere.dispatchEvent(pointer('pointerdown', 2, 400));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.used).toEqual([]);
    expect(rig.cancels).toBe(1);
  });

  it('does not let the synthetic click reopen the row it just closed', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100));
    // Second press uses the first consumable and closes; the click the browser
    // fires after it must not be read as an assistive activation.
    rig.seat.dispatchEvent(pointer('pointerdown', 2, 100));
    rig.seat.dispatchEvent(pointer('pointerup', 2, 100));
    rig.seat.click();
    expect(rig.used).toEqual([0]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('with the setting OFF the swipe still walks the row and no outside tap closes it', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.used).toEqual([0]);

    // The assistive sticky path is unchanged too, suppression included: the click
    // the browser fires after the drag is not read as an activation, and only the
    // next one opens the row.
    rig.seat.click();
    expect(rig.gesture.isOpen()).toBe(false);
    rig.seat.click();
    expect(rig.gesture.isOpen()).toBe(true);
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    elsewhere.dispatchEvent(pointer('pointerdown', 2, 400));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.cancels).toBe(0);
  });
});

// Escape belongs to Hud's single closeAll dispatcher, which asks the shared
// tap-menu registry rather than knowing any menu by name. Before this the sticky
// row had NO key-driven way out at all.
describe('ConsumableStripGesture: the Escape path and the seat open state', () => {
  it('closes the sticky row through the shared registry, using nothing', () => {
    const rig = makeRig({ tapMenus: true });
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);

    expect(closeOpenTouchMenu()).toBe(true);
    expect(rig.gesture.isOpen()).toBe(false);
    // A dismissal, never a quaff.
    expect(rig.used).toEqual([]);
    expect(rig.cancels).toBe(1);
    expect(rig.items.every((btn) => btn.tabIndex === -1)).toBe(true);
  });

  it('reports nothing to close while the row is down', () => {
    const rig = makeRig();
    expect(closeOpenTouchMenu()).toBe(false);
    expect(rig.cancels).toBe(0);
  });

  it('tells assistive tech whether the row is showing', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.seat.getAttribute('aria-expanded')).toBe('true');
    rig.gesture.closeSticky();
    expect(rig.seat.getAttribute('aria-expanded')).toBe('false');

    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    // The rig seats the button at the LEFT edge, so this row grows rightward
    // (resolveConsumableStripDirection's mirror case).
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.seat.getAttribute('aria-expanded')).toBe('true');
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.seat.getAttribute('aria-expanded')).toBe('false');
  });
});

// The row's items are strip-owned buttons with no handler of their own, so the
// pick callback IS the action here: it must run once per activation, and once
// only. The seated-button twin (the menu strip) is where a re-activated element
// double-fired; this is the pin that the shared layer never grew a second call
// for this row either.
describe('ConsumableStripGesture: an activation uses the item exactly once', () => {
  it('uses it once for a real touchscreen tap on a sticky-open item', () => {
    const rig = makeRig();
    // The assistive/sticky path, opened by a plain click on the seat.
    rig.seat.click();
    expect(rig.gesture.isOpen()).toBe(true);
    // A real tap: the touch pointer pair, then the compatibility click the
    // browser synthesizes for it.
    rig.items[3].dispatchEvent(pointer('pointerdown', 1, 300));
    rig.items[3].dispatchEvent(pointer('pointerup', 1, 300));
    rig.items[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.used).toEqual([3]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('uses it once for an assistive click, and once for a tap-mode tap', () => {
    const at = makeRig();
    at.seat.click();
    at.items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(at.used).toEqual([1]);

    document.body.replaceChildren();
    const tap = makeRig({ tapMenus: true });
    tap.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    tap.items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tap.used).toEqual([1]);
  });

  it('uses it once for a gesture release', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.used).toEqual([0]);
  });
});

// A second finger's pointercancel on the seat must not drop the first finger's
// live row: the seat handler used to drop the drag whatever pointer the cancel
// named, while the window backstop beneath it and the radial twin both match.
describe('ConsumableStripGesture: pointercancel is matched on the pointer id', () => {
  it('drops the drag when the cancel names the pointer that armed it', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);
    rig.seat.dispatchEvent(pointer('pointercancel', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.openState()).toBeNull();
    expect(rig.used).toEqual([]);
  });

  it('leaves the live row alone when the cancel names another pointer', () => {
    const rig = makeRig();
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.seat.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.seat.dispatchEvent(pointer('pointercancel', 2, 100));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.openState()?.live).toBe(0);
    // And the row still resolves its own release afterwards.
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.used).toEqual([0]);
  });
});

// A sticky open focuses the first item in the same call that opens the row, and
// a row the frame has not painted yet is display:none, which refuses focus and
// leaves it on the seat. The seat rides Hud's frame for its ordinary paints, so
// it has to hand the gesture a repaint of its own for this one.
describe('ConsumableStripGesture: the sticky open paints before it focuses', () => {
  it('repaints with the row already OPEN, before focus moves', () => {
    const rig = makeRig();
    rig.gesture.openSticky();
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.repaints).toContain(true);
    // The repaint that reported the row open ran while focus was still off the
    // row, which is the whole ordering contract.
    const openAt = rig.repaints.indexOf(true);
    expect(rig.focusedAtRepaint[openAt]).not.toBe(rig.items[0]);
    expect(document.activeElement).toBe(rig.items[0]);
  });

  it('repaints on the close as well, before focus returns to the seat', () => {
    const rig = makeRig();
    rig.gesture.openSticky();
    const before = rig.repaints.length;
    rig.gesture.closeSticky();
    expect(rig.repaints.length).toBeGreaterThan(before);
    expect(rig.repaints[rig.repaints.length - 1]).toBe(false);
    expect(document.activeElement).toBe(rig.seat);
  });
});

// The row is frozen from the moment a press ARMS, not from the reveal: the
// consumables list is re-sorted by the world, and the 180ms reveal window used to
// let it move between the press and the index that press resolves to.
describe('ConsumableStripGesture: isArmed reports the press, not the reveal', () => {
  it('is armed from the pointerdown, before the row is showing', () => {
    const rig = makeRig();
    expect(rig.gesture.isArmed()).toBe(false);
    rig.seat.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.gesture.isArmed()).toBe(true);
    expect(rig.gesture.isOpen()).toBe(false);
    rig.seat.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.gesture.isArmed()).toBe(false);
  });

  it('is armed while a sticky row is showing too', () => {
    const rig = makeRig();
    rig.gesture.openSticky();
    expect(rig.gesture.isArmed()).toBe(true);
    rig.gesture.closeSticky();
    expect(rig.gesture.isArmed()).toBe(false);
  });
});
