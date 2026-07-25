// @vitest-environment jsdom
//
// Pins the picker placement math in BagItemActionMenu.paint,
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

interface WorldStub {
  inventory?: { itemId: string; count: number; instance?: unknown }[];
  equipment?: Record<string, string>;
  equippedInstances?: Record<string, unknown>;
}

function harness(innerHeight: number, stub: WorldStub = {}) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  const el = document.createElement('div');
  document.body.append(el);
  const placed: { reserveRight: number; reserveBottom: number }[] = [];
  const applied: { itemId: string; enchantId: string; slot?: string }[] = [];
  let activate: ((act: string) => void) | null = null;
  // The self entity mirror carries equippedInstances in both worlds, which is
  // where the painter reads the worn payloads from.
  const world = {
    inventory: stub.inventory ?? [{ itemId: DUST, count: 99 }],
    equipment: stub.equipment ?? {},
    playerId: 1,
    entities: new Map([[1, { equippedInstances: stub.equippedInstances ?? {} }]]),
    applyEnchant: (itemId: string, enchantId: string, slot?: string) => {
      applied.push({ itemId, enchantId, slot });
    },
  };
  const menu = new BagItemActionMenu({
    world: () => world as unknown as IWorld,
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
  // Step three: drill from the reagent menu into one enchant's target step.
  const openTargets = (enchantId: string) => {
    openPicker();
    if (!activate) throw new Error('bind never called');
    activate(`enchant:${enchantId}`);
  };
  const rows = () =>
    [...el.querySelectorAll('.ctx-item')].map((row) => ({
      act: row.getAttribute('data-act'),
      text: row.textContent ?? '',
    }));
  const click = (act: string) => {
    if (!activate) throw new Error('bind never called');
    activate(act);
  };
  return { el, placed, applied, openPlain, openPicker, openTargets, rows, click };
}

describe('BagItemActionMenu.paint placement reserves', () => {
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

  it('tints each unsatisfied picker reagent, keyed to its own shortfall', () => {
    const h = harness(768);
    h.openPicker();
    const spans = [...h.el.querySelectorAll('.ctx-item-meta .ctx-reagent')];
    expect(spans.length).toBeGreaterThan(0);
    // The 99 held dust satisfies every dust line while a second reagent the
    // inventory lacks is short, so both arms are live in one paint. The
    // class is per-reagent: every marked span's have count is under its
    // required count, every plain span's is not (the {name} x{have}/{required}
    // line format carries both numbers).
    const unsat = spans.filter((span) => span.classList.contains('unsat'));
    const plain = spans.filter((span) => !span.classList.contains('unsat'));
    expect(unsat.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    for (const span of spans) {
      const m = (span.textContent ?? '').match(/x(\d+)\/(\d+)/);
      expect(m, span.textContent ?? '').not.toBeNull();
      const short = Number(m?.[1]) < Number(m?.[2]);
      expect(span.classList.contains('unsat'), span.textContent ?? '').toBe(short);
    }
  });
});

// The target step lists BOTH families: bagged copies and worn ones (worn gear
// is enchanted in place). A worn row carries its equipment slot in its label
// AND in its dispatch, which is what separates a dual-wielded pair.
describe('BagItemActionMenu target step: worn rows', () => {
  const SWORD = 'eastbrook_arming_sword'; // def slot 'mainhand'
  const WEAPON_ENCHANT = 'enchant_weapon_might';

  it('lists a worn copy alongside the bagged ones, tagged with its slot', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
      equipment: { mainhand: SWORD },
    });
    h.openTargets(WEAPON_ENCHANT);
    const acts = h.rows().map((row) => row.act);
    // The worn target and the bagged one are BOTH offered; the worn row leads.
    expect(acts).toEqual(['worn:mainhand', `target:${SWORD}`]);
    // slotName is stubbed to the raw slot key in this harness, so the tag shows
    // the localized "Worn (...)" wrapper around it.
    expect(h.rows()[0].text).toContain('Worn (mainhand)');
    expect(h.rows()[1].text).not.toContain('Worn');
  });

  it('dispatches the WORN row with its slot and the BAGGED row without one', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
      equipment: { mainhand: SWORD },
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click('worn:mainhand');
    expect(h.applied).toEqual([{ itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: 'mainhand' }]);

    h.openTargets(WEAPON_ENCHANT);
    h.click(`target:${SWORD}`);
    // The bagged arm sends no slot at all: byte-identical to the pre-feature call.
    expect(h.applied[1]).toEqual({ itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: undefined });
  });

  it('lists both hands separately, each dispatching its own slot', () => {
    const h = harness(768, {
      inventory: [{ itemId: DUST, count: 99 }],
      equipment: { mainhand: SWORD, offhand: SWORD },
    });
    h.openTargets(WEAPON_ENCHANT);
    expect(h.rows().map((row) => row.act)).toEqual(['worn:mainhand', 'worn:offhand']);
    h.click('worn:offhand');
    expect(h.applied).toEqual([{ itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: 'offhand' }]);
  });

  it('omits an already-enchanted worn copy and falls back to the empty state', () => {
    const h = harness(768, {
      inventory: [{ itemId: DUST, count: 99 }],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: WEAPON_ENCHANT } },
    });
    h.openTargets(WEAPON_ENCHANT);
    // No selectable row survives, so the picker shows only the inert empty line.
    expect(h.rows().map((row) => row.act)).toEqual([null]);
  });
});
