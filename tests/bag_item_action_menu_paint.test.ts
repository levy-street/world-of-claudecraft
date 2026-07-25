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
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { isDisenchantable } from '../src/sim/professions/enchanting';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { BagItemActionMenu, CTX_MENU_PICKER_CLASS } from '../src/ui/bag_item_action_menu';
import { disenchantYieldLines } from '../src/ui/disenchant_yield_view';
import { enchantSectionsForReagent } from '../src/ui/enchant_apply_view';
import type { IWorld } from '../src/world_api';

const DUST = 'arcane_dust';
const ESSENCE = 'arcane_essence';

/** A live disenchantable def of the requested quality, so the confirm's yield
 *  preview is exercised against real content. */
function defFor(quality: NonNullable<ItemDef['quality']>): ItemDef {
  const found = Object.values(ITEMS).find(
    (def) => isDisenchantable(def) && def.quality === quality,
  );
  if (!found) throw new Error(`no disenchantable ${quality} def`);
  return found;
}

/** The world surface the picker reads. The worn-target step needs the paperdoll
 *  and the self entity mirror on top of the inventory, so the second harness
 *  argument accepts either a bare inventory (the common case) or this record. */
interface WorldStub {
  inventory?: InvSlot[];
  equipment?: Record<string, string>;
  equippedInstances?: Record<string, unknown>;
}

