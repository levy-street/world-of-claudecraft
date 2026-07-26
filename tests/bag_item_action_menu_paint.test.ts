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
import {
  BagItemActionMenu,
  CTX_ITEM_DANGER_CLASS,
  CTX_MENU_PICKER_CLASS,
} from '../src/ui/bag_item_action_menu';
import { disenchantYieldLines } from '../src/ui/disenchant_yield_view';
import { enchantSectionsForReagent } from '../src/ui/enchant_apply_view';
import type { IWorld } from '../src/world_api';

const DUST = 'arcane_dust';
const ESSENCE = 'arcane_essence';
/** The base meta sub-line class every picker tag shares; the #2421 destructive
 *  modifier is the second class on a replace flag alone. */
const CTX_ITEM_META_CLASS = 'ctx-item-meta';

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
  const applied: { itemId: string; enchantId: string; slot?: string; confirmReplace?: boolean }[] =
    [];
  const confirms: {
    title: string;
    body: string;
    ok: string;
    cancel: string;
    onOk: () => void;
  }[] = [];
  // Observable, not a no-op stub: the dialog-opening paths document an EARLY
  // RETURN (the dialog repaints on OK instead), so afterAction has to be
  // countable for that contract to be pinnable at all.
  let afterActions = 0;
  let activate: ((act: string) => void) | null = null;
  // The self entity mirror carries equippedInstances in both worlds, which is
  // where the painter reads the worn payloads from.
  const world = {
    inventory: stub.inventory ?? [{ itemId: DUST, count: 99 }],
    equipment: stub.equipment ?? {},
    playerId: 1,
    entities: new Map([[1, { equippedInstances: stub.equippedInstances ?? {} }]]),
    applyEnchant: (itemId: string, enchantId: string, slot?: string, confirmReplace?: boolean) => {
      applied.push({ itemId, enchantId, slot, confirmReplace });
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
    confirmDialog: (title, body, ok, cancel, onOk) => {
      confirms.push({ title, body, ok, cancel, onOk });
    },
    slotName: (slot) => slot,
    isMobileLayout: () => false,
    afterAction: () => {
      afterActions += 1;
    },
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
      // The meta sub-lines with their modifier classes, for the #2421
      // destructive-vs-informational split: textContent alone cannot tell a
      // warning-styled tag from a muted one.
      metas: [...row.querySelectorAll('.ctx-item-meta')].map((meta) => ({
        text: meta.textContent ?? '',
        classes: [...meta.classList],
      })),
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
    afterActions: () => afterActions,
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

  it('paints a worn copy already carrying the PICKED enchant as a disabled same-enchant row', () => {
    const h = harness(768, {
      inventory: [{ itemId: DUST, count: 99 }],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: WEAPON_ENCHANT } },
    });
    h.openTargets(WEAPON_ENCHANT);
    // #2415: no longer hidden, but not selectable either: a confirm whose
    // accept the sim denies same_enchant is never offered.
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([null]);
    expect(rows[0].text).toContain('Already applied');
  });
});

