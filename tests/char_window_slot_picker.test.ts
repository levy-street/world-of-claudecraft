// @vitest-environment happy-dom
// The paperdoll slot picker, driven through the REAL CharWindow and the real
// slot_picker_menu painter: a press on a slot opens the shared #ctx-menu with
// one row per bag copy the slot would take (best first), and choosing a row
// sends the equip command for exactly that copy, re-found if the bags shifted.
import { describe, expect, it, vi } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { CharWindow } from '../src/ui/char_window';
import { ItemDragState } from '../src/ui/item_drag_state';

function harness(inventory: InvSlot[], equipment: Record<string, string> = {}) {
  const menu = document.createElement('div');
  document.body.appendChild(menu);
  let activate: ((act: string) => void) | null = null;
  const equipItemToSlot = vi.fn();
  const showError = vi.fn();
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Aurelia', level: 60, skin: 0 },
    talentSpec: null,
    equipment,
    equipmentInstances: {},
    inventory,
    equipItemToSlot,
  };
  const win = new CharWindow({
    root: () => document.createElement('div'),
    world: () => world as never,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
    slotName: (slot) => (slot === 'mainhand' ? 'Main Hand' : slot),
    statCellHtml: () => '',
    statTooltipHtml: () => '',
    progressionHtml: () => '',
    unequip: vi.fn(),
    beginUnequipDrag: vi.fn(),
    endUnequipDrag: vi.fn(),
    renderPreview: vi.fn(),
    renderSkinPicker: vi.fn(),
    openPlayerCard: vi.fn(),
    openPrestige: vi.fn(),
    openDeeds: vi.fn(),
    openCosmetics: vi.fn(),
    openReliquary: vi.fn(),
    dragState: new ItemDragState(),
    renderBags: vi.fn(),
    showError,
    ctxMenu: {
      element: () => menu,
      place: vi.fn(),
      bind: (onActivate) => {
        activate = onActivate;
      },
    },
    isMobileLayout: () => false,
    helmSlotAvailable: () => false,
    helmHidden: () => false,
    toggleHelm: vi.fn(),
    playtimeVisible: () => true,
    togglePlaytimeVisible: vi.fn(),
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    wornItemTooltip: () => '',
    attachTooltip: vi.fn(),
  });
  const pick = (act: string) => activate?.(act);
  return { win, menu, world, equipItemToSlot, showError, pick };
}

const anchor = () => document.createElement('div');

describe('paperdoll slot picker', () => {
  it('lists exactly the bag copies the slot would take, titled by the slot', () => {
    const { win, menu } = harness([
      { itemId: 'baked_bread', count: 3 },
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'recruit_tunic', count: 1 },
      { itemId: 'eastbrook_greatsword', count: 1 },
    ]);
    win.openSlotPicker('mainhand', anchor(), null);
    expect(menu.style.display).toBe('block');
    expect(menu.querySelector('.ctx-title')?.textContent).toBe('Equip: Main Hand');
    const names = [...menu.querySelectorAll('.slot-pick-row .slot-pick-name')].map(
      (el) => el.textContent,
    );
    // Both weapons, never the bread or the chest piece.
    expect(names).toHaveLength(2);
    expect(names).toContain('Pitted Shortsword');
    expect(menu.textContent).not.toContain('Recruit');
  });

  it('says so when nothing fits, with an inert row', () => {
    const { win, menu } = harness([{ itemId: 'baked_bread', count: 3 }]);
    win.openSlotPicker('helmet', anchor(), null);
    const rows = menu.querySelectorAll('.ctx-item');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('aria-disabled')).toBe('true');
    expect(rows[0].textContent).toBe('Nothing in your bags fits this slot');
  });

  it('choosing a row equips that copy by its bag index, re-found after a shift', () => {
    const sword: InvSlot = { itemId: 'worn_sword', count: 1 };
    const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 3 }, sword];
    const { win, menu, equipItemToSlot, pick } = harness(inventory);
    win.openSlotPicker('mainhand', anchor(), null);
    const act = menu.querySelector<HTMLElement>('.slot-pick-row')?.dataset.act ?? '';
    // The bread is used up before the row is chosen: the sword moved to index 0.
    inventory.shift();
    pick(act);
    expect(equipItemToSlot).toHaveBeenCalledWith('worn_sword', 'mainhand', { slotIndex: 0 });
  });

  it('refuses with the not-held toast when the copy left the bags', () => {
    const inventory: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    const { win, menu, equipItemToSlot, showError, pick } = harness(inventory);
    win.openSlotPicker('mainhand', anchor(), null);
    const act = menu.querySelector<HTMLElement>('.slot-pick-row')?.dataset.act ?? '';
    inventory.length = 0;
    pick(act);
    expect(equipItemToSlot).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
  });
});
