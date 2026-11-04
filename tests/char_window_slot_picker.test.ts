// @vitest-environment happy-dom
// The paperdoll slot picker, driven through the REAL CharWindow and the real
// slot_picker_controller painter: a press on a slot opens the shared #ctx-menu with
// one row per bag copy the slot would take (best first), and choosing a row
// sends the equip command for exactly that copy, re-found if the bags shifted.
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemInstanceLevel } from '../src/sim/item_level';
import type { InvSlot } from '../src/sim/types';
import { CharWindow } from '../src/ui/char_window';
import { paperdollDropAction } from '../src/ui/equip_drop_core';
import { ItemDragState } from '../src/ui/item_drag_state';

function harness(
  inventory: InvSlot[],
  equipment: Record<string, string> = {},
  opts: { mirror?: boolean; peek?: boolean } = {},
) {
  const menu = document.createElement('div');
  document.body.appendChild(menu);
  let activate: ((act: string) => void) | null = null;
  const equipItemToSlot = vi.fn();
  const showError = vi.fn();
  const restoreFocus = vi.fn();
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Aurelia', level: 60, skin: 0 },
    talentSpec: null,
    equipment,
    // The online mirror may carry no worn-payload map at all.
    ...(opts.mirror ? {} : { equipmentInstances: {} }),
    inventory,
    equipItemToSlot,
  };
  const sheet = document.createElement('div');
  const win = new CharWindow({
    root: () => sheet,
    world: () => world as never,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus,
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
        // The HUD's bindContextMenuActions makes every row a keyboard stop.
        for (const row of menu.querySelectorAll<HTMLElement>('.ctx-item')) row.tabIndex = 0;
      },
    },
    isMobileLayout: () => false,
    consumePeek: () => opts.peek ?? false,
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
  return { win, menu, world, equipItemToSlot, showError, restoreFocus, pick };
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

describe('paperdoll slot picker: keyboard, touch and the online mirror', () => {
  const click = { clientX: 10, clientY: 20 } as MouseEvent;

  it('a keyboard open focuses the first row; a keyboard pick hands focus back', () => {
    const { win, menu, restoreFocus, pick } = harness([{ itemId: 'worn_sword', count: 1 }]);
    win.openSlotPicker('mainhand', anchor(), null);
    const first = menu.querySelector<HTMLElement>('.ctx-item');
    expect(document.activeElement).toBe(first);
    pick(first?.dataset.act ?? '');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('a pointer open leaves focus alone, and its pick does not move focus', () => {
    const { win, menu, restoreFocus, pick } = harness([{ itemId: 'worn_sword', count: 1 }]);
    win.openSlotPicker('mainhand', anchor(), click);
    expect(document.activeElement).not.toBe(menu.querySelector('.ctx-item'));
    pick(menu.querySelector<HTMLElement>('.slot-pick-row')?.dataset.act ?? '');
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('the release of a touch long-press peek does not open the picker', () => {
    const { win, menu } = harness([{ itemId: 'worn_sword', count: 1 }], {}, { peek: true });
    const row = document.createElement('div');
    (win as unknown as { bindSlotPicker(r: HTMLElement, s: string): void }).bindSlotPicker(
      row,
      'mainhand',
    );
    row.click();
    expect(menu.style.display).not.toBe('block');
  });

  it('a press on a bound slot opens the picker, and Enter does too', () => {
    const { win, menu } = harness([{ itemId: 'worn_sword', count: 1 }]);
    const row = document.createElement('div');
    document.body.appendChild(row);
    (win as unknown as { bindSlotPicker(r: HTMLElement, s: string): void }).bindSlotPicker(
      row,
      'mainhand',
    );
    expect(row.tabIndex).toBe(0);
    row.click();
    expect(menu.style.display).toBe('block');
    menu.style.display = 'none';
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(menu.style.display).toBe('block');
  });

  it('works against a mirror with no worn-payload map, with a delta vs the worn piece', () => {
    const { win, menu } = harness(
      [{ itemId: 'eastbrook_greatsword', count: 1 }],
      { mainhand: 'worn_sword' },
      { mirror: true },
    );
    win.openSlotPicker('mainhand', anchor(), click);
    const rows = menu.querySelectorAll('.slot-pick-row');
    expect(rows).toHaveLength(1);
    const wornLevel = itemInstanceLevel(ITEMS.worn_sword);
    const bagLevel = itemInstanceLevel(ITEMS.eastbrook_greatsword);
    if (wornLevel !== undefined && bagLevel !== undefined && wornLevel !== bagLevel) {
      expect(rows[0].querySelector('.slot-pick-delta')).not.toBeNull();
    }
  });

  it('the delta badge reads the change against the worn piece, toned up or down', () => {
    // Two one-handers a level-60 warrior can wield whose item levels differ.
    const levelled = Object.values(ITEMS).filter(
      (d) =>
        d.kind === 'weapon' &&
        (d.hand ?? 'onehand') === 'onehand' &&
        itemInstanceLevel(d) !== undefined &&
        paperdollDropAction(d, 'mainhand', 'warrior', 60) === 'equip',
    );
    const worn = levelled[0];
    const bag = levelled.find((d) => itemInstanceLevel(d) !== itemInstanceLevel(worn));
    expect(worn && bag, 'two levelled one-handers').toBeTruthy();
    const { win, menu } = harness([{ itemId: bag!.id, count: 1 }], { mainhand: worn!.id });
    win.openSlotPicker('mainhand', anchor(), click);
    const diff = (itemInstanceLevel(bag!) ?? 0) - (itemInstanceLevel(worn!) ?? 0);
    const delta = menu.querySelector<HTMLElement>('.slot-pick-delta');
    expect(
      delta?.classList.contains(diff > 0 ? 'slot-pick-delta-up' : 'slot-pick-delta-down'),
    ).toBe(true);
    expect(delta?.textContent).toBe(diff > 0 ? `+${diff}` : `-${-diff}`);
  });

  it('closing the sheet closes an open picker, and leaves any other menu alone', () => {
    const { win, menu } = harness([{ itemId: 'worn_sword', count: 1 }]);
    const root = (win as unknown as { deps: { root(): HTMLElement } }).deps.root();
    win.openSlotPicker('mainhand', anchor(), click);
    root.style.display = 'block';
    win.close();
    expect(menu.style.display).toBe('none');
    menu.innerHTML = '<div class="ctx-item">Other menu</div>';
    menu.style.display = 'block';
    root.style.display = 'block';
    win.close();
    expect(menu.style.display).toBe('block');
  });
});
