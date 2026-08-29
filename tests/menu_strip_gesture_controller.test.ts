// @vitest-environment happy-dom
// Pointer-level regressions for the menu control's gesture layer, the third of
// the touch HUD's gesture twins. The RULES have their own suite
// (menu_strip_core.test.ts); this covers what only a DOM can show: the release
// backstop for a gesture the anchor never sees, the clamp box the row is laid out
// against, the tap-versus-swipe split at the anchor, and the sticky path Phase 6
// promotes to tap mode.
//
// MenuStripGesture is a thin instantiation of the shared StripGesture
// (src/ui/hud/strip_gesture_controller.ts), so every pin here drives that shared
// layer through the parameters this menu supplies (direction, pitch, count, and
// the anchorRole 'toggle' that makes a bare tap OPEN the row rather than run an
// action the control does not have).

import { beforeEach, describe, expect, it } from 'vitest';
import { MENU_STRIP_COUNT, MENU_STRIP_PITCH_PX } from '../src/ui/hud/menu/menu_strip_core';
import {
  MenuStripGesture,
  type MenuStripGestureDeps,
} from '../src/ui/hud/menu/menu_strip_gesture_controller';
import type { StripPickSource } from '../src/ui/hud/strip_gesture_controller';
import { closeOpenTouchMenu } from '../src/ui/hud/tap_menu';
import { makeWriterFacet } from '../src/ui/painter_host';

/** A private facet per rig: the class takes Hud's shared one in production, and
 *  a test only needs the elision behaviour, not the shared skip counters. The
 *  ATTRIBUTE cache is handed back, because a write that reached the DOM without
 *  going through the facet leaves no entry in it. */
function writers(attrCache: Map<HTMLElement, Map<string, string>> = new Map()) {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    attrCache,
    () => {},
    () => {},
  );
}

const ANCHOR_SIZE_PX = 40;
/** Past STRIP_DEADZONE_PX (22), so a move commits to an item and pulls the row up
 *  without waiting out the reveal timer. */
const SWIPE_PX = 30;
const ANCHOR_X = 60;

interface Rig {
  anchor: HTMLButtonElement;
  items: HTMLButtonElement[];
  cancel: HTMLButtonElement;
  gesture: MenuStripGesture;
  picks: number[];
  /** How each pick was made, which is what tells the owner whether the item's
   *  own button has already run. */
  pickSources: StripPickSource[];
  cancels: number;
  repaints: number;
  /** settings.touchTapMenus, flipped per test. */
  tapMenus: boolean;
  /** body.mobile-left-handed, flipped per test: it reseats the anchor against
   *  the opposite edge, so the row has to grow the other way. */
  leftHanded: boolean;
  /** The facet's own attribute cache: an entry per (element, attr) it wrote. */
  attrCache: Map<HTMLElement, Map<string, string>>;
}

