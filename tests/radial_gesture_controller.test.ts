// @vitest-environment happy-dom
// Pointer-level regressions for the radial ring's gesture controller: the DOM
// half that radial_gesture_core.ts owns no part of. The RULES have their own
// suite (radial_gesture_core.test.ts); everything here is about pointer
// bookkeeping, which is where the defects actually were.
//
// Four of them, each pinned below:
//   - one shared drag slot, so a second thumb on a second ring button was
//     dropped entirely (combat is played with two thumbs),
//   - no release path other than the button's own, so a setPointerCapture throw
//     plus a finger that left the button stranded the drag forever,
//   - the petal clamp measured against window.innerWidth/innerHeight while the
//     overlay is sized from the shared --app-vw/--app-vh box, and never widened
//     for the device's safe area,
//   - the shared "this release was a drag" flag consumed before the pointer-id
//     guard, so one thumb's release cleared the flag the other thumb's hold set.

import { beforeEach, describe, expect, it } from 'vitest';
import type { RadialDirection } from '../src/ui/hud/action_bar/radial_action_core';
import {
  RadialGesture,
  type RadialGestureDeps,
} from '../src/ui/hud/action_bar/radial_gesture_controller';
import { closeOpenTouchMenu } from '../src/ui/hud/tap_menu';
import type { TapMenuAnchorRole } from '../src/ui/hud/tap_menu_core';
import { makeWriterFacet } from '../src/ui/painter_host';

const BUTTON_SIZE_PX = 40;
/** The petal order the painter seats and the gesture is handed. */
const PETAL_DIRECTIONS: RadialDirection[] = ['up', 'right', 'down', 'left'];
/** Past FLICK_DEADZONE_PX (22), so a move resolves to a direction and pulls the
 *  petals up without waiting out the reveal timer. */
const FLICK_PX = 30;

interface Rig {
  buttons: HTMLButtonElement[];
  petals: HTMLButtonElement[];
  petalCancel: HTMLButtonElement;
  host: HTMLElement;
  gesture: RadialGesture;
  casts: Array<[number, RadialDirection]>;
  cancels: number;
  suppressed: { value: boolean; takes: number };
  claimed: Set<number>;
  activeAim: { buttonIndex: number; direction: RadialDirection } | null;
  aimCancels: number;
  /** settings.touchTapMenus, flipped per test. */
  tapMenus: boolean;
  /** Every repaint the gesture asked for, each recording whether the petals were
   *  open at that moment: a sticky open must paint BEFORE it moves focus onto
   *  the first petal. */
  repaints: boolean[];
  /** What held focus at each repaint, so the ORDER of the two is pinned. */
  focusedAtRepaint: (Element | null)[];
  /** The facet's own attribute cache: an entry per (element, attr) it wrote, so
   *  a write that reached the DOM around the facet leaves no trace here. */
  attrCache: Map<HTMLElement, Map<string, string>>;
}

function rect(btn: HTMLElement, x: number, y: number): void {
  btn.getBoundingClientRect = () =>
    ({
      x,
      y,
      left: x,
      top: y,
      width: BUTTON_SIZE_PX,
      height: BUTTON_SIZE_PX,
      right: x + BUTTON_SIZE_PX,
      bottom: y + BUTTON_SIZE_PX,
    }) as DOMRect;
}

