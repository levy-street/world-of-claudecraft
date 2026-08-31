// @vitest-environment happy-dom
// The consumables seat's composition: what the ring's 5th arc position and the
// row it opens do BEYOND the gesture (consumable_strip_gesture_controller.test)
// and the list arithmetic (consumable_bar_view.test).
//
//   - the live CAPTION, which is the item identification the retired quick bar
//     had and the seat lost: one box naming the item under the finger, so a
//     healing potion is told from a mana one mid-fight without reading icons,
//   - the row items' TOOLTIPS, the sticky / tap-mode half of the same problem
//     (real focusable buttons, long-press peek), including the in-bags line the
//     retired bar showed; the closed seat deliberately gets none, because a hold
//     there opens the row,
//   - and the SCAN gating: the carried-consumables scan walks the whole
//     inventory four times, and ran on every frame of every touch session.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import type { ActionBarWorldInput } from '../src/ui/hud/action_bar/action_bar_view';
import { CONSUMABLE_BAR_SLOTS } from '../src/ui/hud/action_bar/consumable_bar_view';
import {
  buildMobileConsumableSeat,
  type MobileConsumableSeatDeps,
} from '../src/ui/hud/action_bar/consumable_seat_controller';
import { makeWriterFacet } from '../src/ui/painter_host';

const scanSpy = vi.fn();
vi.mock('../src/ui/hud/action_bar/consumable_bar_view', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/ui/hud/action_bar/consumable_bar_view')>();
  return {
    ...actual,
    consumableBarItems: (...args: Parameters<typeof actual.consumableBarItems>) => {
      scanSpy();
      return actual.consumableBarItems(...args);
    },
  };
});

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

/** REAL content ids, so the caption's localized name is a genuine literal from
 *  the live catalog rather than whatever the test typed into a stub. */
const ITEMS: Record<string, ItemDef> = {
  healing_potion: { id: 'healing_potion', name: 'Healing Potion', kind: 'potion' },
  mana_potion: { id: 'mana_potion', name: 'Mana Potion', kind: 'potion' },
} as unknown as Record<string, ItemDef>;

const SEAT_SIZE_PX = 40;
/** Past STRIP_DEADZONE_PX (22), so a move commits to an item. */
const SWIPE_PX = 30;

function markup(): void {
  const host = document.createElement('div');
  host.innerHTML = `
    <button type="button" id="mobile-consumable-seat"></button>
    <div id="mobile-consumable-strip">
      ${Array.from(
        { length: CONSUMABLE_BAR_SLOTS },
        (_unused, i) =>
          `<button type="button" class="mobile-consumable-item" data-consumable-index="${i}" tabindex="-1"></button>`,
      ).join('')}
      <button type="button" id="mobile-consumable-cancel" tabindex="-1"></button>
      <div id="mobile-consumable-caption" class="panel" aria-hidden="true"><span class="tt-title"></span></div>
    </div>`;
  document.body.append(host);
  const strip = document.getElementById('mobile-consumable-strip') as HTMLElement;
  strip.style.setProperty('--strip-gap', '8px');
  strip.style.setProperty('--strip-margin', '6px');
  strip.style.setProperty('--app-vw', '380px');
  const seat = document.getElementById('mobile-consumable-seat') as HTMLElement;
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
}

interface Rig {
  seat: NonNullable<ReturnType<typeof buildMobileConsumableSeat>>;
  tooltips: Map<HTMLElement, () => string>;
  used: string[];
  paint(inventory?: readonly { itemId: string; count: number }[]): void;
}

const CARRIED = [
  { itemId: 'healing_potion', count: 4 },
  { itemId: 'mana_potion', count: 2 },
];

function world(inventory: readonly { itemId: string; count: number }[]): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      resourceType: 'mana',
      savedMana: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
      auras: [],
    },
    target: null,
    inventory,
    stealthed: false,
    fateThreads: 0,
    entities: [],
    activeAimSlot: null,
  };
}

