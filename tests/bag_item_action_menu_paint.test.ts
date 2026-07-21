// @vitest-environment jsdom
//
// Phase 13 QA: pins the picker placement math in BagItemActionMenu.paint,
// the one fix surface the CSS guard (tests/ctx_menu_picker_sizing.test.ts)
// cannot see: the picker states reserve the CAPPED box (mirroring the CSS
// max-height min(60vh, 560px)) plus the wider right reserve, while a plain
// menu keeps the full natural estimate and the narrow reserve. Drives the
// real painter through its public open() flow with a stubbed CtxMenuSeam
// capturing what place() receives.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { BagItemActionMenu, CTX_MENU_PICKER_CLASS } from '../src/ui/bag_item_action_menu';
import type { IWorld } from '../src/world_api';

const DUST = 'arcane_dust';

function harness(innerHeight: number) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  const el = document.createElement('div');
  document.body.append(el);
  const placed: { reserveRight: number; reserveBottom: number }[] = [];
  let activate: ((act: string) => void) | null = null;
  const menu = new BagItemActionMenu({
    world: () => ({ inventory: [{ itemId: DUST, count: 99 }] }) as unknown as IWorld,
    ctxMenu: {
      element: () => el,
      place: (_el, _x, _y, reserveRight, reserveBottom) => {
        placed.push({ reserveRight, reserveBottom });
      },
      bind: (onActivate) => {
        activate = onActivate;
      },
    },
    confirmDialog: () => {},
    slotName: (slot) => slot,
    isMobileLayout: () => false,
    afterAction: () => {},
  });
  const openPlain = () => menu.open(ITEMS[DUST], DUST, 10, 10, () => {});
  const openPicker = () => {
    openPlain();
    if (!activate) throw new Error('bind never called');
    activate('applyEnchant');
  };
  return { el, placed, openPlain, openPicker };
}

describe('BagItemActionMenu.paint placement reserves (Phase 13 QA)', () => {
  it('a plain menu keeps the narrow reserve and the natural estimate, no modifier', () => {
    const h = harness(768);
    h.openPlain();
    expect(h.placed).toHaveLength(1);
    expect(h.placed[0].reserveRight).toBe(190);
    // Dust rows: the classic default action plus Apply Enchant, nothing else.
    const rows = h.el.querySelectorAll('.ctx-item').length;
    expect(rows).toBe(2);
    expect(h.placed[0].reserveBottom).toBe(80 + rows * 32);
    expect(h.el.classList.contains(CTX_MENU_PICKER_CLASS)).toBe(false);
  });

  it('the picker reserves the wider right margin and the viewport-fraction cap', () => {
    const h = harness(768);
    h.openPicker();
    // paint ran twice: the plain menu, then the picker.
    expect(h.placed).toHaveLength(2);
    const picker = h.placed[1];
    expect(picker.reserveRight).toBe(410);
    // Enough dust-consuming enchants that the natural estimate exceeds the
    // cap (the guard below keeps this premise honest as content evolves).
    const rows = h.el.querySelectorAll('.ctx-item').length;
    expect(rows).toBeGreaterThanOrEqual(16);
    expect(80 + rows * 32).toBeGreaterThan(picker.reserveBottom);
    // 768 * 0.6 = 460.8 -> rounds to 461, plus the 24px margin: the
    // viewport-fraction arm of min(60vh, 560px) binds on a short viewport.
    expect(picker.reserveBottom).toBe(485);
    expect(h.el.classList.contains(CTX_MENU_PICKER_CLASS)).toBe(true);
  });

  it('the fixed 560px arm binds on a tall viewport', () => {
    const h = harness(1200);
    h.openPicker();
    // 1200 * 0.6 = 720 exceeds the 560px desktop ceiling: 560 + 24.
    expect(h.placed[1].reserveBottom).toBe(584);
  });

  it('repainting as a plain menu drops the modifier again', () => {
    const h = harness(768);
    h.openPicker();
    expect(h.el.classList.contains(CTX_MENU_PICKER_CLASS)).toBe(true);
    h.openPlain();
    expect(h.el.classList.contains(CTX_MENU_PICKER_CLASS)).toBe(false);
  });
});