function makeRig(
  options: {
    appVw?: string;
    appVh?: string;
    safeAreaPx?: string;
    tapMenus?: boolean;
    anchorRole?: TapMenuAnchorRole;
  } = {},
): Rig {
  const host = document.createElement('div');
  host.style.setProperty('--radial-radius-ratio', '1.35');
  host.style.setProperty('--radial-margin', '6px');
  host.style.setProperty('--app-vw', options.appVw ?? '400px');
  host.style.setProperty('--app-vh', options.appVh ?? '300px');
  for (const side of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    host.style.setProperty(side, options.safeAreaPx ?? '0px');
  }
  document.body.append(host);

  const buttons = [0, 1].map(() => {
    const btn = document.createElement('button');
    btn.type = 'button';
    document.body.append(btn);
    return btn;
  });
  // Both near the bottom-right corner, which is where the ring actually sits and
  // the only place the edge clamp does anything.
  rect(buttons[0], 360, 180);
  rect(buttons[1], 200, 180);

  // The petal overlay's own buttons, in the order the painter seats them. Tap
  // mode chooses by tapping one, so the gesture needs them; the drag path never
  // touches them.
  const petals = PETAL_DIRECTIONS.map(() => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    document.body.append(btn);
    return btn;
  });
  const petalCancel = document.createElement('button');
  petalCancel.type = 'button';
  petalCancel.tabIndex = -1;
  document.body.append(petalCancel);

  const rig: Rig = {
    buttons,
    petals,
    petalCancel,
    host,
    casts: [],
    cancels: 0,
    suppressed: { value: false, takes: 0 },
    claimed: new Set<number>(),
    activeAim: null,
    aimCancels: 0,
    tapMenus: options.tapMenus ?? false,
    repaints: [],
    focusedAtRepaint: [],
    attrCache: new Map<HTMLElement, Map<string, string>>(),
    gesture: null as unknown as RadialGesture,
  };
  const deps: RadialGestureDeps = {
    buttons,
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      rig.attrCache,
      () => {},
      () => {},
    ),
    tapMenus: () => rig.tapMenus,
    anchorRole: options.anchorRole,
    metricsHost: host,
    hasSlot: () => true,
    aimOwnsButton: (buttonIndex) => rig.activeAim?.buttonIndex === buttonIndex,
    cancelAim: () => {
      rig.aimCancels++;
      rig.activeAim = null;
    },
    cast: (buttonIndex, direction) => rig.casts.push([buttonIndex, direction]),
    pressClaimed: (buttonIndex) => rig.claimed.has(buttonIndex),
    takeSuppressedPress: () => {
      rig.suppressed.takes++;
      const was = rig.suppressed.value;
      rig.suppressed.value = false;
      return was;
    },
    onCancel: () => {
      rig.cancels++;
    },
    repaint: () => {
      rig.repaints.push(rig.gesture.isOpen());
      rig.focusedAtRepaint.push(document.activeElement);
    },
  };
  rig.gesture = new RadialGesture(deps);
  rig.gesture.attach();
  rig.gesture.attachPetals(
    PETAL_DIRECTIONS.map((direction, i) => ({ direction, el: petals[i] })),
    petalCancel,
  );
  return rig;
}

function pointer(type: string, pointerId: number, clientX: number, clientY: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }), {
    pointerId,
    pointerType: 'touch',
  });
}

function down(rig: Rig, button: number, pointerId: number, x = 0, y = 0): void {
  rig.buttons[button].dispatchEvent(pointer('pointerdown', pointerId, x, y));
}

function move(rig: Rig, button: number, pointerId: number, x: number, y = 0): void {
  rig.buttons[button].dispatchEvent(pointer('pointermove', pointerId, x, y));
}

function up(rig: Rig, button: number, pointerId: number, x = 0, y = 0): void {
  rig.buttons[button].dispatchEvent(pointer('pointerup', pointerId, x, y));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('RadialGesture: two thumbs, two ring buttons', () => {
  it('casts BOTH presses when a second ring button is pressed under the first', () => {
    const rig = makeRig();
    down(rig, 0, 1);
    down(rig, 1, 2);
    up(rig, 0, 1);
    up(rig, 1, 2);
    // One shared drag slot dropped the second press entirely: onDown returned
    // early while any drag was live, so the second thumb cast nothing.
    expect(rig.casts).toEqual([
      [0, 'center'],
      [1, 'center'],
    ]);
  });

  it('keeps each press on its own start point, so one thumb never flicks for the other', () => {
    const rig = makeRig();
    down(rig, 0, 1, 100, 100);
    down(rig, 1, 2, 300, 100);
    // Pointer 2 flicks right from ITS start; pointer 1 never moved.
    move(rig, 1, 2, 300 + FLICK_PX, 100);
    up(rig, 1, 2, 300 + FLICK_PX, 100);
    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([
      [1, 'right'],
      [0, 'center'],
    ]);
  });

  it('opens the petal overlay for the FIRST press only, and the second still casts', () => {
    const rig = makeRig();
    down(rig, 0, 1, 100, 100);
    down(rig, 1, 2, 300, 100);
    // The second thumb flicks first. Two reveals cannot coexist visually, so it
    // resolves its own direction without seating a second overlay.
    move(rig, 1, 2, 300 + FLICK_PX, 100);
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.heldButtonIndex()).toBe(0);

    move(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);
    expect(rig.gesture.liveDirection()).toBe('right');

    up(rig, 1, 2, 300 + FLICK_PX, 100);
    expect(rig.casts).toEqual([[1, 'right']]);
  });
});

