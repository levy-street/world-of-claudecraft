// @vitest-environment happy-dom
// Quick Actions' build wiring, and the one thing about it that a gesture test
// cannot see: the anchor's ACCESSIBLE NAME depends on the MODE.
//
// The static name teaches the gesture, because a touch device has no hover to
// discover it with. Under settings.touchTapMenus the row is opened and chosen
// from with separate taps, so that sentence teaches a screen-reader user
// something the control does not do; nothing rewrote it when the setting
// flipped. The name is re-resolved on the settings broadcast and again after a
// language switch, since the shell's own translatePage() pass re-stamps the
// gesture-mode name from data-i18n-aria on every locale change.

import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_CHANGE_EVENT, Settings } from '../src/game/settings';
import {
  buildMobileMenuControl,
  type MobileMenuControl,
} from '../src/ui/hud/menu/menu_control_controller';
import { MENU_STRIP_ITEMS } from '../src/ui/hud/menu/menu_strip_core';
import { t } from '../src/ui/i18n';
import { bindTouchTap } from '../src/ui/touch_tap';

const GESTURE_NAME = t('hudChrome.mobile.quickActionsAria');
const TAP_NAME = t('hudChrome.mobile.quickActionsAriaTap');

function mount(): HTMLButtonElement {
  document.body.replaceChildren();
  const anchor = document.createElement('button');
  anchor.type = 'button';
  anchor.id = 'mobile-menu-anchor';
  anchor.setAttribute('aria-expanded', 'false');
  // What the shell's data-i18n-aria pass leaves on the element at boot.
  anchor.setAttribute('aria-label', GESTURE_NAME);
  const strip = document.createElement('div');
  strip.id = 'mobile-menu-strip';
  const cancel = document.createElement('button');
  cancel.id = 'mobile-menu-cancel';
  const caption = document.createElement('div');
  caption.id = 'mobile-menu-caption';
  const captionText = document.createElement('span');
  captionText.className = 'tt-title';
  caption.append(captionText);
  document.body.append(anchor, strip, cancel, caption);
  for (const item of MENU_STRIP_ITEMS) {
    const btn = document.createElement('button');
    btn.id = item.elementId;
    btn.tabIndex = -1;
    document.body.append(btn);
  }
  return anchor;
}

function setTapMenus(on: boolean): void {
  new Settings().set('touchTapMenus', on);
}

beforeEach(() => {
  localStorage.clear();
  setTapMenus(false);
});

describe('buildMobileMenuControl: the anchor name follows the mode', () => {
  it('teaches the gesture with the setting off', () => {
    const anchor = mount();
    expect(buildMobileMenuControl()).not.toBeNull();
    expect(anchor.getAttribute('aria-label')).toBe(GESTURE_NAME);
    expect(GESTURE_NAME).toContain('swipe');
  });

  it('swaps to the tap-mode name the moment the options row flips', () => {
    const anchor = mount();
    expect(buildMobileMenuControl()).not.toBeNull();
    setTapMenus(true);
    expect(anchor.getAttribute('aria-label')).toBe(TAP_NAME);
    // The gesture sentence is what was wrong under tap mode: there is no swipe
    // there, the row is opened and chosen from with separate taps.
    expect(TAP_NAME).not.toBe(GESTURE_NAME);
    expect(TAP_NAME).not.toContain('swipe');

    setTapMenus(false);
    expect(anchor.getAttribute('aria-label')).toBe(GESTURE_NAME);
  });

  it('re-applies the tap-mode name after the shell re-stamps it on a locale switch', () => {
    const anchor = mount();
    expect(buildMobileMenuControl()).not.toBeNull();
    setTapMenus(true);
    // translatePage() writes data-i18n-aria straight onto the element, outside
    // any facet, so the correction must not be elided away.
    anchor.setAttribute('aria-label', GESTURE_NAME);
    document.dispatchEvent(new CustomEvent('woc:languagechange'));
    expect(anchor.getAttribute('aria-label')).toBe(TAP_NAME);
  });

  it('builds nothing when the markup is absent, and touches no name', () => {
    document.body.replaceChildren();
    expect(buildMobileMenuControl()).toBeNull();
  });

  it('takes no default-action callback: the control runs no action of its own', () => {
    // It used to be handed MobileControls' chat toggle. Chat is a strip item
    // now, so a bare tap opens the row and there is nothing left to hand down.
    const anchor = mount();
    const control = buildMobileMenuControl();
    expect(control).not.toBeNull();
    anchor.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }), {
        pointerId: 1,
        pointerType: 'touch',
      }),
    );
    anchor.dispatchEvent(
      Object.assign(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 100 }), {
        pointerId: 1,
        pointerType: 'touch',
      }),
    );
    expect(control?.gesture.isOpen()).toBe(true);
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the anchor open state to the gesture layer, starting closed', () => {
    const anchor = mount();
    const control = buildMobileMenuControl();
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    control?.gesture.openSticky();
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    control?.gesture.closeSticky();
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('buildMobileMenuControl: the settings broadcast is the only invalidation', () => {
  it('answers a bare broadcast without a build having gone stale', () => {
    const anchor = mount();
    expect(buildMobileMenuControl()).not.toBeNull();
    window.dispatchEvent(new Event(SETTINGS_CHANGE_EVENT));
    expect(anchor.getAttribute('aria-label')).toBe(GESTURE_NAME);
  });
});

