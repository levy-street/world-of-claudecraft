// The character-sheet slot picker's controller (slot_picker_core.ts owns the
// decisions). It reuses the shared #ctx-menu popup family through the same
// CtxMenuSeam the bag item menu drives (placement, keep-on-screen, the
// keyboard-reachable action binding, and the shared reserve maths), so the
// picker is not a new kind of menu: a title naming the slot, then one row per
// bag copy the slot would take.
//
// The candidate list is assembled here from the world and the paperdoll's own
// drop verdict (equip_drop_core.ts paperdollDropAction), so the character
// window only binds the press and supplies the equip. The one layout read is
// the slot row's rect on a KEYBOARD open (there is no pointer to anchor to),
// read once per press, never on a repaint.

import { ITEMS } from '../sim/data';
import type { EquipSlot } from '../sim/types';
import type { IWorld } from '../world_api';
import { CTX_MENU_PICKER_CLASS, type CtxMenuSeam, ctxMenuReserve } from './bag_item_action_menu';
import { paperdollDropAction } from './equip_drop_core';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { knownItemDef } from './known_item';
import type { PainterHostPresentation } from './painter_host';
import { tSim } from './sim_i18n';
import {
  buildSlotPickerCandidates,
  resolveSlotPickerIndex,
  type SlotPickerCandidate,
  slotPickerDeltaTone,
} from './slot_picker_core';
import { wornItemCellParts } from './worn_item_cell_view';

export interface SlotPickerDeps {
  ctxMenu: CtxMenuSeam;
  itemIcon: PainterHostPresentation['itemIcon'];
  slotName(slot: EquipSlot): string;
  isMobileLayout(): boolean;
  world(): IWorld;
  hideTooltip(): void;
  showError(text: string): void;
}

/** Marks the shared popup's title while it shows the slot picker, so the
 *  character window can close the picker with itself (closeSlotPickerIfOpen)
 *  without leaving a marker on the shared element for the next menu. */
const SLOT_PICKER_TITLE_CLASS = 'slot-pick-title';

/** Close the shared popup if (and only if) it is showing the slot picker. */
export function closeSlotPickerIfOpen(deps: Pick<SlotPickerDeps, 'ctxMenu'>): void {
  const el = deps.ctxMenu.element();
  if (el.style.display === 'none' || !el.querySelector(`.${SLOT_PICKER_TITLE_CLASS}`)) return;
  if (deps.ctxMenu.close) deps.ctxMenu.close();
  else el.style.display = 'none';
}

/** The `data-act` a candidate row carries: its position in the candidate list. */
export function slotPickerAct(index: number): string {
  return `pick:${index}`;
}

/** Parse a row's `data-act` back to a candidate position (null for anything else). */
export function slotPickerActIndex(act: string): number | null {
  const m = /^pick:(\d+)$/.exec(act);
  return m ? Number(m[1]) : null;
}

function deltaHtml(delta: number | undefined): string {
  if (delta === undefined) return '';
  const tone = slotPickerDeltaTone(delta);
  const n = formatNumber(Math.abs(delta), { maximumFractionDigits: 0 });
  const text =
    tone === 'same'
      ? t('hudChrome.paperdoll.pickerDeltaSame')
      : tone === 'up'
        ? t('hudChrome.paperdoll.pickerDeltaUp', { n })
        : t('hudChrome.paperdoll.pickerDeltaDown', { n });
  return `<span class="slot-pick-delta slot-pick-delta-${tone}">${esc(text)}</span>`;
}

function rowHtml(deps: SlotPickerDeps, c: SlotPickerCandidate): string {
  // The all-surfaces item-cell rule: the copy's own name, quality and color.
  const parts = wornItemCellParts(c.item, c.slot.instance);
  const level =
    c.itemLevel !== undefined
      ? `<span class="ctx-item-meta">${esc(
          t('hudChrome.paperdoll.pickerItemLevel', {
            n: formatNumber(c.itemLevel, { maximumFractionDigits: 0 }),
          }),
        )}</span>`
      : '';
  return `<span class="slot-pick-icon">${deps.itemIcon(c.item, parts.quality)}</span><span class="slot-pick-name" style="color:${parts.color}">${esc(parts.name)}</span>${level}${deltaHtml(c.delta)}`;
}