function makeRig(
  options: {
    appVw?: string;
    safeAreaPx?: string;
    tapMenus?: boolean;
    leftHanded?: boolean;
    anchorX?: number;
  } = {},
): Rig {
  const host = document.createElement('div');
  host.style.setProperty('--strip-gap', '8px');
  host.style.setProperty('--strip-margin', '6px');
  host.style.setProperty('--app-vw', options.appVw ?? '520px');
  for (const side of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    host.style.setProperty(side, options.safeAreaPx ?? '0px');
  }
  document.body.append(host);

  const anchor = document.createElement('button');
  anchor.type = 'button';
  document.body.append(anchor);
  const anchorX = options.anchorX ?? ANCHOR_X;
  anchor.getBoundingClientRect = () =>
    ({
      x: anchorX,
      y: 300,
      left: anchorX,
      top: 300,
      width: ANCHOR_SIZE_PX,
      height: ANCHOR_SIZE_PX,
      right: anchorX + ANCHOR_SIZE_PX,
      bottom: 300 + ANCHOR_SIZE_PX,
    }) as DOMRect;

  const items = Array.from({ length: MENU_STRIP_COUNT }, () => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    document.body.append(btn);
    return btn;
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.tabIndex = -1;
  document.body.append(cancel);

  const rig: Rig = {
    anchor,
    items,
    cancel,
    picks: [],
    pickSources: [],
    cancels: 0,
    repaints: 0,
    tapMenus: options.tapMenus ?? false,
    leftHanded: options.leftHanded ?? false,
    attrCache: new Map<HTMLElement, Map<string, string>>(),
    gesture: null as unknown as MenuStripGesture,
  };
  const deps: MenuStripGestureDeps = {
    anchor,
    writers: writers(rig.attrCache),
    metricsHost: host,
    items,
    cancel,
    tapMenus: () => rig.tapMenus,
    leftHanded: () => rig.leftHanded,
    pick: (index, source) => {
      rig.picks.push(index);
      rig.pickSources.push(source);
    },
    onCancel: () => {
      rig.cancels++;
    },
    repaint: () => {
      rig.repaints++;
    },
  };
  rig.gesture = new MenuStripGesture(deps);
  rig.gesture.attach();
  return rig;
}

function pointer(type: string, pointerId: number, clientX: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 320 }), {
    pointerId,
    pointerType: 'touch',
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('MenuStripGesture: the release rules through real pointers', () => {
  it('OPENS the row on a bare tap and picks nothing', () => {
    // Quick Actions runs no action of its own, so the tap that used to open chat
    // now reveals the row as a persistent, focusable menu.
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.picks).toEqual([]);
    expect(rig.items.every((btn) => btn.tabIndex === 0)).toBe(true);
  });

  it('closes the row again on the next press of the control', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerdown', 2, 100));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toBe(1);
    // And the click the browser synthesizes after that press must not reopen it.
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('dismisses the tapped-open row on a press outside it', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    elsewhere.dispatchEvent(pointer('pointerdown', 2, 400));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toBe(1);
  });

  it('picks the item a rightward swipe lands on', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.picks).toEqual([0]);
    // A pick closes the row: it is not left open behind the window it opened.
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('cancels when the finger comes back to the anchor with the row open', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.cancels).toBe(1);
    expect(rig.picks).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('ignores a LEFTWARD drag: the row only grows one way', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 - SWIPE_PX * 3));
    expect(rig.gesture.isOpen()).toBe(false);
    // It reads as a bare tap, which opens the row rather than picking anything.
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 - SWIPE_PX * 3));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.picks).toEqual([]);
  });
});

describe('MenuStripGesture: the window release backstop', () => {
  it('drops a drag whose release never reaches the anchor', () => {
    const rig = makeRig();
    rig.anchor.setPointerCapture = () => {
      throw new Error('no capture for a synthetic pointer id');
    };
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);

    window.dispatchEvent(Object.assign(new MouseEvent('pointerup'), { pointerId: 1 }));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.openState()).toBeNull();
    // Dropping is not resolving: a release the gesture never saw opens nothing.
    expect(rig.picks).toEqual([]);

    // And the control is alive again, rather than dead under a painted row.
    rig.anchor.dispatchEvent(pointer('pointerdown', 2, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 2, 100));
    expect(rig.gesture.isOpen()).toBe(true);
  });

  it('leaves an ordinary release to the anchor, which resolves it first', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    // Bubbles to window, so the backstop runs on the same event and must find
    // nothing left to drop rather than eating the release.
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);
  });

  it('ignores a stray window release for a pointer it never armed', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    window.dispatchEvent(Object.assign(new MouseEvent('pointerup'), { pointerId: 9 }));
    expect(rig.gesture.isOpen()).toBe(true);
  });

  it('ignores a second pointer while one drag owns the control', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointermove', 2, 100 + SWIPE_PX * 6));
    expect(rig.gesture.openState()?.live).toBe(0);
  });
});

