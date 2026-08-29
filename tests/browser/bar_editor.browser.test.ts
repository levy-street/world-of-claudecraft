// Real-browser regression for the touch bar editor and for the gesture it
// retires, at a real landscape phone viewport.
//
// Two coupled defects shipped together on the radial ring, and neither is
// visible to a unit test:
//   1. Binding rode the mobile long-press rearrange, which reached only the four
//      VISIBLE ring centres. The 16 directional slots per page could not be
//      bound at all.
//   2. That rearrange armed UNDERNEATH the radial gestures, so a hold long
//      enough to open the petals could also pick a slot up and swap it on
//      release (an accidental slot 1/2 swap mid-combat).
// So this file pins both halves against real layout and real events: the editor
// opens from the shipped Edit control with all 20 cells and both page tabs above
// the touch floor and tap-to-place / tap-to-swap really mutating the rendered
// bindings, AND a long hold on a live ring button followed by a release over its
// neighbour swaps nothing.
//
// The Edit control is wired here with bindTouchTap, the SAME helper
// MobileControls.bindButton uses (MobileControls itself needs a live phone media
// query to activate, which a headless chromium cannot be given); that it is the
// bar-editor callback on the other side of that binding is pinned in
// tests/mobile_controls.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ACTION_BAR_ABILITY_SLOTS } from '../../src/ui/hud/action_bar/action_bar_layout_core';
import { BarEditorWindow } from '../../src/ui/hud/action_bar/bar_editor/bar_editor_window';
import type { HotbarAction } from '../../src/ui/hud/action_bar/hotbar';
import {
  clearHotbarSlot,
  placeAbilityOnSlot,
  swapHotbarSlots,
} from '../../src/ui/hud/action_bar/hotbar';
import {
  MOBILE_ACTION_BUTTONS,
  mobileActionSourceSlotCount,
  sourceSlotForMobileButton,
} from '../../src/ui/hud/action_bar/mobile_action_page_view';
import { RadialGesture } from '../../src/ui/hud/action_bar/radial_gesture_controller';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { bindTouchTap } from '../../src/ui/touch_tap';
import '../../src/styles/index.css';
import { cleanup } from './_harness';

// The procedural icon compositor is stubbed: it is irrelevant to layout and to
// the swap decisions under test, and rasterizing 20 cells of art per open would
// only slow the run down.
vi.mock('../../src/ui/icons', () => ({ iconDataUrl: () => 'data:,' }));

// The iPhone 14/15-class landscape viewport the touch HUD ships to, and the tier
// the mobile stylesheet lands on there.
const VIEWPORT = { width: 844, height: 390, tier: 'hud-mobile-compact' };

/** The WCAG 2.2 / house floor for a touch target (src/ui/CLAUDE.md). */
const TOUCH_FLOOR_PX = 40;

/** The span Hud hands the editor for the SHIPPED DEFAULT desktop row visibility
 *  (both optional rows hidden). Wiring the rig with the real function is the
 *  point: a span tied to those rows left the down row, the left row and all of
 *  page 2 unbindable on a default character. */
const DEFAULT_TOUCH_SPAN = mobileActionSourceSlotCount({ secondary: false, third: false });

function mountShell() {
  // The More tray's Edit control, in the shipped markup shape.
  const tray = document.createElement('div');
  tray.id = 'mobile-extra-controls';
  tray.className = 'window panel';
  const grid = document.createElement('div');
  grid.id = 'mobile-extra-grid';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'mobile-btn';
  edit.id = 'mobile-bar-editor';
  const editLabel = document.createElement('span');
  editLabel.className = 'mobile-label';
  editLabel.textContent = 'Edit Bars';
  edit.appendChild(editLabel);
  grid.appendChild(edit);
  tray.appendChild(grid);

  const root = document.createElement('div');
  root.id = 'bar-editor';
  root.className = 'window panel';

  document.body.append(tray, root);
  return { edit, root };
}

/** The live ring: four action buttons the radial gesture attaches to. */
function mountRing() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';
  const ring = document.createElement('div');
  ring.id = 'mobile-action-ring';
  const slotBtns = Array.from({ length: MOBILE_ACTION_BUTTONS }, (_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-action-slot';
    btn.dataset.mobileIndex = String(i);
    return btn;
  });
  ring.append(...slotBtns);
  controls.appendChild(ring);
  document.body.appendChild(controls);
  return { ring, slotBtns };
}

function touch(type: string, target: Element, pointerId: number, x: number, y: number): void {
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

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
});