function makeRig(): Rig {
  markup();
  const tooltips = new Map<HTMLElement, () => string>();
  const used: string[] = [];
  const deps: MobileConsumableSeatDeps = {
    writers: writers(),
    iconBackground: () => '',
    lookupItem: (id) => ITEMS[id],
    useItem: (id) => {
      used.push(id);
      return true;
    },
    flash: () => {},
    attachTooltip: (el, html) => tooltips.set(el, html),
    itemTooltip: (item) => `<div class="tt-title">${item.name}</div>`,
    hideTooltip: () => {},
    consumePeekGuard: () => {},
  };
  const seat = buildMobileConsumableSeat(deps);
  if (!seat) throw new Error('the seat markup did not build');
  return {
    seat,
    tooltips,
    used,
    paint: (inventory = CARRIED) => seat.paint(world(inventory)),
  };
}

function pointer(type: string, clientX: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 200 }), {
    pointerId: 1,
    pointerType: 'touch',
  });
}

function captionText(): string {
  return document.querySelector('#mobile-consumable-caption .tt-title')?.textContent ?? '';
}

function captionShown(): boolean {
  return document.getElementById('mobile-consumable-caption')?.classList.contains('shown') === true;
}

beforeEach(() => {
  document.body.replaceChildren();
  scanSpy.mockClear();
});

describe('the consumables row names the item under the finger', () => {
  it('shows ONE caption for the traversed item and moves it along the row', () => {
    const rig = makeRig();
    rig.paint();
    expect(captionShown()).toBe(false);

    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.seat.seatBtn.dispatchEvent(pointer('pointermove', 100 + SWIPE_PX));
    rig.paint();
    expect(rig.seat.gesture.isOpen()).toBe(true);
    // The row is id-sorted within a kind: healing_potion then mana_potion.
    expect(captionText()).toBe('Healing Potion');
    expect(captionShown()).toBe(true);

    // One more pitch along: the caption follows the finger to the next item.
    rig.seat.seatBtn.dispatchEvent(pointer('pointermove', 100 + SWIPE_PX + 48));
    rig.paint();
    expect(captionText()).toBe('Mana Potion');
  });

  it('hides the caption again when the row closes', () => {
    const rig = makeRig();
    rig.paint();
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.seat.seatBtn.dispatchEvent(pointer('pointermove', 100 + SWIPE_PX));
    rig.paint();
    expect(captionShown()).toBe(true);

    rig.seat.seatBtn.dispatchEvent(pointer('pointerup', 100 + SWIPE_PX));
    rig.paint();
    expect(rig.seat.gesture.isOpen()).toBe(false);
    expect(captionShown()).toBe(false);
  });
});

describe('the row items carry the retired quick bar identification', () => {
  it('binds an item tooltip with the in-bags count, and none on the seat itself', () => {
    const rig = makeRig();
    rig.paint();
    const items = [...document.querySelectorAll<HTMLElement>('.mobile-consumable-item')];
    expect(rig.tooltips.size).toBe(CONSUMABLE_BAR_SLOTS);
    // The seat's own hold OPENS the row, so a tooltip there would fight it.
    expect(rig.tooltips.has(rig.seat.seatBtn)).toBe(false);

    const html = rig.tooltips.get(items[0])?.() ?? '';
    expect(html).toContain('Healing Potion');
    expect(html).toContain('4');
    // A position past what the player carries names itself as empty rather than
    // resolving nothing at all.
    expect(rig.tooltips.get(items[5])?.() ?? '').toContain('Empty slot');
  });

  it('reads the in-bags count off the snapshot the row was painted from', () => {
    const rig = makeRig();
    rig.paint([{ itemId: 'healing_potion', count: 9 }]);
    const first = document.querySelector<HTMLElement>('.mobile-consumable-item');
    expect(rig.tooltips.get(first as HTMLElement)?.() ?? '').toContain('9');
  });
});