describe('MenuStripGesture: the clamp box', () => {
  it('clamps the row against the shared --app-vw box, not the window', () => {
    const rig = makeRig({ appVw: '520px' });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    // itemSize 40 + gap 8 = pitch 48 from an anchor centre at 80, so the tenth
    // item's right edge lands at 560 + 20 = 580 and the 520px app box shifts the
    // whole row 66px left. happy-dom's 1024px window would not have clamped.
    expect(window.innerWidth).toBeGreaterThan(520);
    expect(open?.placement.clamped).toBe(true);
    expect(open?.viewportWidth).toBe(520);
    expect(open?.placement.centers[0]).toBe(62);
  });

  // The overlay carries the device safe area as PADDING, and its items are
  // absolutely positioned children, so what the painter writes is resolved
  // against the PADDING box rather than the viewport. The gesture layer
  // therefore measures in that frame. NOT coverable by the real-browser suite:
  // env(safe-area-inset-*) resolves to 0 on a headless desktop viewport, so only
  // a stubbed computed style can drive the nonzero arm at all.
  it('seats the row in the overlay padding-box frame, counting the safe area once', () => {
    const rig = makeRig({ appVw: '520px', safeAreaPx: '30px' });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    // The anchor's viewport centre is 80, so in the padding box it is 50, and the
    // clamp box is the app box minus BOTH insets. The margin stays the
    // stylesheet's own 6px literal rather than absorbing the inset a second time.
    expect(open?.anchorX).toBe(50);
    expect(open?.viewportWidth).toBe(460);
    expect(open?.margin).toBe(6);
    // The tenth item's right edge overruns 460 - 6 by 96, so the row shifts left
    // by that. Rendered, that edge lands at 434 + 20 + 30 = 484, exactly 6px
    // inside the safe area; the old max(6, 30) margin put it on 520, the
    // physical screen edge, with the inset spent twice.
    expect(open?.placement.centers[MENU_STRIP_COUNT - 1]).toBe(434);
  });

  it('shifts an unclamped row by the inset and not one pixel more', () => {
    // Wide enough that nothing clamps, which isolates the frame change itself.
    const rig = makeRig({ appVw: '640px', safeAreaPx: '30px' });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    expect(open?.placement.clamped).toBe(false);
    // 98 written into a padding box that starts 30px in renders at 128, which is
    // exactly where the same unclamped row sits with no inset at all.
    expect(open?.placement.centers[0]).toBe(98);
    expect(open?.anchorY).toBe(300 + ANCHOR_SIZE_PX / 2 - 30);
  });

  it('anchors the row on the measured centre of the control itself', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const open = rig.gesture.openState();
    expect(open?.anchorX).toBe(ANCHOR_X + ANCHOR_SIZE_PX / 2);
    expect(open?.anchorY).toBe(300 + ANCHOR_SIZE_PX / 2);
    expect(open?.cancelLive).toBe(false);
  });
});

describe('MenuStripGesture: the sticky path Phase 6 promotes', () => {
  it('opens a focusable menu of real buttons on an assistive activation', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.gesture.isOpen()).toBe(true);
    for (const btn of rig.items) expect(btn.tabIndex).toBe(0);
    expect(rig.cancel.tabIndex).toBe(0);
    // Chosen by focus, not by travel, so nothing is live and the X is not either.
    expect(rig.gesture.openState()?.live).toBe(-1);
    expect(rig.gesture.openState()?.cancelLive).toBe(false);
  });

  it('picks from an item click and closes the menu again', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rig.items[4].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.picks).toEqual([4]);
    expect(rig.gesture.isOpen()).toBe(false);
    for (const btn of rig.items) expect(btn.tabIndex).toBe(-1);
  });

  it('backs out of the sticky menu through the cancel target', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rig.cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.cancels).toBe(1);
    expect(rig.picks).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('does not mistake the click a resolved gesture leaves behind for an activation', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.picks).toEqual([0]);
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // The row would be showing again if the synthetic click reopened it.
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.picks).toEqual([0]);
  });

  it('ignores an item click while the menu is closed, so the row is inert', () => {
    const rig = makeRig();
    rig.items[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.picks).toEqual([]);
  });
});

// The touchTapMenus setting: the same sticky path VoiceOver already used, now a
// player option. The RULES are tap_menu_core.ts's (its own suite); what is pinned
// here is that the anchor's pointer path routes to them and arms no drag.
describe('MenuStripGesture: tap mode', () => {
  it('opens the row on a press and picks nothing', () => {
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.picks).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
    // No drag armed, so the release resolves nothing and the row stays up.
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.liveIndex()).toBe(-1);
    expect(rig.items.every((btn) => btn.tabIndex === 0)).toBe(true);
  });

  it('opens the item that is tapped, then closes', () => {
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.items[4].click();
    expect(rig.picks).toEqual([4]);
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.items.every((btn) => btn.tabIndex === -1)).toBe(true);
  });

  it('closes the row when the anchor is pressed again, running nothing', () => {
    // The control has no default action to run here, so the second press is the
    // way out rather than a chat toggle.
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointerdown', 2, 100));
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toBe(1);
    expect(rig.gesture.isOpen()).toBe(false);
  });

  it('dismisses on a press outside the row, opening nothing', () => {
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);

    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    elsewhere.dispatchEvent(pointer('pointerdown', 2, 40));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toBe(1);
  });

  it('with the setting OFF the swipe still picks in one gesture', () => {
    // The promise of the setting: turning it off leaves the drag exactly as it
    // was, so the row is still reachable and pickable without lifting a finger.
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.picks).toEqual([0]);
    expect(rig.gesture.isOpen()).toBe(false);
  });
});

