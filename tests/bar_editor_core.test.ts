// The touch bar editor's pure core: the exploded grid model for one ring page
// and the tap state machine that replaces the retired long-press rearrange.
//
// Node env, no DOM: every decision here is a pure function, which is the whole
// point of the split (the window is a thin consumer over these results).

import { describe, expect, it } from 'vitest';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ACTION_BAR_ABILITY_SLOTS_PER_ROW,
} from '../src/ui/hud/action_bar/action_bar_layout_core';
import {
  armBarEditorAbility,
  BAR_EDITOR_CELLS_PER_PAGE,
  BAR_EDITOR_DIRECTION_KEYS,
  BAR_EDITOR_IDLE,
  BAR_EDITOR_ROW_DIRECTIONS,
  type BarEditorCell,
  type BarEditorSelection,
  barEditorCaption,
  barEditorCellAria,
  barEditorClearArmed,
  barEditorPageCount,
  barEditorPickedSlot,
  buildBarEditorGrid,
  clampBarEditorPage,
  resolveBarEditorTap,
  toggleBarEditorClear,
} from '../src/ui/hud/action_bar/bar_editor/bar_editor_core';
import {
  mobileActionSourceSlotCount,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';

const ALL_SLOTS = ACTION_BAR_ABILITY_SLOTS;
/** The span the editor is wired with on a character showing only the primary
 *  DESKTOP row, which is the shipped default and the reported configuration. */
const DEFAULT_TOUCH_SPAN = mobileActionSourceSlotCount({ secondary: false, third: false });

/** A cell by its grid coordinates, so a case reads as the tap a player makes. */
function cellAt(page: number, direction: BarEditorCell['direction'], buttonIndex: number) {
  const cells = buildBarEditorGrid(page, ALL_SLOTS);
  const cell = cells.find((c) => c.direction === direction && c.buttonIndex === buttonIndex);
  if (!cell) throw new Error(`no cell for ${direction}/${buttonIndex}`);
  return cell;
}

describe('bar editor grid model', () => {
  it('explodes one page into 4 buttons x 5 directions', () => {
    expect(BAR_EDITOR_CELLS_PER_PAGE).toBe(20);
    expect(buildBarEditorGrid(0, ALL_SLOTS)).toHaveLength(20);
  });

  it('lays the rows out direction-major, centre first', () => {
    expect([...BAR_EDITOR_ROW_DIRECTIONS]).toEqual(['center', 'up', 'right', 'down', 'left']);
    const cells = buildBarEditorGrid(0, ALL_SLOTS);
    // Row-major flat order: four buttons of one direction, then the next.
    expect(cells.slice(0, 4).map((c) => c.direction)).toEqual([
      'center',
      'center',
      'center',
      'center',
    ]);
    expect(cells.slice(0, 4).map((c) => c.buttonIndex)).toEqual([0, 1, 2, 3]);
    expect(cells.slice(4, 8).map((c) => c.direction)).toEqual(['up', 'up', 'up', 'up']);
  });

  it('maps every cell to the SAME slot the live ring casts from', () => {
    for (const page of [0, 1]) {
      for (const cell of buildBarEditorGrid(page, ALL_SLOTS)) {
        expect(cell.slot).toBe(sourceSlotForMobileButton(page, cell.buttonIndex, cell.direction));
      }
    }
  });

  it('keeps the resting row equal to the desktop 1-4 keys on page 1', () => {
    const cells = buildBarEditorGrid(0, ALL_SLOTS);
    expect(cells.slice(0, 4).map((c) => c.slot)).toEqual([1, 2, 3, 4]);
  });

  it('marks the last page tail out of range instead of dropping the cells', () => {
    const lastPage = barEditorPageCount(ALL_SLOTS) - 1;
    const cells = buildBarEditorGrid(lastPage, ALL_SLOTS);
    // The geometry is stable: 20 cells whatever the page.
    expect(cells).toHaveLength(20);
    const inRange = cells.filter((c) => c.inRange);
    expect(inRange.length).toBeLessThan(20);
    expect(inRange.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.inRange).toBe(cell.slot <= ALL_SLOTS);
  });

  it('narrows to whatever span it is handed, cell by cell', () => {
    const cells = buildBarEditorGrid(0, ACTION_BAR_ABILITY_SLOTS_PER_ROW);
    for (const cell of cells) {
      expect(cell.inRange).toBe(cell.slot <= ACTION_BAR_ABILITY_SLOTS_PER_ROW);
    }
  });

  it('keeps every cell of page 1 bindable at the DEFAULT desktop row visibility', () => {
    // The reported bug: hiding the optional DESKTOP rows (the default) trimmed
    // the editor to 11 slots, so the down row, the left row and page 2 refused
    // every placement.
    for (const cell of buildBarEditorGrid(0, DEFAULT_TOUCH_SPAN)) {
      expect(cell.inRange, `page 1 slot ${cell.slot} (${cell.direction})`).toBe(true);
    }
    expect(barEditorPageCount(DEFAULT_TOUCH_SPAN)).toBe(2);
  });

  it('offers page 2 up to slot 33 and disables its tail at the default visibility', () => {
    for (const cell of buildBarEditorGrid(1, DEFAULT_TOUCH_SPAN)) {
      expect(cell.inRange, `page 2 slot ${cell.slot} (${cell.direction})`).toBe(
        cell.slot <= ACTION_BAR_ABILITY_SLOTS,
      );
    }
  });

  it('offers exactly the live ring page span, clamped both ways', () => {
    const pages = barEditorPageCount(ALL_SLOTS);
    expect(pages).toBe(2);
    expect(clampBarEditorPage(-3, ALL_SLOTS)).toBe(0);
    expect(clampBarEditorPage(0, ALL_SLOTS)).toBe(0);
    expect(clampBarEditorPage(1, ALL_SLOTS)).toBe(1);
    expect(clampBarEditorPage(99, ALL_SLOTS)).toBe(pages - 1);
    expect(clampBarEditorPage(Number.NaN, ALL_SLOTS)).toBe(0);
  });
});

describe('bar editor tap state machine', () => {
  const bound = true;
  const empty = false;

  it('does nothing when an empty cell is tapped with nothing armed', () => {
    const tap = resolveBarEditorTap(BAR_EDITOR_IDLE, cellAt(0, 'center', 0), empty);
    expect(tap.kind).toBe('idle');
    expect(tap.selection).toEqual(BAR_EDITOR_IDLE);
  });

  it('picks a bound cell up when nothing is armed', () => {
    const cell = cellAt(0, 'up', 2);
    const tap = resolveBarEditorTap(BAR_EDITOR_IDLE, cell, bound);
    expect(tap).toMatchObject({ kind: 'pick', slot: cell.slot });
    expect(tap.selection).toEqual({ kind: 'slot', slot: cell.slot });
    expect(barEditorPickedSlot(tap.selection)).toBe(cell.slot);
  });

  it('places an armed ability on the tapped cell and disarms', () => {
    const cell = cellAt(0, 'left', 1);
    const tap = resolveBarEditorTap(armBarEditorAbility('fireball'), cell, empty);
    expect(tap).toMatchObject({ kind: 'place', abilityId: 'fireball', slot: cell.slot });
    expect(tap.selection).toEqual(BAR_EDITOR_IDLE);
  });

  it('places an armed ability onto an already bound cell too', () => {
    // Placing over a bound slot is how a player REPLACES a binding; refusing
    // would leave a full page uneditable from the spellbook.
    const cell = cellAt(0, 'down', 3);
    const tap = resolveBarEditorTap(armBarEditorAbility('fireball'), cell, bound);
    expect(tap).toMatchObject({ kind: 'place', abilityId: 'fireball', slot: cell.slot });
  });

  it('swaps two cells across the SAME page', () => {
    const from = cellAt(0, 'center', 0);
    const to = cellAt(0, 'right', 3);
    const picked = resolveBarEditorTap(BAR_EDITOR_IDLE, from, bound).selection;
    const tap = resolveBarEditorTap(picked, to, bound);
    expect(tap).toMatchObject({ kind: 'swap', from: from.slot, to: to.slot });
    expect(tap.selection).toEqual(BAR_EDITOR_IDLE);
  });

  it('swaps ACROSS pages, the move the retired drag could never make', () => {
    const from = cellAt(0, 'center', 0);
    const to = cellAt(1, 'center', 0);
    const picked: BarEditorSelection = { kind: 'slot', slot: from.slot };
    const tap = resolveBarEditorTap(picked, to, empty);
    expect(tap).toMatchObject({ kind: 'swap', from: from.slot, to: to.slot });
  });

  it('cancels when the picked-up cell is tapped again', () => {
    const cell = cellAt(0, 'up', 1);
    const picked = resolveBarEditorTap(BAR_EDITOR_IDLE, cell, bound).selection;
    const tap = resolveBarEditorTap(picked, cell, bound);
    expect(tap.kind).toBe('cancel');
    expect(tap.selection).toEqual(BAR_EDITOR_IDLE);
    expect(barEditorPickedSlot(tap.selection)).toBe(-1);
  });

  it('leaves an out-of-range cell inert whatever is armed', () => {
    const lastPage = barEditorPageCount(ALL_SLOTS) - 1;
    const tail = buildBarEditorGrid(lastPage, ALL_SLOTS).find((c) => !c.inRange);
    expect(tail).toBeDefined();
    const outOfRange = tail as BarEditorCell;
    for (const selection of [
      BAR_EDITOR_IDLE,
      armBarEditorAbility('fireball'),
      { kind: 'slot', slot: 1 } as BarEditorSelection,
    ]) {
      const tap = resolveBarEditorTap(selection, outOfRange, bound);
      expect(tap.kind).toBe('idle');
      // An armed spell must SURVIVE the dead tap rather than being dropped.
      expect(tap.selection).toEqual(selection);
    }
  });
});

// The 'mobile touch drag drop resolution' cases from tests/hotbar.test.ts,
// carried over rather than deleted: resolveMobileHotbarDrop made exactly this
// decision for the long-press rearrange (a different target swaps; releasing
// back on the source cancels), and the retired gesture's third case (releasing
// outside any slot) has no tap analogue, so it is answered by the out-of-range
// case above, which is the same "the pointer landed on nothing bindable" shape.
describe('bar editor placement at the default desktop row visibility', () => {
  const armed = armBarEditorAbility('fireball');

  function defaultCell(page: number, direction: BarEditorCell['direction'], buttonIndex: number) {
    const cell = buildBarEditorGrid(page, DEFAULT_TOUCH_SPAN).find(
      (c) => c.direction === direction && c.buttonIndex === buttonIndex,
    );
    if (!cell) throw new Error(`no cell for ${direction}/${buttonIndex}`);
    return cell;
  }

  it('accepts a placement into a DOWN cell (slots 13 to 16)', () => {
    const cell = defaultCell(0, 'down', 3);
    expect(cell.slot).toBe(16);
    expect(resolveBarEditorTap(armed, cell, false)).toEqual({
      kind: 'place',
      abilityId: 'fireball',
      slot: 16,
      selection: BAR_EDITOR_IDLE,
    });
  });

  it('accepts a placement into a LEFT cell (slots 17 to 20)', () => {
    const cell = defaultCell(0, 'left', 0);
    expect(cell.slot).toBe(17);
    expect(resolveBarEditorTap(armed, cell, false)).toEqual({
      kind: 'place',
      abilityId: 'fireball',
      slot: 17,
      selection: BAR_EDITOR_IDLE,
    });
  });

  it('accepts a placement into a page-2 cell (slots 21 to 33)', () => {
    const cell = defaultCell(1, 'center', 0);
    expect(cell.slot).toBe(21);
    expect(resolveBarEditorTap(armed, cell, false)).toEqual({
      kind: 'place',
      abilityId: 'fireball',
      slot: 21,
      selection: BAR_EDITOR_IDLE,
    });
    const last = defaultCell(1, 'down', 0);
    expect(last.slot).toBe(33);
    expect(resolveBarEditorTap(armed, last, false).kind).toBe('place');
  });

  it('still refuses the tail past slot 33, keeping the armed spell armed', () => {
    for (const [direction, buttonIndex] of [
      ['down', 1],
      ['left', 3],
    ] as const) {
      const cell = defaultCell(1, direction, buttonIndex);
      expect(cell.slot).toBeGreaterThan(ACTION_BAR_ABILITY_SLOTS);
      expect(resolveBarEditorTap(armed, cell, false)).toEqual({ kind: 'idle', selection: armed });
    }
  });
});

describe('the retired long-press drop decision, carried over', () => {
  it('resolves the target slot when it differs from the source', () => {
    const from = cellAt(0, 'center', 1);
    const to = cellAt(0, 'center', 3);
    const tap = resolveBarEditorTap({ kind: 'slot', slot: from.slot }, to, true);
    expect(tap).toMatchObject({ kind: 'swap', from: from.slot, to: to.slot });
  });

  it('cancels when the second tap lands back on the source slot', () => {
    const cell = cellAt(0, 'center', 1);
    const tap = resolveBarEditorTap({ kind: 'slot', slot: cell.slot }, cell, true);
    expect(tap.kind).toBe('cancel');
  });

  it('cancels rather than swapping with a position that binds nothing', () => {
    const lastPage = barEditorPageCount(ALL_SLOTS) - 1;
    const tail = buildBarEditorGrid(lastPage, ALL_SLOTS).find((c) => !c.inRange) as BarEditorCell;
    const tap = resolveBarEditorTap({ kind: 'slot', slot: 2 }, tail, true);
    expect(tap.kind).toBe('idle');
    expect(tap.selection).toEqual({ kind: 'slot', slot: 2 });
  });
});

describe('bar editor accessible names and caption', () => {
  // A recording t(): the core must EMIT the key plus values, never concatenate.
  const deps = {
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}|${JSON.stringify(values)}` : key,
    formatIndex: (value: number) => `#${value}`,
  } as unknown as Parameters<typeof barEditorCellAria>[2];

  it('names a bound cell by its BUTTON and DIRECTION, never a slot number', () => {
    const aria = barEditorCellAria(cellAt(0, 'up', 1), 'Fireball', deps);
    expect(aria).toContain('hudChrome.barEditor.cellAria');
    expect(aria).toContain('"button":"#2"');
    expect(aria).toContain('hudChrome.mobile.radialUp');
    expect(aria).toContain('"action":"Fireball"');
    // The invisible slot index must not leak into the spoken name.
    expect(aria).not.toContain('"slot"');
  });

  it('names an empty cell through its own key', () => {
    const aria = barEditorCellAria(cellAt(0, 'center', 0), null, deps);
    expect(aria).toContain('hudChrome.barEditor.emptyCellAria');
    expect(aria).not.toContain('hudChrome.barEditor.cellAria');
  });

  it('reuses the live ring petal direction keys, so both surfaces speak alike', () => {
    expect(BAR_EDITOR_DIRECTION_KEYS.center).toBe('hudChrome.mobile.radialCenter');
    expect(BAR_EDITOR_DIRECTION_KEYS.up).toBe('hudChrome.mobile.radialUp');
    expect(BAR_EDITOR_DIRECTION_KEYS.right).toBe('hudChrome.mobile.radialRight');
    expect(BAR_EDITOR_DIRECTION_KEYS.down).toBe('hudChrome.mobile.radialDown');
    expect(BAR_EDITOR_DIRECTION_KEYS.left).toBe('hudChrome.mobile.radialLeft');
  });

  it('says what the next tap will do, per selection state', () => {
    expect(barEditorCaption(BAR_EDITOR_IDLE, null, deps)).toContain('hudChrome.barEditor.hint');
    expect(barEditorCaption(armBarEditorAbility('fireball'), 'Fireball', deps)).toContain(
      'hudChrome.barEditor.armed',
    );
    expect(barEditorCaption({ kind: 'slot', slot: 3 }, 'Fireball', deps)).toContain(
      'hudChrome.barEditor.picked',
    );
    expect(barEditorCaption(toggleBarEditorClear(BAR_EDITOR_IDLE), null, deps)).toContain(
      'hudChrome.barEditor.clearArmed',
    );
  });
});