describe('RadialGesture: the window release backstop', () => {
  it('drops a drag whose release never reaches the button', () => {
    const rig = makeRig();
    // The exact shape the backstop exists for: capture throws, so the finger
    // leaving the button takes every pointer event with it.
    rig.buttons[0].setPointerCapture = () => {
      throw new Error('no capture for a synthetic pointer id');
    };
    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.gesture.isOpen()).toBe(true);

    window.dispatchEvent(Object.assign(new MouseEvent('pointerup'), { pointerId: 1 }));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.heldButtonIndex()).toBe(-1);
    // Dropping is not resolving: a release the gesture never saw must not cast.
    expect(rig.casts).toEqual([]);

    // And the ring is alive again. Before the backstop the stranded drag kept
    // every button dead under a painted overlay.
    down(rig, 1, 2);
    up(rig, 1, 2);
    expect(rig.casts).toEqual([[1, 'center']]);
  });

  it('leaves an ordinary release to the button, which resolves it first', () => {
    const rig = makeRig();
    down(rig, 0, 1);
    // Bubbles to window, so the backstop runs on the same event and must find
    // nothing left to drop rather than eating the cast.
    up(rig, 0, 1);
    expect(rig.casts).toEqual([[0, 'center']]);
  });

  it('drops only the matching pointer, never a neighbour still held', () => {
    const rig = makeRig();
    down(rig, 0, 1);
    down(rig, 1, 2);
    window.dispatchEvent(Object.assign(new MouseEvent('pointercancel'), { pointerId: 1 }));
    up(rig, 1, 2);
    up(rig, 0, 1);
    expect(rig.casts).toEqual([[1, 'center']]);
  });
});

// See tests/mobile_action_ring_painter.test.ts "arms NO rearrange gesture on
// the live ring" for the source-scan half of this pin (the retired
// bindMobileRingDrag / bindMobileActionDrag / mobileHotbarDrag tokens). This
// is the behavioral half: a held drag that reveals the petals and releases
// over where a NEIGHBOUR button sits on screen must still resolve through
// this button's own cast/cancel outcome, never rebind anything. The
// RadialGestureDeps interface exposes no callback that could touch another
// button's slot at all (only cast and onCancel), so this proves the negative
// concretely rather than by interface inspection alone.
describe('RadialGesture: a held drag toward a neighbour never rearranges anything', () => {
  it('resolves through cast/cancel on the PRESSED button, even when the release lands over a neighbour', () => {
    const rig = makeRig();
    // Button 1's rect is seated at (200,180)-(240,220) (see makeRig). Pressing
    // button 0 and dragging into that box is literally what the retired
    // long-press rearrange read as "pick up button 0, drop it on button 1".
    down(rig, 0, 1, 300, 200);
    move(rig, 0, 1, 220, 200); // dx -80, past FLICK_DEADZONE_PX: reveals and resolves 'left'.
    expect(rig.gesture.isOpen()).toBe(true);
    up(rig, 0, 1, 220, 200);

    // The only outcome is a cast of BUTTON 0's own 'left' slot: nothing
    // addresses button 1, because the deps interface has no such callback.
    expect(rig.casts).toEqual([[0, 'left']]);
    expect(rig.cancels).toBe(0);
  });

  it('cancels rather than rebinding when the release lands back on the anchor', () => {
    const rig = makeRig();
    down(rig, 0, 1, 300, 200);
    move(rig, 0, 1, 220, 200);
    move(rig, 0, 1, 300, 200); // back to the anchor with the petals still up.
    expect(rig.gesture.cancelIsLive()).toBe(true);
    up(rig, 0, 1, 300, 200);

    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(1);
  });
});