// Escape belongs to Hud's single closeAll dispatcher, which asks the shared
// tap-menu registry rather than knowing any menu by name. Before this the sticky
// row had NO key-driven way out at all, which stranded a keyboard or Switch
// Control user inside a menu they could not dismiss.
describe('MenuStripGesture: the Escape path and the anchor open state', () => {
  it('closes the sticky row through the shared registry, opening nothing', () => {
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    expect(rig.gesture.isOpen()).toBe(true);

    expect(closeOpenTouchMenu()).toBe(true);
    expect(rig.gesture.isOpen()).toBe(false);
    // A dismissal, never a choice: nothing is opened.
    expect(rig.picks).toEqual([]);
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
    // The retired toggle this control replaced carried aria-expanded; the
    // gesture menus dropped it, which is the regression this closes.
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('true');
    rig.gesture.closeSticky();
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');

    // The DRAG path opens the same popup, so it moves the same state.
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('true');
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');
  });
});

// The one thing about a pick the owner cannot work out for itself: whether the
// item element has ALREADY been activated. The menu strip seats real bound
// buttons and routes a gesture pick by clicking one, so a pick made BY a click
// on that same item must be reported as such or the action runs twice
// (menu_control_controller.test.ts drives that whole path end to end).
describe('MenuStripGesture: where a pick came from', () => {
  it('reports an item click as an item pick, not a gesture one', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rig.items[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.picks).toEqual([3]);
    expect(rig.pickSources).toEqual(['item']);
  });

  it('reports a tap-mode item tap as an item pick too', () => {
    const rig = makeRig({ tapMenus: true });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.items[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.picks).toEqual([1]);
    expect(rig.pickSources).toEqual(['item']);
  });

  it('reports a swipe release as a gesture pick, which touched no item', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.picks).toEqual([0]);
    expect(rig.pickSources).toEqual(['gesture']);
  });

  it('picks ONCE per item activation, whatever else the element is bound to', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // A real touchscreen tap: the touch pointer pair, then the compatibility
    // click the browser synthesizes for it.
    rig.items[2].dispatchEvent(pointer('pointerdown', 1, 200));
    rig.items[2].dispatchEvent(pointer('pointerup', 1, 200));
    rig.items[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.picks).toEqual([2]);
  });
});

// The left-handed HUD mirror (body.mobile-left-handed) reseats the control
// against the OPPOSITE screen edge, where a rightward row runs off the screen and
// placeConsumableStrip clamps it back over the anchor. The direction is resolved
// per GESTURE for exactly that reason: with it hard-coded 'right', the drawn
// items, the travel that highlights them and the dim band all disagreed.
describe('MenuStripGesture: the left-handed mirror', () => {
  /** The landscape phone box the touch HUD ships to, wide enough to seat the
   *  whole ten-item row without a clamp, so the direction is what is under test. */
  const MIRROR_APP_VW = '844px';
  /** The mirrored seat: 152px in from the RIGHT edge, as hud.mobile.css puts it. */
  const MIRRORED_ANCHOR_X = 844 - 152 - ANCHOR_SIZE_PX;

  it('grows the row LEFT of the anchor under the mirror', () => {
    const rig = makeRig({ appVw: MIRROR_APP_VW, leftHanded: true, anchorX: MIRRORED_ANCHOR_X });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 - SWIPE_PX));
    const open = rig.gesture.openState();
    const anchorX = open?.anchorX ?? 0;
    for (const center of open?.placement.centers ?? []) expect(center).toBeLessThan(anchorX);
  });

  it('reads the LEFTWARD travel as the walk along the row', () => {
    const rig = makeRig({ appVw: MIRROR_APP_VW, leftHanded: true, anchorX: MIRRORED_ANCHOR_X });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 300));
    // One pitch past the deadzone, LEFTWARD: the item under the finger is the
    // second one, and the rightward reading would have answered -1 (a cancel).
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 300 - (MENU_STRIP_PITCH_PX + SWIPE_PX)));
    expect(rig.gesture.liveIndex()).toBe(1);
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 300 - (MENU_STRIP_PITCH_PX + SWIPE_PX)));
    expect(rig.picks).toEqual([1]);
  });

  it('a RIGHTWARD drag under the mirror is a bare tap, not item 0', () => {
    const rig = makeRig({ appVw: MIRROR_APP_VW, leftHanded: true, anchorX: MIRRORED_ANCHOR_X });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 300));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 300 + SWIPE_PX * 3));
    expect(rig.gesture.isOpen()).toBe(false);
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 300 + SWIPE_PX * 3));
    expect(rig.picks).toEqual([]);
    expect(rig.gesture.isOpen()).toBe(true);
  });

  // The dim band is measured from the placement, so the mirror reaches it for
  // free: what is pinned here is that the two can never disagree.
  it('puts the anchor at the RIGHT edge of the dim band under the mirror', () => {
    const mirrored = makeRig({
      appVw: MIRROR_APP_VW,
      leftHanded: true,
      anchorX: MIRRORED_ANCHOR_X,
    });
    mirrored.anchor.dispatchEvent(pointer('pointerdown', 1, 300));
    mirrored.anchor.dispatchEvent(pointer('pointermove', 1, 300 - SWIPE_PX));
    const open = mirrored.gesture.openState();
    const last = open?.placement.centers[MENU_STRIP_COUNT - 1] ?? 0;
    expect(last).toBeLessThan(open?.anchorX ?? 0);

    document.body.replaceChildren();
    const plain = makeRig({ appVw: MIRROR_APP_VW });
    plain.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    plain.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const plainOpen = plain.gesture.openState();
    expect(plainOpen?.placement.centers[MENU_STRIP_COUNT - 1] ?? 0).toBeGreaterThan(
      plainOpen?.anchorX ?? 0,
    );
  });

  // The mirror is the ONLY thing that flips it: a right-handed anchor sitting
  // right of the viewport centre (a narrow portrait phone) keeps growing right,
  // which a room comparison would have got wrong.
  it('keeps growing RIGHT for a right-handed anchor past the viewport centre', () => {
    // A narrow portrait phone: the anchor's 152px seat puts it right of centre,
    // where the side with more ROOM is the left one. The row still grows right,
    // which a room comparison would have got backwards.
    const rig = makeRig({ appVw: '360px', anchorX: 200 });
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    const centers = rig.gesture.openState()?.placement.centers ?? [];
    expect(centers).toHaveLength(MENU_STRIP_COUNT);
    // Increasing centres ARE the rightward row; the clamp shifts the whole row
    // without reordering it, so this survives a row too long for the viewport.
    for (let i = 1; i < centers.length; i++) expect(centers[i]).toBeGreaterThan(centers[i - 1]);
    // And a rightward flick is what walks it, rather than reading as a cancel.
    expect(rig.gesture.liveIndex()).toBe(0);
  });
});

