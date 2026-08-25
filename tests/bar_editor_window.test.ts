// @vitest-environment jsdom

// The touch bar editor window: the DOM half of the overlay that replaced the
// mobile long-press rearrange. Drives the real window against a fake bar and
// asserts what a player actually gets: 20 cells and the page tabs, a tap that
// places an armed spell, a tap pair that swaps, a second tap on the picked cell
// that cancels, a page switch that keeps a pending pick, and a locked bar that
// is read-only. Plus the cold-window contracts a source scan owns.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveHudElement } from '../src/game/touch_router';
import { ACTION_BAR_ABILITY_SLOTS } from '../src/ui/hud/action_bar/action_bar_layout_core';
import { BarEditorWindow } from '../src/ui/hud/action_bar/bar_editor/bar_editor_window';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import { mobileActionSourceSlotCount } from '../src/ui/hud/action_bar/mobile_action_page_view';
import { t } from '../src/ui/i18n';

/** The span Hud wires the editor with on a character showing only the primary
 *  DESKTOP row: the shipped default, and the configuration the bug was on. */
const DEFAULT_TOUCH_SPAN = mobileActionSourceSlotCount({ secondary: false, third: false });

// jsdom ships no 2D canvas, so the procedural icon compositor cannot run here;
// the window only ever uses the returned string as a CSS background-image.
vi.mock('../src/ui/icons', () => ({ iconDataUrl: () => 'data:,' }));

// A jsdom `import.meta.url` is not a file: URL, so the source scans below read
// through the vitest root instead.
const SOURCE = readFileSync(
  join(process.cwd(), 'src/ui/hud/action_bar/bar_editor/bar_editor_window.ts'),
  'utf8',
);

interface Harness {
  window: BarEditorWindow;
  root: HTMLElement;
  bar: HotbarAction[];
  placed: Array<{ abilityId: string; slot: number }>;
  swapped: Array<{ a: number; b: number }>;
  cleared: number[];
  locked: { value: boolean };
  cells(): HTMLButtonElement[];
  tabs(): HTMLButtonElement[];
  clearBtn(): HTMLButtonElement;
}

