// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { HotbarAction } from '../src/ui/hotbar';
import { SpellbookWindow, type SpellbookWindowDeps } from '../src/ui/spellbook_window';
import type { IWorld } from '../src/world_api';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/ui/icons', () => ({ iconDataUrl: () => 'data:image/png;base64,' }));

function touchEvent(type: string, pointerId: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    pointerId: { value: pointerId },
    clientX: { value: 20 },
    clientY: { value: 20 },
  });
  return event;
}

function tap(el: HTMLElement, pointerId: number): void {
  el.dispatchEvent(touchEvent('pointerdown', pointerId));
  el.dispatchEvent(touchEvent('pointerup', pointerId));
}

function activateControl(el: HTMLElement, pointerId: number): void {
  tap(el, pointerId);
  el.click();
}

function required<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Missing ${label}`);
  return value;
}

function resolvedAbility(id: string): ResolvedAbility {
  return {
    def: ABILITIES[id],
    rank: 1,
    cost: 10,
    castTime: 0,
    cooldown: 0,
    effects: [],
    threatFlat: 0,
    threatMult: 1,
  };
}

describe('SpellbookWindow touch description controls', () => {
  let root: HTMLElement;
  let tooltip: HTMLElement;
  let actions: HotbarAction[];
  let window: SpellbookWindow;
  let abilityTooltip: SpellbookWindowDeps['abilityTooltip'];
  let removeFromBar: SpellbookWindowDeps['removeFromBar'];
  // The right-edge boundary each description show received (undefined = none).
  let shownBoundaries: Array<number | undefined>;

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="spellbook" style="display:block"></div><div id="tooltip" style="display:none"></div>';
    root = required(document.querySelector<HTMLElement>('#spellbook'), 'Spellbook root');
    tooltip = required(document.querySelector<HTMLElement>('#tooltip'), 'tooltip');
    const [firstId, secondId] = CLASSES.warrior.abilities;
    actions = [
      { type: 'ability', id: firstId },
      { type: 'ability', id: secondId },
      ...new Array<HotbarAction>(18).fill(null),
    ];
    const known = [resolvedAbility(firstId), resolvedAbility(secondId)];
    abilityTooltip = vi.fn((ability: ResolvedAbility) => `description:${ability.def.id}`);
    removeFromBar = vi.fn((abilityId: string) => {
      const index = actions.findIndex(
        (action) => action?.type === 'ability' && action.id === abilityId,
      );
      if (index < 0) return false;
      actions[index] = null;
      return true;
    });
    const hideTooltip = () => {
      tooltip.style.display = 'none';
    };
    shownBoundaries = [];
    const deps: SpellbookWindowDeps = {
      root: () => root,
      world: () => ({ cfg: { playerClass: 'warrior' }, known }) as unknown as IWorld,
      closeOthers: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      hideTooltip,
      attachTooltip: (el, html, enabled, directFocusOnly) => {
        const show = (maxRightX?: number) => {
          shownBoundaries.push(maxRightX);
          if (enabled && !enabled()) {
            hideTooltip();
            return;
          }
          tooltip.textContent = html();
          tooltip.style.display = 'block';
        };
        el.addEventListener('focusin', (event) => {
          if (directFocusOnly && event.target !== el) return;
          show();
        });
        return show;
      },
      abilitySummary: () => 'summary',
      abilityTooltip,
      barAbilityIds: () =>
        actions.flatMap((action) => (action?.type === 'ability' ? [action.id] : [])),
      abilityIdByBarSlot: () =>
        actions.map((action) => (action?.type === 'ability' ? action.id : null)),
      hasFreeSlot: () => actions.some((action) => action === null),
      addToBar: vi.fn(() => false),
      removeFromBar,
      hasFormBars: () => false,
      resetFormBar: vi.fn(),
      setDragAction: vi.fn(),
      clearActionDropTargets: vi.fn(),
      isTouch: () => true,
      hotbarActions: () => actions,
      barToken: () => actions.map((action) => action?.id ?? '').join('|'),
    };
    window = new SpellbookWindow(deps);
    window.render();
  });

  it('shows a row description only while the picker is closed', () => {
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    tap(row, 1);
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.textContent).toContain('description:');
    expect(abilityTooltip).toHaveBeenCalledTimes(1);

    const chip = required(
      row.querySelector<HTMLButtonElement>('.spell-assignment-chip'),
      'assignment chip',
    );
    activateControl(chip, 2);
    expect(root.classList.contains('spell-slot-picker-open')).toBe(true);
    expect(tooltip.style.display).toBe('none');

    tap(required(root.querySelector<HTMLElement>('.spell-row'), 'rerendered spell row'), 3);
    expect(tooltip.style.display).toBe('none');
    expect(abilityTooltip).toHaveBeenCalledTimes(1);
  });

  it('hides a stale description and removes the assignment exactly once on X', () => {
    const rows = root.querySelectorAll<HTMLElement>('.spell-row');
    tap(rows[0], 4);
    expect(tooltip.style.display).toBe('block');

    const remove = required(
      rows[1].querySelector<HTMLButtonElement>('.spell-hotbar-remove'),
      'remove button',
    );
    activateControl(remove, 5);

    expect(tooltip.style.display).toBe('none');
    expect(removeFromBar).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.spell-hotbar-remove')).toHaveLength(1);
    expect(root.querySelectorAll('.spell-hotbar-add')).toHaveLength(1);
    expect(abilityTooltip).toHaveBeenCalledTimes(1);

    tooltip.style.display = 'block';
    const add = required(root.querySelector<HTMLButtonElement>('.spell-hotbar-add'), 'add button');
    activateControl(add, 6);
    expect(root.classList.contains('spell-slot-picker-open')).toBe(true);
    expect(tooltip.style.display).toBe('none');
    expect(abilityTooltip).toHaveBeenCalledTimes(1);
  });

  it('shows on direct row focus but not focus on nested touch controls', () => {
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    row.focus();
    expect(tooltip.style.display).toBe('block');

    const chip = required(
      row.querySelector<HTMLButtonElement>('.spell-assignment-chip'),
      'assignment chip',
    );
    tooltip.style.display = 'none';
    chip.focus();
    expect(tooltip.style.display).toBe('none');
    expect(abilityTooltip).toHaveBeenCalledTimes(1);
  });

  it('highlights the active row for a description tap and follows the picker', () => {
    const rows = root.querySelectorAll<HTMLElement>('.spell-row');
    // Tapping a row for its description marks that row selected.
    tap(rows[0], 9);
    expect(rows[0].classList.contains('is-selected')).toBe(true);
    expect(rows[1].classList.contains('is-selected')).toBe(false);

    // Opening the slot picker from the OTHER row moves the highlight there,
    // and it survives the picker re-render.
    const chip = required(
      rows[1].querySelector<HTMLButtonElement>('.spell-assignment-chip'),
      'assignment chip',
    );
    activateControl(chip, 10);
    const rerendered = root.querySelectorAll<HTMLElement>('.spell-row');
    expect(rerendered[1].classList.contains('is-selected')).toBe(true);
    expect(rerendered[0].classList.contains('is-selected')).toBe(false);
  });

  it('never shows a description for a tap on or around the touch controls strip', () => {
    // A fat-finger tap can land INSIDE .spell-touch-controls but beside its
    // buttons. The strip swallows the pointerdown, so the row's touch-tap
    // never records the pointer, but the browser still synthesizes a click
    // that bubbles through the strip into the row, which used to read it as
    // a fresh mouse activation and open the description. The whole strip is
    // a description dead zone: on it, around it, never a description.
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    const controls = required(
      row.querySelector<HTMLElement>('.spell-touch-controls'),
      'touch controls strip',
    );
    activateControl(controls, 7);
    expect(tooltip.style.display).toBe('none');
    expect(abilityTooltip).not.toHaveBeenCalled();

    // The buttons inside the strip keep working: X still unassigns exactly once.
    const remove = required(
      row.querySelector<HTMLButtonElement>('.spell-hotbar-remove'),
      'remove button',
    );
    activateControl(remove, 8);
    expect(removeFromBar).toHaveBeenCalledTimes(1);
    expect(tooltip.style.display).toBe('none');
    expect(abilityTooltip).not.toHaveBeenCalled();
  });

  it('closes an open description when the same row is tapped again', () => {
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    tap(row, 11);
    expect(tooltip.style.display).toBe('block');
    expect(row.classList.contains('is-selected')).toBe(true);

    // Second tap on the SAME row folds the description away and drops the seat.
    tap(row, 12);
    expect(tooltip.style.display).toBe('none');
    expect(row.classList.contains('is-selected')).toBe(false);
    expect(abilityTooltip).toHaveBeenCalledTimes(1);

    // A third tap brings it back: a toggle, not a one-way dismissal.
    tap(row, 13);
    expect(tooltip.style.display).toBe('block');
    expect(row.classList.contains('is-selected')).toBe(true);
  });

  it('shows the description again after the controls strip dismissed it', () => {
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    tap(row, 14);
    expect(tooltip.style.display).toBe('block');

    const controls = required(
      row.querySelector<HTMLElement>('.spell-touch-controls'),
      'touch controls strip',
    );
    activateControl(controls, 15);
    expect(tooltip.style.display).toBe('none');

    // The dead-zone dismissal cleared the open flag, so this tap SHOWS the
    // description again instead of reading as the closing half of a toggle.
    tap(row, 16);
    expect(tooltip.style.display).toBe('block');
  });

  it('keeps the description clear of the +/x column by passing its left boundary', () => {
    const row = required(root.querySelector<HTMLElement>('.spell-row'), 'learned spell row');
    const controls = required(
      row.querySelector<HTMLElement>('.spell-touch-controls'),
      'touch controls strip',
    );
    controls.getBoundingClientRect = () =>
      ({
        left: 321,
        right: 405,
        top: 0,
        bottom: 40,
        width: 84,
        height: 40,
        x: 321,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    tap(row, 17);
    expect(tooltip.style.display).toBe('block');
    expect(shownBoundaries.at(-1)).toBe(321);
  });
});