// The strip seats REAL buttons the touch HUD already binds, so a pick must run
// that button's action EXACTLY once, however the pick was made. A pick made by
// CLICKING the item itself had already activated it, and re-clicking it ran the
// action a second time: one tap on the seated #mobile-more opened the tray and
// instantly closed it again. bindTouchTap is bound here exactly as
// MobileControls binds it, on both sides of the build, because the production
// order differs per item (#mobile-more is bound after the control, the promoted
// items before it) and the listener order must not decide how often an action
// runs.
describe('buildMobileMenuControl: a pick runs the seated action exactly once', () => {
  interface PickRig {
    anchor: HTMLButtonElement;
    control: MobileMenuControl;
    item: HTMLButtonElement;
    runs: number;
  }

  /** The seated button MobileControls binds, and the control around it. */
  function pickRig(index: number, bindOrder: 'before' | 'after'): PickRig {
    const anchor = mount();
    const item = document.getElementById(MENU_STRIP_ITEMS[index].elementId) as HTMLButtonElement;
    const rig = { anchor, item, runs: 0 } as PickRig;
    const bind = (): void => {
      bindTouchTap(item, () => {
        rig.runs++;
      });
    };
    if (bindOrder === 'before') bind();
    const control = buildMobileMenuControl();
    if (!control) throw new Error('the control must build over the mounted markup');
    if (bindOrder === 'after') bind();
    rig.control = control;
    return rig;
  }

  function touchPointer(type: string, pointerId: number, clientX: number): MouseEvent {
    return Object.assign(
      new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 320 }),
      { pointerId, pointerType: 'touch' },
    );
  }

  /** What a real touchscreen tap delivers: the touch pointer pair, then the
   *  compatibility click the browser synthesizes for it. */
  function touchTap(el: HTMLElement, pointerId: number): void {
    el.dispatchEvent(touchPointer('pointerdown', pointerId, 100));
    el.dispatchEvent(touchPointer('pointerup', pointerId, 100));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  for (const bindOrder of ['before', 'after'] as const) {
    it(`runs it once for a tap on a sticky-open item, bound ${bindOrder} the build`, () => {
      const rig = pickRig(9, bindOrder);
      rig.control.gesture.openSticky();
      touchTap(rig.item, 1);
      expect(rig.runs).toBe(1);
      expect(rig.control.gesture.isOpen()).toBe(false);
    });

    it(`runs it once for an assistive click, bound ${bindOrder} the build`, () => {
      // VoiceOver and Switch Control activate a button with a plain click and
      // emit no pointer events at all.
      const rig = pickRig(9, bindOrder);
      rig.control.gesture.openSticky();
      rig.item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(rig.runs).toBe(1);
    });
  }

  it('runs it once for a keyboard activation of the focused item', () => {
    // Enter/Space on a focused button reports detail 0 and no pointer events.
    const rig = pickRig(0, 'before');
    rig.control.gesture.openSticky();
    rig.item.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(rig.runs).toBe(1);
  });

  it('runs it once for a tap on the item with tap mode ON', () => {
    setTapMenus(true);
    const rig = pickRig(9, 'after');
    rig.anchor.dispatchEvent(touchPointer('pointerdown', 1, 100));
    expect(rig.control.gesture.isOpen()).toBe(true);
    touchTap(rig.item, 2);
    expect(rig.runs).toBe(1);
    expect(rig.control.gesture.isOpen()).toBe(false);
  });

  it('runs it once for a gesture release, which never touched the item', () => {
    // The swipe path has no originating click, so the synthesized one is what
    // activates the button and must stay.
    const rig = pickRig(0, 'after');
    rig.anchor.dispatchEvent(touchPointer('pointerdown', 1, 100));
    rig.anchor.dispatchEvent(touchPointer('pointermove', 1, 130));
    rig.anchor.dispatchEvent(touchPointer('pointerup', 1, 130));
    expect(rig.runs).toBe(1);
    expect(rig.control.gesture.isOpen()).toBe(false);
  });
});