// Focusability rides the shared elided writer as the tabindex ATTRIBUTE rather
// than as a raw tabIndex IDL write, which is what every other write this layer
// makes already does.
describe('MenuStripGesture: row focusability goes through the writer facet', () => {
  it('opens the row into the tab order and closes it out again', () => {
    const rig = makeRig();
    expect(rig.items.every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    rig.gesture.openSticky();
    expect(rig.items.every((el) => el.getAttribute('tabindex') === '0')).toBe(true);
    expect(rig.cancel.getAttribute('tabindex')).toBe('0');
    // Reflected onto the IDL property, which is what the tab order reads.
    expect(rig.items[0].tabIndex).toBe(0);
    // And it went through the FACET: a raw tabIndex write leaves the shared
    // elision cache empty, so a later identical write would hit the DOM again.
    expect(rig.attrCache.get(rig.items[0])?.get('tabindex')).toBe('0');
    expect(rig.attrCache.get(rig.cancel)?.get('tabindex')).toBe('0');

    rig.gesture.closeSticky();
    expect(rig.items.every((el) => el.getAttribute('tabindex') === '-1')).toBe(true);
    expect(rig.cancel.getAttribute('tabindex')).toBe('-1');
    expect(rig.attrCache.get(rig.items[0])?.get('tabindex')).toBe('-1');
  });
});

// A second finger's pointercancel on the anchor must not drop the first finger's
// live row: the anchor handler used to drop the drag whatever pointer the cancel
// named, while the window backstop beneath it and the radial twin both match.
describe('MenuStripGesture: pointercancel is matched on the pointer id', () => {
  it('drops the drag when the cancel names the pointer that armed it', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(true);
    rig.anchor.dispatchEvent(pointer('pointercancel', 1, 100 + SWIPE_PX));
    expect(rig.gesture.isOpen()).toBe(false);
    expect(rig.gesture.openState()).toBeNull();
    expect(rig.picks).toEqual([]);
  });

  it('leaves the live row alone when the cancel names another pointer', () => {
    const rig = makeRig();
    rig.anchor.dispatchEvent(pointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(pointer('pointermove', 1, 100 + SWIPE_PX));
    rig.anchor.dispatchEvent(pointer('pointercancel', 2, 100));
    expect(rig.gesture.isOpen()).toBe(true);
    expect(rig.gesture.openState()?.live).toBe(0);
    // And the row still resolves its own release afterwards.
    rig.anchor.dispatchEvent(pointer('pointerup', 1, 100 + SWIPE_PX));
    expect(rig.picks).toEqual([0]);
  });
});
