// Real-browser regression for tap mode (settings.touchTapMenus), the setting that
// closes WCAG 2.5.1 for the touch HUD: without it the 16 directional actions are
// reachable only by a path-based flick. Composes the shipped markup shape, the
// real mobile stylesheet, the three gesture controllers and their painters, so
// the thing a unit test cannot see is pinned against real layout and real
// hit-testing: with the setting on, every action is reachable by SINGLE TAPS,
// because the revealed item is genuinely the element under the finger.
//
// The setting-off arm is pinned per menu in the same file, so a change that
// silently turns the gesture path into the tap path fails here rather than in the
// hands of every player who never opened the options panel.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { Settings } from '../../src/game/settings';
import type { ActionBarSlotElements } from '../../src/ui/hud/action_bar/action_bar_painter';
import type {
  ActionBarSlotState,
  ActionBarState,
} from '../../src/ui/hud/action_bar/action_bar_view';
import { CONSUMABLE_BAR_SLOTS } from '../../src/ui/hud/action_bar/consumable_bar_view';
import { ConsumableStripGesture } from '../../src/ui/hud/action_bar/consumable_strip_gesture_controller';
import { ConsumableStripPainter } from '../../src/ui/hud/action_bar/consumable_strip_painter';
import { MOBILE_ACTION_BUTTONS } from '../../src/ui/hud/action_bar/mobile_action_page_view';
import type { RadialDirection } from '../../src/ui/hud/action_bar/radial_action_core';
import { RadialGesture } from '../../src/ui/hud/action_bar/radial_gesture_controller';
import {
  RADIAL_PETAL_DIRECTIONS,
  RadialPetalPainter,
} from '../../src/ui/hud/action_bar/radial_petal_painter';
import { buildMobileMenuControl } from '../../src/ui/hud/menu/menu_control_controller';
import { MENU_STRIP_ITEMS } from '../../src/ui/hud/menu/menu_strip_core';
import { MenuStripGesture } from '../../src/ui/hud/menu/menu_strip_gesture_controller';
import { MenuStripPainter } from '../../src/ui/hud/menu/menu_strip_painter';
import { buildStanceControl } from '../../src/ui/hud/stance/stance_control_controller';
import {
  STANCE_PETAL_DIRECTIONS,
  stanceRadialView,
} from '../../src/ui/hud/stance/stance_radial_core';
import { closeOpenTouchMenu } from '../../src/ui/hud/tap_menu';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { stanceBarView } from '../../src/ui/stance_bar_view';
import { bindTouchTap } from '../../src/ui/touch_tap';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

/** The iPhone 14/15-class landscape viewport the touch HUD ships to. */
const VIEWPORT = { width: 844, height: 390 } as const;
/** Past the deadzones (22px), so a swipe commits without waiting out a timer. */
const SWIPE_PX = 40;

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

function emptySlotState(kind: ActionBarSlotState['kind']): ActionBarSlotState {
  return {
    kind,
    abilityId: null,
    itemId: null,
    iconKey: '',
    cooldownRemaining: 0,
    cooldownTotal: 0,
    cooldownPercent: 0,
    cdText: '',
    count: '',
    isCharges: false,
    rechargePercent: 0,
    usable: true,
    outOfRange: false,
    queued: false,
    aiming: false,
    procGlow: false,
    empowered: false,
    ascensionSpender: false,
    ascensionCostLabel: '',
    fateConsumeReady: false,
    fateSentenceReady: false,
    ariaLabel: kind,
    ariaDescription: '',
    keybindLabel: '',
  };
}

function slotElements(btn: HTMLElement): ActionBarSlotElements {
  const label = document.createElement('span');
  label.className = 'icon-label';
  const countEl = document.createElement('span');
  countEl.className = 'item-count';
  const keybindEl = document.createElement('span');
  keybindEl.className = 'keybind';
  const cdOverlay = document.createElement('div');
  cdOverlay.className = 'cd-overlay';
  const cdText = document.createElement('div');
  cdText.className = 'cdtext';
  const rechargeOverlay = document.createElement('div');
  rechargeOverlay.className = 'recharge-overlay';
  btn.append(label, countEl, keybindEl, cdOverlay, rechargeOverlay, cdText);
  return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
}