describe('RadialGesture: the clamp box', () => {
  it('clamps against the shared --app-vw/--app-vh box, not the window', () => {
    const rig = makeRig({ appVw: '400px', appVh: '300px' });
    down(rig, 0, 1, 380, 200);
    move(rig, 0, 1, 380 + FLICK_PX, 200);
    // radius 40 * 1.35 = 54, petalHalf 20, margin 6 -> reach 80. The button
    // centre is 380, so the app box (400 wide) pulls the origin in to 320 while
    // happy-dom's 1024px window would have left it at 380.
    expect(window.innerWidth).toBeGreaterThan(400);
    expect(rig.gesture.placement()?.originX).toBe(320);
    expect(rig.gesture.placement()?.originY).toBe(200);
  });

  // The overlay carries the device safe area as PADDING, and its petals are
  // absolutely positioned children, so what the painter writes is resolved
  // against the PADDING box rather than the viewport. The gesture layer
  // therefore measures in that frame. NOT coverable by the real-browser suite:
  // env(safe-area-inset-*) resolves to 0 on a headless desktop viewport, so only
  // a stubbed computed style can drive the nonzero arm at all.
  it('seats the petals in the overlay padding-box frame, so the inset never displaces them', () => {
    const rig = makeRig({ appVw: '400px', appVh: '600px', safeAreaPx: '44px' });
    // Button 1 is seated at (200,180)-(240,220), so its centre is (220,200) in
    // VIEWPORT coordinates and nothing about it is near a clamp here.
    down(rig, 1, 1, 220, 200);
    move(rig, 1, 1, 220 + FLICK_PX, 200);
    // The painter writes these into a padding box that starts 44px in on both
    // axes, so the cluster lands back on the button's real centre: 176 + 44 =
    // 220 and 156 + 44 = 200. Written in viewport coordinates it would have been
    // pushed a whole inset off the control it belongs to.
    expect(rig.gesture.placement()?.originX).toBe(220 - 44);
    expect(rig.gesture.placement()?.originY).toBe(200 - 44);
  });

  it('reserves the safe-area inset ONCE, never twice', () => {
    const rig = makeRig({ appVw: '400px', appVh: '300px', safeAreaPx: '30px' });
    down(rig, 0, 1, 380, 200);
    move(rig, 0, 1, 380 + FLICK_PX, 200);
    // The clamp box is the app box minus both insets (400 - 60 = 340 wide,
    // 300 - 60 = 240 tall) and the margin stays the stylesheet's own 6px, so the
    // reach is 54 + 20 + 6 = 80 and the origin clamps to 340 - 80 = 260 by
    // 240 - 80 = 160. Rendered that is 290 by 190, exactly one reach inside the
    // safe area. Folding the inset into the margin INSTEAD (the old max(6, 30))
    // wrote 296 into a box already offset by 30, spending the inset twice.
    expect(rig.gesture.placement()?.originX).toBe(260);
    expect(rig.gesture.placement()?.originY).toBe(160);
  });
});

describe('RadialGesture: the cancel target', () => {
  it('reports the cancel target live only once the petals are up', () => {
    const rig = makeRig();
    down(rig, 0, 1, 100, 100);
    // Centred, but nothing revealed: the centre is still a plain tap.
    expect(rig.gesture.liveDirection()).toBe('center');
    expect(rig.gesture.cancelIsLive()).toBe(false);

    move(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.gesture.cancelIsLive()).toBe(false);
    move(rig, 0, 1, 100, 100);
    expect(rig.gesture.cancelIsLive()).toBe(true);

    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(1);
  });
});

describe('RadialGesture: re-pressing the button that owns a ground aim', () => {
  it('claims the drag-path pointerdown before another gesture owner can take it', () => {
    const rig = makeRig();
    rig.activeAim = { buttonIndex: 0, direction: 'center' };
    rig.claimed.add(0);

    down(rig, 0, 1, 100, 100);
    expect(rig.aimCancels).toBe(1);
    expect(rig.activeAim).toBeNull();
    expect(rig.gesture.heldButtonIndex()).toBe(-1);
    expect(rig.gesture.isOpen()).toBe(false);

    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(0);
  });

  it('claims the tap-mode anchor press as a cancel and opens no sticky menu', () => {
    const rig = makeRig({ tapMenus: true });
    rig.activeAim = { buttonIndex: 0, direction: 'center' };

    down(rig, 0, 1, 100, 100);
    expect(rig.aimCancels).toBe(1);
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.casts).toEqual([]);

    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
  });

  it('cancels a petal-owned aim before the raw centre gesture can cast', () => {
    const rig = makeRig();
    rig.activeAim = { buttonIndex: 1, direction: 'left' };

    down(rig, 1, 7, 300, 100);
    up(rig, 1, 7, 300, 100);

    expect(rig.aimCancels).toBe(1);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('leaves another button on its ordinary cast path', () => {
    const rig = makeRig();
    rig.activeAim = { buttonIndex: 1, direction: 'up' };

    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);

    expect(rig.aimCancels).toBe(0);
    expect(rig.casts).toEqual([[0, 'center']]);
  });
});

