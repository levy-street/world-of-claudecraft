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
    const deps: SpellbookWindowDeps = {
      root: () => root,
      world: () => ({ cfg: { playerClass: 'warrior' }, known }) as unknown as IWorld,
      closeOthers: vi.fn(),
      captureFocus: () => null,
      restoreFocus: vi.fn(),
      hideTooltip,
      attachTooltip: (el, html, enabled, directFocusOnly) => {
        const show = () => {
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
});