function barState(slots: number, kind: ActionBarSlotState['kind']): ActionBarState {
  return { slots: Array.from({ length: slots }, () => emptySlotState(kind)), manySpells: false };
}

/** The shipped structure: the ring plus its two sibling overlays and the menu
 *  control, matching index.html / play.html. */
function mountHud() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';

  const ring = document.createElement('div');
  ring.id = 'mobile-action-ring';
  const slotBtns = Array.from({ length: MOBILE_ACTION_BUTTONS }, (_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-action-slot';
    btn.dataset.mobileIndex = String(i);
    // Mirrors the shipped markup: the anchors ship closed, and the gesture
    // layer moves the state from there.
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    return btn;
  });
  const seat = document.createElement('button');
  seat.type = 'button';
  seat.id = 'mobile-consumable-seat';
  seat.className = 'mobile-ring-seat';
  seat.dataset.mobileIndex = String(MOBILE_ACTION_BUTTONS);
  seat.setAttribute('aria-haspopup', 'true');
  seat.setAttribute('aria-expanded', 'false');
  const attack = document.createElement('button');
  attack.type = 'button';
  attack.id = 'mobile-action-attack';
  ring.append(...slotBtns, seat, attack);

  const radial = document.createElement('div');
  radial.id = 'mobile-action-radial';
  const petals = RADIAL_PETAL_DIRECTIONS.map((direction, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-action-petal';
    btn.dataset.radialDir = direction;
    btn.dataset.mobileIndex = String(i);
    btn.tabIndex = -1;
    return btn;
  });
  const radialCancel = document.createElement('button');
  radialCancel.type = 'button';
  radialCancel.id = 'mobile-action-radial-cancel';
  radialCancel.tabIndex = -1;
  radial.append(...petals, radialCancel);

  const strip = document.createElement('div');
  strip.id = 'mobile-consumable-strip';
  const stripItems = Array.from({ length: CONSUMABLE_BAR_SLOTS }, (_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-consumable-item';
    btn.dataset.consumableIndex = String(i);
    btn.tabIndex = -1;
    return btn;
  });
  const stripCancel = document.createElement('button');
  stripCancel.type = 'button';
  stripCancel.id = 'mobile-consumable-cancel';
  stripCancel.tabIndex = -1;
  strip.append(...stripItems, stripCancel);

  const row = document.createElement('div');
  row.id = 'mobile-combat-controls';
  const anchor = document.createElement('button');
  anchor.type = 'button';
  anchor.id = 'mobile-menu-anchor';
  anchor.className = 'mobile-btn';
  anchor.setAttribute('aria-haspopup', 'true');
  anchor.setAttribute('aria-expanded', 'false');
  row.append(anchor);

  const menuStrip = document.createElement('div');
  menuStrip.id = 'mobile-menu-strip';
  const menuItems = MENU_STRIP_ITEMS.map((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-menu-item';
    btn.id = item.elementId;
    btn.dataset.menuIndex = String(i);
    btn.tabIndex = -1;
    return btn;
  });
  const menuCancel = document.createElement('button');
  menuCancel.type = 'button';
  menuCancel.id = 'mobile-menu-cancel';
  menuCancel.tabIndex = -1;
  const caption = document.createElement('div');
  caption.id = 'mobile-menu-caption';
  caption.className = 'panel';
  const captionText = document.createElement('span');
  captionText.className = 'tt-title';
  caption.append(captionText);
  menuStrip.append(...menuItems, menuCancel, caption);

  // The stance control: a ring child (its seat is Jump's own line) plus its own
  // radial overlay, the fourth consumer of the shared tap-mode table.
  const stanceAnchor = document.createElement('button');
  stanceAnchor.type = 'button';
  stanceAnchor.id = 'mobile-stance-anchor';
  stanceAnchor.className = 'mobile-btn';
  stanceAnchor.setAttribute('aria-haspopup', 'true');
  stanceAnchor.setAttribute('aria-expanded', 'false');
  stanceAnchor.setAttribute('aria-pressed', 'false');
  const stanceAnchorIcon = document.createElement('span');
  stanceAnchorIcon.className = 'icon-label';
  stanceAnchor.append(stanceAnchorIcon);
  ring.append(stanceAnchor);

  const stanceRadial = document.createElement('div');
  stanceRadial.id = 'mobile-stance-radial';
  stanceRadial.setAttribute('role', 'group');
  const stancePetals = STANCE_PETAL_DIRECTIONS.map((direction) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-stance-petal';
    btn.dataset.radialDir = direction;
    btn.tabIndex = -1;
    const icon = document.createElement('span');
    icon.className = 'icon-label';
    btn.append(icon);
    return btn;
  });
  const stanceCancel = document.createElement('button');
  stanceCancel.type = 'button';
  stanceCancel.id = 'mobile-stance-cancel';
  stanceCancel.tabIndex = -1;
  stanceRadial.append(...stancePetals, stanceCancel);

  controls.append(ring, radial, strip, row, menuStrip, stanceRadial);
  document.body.appendChild(controls);
  return {
    controls,
    ring,
    stanceAnchor,
    stanceRadial,
    stancePetals,
    stanceCancel,
    slotBtns,
    seat,
    radial,
    petals,
    radialCancel,
    strip,
    stripItems,
    stripCancel,
    anchor,
    menuStrip,
    menuItems,
    menuCancel,
    caption,
    captionText,
  };
}