function harness(
  options: { hideTooltip?: () => void; sourceSlotCount?: () => number } = {},
): Harness {
  document.body.innerHTML = '<div id="bar-editor" class="window panel"></div>';
  const root = document.getElementById('bar-editor') as HTMLElement;
  const bar: HotbarAction[] = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
  // Two real warrior abilities so name resolution and the icon branch are live.
  bar[0] = { type: 'ability', id: 'heroic_strike' };
  bar[1] = { type: 'ability', id: 'battle_shout' };
  const placed: Array<{ abilityId: string; slot: number }> = [];
  const swapped: Array<{ a: number; b: number }> = [];
  const cleared: number[] = [];
  const locked = { value: false };
  const window = new BarEditorWindow({
    root: () => root,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    onVisibilityChange: () => {},
    hideTooltip: options.hideTooltip ?? (() => {}),
    barActions: () => bar,
    sourceSlotCount: options.sourceSlotCount ?? (() => ACTION_BAR_ABILITY_SLOTS),
    editAllowed: () => !locked.value,
    placeAbility: (abilityId, slot) => {
      placed.push({ abilityId, slot });
      bar[slot - 1] = { type: 'ability', id: abilityId };
    },
    swapSlots: (a, b) => {
      swapped.push({ a, b });
      [bar[a - 1], bar[b - 1]] = [bar[b - 1], bar[a - 1]];
    },
    clearSlot: (slot) => {
      cleared.push(slot);
      bar[slot - 1] = null;
    },
  });
  return {
    window,
    root,
    bar,
    placed,
    swapped,
    cleared,
    locked,
    cells: () => [...root.querySelectorAll<HTMLButtonElement>('.bar-editor-cell')],
    tabs: () => [...root.querySelectorAll<HTMLButtonElement>('.bar-editor-tab')],
    clearBtn: () => root.querySelector<HTMLButtonElement>('.bar-editor-clear') as HTMLButtonElement,
  };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe('bar editor window: what a player sees', () => {
  it('opens with 20 cells and one tab per ring page', () => {
    h.window.open();
    expect(h.window.isOpen).toBe(true);
    expect(h.cells()).toHaveLength(20);
    expect(h.tabs()).toHaveLength(2);
    expect(h.tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(h.tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('marks the window as a dialog root with exactly one accessible name', () => {
    h.window.open();
    expect(h.root.getAttribute('role')).toBe('dialog');
    // aria-modal false, matching every sibling window: these roots trap focus but
    // do not inert the page (see markDialogRoot).
    expect(h.root.getAttribute('aria-modal')).toBe('false');
    expect(h.root.getAttribute('aria-label')).toBeTruthy();
    // aria-labelledby SHADOWS aria-label, so exactly one may be present.
    expect(h.root.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('renders every cell as a real focusable button, never a div', () => {
    h.window.open();
    for (const cell of h.cells()) {
      expect(cell.tagName).toBe('BUTTON');
      expect(cell.type).toBe('button');
    }
  });

  it('names each cell by its button and direction, and shows what it holds', () => {
    h.window.open();
    const first = h.cells()[0];
    expect(first.getAttribute('aria-label')).toContain('Button');
    expect(first.getAttribute('aria-label')).toContain('Centre');
    expect(first.querySelector('.bar-editor-cell-name')?.textContent).toBeTruthy();
    // Row 2 is the 'Up' direction (direction-major), so its aria says so.
    expect(h.cells()[4].getAttribute('aria-label')).toContain('Up');
  });

  it('disables the last page tail rather than dropping the grid geometry', () => {
    h.window.open();
    h.tabs()[1].click();
    const cells = h.cells();
    expect(cells).toHaveLength(20);
    const dead = cells.filter((c) => c.classList.contains('out-of-range'));
    expect(dead.length).toBeGreaterThan(0);
    for (const cell of dead) expect(cell.disabled).toBe(true);
  });

  it('is covered by the touch router, so a tap never leaks to a camera drag', () => {
    h.window.open();
    // The overlay is `.window panel`, which INTERACTIVE_HUD_SELECTORS already
    // names; assert through the real router rather than trusting the class list.
    expect(
      isInteractiveHudElement(
        h.cells()[0] as unknown as Parameters<typeof isInteractiveHudElement>[0],
      ),
    ).toBe(true);
    expect(
      isInteractiveHudElement(h.root as unknown as Parameters<typeof isInteractiveHudElement>[0]),
    ).toBe(true);
  });
});

describe('bar editor window: the DEFAULT desktop row visibility binds everything', () => {
  // Wired exactly as Hud wires it for a character with the optional desktop rows
  // hidden. That trimmed span used to strand the down row, the left row and all
  // of page 2: the cells rendered but refused every placement.
  let d: Harness;
  beforeEach(() => {
    d = harness({ sourceSlotCount: () => DEFAULT_TOUCH_SPAN });
    d.window.open('heroic_strike');
  });

  it('leaves every page-1 cell enabled, including the down and left rows', () => {
    expect(d.cells()).toHaveLength(20);
    expect(d.tabs()).toHaveLength(2);
    for (const cell of d.cells()) {
      expect(cell.disabled, `slot ${cell.dataset.barSlot}`).toBe(false);
    }
  });

  it('places an armed spell into a DOWN cell (slot 13 to 16)', () => {
    const down = d.cells().find((cell) => cell.dataset.barSlot === '13') as HTMLButtonElement;
    down.click();
    expect(d.placed).toEqual([{ abilityId: 'heroic_strike', slot: 13 }]);
    expect(d.bar[12]).toEqual({ type: 'ability', id: 'heroic_strike' });
  });

  it('places an armed spell into a LEFT cell (slot 17 to 20)', () => {
    const left = d.cells().find((cell) => cell.dataset.barSlot === '20') as HTMLButtonElement;
    left.click();
    expect(d.placed).toEqual([{ abilityId: 'heroic_strike', slot: 20 }]);
    expect(d.bar[19]).toEqual({ type: 'ability', id: 'heroic_strike' });
  });

  it('places an armed spell into a page-2 cell, and disables only the tail past 33', () => {
    // The armed spell survives the page switch, which is the move the retired
    // drag could never make.
    d.tabs()[1].click();
    const target = d.cells().find((cell) => cell.dataset.barSlot === '25') as HTMLButtonElement;
    target.click();
    expect(d.placed).toEqual([{ abilityId: 'heroic_strike', slot: 25 }]);
    for (const cell of d.cells()) {
      const slot = Number(cell.dataset.barSlot);
      expect(cell.disabled, `slot ${slot}`).toBe(slot > ACTION_BAR_ABILITY_SLOTS);
    }
  });
});

describe('bar editor window: tap to place', () => {
  it('places an armed spell in the tapped cell and disarms', () => {
    h.window.open('charge');
    // Cell index 6 is the second row ('Up'), third button: page 0, up, button 2,
    // which is bar slot 7 under the direction-major mapping.
    h.cells()[6].click();
    expect(h.placed).toEqual([{ abilityId: 'charge', slot: 7 }]);
    // Disarmed: the next tap picks up rather than placing again.
    h.cells()[0].click();
    expect(h.placed).toHaveLength(1);
    expect(h.cells()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('repaints the tapped cell from the mutated bar without reopening', () => {
    h.window.open('charge');
    const target = h.cells()[6];
    expect(target.classList.contains('empty')).toBe(true);
    target.click();
    expect(target.classList.contains('empty')).toBe(false);
    expect(target.querySelector('.bar-editor-cell-name')?.textContent).toBeTruthy();
  });

  it('ignores a tap on an out-of-range cell and KEEPS the spell armed', () => {
    h.window.open('charge');
    h.tabs()[1].click();
    const dead = h.cells().find((c) => c.classList.contains('out-of-range')) as HTMLButtonElement;
    dead.disabled = false; // defeat the DOM guard so the handler itself is tested
    dead.click();
    expect(h.placed).toEqual([]);
    // Still armed: a live cell on the same page still takes it.
    h.cells()[0].click();
    expect(h.placed).toHaveLength(1);
  });
});

describe('bar editor window: tap to swap', () => {
  it('swaps two cells with two taps', () => {
    h.window.open();
    h.cells()[0].click();
    expect(h.cells()[0].getAttribute('aria-pressed')).toBe('true');
    h.cells()[3].click();
    expect(h.swapped).toEqual([{ a: 1, b: 4 }]);
    expect(h.bar[3]).toEqual({ type: 'ability', id: 'heroic_strike' });
    expect(h.cells()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('cancels the pick when the same cell is tapped again', () => {
    h.window.open();
    h.cells()[0].click();
    h.cells()[0].click();
    expect(h.swapped).toEqual([]);
    expect(h.cells()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('does nothing when an empty cell is tapped with nothing armed', () => {
    h.window.open();
    h.cells()[5].click();
    expect(h.swapped).toEqual([]);
    for (const cell of h.cells()) expect(cell.getAttribute('aria-pressed')).toBe('false');
  });

  it('carries a pending pick ACROSS a page switch and swaps between pages', () => {
    h.window.open();
    h.cells()[0].click();
    h.tabs()[1].click();
    expect(h.tabs()[1].getAttribute('aria-selected')).toBe('true');
    h.cells()[0].click();
    expect(h.swapped).toEqual([{ a: 1, b: 21 }]);
  });
});

describe('bar editor window: the action-bar lock', () => {
  it('renders the grid read-only while the bars are locked', () => {
    h.locked.value = true;
    h.window.open();
    for (const cell of h.cells()) expect(cell.disabled).toBe(true);
    h.cells()[0].click();
    expect(h.swapped).toEqual([]);
    expect(h.placed).toEqual([]);
  });
});

describe('bar editor window: the Clear control', () => {
  it('empties the next tapped slot through the shared clear path, then disarms', () => {
    h.window.open();
    expect(h.clearBtn().getAttribute('aria-pressed')).toBe('false');

    h.clearBtn().click();
    expect(h.clearBtn().getAttribute('aria-pressed')).toBe('true');
    // Slot 1 (button 0, centre) holds heroic_strike in the harness bar.
    h.cells()[0].click();
    expect(h.cleared).toEqual([1]);
    expect(h.bar[0]).toBeNull();
    expect(h.swapped).toEqual([]);
    // One tap, one clear: the mode disarms so the next tap is an ordinary pick.
    expect(h.clearBtn().getAttribute('aria-pressed')).toBe('false');
    h.cells()[1].click();
    expect(h.cleared).toEqual([1]);
  });

  it('toggles back off without touching the bar', () => {
    h.window.open();
    h.clearBtn().click();
    h.clearBtn().click();
    expect(h.clearBtn().getAttribute('aria-pressed')).toBe('false');
    h.cells()[0].click();
    expect(h.cleared).toEqual([]);
  });

  it('is disabled while the action bars are locked', () => {
    h.locked.value = true;
    h.window.open();
    expect(h.clearBtn().disabled).toBe(true);
    h.clearBtn().click();
    h.cells()[0].click();
    expect(h.cleared).toEqual([]);
  });

  it('carries an accessible name of its own', () => {
    h.window.open();
    expect(h.clearBtn().getAttribute('aria-label')).toBeTruthy();
  });
});

// #1485: a drop that lands with the cursor already inside the target slot
// fires no mouseenter, so the tooltip kept its pre-drop text. Every mutation
// this window makes shares ONE deps.hideTooltip() call after the dispatch
// (bar_editor_window.ts's tapCell); tests/hotbar_drop_tooltip.test.ts pins the
// source-text shape of that guard (ordering plus the literal condition), and
// this is the behavioral half: drive the real window and count the actual
// calls, so a narrowed guard (dropping the clear arm, say) fails here even
// though no string moved position.
describe('bar editor window: hideTooltip fires on every mutation, never on an idle tap (#1485)', () => {
  function withHideTooltipSpy() {
    let calls = 0;
    const h2 = harness({
      hideTooltip: () => {
        calls++;
      },
    });
    return { ...h2, hideTooltipCalls: () => calls };
  }

  it('fires exactly once after a place', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open('charge');
    h2.cells()[5].click();
    expect(h2.placed).toHaveLength(1);
    expect(h2.hideTooltipCalls()).toBe(1);
  });

  it('fires exactly once after a swap', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open();
    h2.cells()[0].click();
    h2.cells()[3].click();
    expect(h2.swapped).toHaveLength(1);
    expect(h2.hideTooltipCalls()).toBe(1);
  });

  it('fires exactly once after a clear', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open();
    h2.clearBtn().click();
    h2.cells()[0].click();
    expect(h2.cleared).toHaveLength(1);
    expect(h2.hideTooltipCalls()).toBe(1);
  });

  it('does not fire when a tap only arms a pending pick (no mutation yet)', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open();
    h2.cells()[0].click();
    expect(h2.swapped).toEqual([]);
    expect(h2.hideTooltipCalls()).toBe(0);
  });

  it('does not fire on an idle tap: an empty cell with nothing armed', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open();
    h2.cells()[5].click();
    expect(h2.placed).toEqual([]);
    expect(h2.swapped).toEqual([]);
    expect(h2.hideTooltipCalls()).toBe(0);
  });

  it('does not fire when a pending pick cancels on the same cell', () => {
    const h2 = withHideTooltipSpy();
    h2.window.open();
    h2.cells()[0].click();
    h2.cells()[0].click();
    expect(h2.swapped).toEqual([]);
    expect(h2.hideTooltipCalls()).toBe(0);
  });
});

describe('bar editor window: the eligibility gate refuses an ineligible place (#hud.ts:5321)', () => {
  it('an ineligible ability never reaches the bar, and the caption drops the armed name', () => {
    // Mirrors the real gate at src/ui/hud.ts:5321
    // (actionBarController.isAssignableAction): the deps-level placeAbility is
    // the one place that can refuse, so a rejected ability must never reach
    // placeAbilityOnSlot at all.
    let eligible = false;
    const bar: HotbarAction[] = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
    const placed: Array<{ abilityId: string; slot: number }> = [];
    const w = new BarEditorWindow({
      root: () => h.root,
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      onVisibilityChange: () => {},
      hideTooltip: () => {},
      barActions: () => bar,
      sourceSlotCount: () => ACTION_BAR_ABILITY_SLOTS,
      editAllowed: () => true,
      placeAbility: (abilityId, slot) => {
        if (!eligible) return;
        placed.push({ abilityId, slot });
        bar[slot - 1] = { type: 'ability', id: abilityId };
      },
      swapSlots: () => {},
      clearSlot: () => {},
    });

    w.open('charge');
    const caption = h.root.querySelector('.bar-editor-caption') as HTMLElement;
    const armedCaption = caption.textContent;
    // Armed names the spell (hudChrome.barEditor.armed), which is never the
    // same text as the idle hint.
    expect(armedCaption).not.toBe(t('hudChrome.barEditor.hint'));

    const target = h.cells()[5];
    target.click();

    expect(placed).toEqual([]);
    expect(bar[5]).toBeNull();
    expect(target.classList.contains('empty')).toBe(true);
    // The caption drops the armed name: the tap still disarms (there is
    // nothing left to place), so it falls back to the idle hint rather than
    // confirming a placement that never happened.
    expect(caption.textContent).not.toBe(armedCaption);
    expect(caption.textContent).toBe(t('hudChrome.barEditor.hint'));

    // The gate genuinely gates: flip it and the SAME tap sequence places.
    eligible = true;
    w.open('charge');
    h.cells()[5].click();
    expect(placed).toEqual([{ abilityId: 'charge', slot: 6 }]);
  });
});

describe('bar editor window: open / close lifecycle', () => {
  it('returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    let restored: HTMLElement | null = null;
    const w = new BarEditorWindow({
      root: () => h.root,
      closeOthers: () => {},
      captureFocus: () => opener,
      restoreFocus: (target) => {
        restored = target;
      },
      onVisibilityChange: () => {},
      hideTooltip: () => {},
      barActions: () => h.bar,
      sourceSlotCount: () => ACTION_BAR_ABILITY_SLOTS,
      editAllowed: () => true,
      placeAbility: () => {},
      swapSlots: () => {},
      clearSlot: () => {},
    });
    w.open();
    w.close();
    expect(restored).toBe(opener);
    expect(w.isOpen).toBe(false);
  });

  it('drops any armed spell on close, so a later open starts idle', () => {
    h.window.open('charge');
    h.window.close();
    h.window.open();
    h.cells()[5].click();
    expect(h.placed).toEqual([]);
  });

  it('toggles closed when already open', () => {
    h.window.open();
    h.window.toggle();
    expect(h.window.isOpen).toBe(false);
  });

  it('relocalize is a no-op while closed, and rebuilds while open', () => {
    h.window.relocalize();
    expect(h.cells()).toHaveLength(0);
    h.window.open();
    h.window.relocalize();
    expect(h.cells()).toHaveLength(20);
  });
});

describe('bar editor window: the cold-window contracts', () => {
  it('takes no forced-reflow layout read', () => {
    for (const token of [
      'offsetWidth',
      'offsetHeight',
      'getBoundingClientRect',
      'getComputedStyle',
      'clientWidth',
      'clientHeight',
    ]) {
      expect(SOURCE, `${token} forces a reflow`).not.toContain(token);
    }
  });

  it('arms no repeating driver of its own', () => {
    for (const token of ['requestAnimationFrame', 'requestIdleCallback', 'setInterval']) {
      expect(SOURCE, `${token} would put a cold window on a cadence`).not.toContain(token);
    }
  });

  it('holds no literal color or px value (those belong in the stylesheet)', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b\d+px\b/);
    expect(code).not.toMatch(/\brgba?\(/);
  });

  it('binds by click only: no gesture survives in the touch binding path', () => {
    for (const token of ['pointerdown', 'pointermove', 'pointerup', 'setPointerCapture']) {
      expect(SOURCE, `${token} would reintroduce a gesture`).not.toContain(token);
    }
    expect(SOURCE).toContain("addEventListener('click'");
  });
});

// The editor re-mints its whole subtree on a page switch and on an in-game
// language switch, so the control the player just activated is destroyed under
// them. Without the shared focus_restore seam focus fell to <body> both times,
// which strands a keyboard or Switch Control user mid-edit.
describe('bar editor: focus survives the rebuild, and the caption is announced', () => {
  it('keeps focus on the tab that was activated across the page switch', () => {
    h.window.open();
    const tabs = h.tabs();
    expect(tabs.length).toBeGreaterThan(1);
    tabs[1].focus();
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].click();
    // A FRESH node with the same identity, never the destroyed one.
    const rebuilt = h.tabs()[1];
    expect(rebuilt).not.toBe(tabs[1]);
    expect(document.activeElement).toBe(rebuilt);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps focus on the cell that was activated across a language switch', () => {
    h.window.open();
    const cell = h.cells()[3];
    cell.focus();
    const slot = cell.dataset.barSlot;
    h.window.relocalize();
    const rebuilt = h.cells()[3];
    expect(rebuilt).not.toBe(cell);
    expect(rebuilt.dataset.barSlot).toBe(slot);
    expect(document.activeElement).toBe(rebuilt);
  });

  it('degrades to the active tab when the focused control did not come back', () => {
    h.window.open();
    const clear = h.clearBtn();
    clear.focus();
    // The lock disables the Clear toggle, so the rebuilt equivalent cannot take
    // focus and the ladder has to step past it rather than drop to <body>.
    h.locked.value = true;
    h.window.relocalize();
    expect(h.clearBtn().disabled).toBe(true);
    expect(document.activeElement).toBe(h.tabs()[0]);
  });

  it('announces the arm / place / refuse caption as a live status', () => {
    h.window.open();
    const caption = h.root.querySelector('.bar-editor-caption') as HTMLElement;
    // The editor is the ONLY binding path on touch, so its confirmation cannot
    // be drawn-only: without a live region an AT user gets no answer at all.
    expect(caption.getAttribute('role')).toBe('status');
    const before = caption.textContent;
    h.cells()[0].click();
    expect(caption.textContent).not.toBe(before);
  });
});