/** Every bag copy `slot` would take right now, best first. */
export function slotPickerCandidatesFor(world: IWorld, slot: EquipSlot): SlotPickerCandidate[] {
  const wornId = world.equipment[slot];
  const worn = wornId ? knownItemDef(ITEMS, wornId) : undefined;
  return buildSlotPickerCandidates({
    inventory: world.inventory,
    lookup: (id) => knownItemDef(ITEMS, id),
    canEquip: (item, bagIndex) =>
      paperdollDropAction(
        item,
        slot,
        world.cfg.playerClass,
        world.player.level,
        world.talentSpec,
        world.equipment,
        world.equipmentInstances,
        world.inventory,
        bagIndex,
      ) === 'equip',
    worn: worn ? { item: worn, instance: world.equipmentInstances?.[slot] } : undefined,
  });
}

/**
 * Open the picker for one paperdoll slot: at the pointer for a click, beside the
 * slot row for a keyboard press (which also moves focus into the list). An empty
 * list still opens, with one inert row saying nothing in the bags fits, so the
 * press always answers. A chosen row re-finds its copy (the bags can shift while
 * the picker is open) and hands it to `equip`; a copy that left the bags is
 * refused with the sim's own not-held toast.
 */
export function openSlotPicker(
  deps: SlotPickerDeps,
  slot: EquipSlot,
  anchor: HTMLElement,
  ev: MouseEvent | null,
  equip: (itemId: string, slot: EquipSlot, target: { slotIndex: number }) => void,
): void {
  const candidates = slotPickerCandidatesFor(deps.world(), slot);
  deps.hideTooltip();
  const el = deps.ctxMenu.element();
  // The capped, scrolling picker box (the Apply Enchant precedent), not a new class.
  el.classList.add(CTX_MENU_PICKER_CLASS);
  let html = `<div class="ctx-title ${SLOT_PICKER_TITLE_CLASS}">${esc(
    t('hudChrome.paperdoll.pickerTitle', { slot: deps.slotName(slot) }),
  )}</div>`;
  if (candidates.length === 0) {
    html += `<div class="ctx-item" aria-disabled="true">${esc(t('hudChrome.paperdoll.pickerEmpty'))}</div>`;
  } else {
    candidates.forEach((c, i) => {
      html += `<div class="ctx-item slot-pick-row" data-act="${slotPickerAct(i)}">${rowHtml(deps, c)}</div>`;
    });
  }
  el.innerHTML = html;
  el.style.display = 'block';
  const reserve = ctxMenuReserve(Math.max(1, candidates.length), deps.isMobileLayout(), true);
  let x: number;
  let y: number;
  if (ev) {
    x = ev.clientX;
    y = ev.clientY;
  } else {
    const rect = anchor.getBoundingClientRect();
    x = rect.right;
    y = rect.top;
  }
  deps.ctxMenu.place(el, x, y, reserve.right, reserve.bottom);
  deps.ctxMenu.bind((act) => {
    const index = slotPickerActIndex(act);
    const pick = index === null ? undefined : candidates[index];
    if (!pick) return;
    const bagIndex = resolveSlotPickerIndex(deps.world().inventory, pick);
    if (bagIndex === null) {
      deps.showError(tSim('error.noItem'));
      return;
    }
    equip(pick.item.id, slot, { slotIndex: bagIndex });
  });
  // A keyboard open lands focus on the first row, so Enter / arrow use reaches it.
  if (!ev) el.querySelector<HTMLElement>('.ctx-item')?.focus();
}