describe('the carried-consumables scan is gated, never per frame', () => {
  it('scans once per divider window while the inventory sits still', () => {
    const rig = makeRig();
    for (let frame = 0; frame < 24; frame++) rig.paint();
    // 24 closed paints at CLOSED_RESCAN_FRAMES = 12: the establishing scan plus
    // one per completed window, never one per frame (which is 24).
    expect(scanSpy.mock.calls.length).toBe(2);
  });

  it('rescans on the very next frame after a use', () => {
    const rig = makeRig();
    rig.paint();
    rig.paint();
    const before = scanSpy.mock.calls.length;

    // A bare tap on the seat uses the first consumable.
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.seat.seatBtn.dispatchEvent(pointer('pointerup', 100));
    expect(rig.used).toEqual(['healing_potion']);

    rig.paint();
    expect(scanSpy.mock.calls.length).toBe(before + 1);
  });

  it('freezes the list while the row is open, then rescans as it closes', () => {
    const rig = makeRig();
    rig.paint();
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.seat.seatBtn.dispatchEvent(pointer('pointermove', 100 + SWIPE_PX));
    const beforeOpenPaints = scanSpy.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) rig.paint();
    // Not one scan while the row is open: an item must never shift out from
    // under a thumb travelling toward it.
    expect(scanSpy.mock.calls.length).toBe(beforeOpenPaints);

    rig.seat.gesture.cancelDrag();
    rig.paint();
    expect(scanSpy.mock.calls.length).toBe(beforeOpenPaints + 1);
  });
});

// The freeze is armed by the PRESS, not by the reveal. A press spends
// RADIAL_REVEAL_MS armed and unrevealed, and the row it will choose from is
// already decided there: a loot or a use landing inside that window used to
// re-sort the id list between the press and the index it resolved to, so the
// seat quaffed something other than what the player pressed on.
describe('the frozen list starts at the press, not at the reveal', () => {
  it('uses the item the press armed on, after the inventory re-sorts mid-press', () => {
    const rig = makeRig();
    // Carrying only a mana potion, so a bare tap on the seat uses index 0.
    rig.paint([{ itemId: 'mana_potion', count: 2 }]);
    // A USE forces the next painted frame to rescan rather than wait out the
    // divider, which is exactly how a rescan lands inside the NEXT press's armed
    // window: the player taps twice in a row.
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.seat.seatBtn.dispatchEvent(pointer('pointerup', 100));
    expect(rig.used).toEqual(['mana_potion']);

    // Second press, and a healing potion arrives DURING its armed window; it
    // sorts AHEAD of the mana one, so an unfrozen list moves index 0 under the
    // finger and the release quaffs something the player never pressed on.
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.paint(CARRIED);
    rig.seat.seatBtn.dispatchEvent(pointer('pointerup', 100));
    expect(rig.used).toEqual(['mana_potion', 'mana_potion']);
  });

  it('takes no scan at all while the press is armed but unrevealed', () => {
    const rig = makeRig();
    rig.paint();
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    expect(rig.seat.gesture.isArmed()).toBe(true);
    expect(rig.seat.gesture.isOpen()).toBe(false);
    const before = scanSpy.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) rig.paint();
    expect(scanSpy.mock.calls.length).toBe(before);
  });

  it('rescans on the frame after the press ends', () => {
    const rig = makeRig();
    rig.paint();
    rig.seat.seatBtn.dispatchEvent(pointer('pointerdown', 100));
    rig.paint();
    const before = scanSpy.mock.calls.length;
    rig.seat.gesture.cancelDrag();
    rig.paint();
    expect(scanSpy.mock.calls.length).toBe(before + 1);
  });
});

// The sticky path chooses by FOCUS, so the row has to be painted before focus
// moves onto its first item: an item still carrying display:none refuses focus
// and it stays on the seat. The seat rides Hud's frame, so it hands the gesture
// a repaint of its own.
describe('the sticky open paints the row before it focuses the first item', () => {
  it('has the row open at the moment focus lands on the first item', () => {
    const rig = makeRig();
    rig.paint();
    const strip = document.getElementById('mobile-consumable-strip') as HTMLElement;
    const items = [...document.querySelectorAll<HTMLElement>('.mobile-consumable-item')];
    expect(strip.classList.contains('open')).toBe(false);
    // The stylesheet hides an unopened row, so what decides whether the focus
    // move lands is whether the paint has already run when it happens.
    let openAtFocus: boolean | null = null;
    const focus = items[0].focus.bind(items[0]);
    items[0].focus = () => {
      openAtFocus = strip.classList.contains('open');
      focus();
    };

    rig.seat.gesture.openSticky();
    expect(openAtFocus).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    // And the item was seated by that same paint, not left at the origin.
    expect(items[0].style.left).not.toBe('');
  });
});