function pointerEvent(type: string, target: Element, x: number, y: number, pointerId: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
    }),
  );
}

function centerOf(el: Element): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** One finger down and up on an element's centre, plus the click a real tap
 *  produces. The controllers decide on the pointerdown and suppress that click,
 *  so a tap that resolved twice would show up as a doubled cast. */
function tap(el: Element, pointerId = 1): void {
  const { x, y } = centerOf(el);
  pointerEvent('pointerdown', el, x, y, pointerId);
  pointerEvent('pointerup', el, x, y, pointerId);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

/** A flick from an element's centre: the gesture path tap mode replaces. */
function swipe(el: Element, dx: number, pointerId = 1): void {
  const { x, y } = centerOf(el);
  pointerEvent('pointerdown', el, x, y, pointerId);
  pointerEvent('pointermove', el, x + dx, y, pointerId);
  pointerEvent('pointerup', el, x + dx, y, pointerId);
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  // The setting is real and persisted, so leave it as the product default.
  new Settings().patch({ touchTapMenus: false });
});

describe(`tap mode at ${VIEWPORT.width}x${VIEWPORT.height}`, () => {
  async function setup(tapMenus: boolean) {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    document.documentElement.style.setProperty('--app-vw', `${VIEWPORT.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${VIEWPORT.height}px`);
    // The stance control reads the setting through the SHARED tap_menu.ts cache
    // rather than an injected flag, so this arm writes the real one. patch()
    // persists and broadcasts, which is what drops that cache.
    new Settings().patch({ touchTapMenus: tapMenus });
    const rig = mountHud();

    const casts: Array<[number, RadialDirection]> = [];
    const used: number[] = [];
    const picks: number[] = [];
    const cancels = { radial: 0, strip: 0, menu: 0 };

    const radialGesture = new RadialGesture({
      buttons: rig.slotBtns,
      writers: writers(),
      tapMenus: () => tapMenus,
      metricsHost: rig.radial,
      hasSlot: () => true,
      cast: (buttonIndex, direction) => {
        casts.push([buttonIndex, direction]);
      },
      pressClaimed: () => false,
      takeSuppressedPress: () => false,
      onCancel: () => {
        cancels.radial++;
      },
      // A sticky open focuses the first petal in the same call, and an unpainted
      // petal is display:none, which refuses focus. The owner supplies this in
      // production (mobile_action_ring_controller / stance_control_controller).
      repaint: () => paintRadial(),
    });
    radialGesture.attach();
    radialGesture.attachPetals(
      RADIAL_PETAL_DIRECTIONS.map((direction, i) => ({ direction, el: rig.petals[i] })),
      rig.radialCancel,
    );
    const petalPainter = new RadialPetalPainter(
      writers(),
      {
        overlay: rig.radial,
        cancel: rig.radialCancel,
        bar: { container: rig.radial, slots: rig.petals.map(slotElements) },
      },
      () => '',
    );
    const paintRadial = () => {
      const placement = radialGesture.placement();
      if (placement === null) {
        petalPainter.hide();
        return;
      }
      petalPainter.paint(
        barState(RADIAL_PETAL_DIRECTIONS.length, 'ability'),
        placement,
        radialGesture.liveDirection(),
        radialGesture.cancelIsLive(),
      );
    };

    const stripGesture = new ConsumableStripGesture({
      seat: rig.seat,
      writers: writers(),
      tapMenus: () => tapMenus,
      metricsHost: rig.strip,
      items: rig.stripItems,
      cancel: rig.stripCancel,
      count: () => CONSUMABLE_BAR_SLOTS,
      use: (index) => {
        used.push(index);
      },
      onCancel: () => {
        cancels.strip++;
      },
      // The seat rides Hud's frame for its ordinary paints, so the sticky open
      // hands it a repaint of its own; see the radial's above.
      repaint: () => paintStrip(),
    });
    stripGesture.attach();
    const stripPainter = new ConsumableStripPainter(
      writers(),
      {
        strip: rig.strip,
        cancel: rig.stripCancel,
        seat: slotElements(rig.seat),
        items: rig.stripItems.map(slotElements),
      },
      () => '',
    );
    const paintStrip = () =>
      stripPainter.paint(barState(CONSUMABLE_BAR_SLOTS + 1, 'item'), stripGesture.openState());

    const menuPainter = new MenuStripPainter(writers(), {
      strip: rig.menuStrip,
      items: rig.menuItems,
      cancel: rig.menuCancel,
      caption: rig.caption,
      captionText: rig.captionText,
    });
    const menuGesture: MenuStripGesture = new MenuStripGesture({
      anchor: rig.anchor,
      writers: writers(),
      tapMenus: () => tapMenus,
      metricsHost: rig.menuStrip,
      items: rig.menuItems,
      cancel: rig.menuCancel,
      leftHanded: () => false,
      pick: (index) => {
        picks.push(index);
      },
      onCancel: () => {
        cancels.menu++;
      },
      repaint: () => {
        const open = menuGesture.openState();
        menuPainter.paint(open === null ? null : { ...open, caption: '' });
      },
    });
    menuGesture.attach();

    // The stance control reads tap mode through the SHARED tap_menu.ts cache, so
    // this arm drives the same setting the other three read. It is built from the
    // shipped markup exactly as Hud builds it.
    const stances = ['battle_stance', 'defensive_stance', 'berserker_stance'];
    const stanceCasts: string[] = [];
    let wornStance = stances[0];
    const stanceControl = buildStanceControl({
      writers: writers(),
      iconBackground: (key) => `#${key}`,
      name: (id) => id,
      anchorName: (m) => `stance ${m.activeId ?? 'none'}`,
      cast: (id) => {
        stanceCasts.push(id);
        wornStance = id;
      },
    });
    const paintStance = () =>
      stanceControl?.render(stanceRadialView(stanceBarView('warrior', stances, wornStance)));
    paintStance();

    return {
      ...rig,
      stances,
      stanceCasts,
      stanceControl,
      paintStance,
      casts,
      used,
      picks,
      cancels,
      radialGesture,
      stripGesture,
      menuGesture,
      paintRadial,
      paintStrip,
    };
  }

  /** Whether a finger at this element's centre actually reaches it. The painter's
   *  own child spans (the icon label, the cooldown overlays) sit on top of it, so
   *  containment is the honest question; an item that is not reached AT ALL there
   *  is not tappable, whatever its handlers say. */
  function tappableAtItsCentre(el: Element): boolean {
    const { x, y } = centerOf(el);
    const top = document.elementFromPoint(x, y);
    return top !== null && el.contains(top);
  }

  it('casts a directional action with taps only: open, then tap the petal', async () => {
    const rig = await setup(true);
    tap(rig.slotBtns[0]);
    rig.paintRadial();

    // Opening casts NOTHING, which is the whole contract of the setting.
    expect(rig.casts).toEqual([]);
    expect(rig.radial.classList.contains('open')).toBe(true);

    const petal = rig.petals[RADIAL_PETAL_DIRECTIONS.indexOf('up')];
    const box = petal.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.top).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThanOrEqual(VIEWPORT.height);
    // Real hit-testing: the drag path keeps the overlay pointer-transparent, so
    // without the sticky rule this petal would not be the element under a finger.
    expect(getComputedStyle(petal).pointerEvents).toBe('auto');
    expect(tappableAtItsCentre(petal)).toBe(true);

    tap(petal, 2);
    expect(rig.casts).toEqual([[0, 'up']]);
    rig.paintRadial();
    expect(rig.radial.classList.contains('open')).toBe(false);
  });

  it('switches stance with taps only: open the ring, then tap the stance', async () => {
    const rig = await setup(true);
    tap(rig.stanceAnchor);
    rig.paintStance();

    // Opening casts NOTHING: the control runs no action of its own, so the tap
    // that would be a "default" on the action ring is the one that opens here.
    expect(rig.stanceCasts).toEqual([]);
    expect(rig.stanceRadial.classList.contains('open')).toBe(true);
    expect(rig.stanceAnchor.getAttribute('aria-expanded')).toBe('true');

    const petal = rig.stancePetals[0];
    const box = petal.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.top).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThanOrEqual(VIEWPORT.height);
    // Real hit-testing: the drag path keeps the overlay pointer-transparent, so
    // without the sticky rule this petal would not be under a finger at all.
    expect(getComputedStyle(petal).pointerEvents).toBe('auto');
    expect(tappableAtItsCentre(petal)).toBe(true);

    tap(petal, 2);
    expect(rig.stanceCasts).toEqual([rig.stances[1]]);
    rig.paintStance();
    expect(rig.stanceRadial.classList.contains('open')).toBe(false);
    // The anchor now wears what was picked, which is the whole readout.
    expect(rig.stanceAnchor.getAttribute('aria-label')).toContain(rig.stances[1]);
  });

  it('with the setting OFF a bare tap still OPENS the stance ring, casting nothing', async () => {
    // anchorRole 'toggle': a control with no action of its own reaches its menu
    // from a bare tap in EITHER mode, and the next press closes it again.
    const rig = await setup(false);
    tap(rig.stanceAnchor);
    rig.paintStance();
    expect(rig.stanceCasts).toEqual([]);
    expect(rig.stanceRadial.classList.contains('open')).toBe(true);
    tap(rig.stanceAnchor, 2);
    rig.paintStance();
    expect(rig.stanceRadial.classList.contains('open')).toBe(false);
    expect(rig.stanceCasts).toEqual([]);
  });

  it('uses a consumable with taps only: open the seat, then tap the item', async () => {
    const rig = await setup(true);
    tap(rig.seat);
    rig.paintStrip();

    expect(rig.used).toEqual([]);
    expect(rig.strip.classList.contains('open')).toBe(true);
    const item = rig.stripItems[2];
    expect(getComputedStyle(item).pointerEvents).toBe('auto');
    expect(tappableAtItsCentre(item)).toBe(true);

    tap(item, 2);
    expect(rig.used).toEqual([2]);
    rig.paintStrip();
    expect(rig.strip.classList.contains('open')).toBe(false);
  });

  it('opens a menu item with taps only: open the control, then tap the item', async () => {
    const rig = await setup(true);
    tap(rig.anchor);

    expect(rig.picks).toEqual([]);
    expect(rig.menuStrip.classList.contains('open')).toBe(true);
    expect(rig.menuItems).toHaveLength(MENU_STRIP_ITEMS.length);
    const item = rig.menuItems[3];
    expect(getComputedStyle(item).pointerEvents).toBe('auto');
    expect(tappableAtItsCentre(item)).toBe(true);

    tap(item, 2);
    expect(rig.picks).toEqual([3]);
    expect(rig.menuStrip.classList.contains('open')).toBe(false);
  });

  it('dismisses each menu on a tap outside, with nothing cast, used or opened', async () => {
    const rig = await setup(true);
    const elsewhere = document.createElement('div');
    elsewhere.id = 'game-canvas';
    document.body.appendChild(elsewhere);

    tap(rig.slotBtns[0]);
    expect(rig.radialGesture.isOpen()).toBe(true);
    pointerEvent('pointerdown', elsewhere, 5, 5, 9);
    rig.paintRadial();
    expect(rig.radialGesture.isOpen()).toBe(false);
    expect(rig.radial.classList.contains('open')).toBe(false);

    tap(rig.seat);
    expect(rig.stripGesture.isOpen()).toBe(true);
    pointerEvent('pointerdown', elsewhere, 5, 5, 10);
    rig.paintStrip();
    expect(rig.stripGesture.isOpen()).toBe(false);
    expect(rig.strip.classList.contains('open')).toBe(false);

    tap(rig.anchor);
    expect(rig.menuGesture.isOpen()).toBe(true);
    pointerEvent('pointerdown', elsewhere, 5, 5, 11);
    expect(rig.menuGesture.isOpen()).toBe(false);
    expect(rig.menuStrip.classList.contains('open')).toBe(false);

    expect(rig.casts).toEqual([]);
    expect(rig.used).toEqual([]);
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toEqual({ radial: 1, strip: 1, menu: 1 });
  });

  // Tap mode opens a persistent menu of real buttons, and the point of that is
  // that a keyboard or Switch Control user lands INSIDE it. The focus move
  // happens in the same call as the open, so a menu whose items the frame has
  // not painted yet is display:none and refuses focus, silently leaving it on
  // the anchor. Only real layout can show that, which is why it is pinned here.
  it('lands focus inside the row and the petals it just opened', async () => {
    const rig = await setup(true);

    tap(rig.slotBtns[0]);
    expect(rig.radialGesture.isOpen()).toBe(true);
    expect(getComputedStyle(rig.petals[0]).display).not.toBe('none');
    expect(document.activeElement).toBe(rig.petals[0]);
    rig.radialGesture.closeSticky();
    expect(document.activeElement).toBe(rig.slotBtns[0]);

    tap(rig.seat, 2);
    expect(rig.stripGesture.isOpen()).toBe(true);
    expect(getComputedStyle(rig.stripItems[0]).display).not.toBe('none');
    expect(document.activeElement).toBe(rig.stripItems[0]);
    rig.stripGesture.closeSticky();
    expect(document.activeElement).toBe(rig.seat);

    tap(rig.anchor, 3);
    expect(rig.menuGesture.isOpen()).toBe(true);
    expect(getComputedStyle(rig.menuItems[0]).display).not.toBe('none');
    expect(document.activeElement).toBe(rig.menuItems[0]);
  });

  it('exposes the open state on every anchor, so assistive tech is told', async () => {
    const rig = await setup(true);
    // The retired #mobile-consumables-toggle carried aria-expanded and the
    // gesture menus that replaced it carried none, which is the regression.
    // Under tap mode each row is a persistent, focusable popup: an AT user who
    // opens one has to be able to tell that it is open.
    expect(rig.slotBtns[0].getAttribute('aria-expanded')).toBe('false');
    expect(rig.seat.getAttribute('aria-expanded')).toBe('false');
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');

    tap(rig.slotBtns[0]);
    expect(rig.slotBtns[0].getAttribute('aria-expanded')).toBe('true');
    // Only the pressed button, never the whole ring.
    expect(rig.slotBtns[1].getAttribute('aria-expanded')).toBe('false');
    rig.radialGesture.closeSticky();
    expect(rig.slotBtns[0].getAttribute('aria-expanded')).toBe('false');

    tap(rig.seat, 2);
    expect(rig.seat.getAttribute('aria-expanded')).toBe('true');
    rig.stripGesture.closeSticky();
    expect(rig.seat.getAttribute('aria-expanded')).toBe('false');

    tap(rig.anchor, 3);
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('true');
    rig.menuGesture.closeSticky();
    expect(rig.anchor.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes every open menu from the Escape dispatcher, casting nothing', async () => {
    const rig = await setup(true);
    // Hud.closeAll asks the shared registry; a keyboard or Switch Control user
    // who opens one of these rows had no key-driven way out at all before it.
    for (const [open, painted, isOpen] of [
      [() => tap(rig.slotBtns[0]), rig.paintRadial, () => rig.radialGesture.isOpen()],
      [() => tap(rig.seat, 2), rig.paintStrip, () => rig.stripGesture.isOpen()],
      [() => tap(rig.anchor, 3), () => {}, () => rig.menuGesture.isOpen()],
    ] as const) {
      open();
      expect(isOpen()).toBe(true);
      expect(closeOpenTouchMenu()).toBe(true);
      painted();
      expect(isOpen()).toBe(false);
    }
    expect(rig.casts).toEqual([]);
    expect(rig.used).toEqual([]);
    expect(rig.picks).toEqual([]);
    expect(rig.cancels).toEqual({ radial: 1, strip: 1, menu: 1 });
  });

  it('with the setting OFF every gesture still resolves the way it always did', async () => {
    const rig = await setup(false);

    // The radial: a flick casts that direction, and the tap that would have
    // opened the menu in tap mode casts the centre action instead.
    swipe(rig.slotBtns[0], SWIPE_PX, 1);
    expect(rig.casts).toEqual([[0, 'right']]);
    tap(rig.slotBtns[1], 2);
    expect(rig.casts).toEqual([
      [0, 'right'],
      [1, 'center'],
    ]);

    // The consumables row: a bare tap uses the first consumable, a leftward
    // swipe walks the row (40px at the 34px finger pitch is item 1).
    tap(rig.seat, 3);
    expect(rig.used).toEqual([0]);
    swipe(rig.seat, -SWIPE_PX, 4);
    expect(rig.used).toEqual([0, 1]);

    // Quick Actions: a bare tap OPENS the row (it runs no action of its own), a
    // rightward swipe of the same distance picks item 1 in one gesture. The tap
    // is resolved at RELEASE, which is what leaves room for the swipe.
    tap(rig.anchor, 5);
    expect(rig.picks).toEqual([]);
    expect(rig.menuGesture.isOpen()).toBe(true);
    // A second press on the control closes what the first one opened.
    tap(rig.anchor, 6);
    expect(rig.menuGesture.isOpen()).toBe(false);
    expect(rig.picks).toEqual([]);

    swipe(rig.anchor, SWIPE_PX, 7);
    expect(rig.picks).toEqual([1]);
  });

  it('with the setting OFF the tapped-open row still reaches Chat, its second item', async () => {
    // The tap used to open chat outright. It opens the row now, so chat has to
    // be reachable from the row with one more ordinary tap.
    const rig = await setup(false);
    tap(rig.anchor);
    expect(rig.menuStrip.classList.contains('open')).toBe(true);
    expect(MENU_STRIP_ITEMS[1].id).toBe('chat');
    const chat = rig.menuItems[1];
    expect(getComputedStyle(chat).pointerEvents).toBe('auto');
    expect(tappableAtItsCentre(chat)).toBe(true);
    tap(chat, 2);
    expect(rig.picks).toEqual([1]);
    expect(rig.menuStrip.classList.contains('open')).toBe(false);
  });
});