describe('RadialGesture: the shared suppressed-press flag', () => {
  it('never lets an empowered release on one button cancel the cast on another', () => {
    const rig = makeRig();
    // Button 1 is owned by an empowered hold, so the radial never arms on it.
    rig.claimed.add(1);
    down(rig, 0, 1, 100, 100);
    down(rig, 1, 2, 300, 100);
    // The hold resolves and arms the shared flag on its own release.
    rig.suppressed.value = true;
    const takes = rig.suppressed.takes;
    up(rig, 1, 2, 300, 100);
    // THAT release is the one the flag was armed against, so it consumes it on
    // the spot and its own ghost click stays suppressed. Leaving it standing
    // while the neighbouring drag was live is what fed it to the wrong release.
    expect(rig.suppressed.takes).toBe(takes + 1);
    expect(rig.suppressed.value).toBe(false);
    expect(rig.casts).toEqual([]);

    up(rig, 0, 1, 100, 100);
    // Button 0 had nothing to do with the hold, so its cast survives.
    expect(rig.casts).toEqual([[0, 'center']]);
  });

  it('still clears a stale flag on an unowned release while nothing else is held', () => {
    const rig = makeRig();
    rig.claimed.add(1);
    rig.suppressed.value = true;
    up(rig, 1, 2, 300, 100);
    expect(rig.suppressed.value).toBe(false);

    // The next real press casts instead of being swallowed by the leftover flag.
    down(rig, 0, 1);
    up(rig, 0, 1);
    expect(rig.casts).toEqual([[0, 'center']]);
  });
});

// The touchTapMenus setting (WCAG 2.5.1): the 16 directional actions were
// reachable only by a path-based flick, so tap mode promotes the strips' sticky
// path to the radial. Every rule comes from tap_menu_core.ts; what is pinned here
// is the pointer bookkeeping around it.
describe('RadialGesture: tap mode', () => {
  it('opens the petals on a press and casts NOTHING', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);
    expect(rig.gesture.placement()).not.toBeNull();
    // Nothing is under a finger, so no petal is highlighted and the centre is not
    // the way out the way it is mid-drag.
    expect(rig.gesture.liveDirection()).toBe('center');
    expect(rig.gesture.cancelIsLive()).toBe(false);
    // The release must not resolve anything either: the menu stays up.
    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
  });

  it('makes the petals real focusable buttons while open, and inert when closed', () => {
    const rig = makeRig({ tapMenus: true });
    expect(rig.petals.map((p) => p.tabIndex)).toEqual([-1, -1, -1, -1]);
    down(rig, 0, 1, 100, 100);
    expect(rig.petals.map((p) => p.tabIndex)).toEqual([0, 0, 0, 0]);
    expect(rig.petalCancel.tabIndex).toBe(0);
    expect(document.activeElement).toBe(rig.petals[0]);

    rig.gesture.closeSticky();
    expect(rig.petals.map((p) => p.tabIndex)).toEqual([-1, -1, -1, -1]);
    expect(rig.petalCancel.tabIndex).toBe(-1);
  });

  it('casts the direction of the petal that is tapped, then closes', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    rig.petals[1].click();
    expect(rig.casts).toEqual([[0, 'right']]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('casts the centre action when the ring button is tapped again', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    down(rig, 0, 2, 100, 100);
    expect(rig.casts).toEqual([[0, 'center']]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('dismisses on a press outside the menu, casting nothing', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    // The press that OPENED it must not also dismiss it: the document listener is
    // armed mid-dispatch of that very event, and only a capture listener is
    // guaranteed to have been passed already.
    expect(rig.gesture.isOpen()).toBe(true);

    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    elsewhere.dispatchEvent(pointer('pointerdown', 2, 10, 10));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(1);
  });

  it('treats a press on another ring button as opening THAT menu, not an outside tap', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    down(rig, 1, 2, 300, 100);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(1);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(0);
  });

  it('with the setting OFF a petal tap does nothing and the flick still casts', () => {
    const rig = makeRig();
    rig.petals[1].click();
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);

    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    up(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.casts).toEqual([[0, 'right']]);
  });
});