describe(`bar editor at ${VIEWPORT.width}x${VIEWPORT.height}`, () => {
  async function setup() {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    document.body.className = `mobile-touch game-active ${VIEWPORT.tier}`;
    document.documentElement.style.setProperty('--app-vw', `${VIEWPORT.width}px`);
    document.documentElement.style.setProperty('--app-vh', `${VIEWPORT.height}px`);
    const shell = mountShell();
    const bar: HotbarAction[] = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
    bar[0] = { type: 'ability', id: 'heroic_strike' };
    bar[1] = { type: 'ability', id: 'battle_shout' };
    const editor = new BarEditorWindow({
      root: () => shell.root,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      onVisibilityChange: () => {},
      hideTooltip: () => {},
      barActions: () => bar,
      sourceSlotCount: () => DEFAULT_TOUCH_SPAN,
      editAllowed: () => true,
      // The SAME pure helpers the desktop HTML5 drop mutates through, so this rig
      // exercises the real persistence shape rather than a bespoke stub.
      placeAbility: (abilityId, slot) => {
        bar.splice(0, bar.length, ...placeAbilityOnSlot(bar, abilityId, slot - 1));
      },
      swapSlots: (a, b) => {
        bar.splice(0, bar.length, ...swapHotbarSlots(bar, a - 1, b - 1));
      },
      clearSlot: (slot) => {
        bar.splice(0, bar.length, ...clearHotbarSlot(bar, slot - 1));
      },
    });
    bindTouchTap(shell.edit, () => editor.open());
    return { ...shell, bar, editor };
  }

  const cells = (root: HTMLElement) => [
    ...root.querySelectorAll<HTMLButtonElement>('.bar-editor-cell'),
  ];
  const tabs = (root: HTMLElement) => [
    ...root.querySelectorAll<HTMLButtonElement>('.bar-editor-tab'),
  ];
  const nameOf = (cell: HTMLButtonElement) =>
    cell.querySelector<HTMLElement>('.bar-editor-cell-name')?.textContent ?? '';

  it('opens from the Edit control with all 20 cells and both page tabs', async () => {
    const rig = await setup();
    expect(rig.root.style.display).not.toBe('block');

    const box = rig.edit.getBoundingClientRect();
    touch('pointerdown', rig.edit, 1, box.left + 5, box.top + 5);
    touch('pointerup', rig.edit, 1, box.left + 5, box.top + 5);

    expect(rig.editor.isOpen).toBe(true);
    expect(rig.root.style.display).toBe('block');
    // 4 ring buttons x 5 directions: the 16 directional slots per page that the
    // retired drag could not reach are all here, as real buttons.
    expect(cells(rig.root)).toHaveLength(20);
    expect(tabs(rig.root)).toHaveLength(2);
    // And the whole overlay is on screen, not clipped past the viewport edge.
    const rootBox = rig.root.getBoundingClientRect();
    expect(rootBox.left).toBeGreaterThanOrEqual(0);
    expect(rootBox.right).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('keeps every editor control at or above the touch floor', async () => {
    const rig = await setup();
    rig.editor.open();
    for (const control of [...cells(rig.root), ...tabs(rig.root)]) {
      const size = control.getBoundingClientRect();
      expect(size.width, control.className).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(size.height, control.className).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
  });

  it('places an armed spell into a DIRECTIONAL cell and repaints it', async () => {
    const rig = await setup();
    rig.editor.open('charge');
    // Row 4 ('down'), button 1: a directional slot, unreachable before.
    const target = cells(rig.root)[3 * MOBILE_ACTION_BUTTONS + 1];
    expect(target.dataset.barSlot).toBe('14');
    expect(target.disabled).toBe(false);
    expect(nameOf(target)).toBe('');
    target.click();

    const slot = sourceSlotForMobileButton(0, 1, 'down');
    expect(rig.bar[slot - 1]).toEqual({ type: 'ability', id: 'charge' });
    expect(nameOf(target)).not.toBe('');
  });

  it('places an armed spell into a page-2 cell and disables only the tail past 33', async () => {
    const rig = await setup();
    rig.editor.open('charge');
    tabs(rig.root)[1].click();

    const grid = cells(rig.root);
    // Page 2's resting row: slot 21, the first slot page 1 cannot reach.
    const target = grid[0];
    expect(target.dataset.barSlot).toBe('21');
    expect(target.disabled).toBe(false);
    target.click();
    expect(rig.bar[20]).toEqual({ type: 'ability', id: 'charge' });
    expect(nameOf(target)).not.toBe('');

    // The grid keeps its geometry past the configurable span: those cells render
    // but are inert, so an armed spell can never be dropped on the floor.
    for (const cell of grid) {
      const slot = Number(cell.dataset.barSlot);
      expect(cell.disabled, `slot ${slot}`).toBe(slot > ACTION_BAR_ABILITY_SLOTS);
      if (slot > ACTION_BAR_ABILITY_SLOTS) {
        expect(cell.classList.contains('out-of-range'), `slot ${slot}`).toBe(true);
      }
    }
  });

  it('clears a bound cell with the Clear control, at the touch floor', async () => {
    const rig = await setup();
    rig.editor.open();
    const clear = rig.root.querySelector<HTMLButtonElement>('.bar-editor-clear');
    expect(clear, 'the editor must offer a clear control on touch').not.toBeNull();
    const clearBtn = clear as HTMLButtonElement;
    const size = clearBtn.getBoundingClientRect();
    expect(size.width).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    expect(size.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    // On screen with the rest of the overlay, not pushed past the sheet's edge.
    const rootBox = rig.root.getBoundingClientRect();
    expect(size.right).toBeLessThanOrEqual(rootBox.right + 1);

    const grid = cells(rig.root);
    expect(nameOf(grid[0])).not.toBe('');
    clearBtn.click();
    expect(clearBtn.getAttribute('aria-pressed')).toBe('true');
    grid[0].click();

    // Slot 1 is emptied through the same bar the desktop drop mutates, and the
    // cell repaints as empty rather than keeping a stale name.
    expect(rig.bar[0]).toBeNull();
    expect(nameOf(grid[0])).toBe('');
    expect(grid[0].classList.contains('empty')).toBe(true);
    expect(clearBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('swaps two cells with two taps and repaints both', async () => {
    const rig = await setup();
    rig.editor.open();
    const grid = cells(rig.root);
    const first = nameOf(grid[0]);
    const second = nameOf(grid[1]);
    expect(first).not.toBe('');
    expect(second).not.toBe('');

    grid[0].click();
    expect(grid[0].getAttribute('aria-pressed')).toBe('true');
    grid[1].click();

    expect(rig.bar[0]).toEqual({ type: 'ability', id: 'battle_shout' });
    expect(rig.bar[1]).toEqual({ type: 'ability', id: 'heroic_strike' });
    expect(nameOf(grid[0])).toBe(second);
    expect(nameOf(grid[1])).toBe(first);
  });
});

describe('the live action ring no longer arms a rearrange', () => {
  it('does not swap when a long hold releases over a neighbouring ring button', async () => {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    document.body.className = `mobile-touch game-active ${VIEWPORT.tier}`;
    const rig = mountRing();
    const bar: HotbarAction[] = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
    bar[0] = { type: 'ability', id: 'heroic_strike' };
    bar[1] = { type: 'ability', id: 'battle_shout' };
    const before = bar.map((action) => (action === null ? null : action.id));

    const casts: Array<{ buttonIndex: number; direction: string }> = [];
    const gesture = new RadialGesture({
      buttons: rig.slotBtns,
      writers: makeWriterFacet(
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        () => {},
        () => {},
      ),
      // The gesture arm, which is what this regression is about: tap mode is the
      // other arm and has its own suite.
      tapMenus: () => false,
      metricsHost: rig.ring,
      hasSlot: () => true,
      cast: (buttonIndex, direction) => casts.push({ buttonIndex, direction }),
      pressClaimed: () => false,
      takeSuppressedPress: () => false,
      onCancel: () => {},
    });
    gesture.attach();

    const from = rig.slotBtns[0].getBoundingClientRect();
    const to = rig.slotBtns[1].getBoundingClientRect();
    touch(
      'pointerdown',
      rig.slotBtns[0],
      9,
      from.left + from.width / 2,
      from.top + from.height / 2,
    );
    // Hold well past both the radial reveal (180ms) and the retired rearrange
    // pick-up (320ms), then travel onto the neighbour and release there: this is
    // the exact gesture that used to swap slot 1 with slot 2 mid-combat.
    await new Promise((resolve) => setTimeout(resolve, 500));
    touch('pointermove', rig.slotBtns[0], 9, to.left + to.width / 2, to.top + to.height / 2);
    touch('pointerup', rig.slotBtns[0], 9, to.left + to.width / 2, to.top + to.height / 2);

    // The bindings are untouched: no rearrange path exists to run.
    expect(bar.map((action) => (action === null ? null : action.id))).toEqual(before);
    // The gesture layer itself is still alive (it resolved the travel as a flick,
    // which is a CAST), so this is not a dead-listener false green.
    expect(casts.length).toBeGreaterThan(0);
    gesture.cancel();
  });
});