function harness(innerHeight: number, stubOrInventory: WorldStub | InvSlot[] = {}) {
  const stub: WorldStub = Array.isArray(stubOrInventory)
    ? { inventory: stubOrInventory }
    : stubOrInventory;
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  const el = document.createElement('div');
  document.body.append(el);
  const placed: { reserveRight: number; reserveBottom: number }[] = [];
  const applied: { itemId: string; enchantId: string; slot?: string }[] = [];
  const confirms: { title: string; body: string; ok: string }[] = [];
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
    confirmDialog: (title, body, ok) => {
      confirms.push({ title, body, ok });
    },
    slotName: (slot) => slot,
    isMobileLayout: () => false,
    afterAction: () => {},
  });
  const openFor = (itemId: string) => menu.open(ITEMS[itemId], itemId, 10, 10, () => {});
  const openPlain = () => openFor(DUST);
  const openPicker = (reagentId = DUST) => {
    openFor(reagentId);
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
  const runAction = (itemId: string, act: string) => {
    openFor(itemId);
    if (!activate) throw new Error('bind never called');
    activate(act);
  };
  return {
    el,
    placed,
    applied,
    confirms,
    openPlain,
    openPicker,
    openTargets,
    rows,
    click,
    runAction,
  };
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

describe('Apply Enchant picker: tier sections and effect lines', () => {
  it('paints one presentational header per tier, in the core-supplied ladder order', () => {
    const h = harness(768, [{ itemId: ESSENCE, count: 99 }]);
    h.openPicker(ESSENCE);
    const headers = [...h.el.querySelectorAll('.ctx-section')];
    // Essence is the one reagent that reaches all three tiers (the motivating
    // wall this grouping exists for).
    expect(headers.map((el) => el.textContent)).toEqual([
      'Base Enchants',
      'Runed Enchants',
      'Greater Enchants',
    ]);
    // A caption is not an action: it carries no data-act, so it is never a
    // focus stop (bindContextMenuActions promotes only .ctx-item to role=button).
    for (const header of headers) {
      expect(header.getAttribute('data-act')).toBeNull();
    }
    expect(h.el.querySelectorAll('.ctx-section[data-act]').length).toBe(0);
  });

  it('names each tier group for assistive tech, so the ladder is not sighted-only', () => {
    const h = harness(768, [{ itemId: ESSENCE, count: 99 }]);
    h.openPicker(ESSENCE);
    const groups = [...h.el.querySelectorAll('.ctx-group')];
    expect(groups.length).toBe(3);
    const ids = new Set();
    for (const group of groups) {
      expect(group.getAttribute('role')).toBe('group');
      const labelledBy = group.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      // The label target must exist, be unique, and be this group's own caption.
      expect(ids.has(labelledBy)).toBe(false);
      ids.add(labelledBy);
      // Resolve the label target INSIDE the group (this fixture keeps several
      // detached menus alive in one document, so a document-wide id lookup would
      // read another test's markup): the group's name must be its own caption.
      const caption = group.querySelector('.ctx-section');
      expect(caption).not.toBeNull();
      expect(caption?.id).toBe(labelledBy);
      // Every row of the tier sits inside its own group.
      expect(group.querySelectorAll('.ctx-item').length).toBeGreaterThan(0);
    }
    // No row escapes a group, so no enchant is left tier-less.
    const grouped = [...h.el.querySelectorAll('.ctx-group .ctx-item')].length;
    expect(grouped).toBe(h.el.querySelectorAll('.ctx-item').length);
  });

  it('a plain action menu grows no groups or captions', () => {
    const h = harness(768);
    h.openPlain();
    expect(h.el.querySelectorAll('.ctx-group').length).toBe(0);
    expect(h.el.querySelectorAll('.ctx-section').length).toBe(0);
  });

  it('paints every row the core grouped, in the core-supplied order', () => {
    const h = harness(768, [{ itemId: ESSENCE, count: 99 }]);
    h.openPicker(ESSENCE);
    const expected = enchantSectionsForReagent([{ itemId: ESSENCE, count: 99 }], ESSENCE).flatMap(
      (section) => section.rows.map((row) => ENCHANTS[row.enchantId].name),
    );
    const painted = [...h.el.querySelectorAll('.ctx-item')].map(
      (el) => el.firstChild?.textContent ?? '',
    );
    expect(painted).toEqual(expected);
    expect(painted.length).toBeGreaterThan(1);
  });

  it('renders each enchant effect inline, not hover-only, using the tooltip stat wording', () => {
    const h = harness(768, [{ itemId: DUST, count: 99 }]);
    h.openPicker();
    const rows = [...h.el.querySelectorAll('.ctx-item')];
    // Every row states what its enchant does, on the row itself.
    for (const row of rows) {
      const effect = row.querySelector('.ctx-item-effect');
      expect(effect, row.textContent ?? '').not.toBeNull();
      expect((effect?.textContent ?? '').length).toBeGreaterThan(0);
    }
    const texts = rows.map((row) => row.querySelector('.ctx-item-effect')?.textContent);
    // Helmet Fortitude grants sta 3 in content/enchants.ts.
    expect(texts).toContain('+3 Stamina');
    // The armor-axis enchants read their own axis, not a primary stat.
    expect(texts.some((textContent) => textContent?.includes('Armor'))).toBe(true);
  });

  it('keeps an unaffordable enchant visible but unselectable, effect line and all', () => {
    // No essence held, so the essence-consuming base enchants cannot be bought.
    const h = harness(768, [{ itemId: DUST, count: 99 }]);
    h.openPicker();
    const disabled = [...h.el.querySelectorAll('.ctx-item[aria-disabled="true"]')];
    expect(disabled.length).toBeGreaterThan(0);
    for (const row of disabled) {
      expect(row.getAttribute('data-act')).toBeNull();
      expect(row.querySelector('.ctx-item-effect')).not.toBeNull();
    }
  });
});

describe('disenchant confirm: expected-yield preview', () => {
  it('appends the sim-derived yield lines under the destroy warning', () => {
    const def = defFor('rare');
    const h = harness(768, [{ itemId: def.id, count: 1 }]);
    h.runAction(def.id, 'disenchant');
    expect(h.confirms).toHaveLength(1);
    const lines = h.confirms[0].body.split('\n');
    // The pre-existing warning stays line one, unchanged.
    expect(lines[0]).toContain('This destroys');
    expect(lines[0]).toContain('cannot be undone');
    // Then exactly the core's lines, in order.
    expect(lines.slice(1)).toEqual(disenchantYieldLines(def));
    expect(lines.slice(1)[0]).toBe('Expected materials:');
  });

  it('previews a range for a sub-rare piece', () => {
    const def = defFor('common');
    const h = harness(768, [{ itemId: def.id, count: 1 }]);
    h.runAction(def.id, 'disenchant');
    expect(h.confirms[0].body).toMatch(/\d+ to \d+ Chime Dust/);
  });

  it('leaves the salvage confirm untouched: no yield preview, still one line', () => {
    const def = defFor('rare');
    const h = harness(768, [{ itemId: def.id, count: 1 }]);
    h.runAction(def.id, 'salvage');
    expect(h.confirms).toHaveLength(1);
    expect(h.confirms[0].body).not.toContain('\n');
    expect(h.confirms[0].body).not.toContain('Expected materials');
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