// Escape belongs to Hud's single closeAll dispatcher, which asks the shared
// tap-menu registry rather than knowing any menu by name. Before this the
// tap-mode petals had NO key-driven way out at all.
describe('RadialGesture: the Escape path and the button open state', () => {
  it('closes the tap-mode petals through the shared registry, casting nothing', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    expect(rig.gesture.isOpen()).toBe(true);

    expect(closeOpenTouchMenu()).toBe(true);
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(1);
    expect(rig.petals.map((p) => p.tabIndex)).toEqual([-1, -1, -1, -1]);
  });

  it('reports nothing to close while the petals are down', () => {
    const rig = makeRig({ tapMenus: true });
    expect(closeOpenTouchMenu()).toBe(false);
    expect(rig.cancels).toBe(0);
  });

  it('tells assistive tech whether the petals are showing, on the pressed button', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    // The state lands on the BUTTON the petals belong to, which is the control a
    // screen reader is standing on, never on the overlay.
    expect(rig.buttons[0].getAttribute('aria-expanded')).toBe('true');
    expect(rig.buttons[1].getAttribute('aria-expanded')).toBeNull();
    rig.gesture.closeSticky();
    expect(rig.buttons[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('moves the same state on the gesture path, when a hold reveals the petals', () => {
    const rig = makeRig();
    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.buttons[0].getAttribute('aria-expanded')).toBe('true');
    up(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.buttons[0].getAttribute('aria-expanded')).toBe('false');
  });
});

// anchorRole 'toggle': the parameter that lets a control with no action of its
// own (the stance control) reuse this exact gesture layer instead of forking a
// fourth dialect. Every assertion below is about the ROLE, not about stances.
describe("RadialGesture: a 'toggle' anchor with no action of its own", () => {
  it('opens the petals on a bare tap with tap mode OFF, and casts nothing', () => {
    const rig = makeRig({ anchorRole: 'toggle' });
    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);
    // The petals become a real focusable menu, exactly as in tap mode.
    expect(rig.petals.map((p) => p.tabIndex)).toEqual([0, 0, 0, 0]);
    expect(rig.buttons[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('closes again on the next press, in either mode', () => {
    for (const tapMenus of [false, true]) {
      document.body.replaceChildren();
      const rig = makeRig({ anchorRole: 'toggle', tapMenus });
      down(rig, 0, 1, 100, 100);
      up(rig, 0, 1, 100, 100);
      expect(rig.gesture.isOpen(), `tapMenus=${tapMenus}`).toBe(true);
      down(rig, 0, 2, 100, 100);
      expect(rig.gesture.isOpen(), `tapMenus=${tapMenus}`).toBe(false);
      expect(rig.casts, `tapMenus=${tapMenus}`).toEqual([]);
      expect(rig.cancels, `tapMenus=${tapMenus}`).toBe(1);
    }
  });

  it('keeps the flick: a swipe past the deadzone still chooses that direction', () => {
    const rig = makeRig({ anchorRole: 'toggle' });
    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    up(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.casts).toEqual([[0, 'right']]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('backs out when the finger returns to the anchor with the petals up', () => {
    const rig = makeRig({ anchorRole: 'toggle' });
    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    move(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.cancels).toBe(1);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('dismisses on a press OUTSIDE the control, with tap mode off too', () => {
    // A bare tap can open this row in either mode, so a row with no tap-driven
    // way out would strand a player who opened it by accident.
    const rig = makeRig({ anchorRole: 'toggle' });
    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    expect(rig.gesture.isOpen()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.cancels).toBe(1);
  });

  it('an ACTION anchor is untouched: the ring still casts its centre on a tap', () => {
    // The ring passes no role at all, so this is the shipped default arm.
    const rig = makeRig();
    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    expect(rig.casts).toEqual([[0, 'center']]);
    expect(rig.gesture.isOpen()).toBe(false);
    // And with tap mode ON it opens first, then casts the centre on the second
    // press, which is the behaviour that shipped.
    document.body.replaceChildren();
    const tap = makeRig({ tapMenus: true });
    down(tap, 0, 1, 100, 100);
    expect(tap.casts).toEqual([]);
    expect(tap.gesture.isOpen()).toBe(true);
    down(tap, 0, 2, 100, 100);
    expect(tap.casts).toEqual([[0, 'center']]);
  });
});

// A CLAIMED button (its centre slot holds an empowered ability, so the hold owns
// the press) used to be refused at the head of every path, which left its four
// DIRECTIONS unreachable by tap mode, by the sticky menu and by the keyboard
// alike: the claim is over the pointer GESTURE, and nothing else.
describe('RadialGesture: a claimed button keeps its tap and key paths', () => {
  it('opens the sticky petals on a tap-mode press, and a petal tap casts that direction', () => {
    const rig = makeRig({ tapMenus: true });
    rig.claimed.add(0);
    down(rig, 0, 1, 100, 100);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);
    rig.petals[1].click();
    expect(rig.casts).toEqual([[0, 'right']]);
  });

  it('opens on a keyboard activation', () => {
    const rig = makeRig({ tapMenus: true });
    rig.claimed.add(0);
    rig.buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.casts).toEqual([]);
  });

  it('still refuses the FLICK, which is the gesture the hold owns', () => {
    const rig = makeRig();
    rig.claimed.add(0);
    down(rig, 0, 1, 100, 100);
    move(rig, 0, 1, 100 + FLICK_PX, 100);
    up(rig, 0, 1, 100 + FLICK_PX, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('leaves the centre to the hold on the second tap-mode press, casting it once', () => {
    const rig = makeRig({ tapMenus: true });
    rig.claimed.add(0);
    down(rig, 0, 1, 100, 100);
    up(rig, 0, 1, 100, 100);
    // The hold fires the empowered centre from its OWN binding on this press, so
    // the radial only gets out of the way rather than casting it a second time.
    down(rig, 0, 2, 100, 100);
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);
  });
});

// Enter / Space on a focused ring button reads the touchTapMenus setting LIVE.
// It used to assume the setting was on, so a keyboard player with it OFF got a
// petal menu where the pre-branch behaviour cast the centre slot.
describe('RadialGesture: keyboard activation follows the live setting', () => {
  it('casts the centre slot with the setting OFF', () => {
    const rig = makeRig();
    rig.buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.casts).toEqual([[0, 'center']]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('opens the petals with the setting ON', () => {
    const rig = makeRig({ tapMenus: true });
    rig.buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
  });

  it("opens a 'toggle' control in EITHER mode, since it has no centre action", () => {
    for (const tapMenus of [false, true]) {
      document.body.replaceChildren();
      const rig = makeRig({ anchorRole: 'toggle', tapMenus });
      rig.buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(rig.gesture.isOpen(), `tapMenus=${tapMenus}`).toBe(true);
      expect(rig.casts, `tapMenus=${tapMenus}`).toEqual([]);
    }
  });
});

// The strips' seated-button defect has no twin here: a petal is an overlay
// button nothing else binds, and a tap on one casts through the routing callback
// directly rather than by re-activating the element. This is the pin that it
// stays that way.
describe('RadialGesture: a petal activation casts exactly once', () => {
  it('casts from a non-primary touch petal tap that receives no compatibility click', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    // Pointer 1 is already the movement thumb. A second touch gets only this
    // raw pointer pair, since browsers synthesize click for the primary pointer.
    rig.petals[2].dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0 }), {
        pointerId: 7,
        pointerType: 'touch',
      }),
    );
    rig.petals[2].dispatchEvent(
      Object.assign(new MouseEvent('pointerup', { bubbles: true, button: 0 }), {
        pointerId: 7,
        pointerType: 'touch',
      }),
    );
    rig.petals[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.casts).toEqual([[0, PETAL_DIRECTIONS[2]]]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('cancels from a non-primary touch on the centre target', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    rig.petalCancel.dispatchEvent(pointer('pointerdown', 7, 100, 100));
    rig.petalCancel.dispatchEvent(pointer('pointerup', 7, 100, 100));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.cancels).toBe(1);
    expect(rig.casts).toEqual([]);
  });

  it('casts once for an assistive click on a petal', () => {
    const rig = makeRig({ tapMenus: true });
    down(rig, 0, 1, 100, 100);
    rig.petals[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.casts).toEqual([[0, PETAL_DIRECTIONS[3]]]);
  });
});

// The sticky menu owns the ring while it is showing, exactly as the strip twin's
// sticky row owns its anchor. Without the guard a drag on ANOTHER button armed
// underneath the open overlay, so one button cast while the petals on screen
// showed a second one's slots. Reachable with tap menus OFF too: assistive
// activation opens the sticky menu in either mode.
describe('RadialGesture: a sticky menu refuses a drag underneath it', () => {
  it('refuses a drag on another button while the petals are sticky-open', () => {
    const rig = makeRig();
    // The assistive path with the setting OFF: the menu is opened directly,
    // exactly as the click handler opens it for a screen reader.
    rig.gesture.openSticky(0);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);

    down(rig, 1, 1, 100, 100);
    move(rig, 1, 1, 100 + FLICK_PX, 100);
    up(rig, 1, 1, 100 + FLICK_PX, 100);
    // Nothing cast, and the open menu still belongs to the button that opened it.
    expect(rig.casts).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.heldButtonIndex()).toBe(0);
  });

  it('arms again once the sticky menu is closed', () => {
    const rig = makeRig();
    rig.gesture.openSticky(0);
    rig.gesture.closeSticky();
    down(rig, 1, 1, 100, 100);
    move(rig, 1, 1, 100 + FLICK_PX, 100);
    up(rig, 1, 1, 100 + FLICK_PX, 100);
    expect(rig.casts).toEqual([[1, 'right']]);
  });
});

// A sticky open focuses the first petal in the same call, and a petal the frame
// has not painted yet is display:none, which refuses focus and leaves it on the
// ring button. The owner (the ring, the stance control) hands the gesture a
// repaint for exactly this moment; the drag paths keep riding its frame.
describe('RadialGesture: the sticky open paints before it focuses', () => {
  it('repaints with the petals already open, before focus moves', () => {
    const rig = makeRig();
    rig.gesture.openSticky(0);
    expect(rig.repaints).toContain(true);
    const openAt = rig.repaints.indexOf(true);
    expect(rig.focusedAtRepaint[openAt]).not.toBe(rig.petals[0]);
    expect(document.activeElement).toBe(rig.petals[0]);
  });

  it('repaints on the close as well, before focus returns to the button', () => {
    const rig = makeRig();
    rig.gesture.openSticky(0);
    const before = rig.repaints.length;
    rig.gesture.closeSticky();
    expect(rig.repaints.length).toBeGreaterThan(before);
    expect(rig.repaints[rig.repaints.length - 1]).toBe(false);
    expect(document.activeElement).toBe(rig.buttons[0]);
  });
});

// Focusability rides the shared elided writer as the tabindex ATTRIBUTE rather
// than as a raw tabIndex IDL write, which is what every other write this layer
// makes already does.
describe('RadialGesture: petal focusability goes through the writer facet', () => {
  it('opens the petals to the tab order and closes them out of it again', () => {
    const rig = makeRig();
    expect(rig.petals.every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    rig.gesture.openSticky(0);
    expect(rig.petals.every((el) => el.getAttribute('tabindex') === '0')).toBe(true);
    expect(rig.petalCancel.getAttribute('tabindex')).toBe('0');
    // Reflected onto the IDL property, which is what the tab order reads.
    expect(rig.petals[0].tabIndex).toBe(0);
    // And it went through the FACET: a raw tabIndex write leaves the shared
    // elision cache empty, so a later identical write would hit the DOM again.
    expect(rig.attrCache.get(rig.petals[0])?.get('tabindex')).toBe('0');
    expect(rig.attrCache.get(rig.petalCancel)?.get('tabindex')).toBe('0');
    rig.gesture.closeSticky();
    expect(rig.petals.every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    expect(rig.petalCancel.getAttribute('tabindex')).toBe('-1');
  });
});