// The menu strip seats REAL buttons the touch HUD already binds, so a pick runs
// that button's own handler. A tap on a seated item ALREADY activated it, and
// re-activating it ran the action twice: one tap on the seated More button
// opened the tray and instantly closed it again. Pinned in a real browser
// because it takes the browser's own compatibility click after a touch tap,
// alongside the item's real binding, to produce the second run at all.
describe(`a seated strip button at ${VIEWPORT.width}x${VIEWPORT.height}`, () => {
  const MORE_INDEX = MENU_STRIP_ITEMS.findIndex((item) => item.id === 'more');
  const TRAY_OPEN_CLASS = 'mobile-more-open';

  async function setup(tapMenus: boolean) {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    document.body.className = 'mobile-touch game-active hud-mobile-compact';
    document.documentElement.style.setProperty('--app-vw', `${VIEWPORT.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${VIEWPORT.height}px`);
    new Settings().patch({ touchTapMenus: tapMenus });
    const rig = mountHud();
    // The REAL control, not a stub pick: how a pick reaches the seated button is
    // exactly what is under test here.
    const control = buildMobileMenuControl();
    const more = document.getElementById(MENU_STRIP_ITEMS[MORE_INDEX].elementId) as HTMLElement;
    // MobileControls binds the tray toggle through bindTouchTap, and AFTER the
    // control is built; the promoted items are bound before it, so neither
    // listener order may decide how often the action runs.
    let runs = 0;
    bindTouchTap(more, () => {
      runs++;
      document.body.classList.toggle(TRAY_OPEN_CLASS);
    });
    return { ...rig, control, more, runs: () => runs };
  }

  it('opens the More tray and LEAVES it open on a tap with the row sticky-open', async () => {
    const rig = await setup(false);
    // A plain tap on a toggle-role anchor opens the row as a sticky menu, which
    // is the state a player reaches without ever turning tap mode on.
    tap(rig.anchor, 1);
    expect(rig.control?.gesture.isOpen()).toBe(true);

    tap(rig.more, 2);
    expect(rig.runs()).toBe(1);
    expect(document.body.classList.contains(TRAY_OPEN_CLASS)).toBe(true);
    // The pick closes the row behind the tray it opened.
    expect(rig.control?.gesture.isOpen()).toBe(false);
  });

  it('leaves the tray open for a tap with tap mode ON too', async () => {
    const rig = await setup(true);
    tap(rig.anchor, 1);
    expect(rig.control?.gesture.isOpen()).toBe(true);

    tap(rig.more, 2);
    expect(rig.runs()).toBe(1);
    expect(document.body.classList.contains(TRAY_OPEN_CLASS)).toBe(true);
  });

  it('opens the tray once from a swipe release, which never touched the button', async () => {
    // The gesture path has no originating activation, so the synthesized click
    // is what runs the action and must stay.
    const rig = await setup(false);
    const { x, y } = centerOf(rig.anchor);
    pointerEvent('pointerdown', rig.anchor, x, y, 1);
    pointerEvent('pointermove', rig.anchor, x + SWIPE_PX * MENU_STRIP_ITEMS.length * 2, y, 1);
    pointerEvent('pointerup', rig.anchor, x + SWIPE_PX * MENU_STRIP_ITEMS.length * 2, y, 1);
    expect(rig.runs()).toBe(1);
    expect(document.body.classList.contains(TRAY_OPEN_CLASS)).toBe(true);
  });

  it('runs it once for an assistive click on the item, which sends no pointers', async () => {
    const rig = await setup(false);
    rig.anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(rig.control?.gesture.isOpen()).toBe(true);
    rig.more.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(rig.runs()).toBe(1);
    expect(document.body.classList.contains(TRAY_OPEN_CLASS)).toBe(true);
  });
});