// The Clear control: touch's only way to EMPTY a slot, since the desktop clear is
// shift plus right-click. It is an ARMED MODE rather than a per-cell control,
// which is what these cases pin.
describe('bar editor clear mode', () => {
  const armed = toggleBarEditorClear(BAR_EDITOR_IDLE);

  it('arms and disarms from the same control', () => {
    expect(armed).toEqual({ kind: 'clear' });
    expect(barEditorClearArmed(armed)).toBe(true);
    expect(toggleBarEditorClear(armed)).toEqual(BAR_EDITOR_IDLE);
    expect(barEditorClearArmed(BAR_EDITOR_IDLE)).toBe(false);
    // Arming over a pending pick REPLACES it rather than stacking two modes.
    expect(toggleBarEditorClear({ kind: 'slot', slot: 3 })).toEqual({ kind: 'clear' });
  });

  it('empties the bound cell that is tapped and disarms itself', () => {
    const tap = resolveBarEditorTap(armed, cellAt(0, 'up', 1), true);
    expect(tap).toEqual({
      kind: 'clear',
      slot: sourceSlotForMobileButton(0, 1, 'up'),
      selection: BAR_EDITOR_IDLE,
    });
  });

  it('stays armed on an empty cell instead of silently dropping the mode', () => {
    const tap = resolveBarEditorTap(armed, cellAt(0, 'up', 1), false);
    expect(tap.kind).toBe('idle');
    expect(tap.selection).toEqual(armed);
  });

  it('is inert on an out-of-range tail cell, armed or not', () => {
    const tail = { buttonIndex: 3, direction: 'left' as const, slot: 99, inRange: false };
    const tap = resolveBarEditorTap(armed, tail, true);
    expect(tap.kind).toBe('idle');
    expect(tap.selection).toEqual(armed);
  });

  it('never picks a cell up while clear is armed, so a clear cannot become a swap', () => {
    const first = resolveBarEditorTap(armed, cellAt(0, 'center', 0), true);
    expect(first.kind).toBe('clear');
    // And the next tap is an ordinary pick again, because the clear disarmed.
    const second = resolveBarEditorTap(first.selection, cellAt(0, 'center', 1), true);
    expect(second.kind).toBe('pick');
  });
});