// The #2415 replace flow through the real painter: flagged rows carry the
// doomed enchant in their meta, activation opens the ONE destroy-confirm
// family naming exactly what a confirmed apply destroys (plus the no-refund
// ruling and the reagent cost), and only the dialog's OK sends the apply,
// with the confirm flag.
describe('BagItemActionMenu target step: replace rows (#2415)', () => {
  const SWORD = 'eastbrook_arming_sword';
  const WEAPON_ENCHANT = 'enchant_weapon_might';
  const AGILITY = 'enchant_weapon_agility';

  it('a bagged enchanted copy paints as a replace row; OK (and only OK) sends the confirmed apply', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([`replace:${SWORD}`]);
    // The row's meta names the enchant a confirm would destroy.
    expect(rows[0].text).toContain('Enchant Weapon - Agility');

    h.click(`replace:${SWORD}`);
    // The click opened the confirm dialog and sent NOTHING yet.
    expect(h.applied).toEqual([]);
    expect(h.confirms).toHaveLength(1);
    const dialog = h.confirms[0];
    expect(dialog.ok).toBe('Replace');
    expect(dialog.cancel).toBe('Cancel');
    // The title names the ITEM being operated on, not the enchant.
    expect(dialog.title).toBe('Replace the enchant on Eastbrook Arming Sword?');
    const lines = dialog.body.split('\n');
    // Line one names the swap in full, and ORDER is load-bearing: two
    // toContains would still pass with {old} and {new} swapped, which would
    // tell the player the incoming enchant is the one being destroyed.
    expect(lines[0]).toBe(
      'This replaces Enchant Weapon - Agility on Eastbrook Arming Sword with Enchant Weapon - Might.',
    );
    // The settled ruling, stated before it is paid: destroyed, no refund.
    expect(lines[1]).toContain('not refunded');
    // The reagent cost being paid (Might costs 5 dust; dust's display name).
    expect(lines[2]).toBe('Cost: Chime Dust x5');

    dialog.onOk();
    expect(h.applied).toEqual([
      { itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: undefined, confirmReplace: true },
    ]);
  });

  it('a worn enchanted copy routes through the same confirm and dispatches slot plus flag', () => {
    const h = harness(768, {
      inventory: [{ itemId: DUST, count: 99 }],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
    });
    h.openTargets(WEAPON_ENCHANT);
    expect(h.rows().map((row) => row.act)).toEqual(['worn:mainhand']);
    h.click('worn:mainhand');
    expect(h.applied).toEqual([]);
    expect(h.confirms).toHaveLength(1);
    // The worn family paints the same replace meta the bagged one does, on
    // top of its own worn tag (both are .ctx-item-meta sub-lines).
    expect(h.rows()[0].text).toContain('Replaces Enchant Weapon - Agility');
    h.confirms[0].onOk();
    expect(h.applied).toEqual([
      { itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: 'mainhand', confirmReplace: true },
    ]);
  });

  // The mixed holding: ONE item id held both plain and enchanted. It is the
  // only case that emits two rows for a single id, so it is the only place the
  // painter's act-prefix routing can cross the two families' wires, and it is
  // exactly the scene the PR screenshots stage.
  it('a plain AND an enchanted copy of one item id paint as two rows that dispatch differently', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    // Plain row first, replace row after, and only the replace row is flagged.
    expect(rows.map((row) => row.act)).toEqual([`target:${SWORD}`, `replace:${SWORD}`]);
    expect(rows[0].text).not.toContain('Replaces');
    expect(rows[1].text).toContain('Replaces Enchant Weapon - Agility');

    // The plain row sends immediately, unconfirmed, with no dialog at all.
    h.click(`target:${SWORD}`);
    expect(h.confirms).toEqual([]);
    expect(h.applied).toEqual([
      { itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: undefined, confirmReplace: undefined },
    ]);

    // Its twin still confirm-gates: the two rows never share an arm.
    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    expect(h.confirms).toHaveLength(1);
    expect(h.applied).toHaveLength(1); // still just the plain send
    h.confirms[0].onOk();
    expect(h.applied[1]).toEqual({
      itemId: SWORD,
      enchantId: WEAPON_ENCHANT,
      slot: undefined,
      confirmReplace: true,
    });
  });

  // The documented early return on the two dialog-opening paths: the dialog
  // repaints on OK, so the click itself must NOT call afterAction. A dropped
  // `return` would leave the send correct and only this counter wrong.
  it('a replace click defers afterAction to the dialog OK, on both families', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click('worn:mainhand');
    expect(h.afterActions()).toBe(0);
    h.confirms[0].onOk();
    expect(h.afterActions()).toBe(1);

    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    expect(h.afterActions()).toBe(1); // the bagged arm defers too
    h.confirms[1].onOk();
    expect(h.afterActions()).toBe(2);
  });

  it('a MULTI-reagent enchant lists every reagent in the cost line', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: 'arcane_essence', count: 99 },
        { itemId: 'arcane_shard', count: 99 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
    });
    // Greater Might is the shard tier: more than one reagent, so the join is
    // exercised rather than collapsing to a single entry.
    h.openTargets('enchant_weapon_greater_might');
    h.click(`replace:${SWORD}`);
    const costLine = h.confirms[0].body.split('\n')[2];
    const reagents = ENCHANTS.enchant_weapon_greater_might.reagents;
    expect(reagents.length).toBeGreaterThan(1);
    for (const reagent of reagents) {
      expect(costLine).toContain(`x${reagent.count}`);
    }
    expect(costLine.split(',')).toHaveLength(reagents.length);
  });

  it('a LEGACY victim with no enchant id is named by its raw doomed stats instead', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { rolled: { stats: { str: 5 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([`replace:${SWORD}`]);
    expect(rows[0].text).toContain('+5 Strength');
    h.click(`replace:${SWORD}`);
    expect(h.confirms[0].body.split('\n')[0]).toContain('+5 Strength');
  });

  it('a BAGGED copy already carrying the picked enchant paints disabled, exactly like the worn arm', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        {
          itemId: SWORD,
          count: 1,
          instance: { enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
        },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    // No data-act: the row is inert to mouse and keyboard, so a confirm whose
    // accept the sim denies same_enchant (burning nothing but the round trip)
    // is never offered from the bagged family either.
    expect(rows.map((row) => row.act)).toEqual([null]);
    expect(rows[0].text).toContain('Already applied');
  });

  it('a legacy victim with EMPTY or all-zero stats falls back to the plain Enchanted label', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { rolled: { stats: { str: 0 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    // isEnchantedInstance keys on stats PRESENCE, so a zero-valued map still
    // reads as enchanted; with every line filtered out, the row and the
    // dialog fall back to the tooltip's own Enchanted label rather than an
    // empty name.
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([`replace:${SWORD}`]);
    expect(rows[0].text).toContain('Replaces Enchanted');
    h.click(`replace:${SWORD}`);
    expect(h.confirms[0].body.split('\n')[0]).toContain('Enchanted');
  });

  it('with NO eligible target of any kind, the inert empty state still paints', () => {
    // The pre-#2415 empty-state pin, restored on its own premise: an
    // inventory with no slot-matching item at all (dust is a reagent, not a
    // mainhand piece), nothing worn.
    const h = harness(768, { inventory: [{ itemId: DUST, count: 99 }] });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([null]);
    expect(rows[0].text).toBe('No eligible item to enchant.');
    expect(h.confirms).toEqual([]);
  });

  it('a plain apply still sends immediately, with NO confirm flag on the wire call', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click(`target:${SWORD}`);
    expect(h.confirms).toEqual([]);
    expect(h.applied).toEqual([
      { itemId: SWORD, enchantId: WEAPON_ENCHANT, slot: undefined, confirmReplace: undefined },
    ]);
  });
});

// #2421: the three places the replace path under-communicated. A destructive
// row now carries a destructive modifier, the confirm states what SURVIVES as
// well as what dies, and the plain twin of a mixed holding says so, so the pair
// no longer differs only by one row HAVING a sub-line.
describe('BagItemActionMenu target step: destructive-path communication (#2421)', () => {
  const SWORD = 'eastbrook_arming_sword';
  const WEAPON_ENCHANT = 'enchant_weapon_might';
  const AGILITY = 'enchant_weapon_agility';

  it('flags the replace tag as destructive and leaves the informational tags plain', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
    });
    h.openTargets(WEAPON_ENCHANT);
    const [worn, bagged] = h.rows();
    // The worn row carries BOTH kinds of sub-line, which is the whole point:
    // "Worn (mainhand)" is informational and must stay muted, while the replace
    // flag beside it promises to destroy an enchant.
    expect(worn.metas.map((meta) => meta.text)).toEqual([
      'Worn (mainhand)',
      'Replaces Enchant Weapon - Agility',
    ]);
    expect(worn.metas[0].classes).toEqual([CTX_ITEM_META_CLASS]);
    expect(worn.metas[1].classes).toEqual([CTX_ITEM_META_CLASS, CTX_ITEM_DANGER_CLASS]);
    // The bagged replace row takes the same modifier.
    expect(bagged.metas.map((meta) => meta.classes)).toEqual([
      [CTX_ITEM_META_CLASS, CTX_ITEM_DANGER_CLASS],
    ]);
  });

  it('does NOT flag the already-applied tag: an inert row destroys nothing', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        {
          itemId: SWORD,
          count: 1,
          instance: { enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } },
        },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const [row] = h.rows();
    expect(row.act).toBeNull();
    expect(row.metas.map((meta) => meta.text)).toEqual(['Already applied']);
    expect(row.metas[0].classes).toEqual([CTX_ITEM_META_CLASS]);
  });

  it('tags the plain twin of a mixed holding, so the two rows never share a name', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual([`target:${SWORD}`, `replace:${SWORD}`]);
    // The accessible name of a role=button .ctx-item is computed from its
    // contents, so these strings are what FEEDS it (accname inserts whitespace
    // around the block-level sub-line, so AT reads them spaced). Pinned whole,
    // not by toContain: the requirement is that they DIFFER, and that each
    // states its own state rather than one of them staying silent.
    expect(rows[0].text).toBe('Eastbrook Arming SwordNot enchanted');
    expect(rows[1].text).toBe('Eastbrook Arming SwordReplaces Enchant Weapon - Agility');
    // Both rows carry a sub-line now, so the distinction no longer rests on one
    // of them having none.
    expect(rows.map((row) => row.metas.length)).toEqual([1, 1]);
    // The plain tag is INFORMATIONAL and must stay muted: "not enchanted"
    // promises no destruction, and letting it take the danger modifier would
    // spend the warning treatment on the safe row.
    expect(rows[0].metas[0].classes).toEqual([CTX_ITEM_META_CLASS]);
    expect(rows[1].metas[0].classes).toEqual([CTX_ITEM_META_CLASS, CTX_ITEM_DANGER_CLASS]);
  });

  it('tags the bagged plain twin when the enchanted copy is WORN, not bagged', () => {
    // The cross-family holding: one list, two rows, one item name, and the
    // enchanted copy happens to be on the body. Nothing about that changes what
    // the bare bagged row fails to say.
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
      equipment: { mainhand: SWORD },
      equippedInstances: { mainhand: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual(['worn:mainhand', `target:${SWORD}`]);
    expect(rows[0].text).toBe(
      'Eastbrook Arming SwordWorn (mainhand)Replaces Enchant Weapon - Agility',
    );
    expect(rows[1].text).toBe('Eastbrook Arming SwordNot enchanted');
    expect(rows[1].metas[0].classes).toEqual([CTX_ITEM_META_CLASS]);
  });

  it('leaves the bagged plain row bare when the worn twin is ALSO plain', () => {
    // The accepted limit: both copies are unenchanted, so "Not enchanted" would
    // not tell them apart, and the worn row already states where it is.
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
      equipment: { mainhand: SWORD },
    });
    h.openTargets(WEAPON_ENCHANT);
    const rows = h.rows();
    expect(rows.map((row) => row.act)).toEqual(['worn:mainhand', `target:${SWORD}`]);
    expect(rows[1].metas).toEqual([]);
  });

  it('leaves an UNAMBIGUOUS plain row tag-free: the tag is disambiguation, not decoration', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1 },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    const [row] = h.rows();
    expect(row.text).toBe('Eastbrook Arming Sword');
    expect(row.metas).toEqual([]);
  });

  it('states what SURVIVES the swap, in order, above the price', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        {
          itemId: SWORD,
          count: 1,
          instance: {
            enchant: AGILITY,
            signer: 'Tester',
            rolled: { masterwork: true, stats: { agi: 2 } },
            boundTo: 3,
          },
        },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    const lines = h.confirms[0].body.split('\n');
    // The signed masterwork piece the issue names. ORDER is load-bearing twice
    // over: the kept line sits between the destroy warning and the cost, and
    // the traits inside it print signature, masterwork, bind.
    expect(lines[1]).toContain('not refunded');
    expect(lines[2]).toBe("Kept: Maker's mark, Masterwork bonus, Commission bond");
    expect(lines[3]).toBe('Cost: Chime Dust x5');
  });

  it('says NOTHING about survivors when the victim carries none', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } } },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    const body = h.confirms[0].body;
    // A plain copy must never be told its signature is safe, and the line must
    // not degrade to a bare "Kept:" either.
    expect(body).not.toContain('Kept');
    expect(body.split('\n')).toHaveLength(3);
  });

  it('names the bond once for an ARMED lock too, in the same commission wording', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        {
          itemId: SWORD,
          count: 1,
          instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } }, bindOnTrade: true },
        },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    const lines = h.confirms[0].body.split('\n');
    // One label for both bind states, and it is the mechanic's player-facing
    // name, never the raw ItemInstancePayload field.
    expect(lines[2]).toBe('Kept: Commission bond');
    expect(lines[2].toLowerCase()).not.toContain('bindontrade');
  });

  it('the WORN confirm states signature and masterwork but claims no bind state', () => {
    const h = harness(768, {
      inventory: [{ itemId: DUST, count: 99 }],
      equipment: { mainhand: SWORD },
      equippedInstances: {
        mainhand: {
          enchant: AGILITY,
          signer: 'Tester',
          rolled: { masterwork: true, stats: { agi: 2 } },
          // Offline the self entity holds this; the online eqi mirror never
          // does. The dialog has to read the same on both hosts.
          boundTo: 3,
        },
      },
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click('worn:mainhand');
    const lines = h.confirms[0].body.split('\n');
    expect(lines[2]).toBe("Kept: Maker's mark, Masterwork bonus");
    // Named against the label this dialog ACTUALLY emits. An earlier draft
    // asserted a string no catalog row carries, which could never have failed.
    expect(h.confirms[0].body).not.toContain('Commission bond');
  });

  it('states survivors on a LEGACY victim too, whose stat lines name what dies', () => {
    const h = harness(768, {
      inventory: [
        { itemId: DUST, count: 99 },
        {
          itemId: SWORD,
          count: 1,
          instance: { signer: 'Tester', rolled: { stats: { str: 5 } } },
        },
      ],
    });
    h.openTargets(WEAPON_ENCHANT);
    h.click(`replace:${SWORD}`);
    const lines = h.confirms[0].body.split('\n');
    expect(lines[0]).toContain('+5 Strength');
    expect(lines[2]).toBe("Kept: Maker's mark");
    expect(lines[3]).toBe('Cost: Chime Dust x5');
    // A legacy copy is enchanted precisely BECAUSE it carries no masterwork
    // flag, so that trait can never appear on this arm.
    expect(lines[2]).not.toContain('Masterwork');
  });
});
