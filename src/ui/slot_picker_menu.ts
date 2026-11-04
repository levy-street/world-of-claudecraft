// Thin painter for the character-sheet slot picker (slot_picker_core.ts owns the
// decisions). It reuses the shared #ctx-menu popup family through the same
// CtxMenuSeam the bag item menu drives (placement, keep-on-screen, the
// keyboard-reachable action binding), so the picker is not a new kind of menu:
// a title naming the slot, then one row per copy the slot would take.

import type { EquipSlot } from '../sim/types';
import { CTX_MENU_PICKER_CLASS, type CtxMenuSeam } from './bag_item_action_menu';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { type SlotPickerCandidate, slotPickerDeltaTone } from './slot_picker_core';
import { wornItemCellParts } from './worn_item_cell_view';

export interface SlotPickerMenuDeps {
  ctxMenu: CtxMenuSeam;
  itemIcon: PainterHostPresentation['itemIcon'];
  slotName(slot: EquipSlot): string;
  isMobileLayout(): boolean;
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
  const text =
    tone === 'same'
      ? t('hudChrome.paperdoll.pickerDeltaSame')
      : t(
          tone === 'up'
            ? 'hudChrome.paperdoll.pickerDeltaUp'
            : 'hudChrome.paperdoll.pickerDeltaDown',
          {
            n: formatNumber(Math.abs(delta), { maximumFractionDigits: 0 }),
          },
        );
  return `<span class="slot-pick-delta slot-pick-delta-${tone}">${esc(text)}</span>`;
}

function rowHtml(deps: SlotPickerMenuDeps, c: SlotPickerCandidate): string {
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

/** Open the picker at (x, y). An empty list still opens, with one inert row
 *  saying nothing in the bags fits, so the click always answers. */
export function openSlotPickerMenu(
  deps: SlotPickerMenuDeps,
  slot: EquipSlot,
  candidates: readonly SlotPickerCandidate[],
  x: number,
  y: number,
  onPick: (candidate: SlotPickerCandidate) => void,
): void {
  const el = deps.ctxMenu.element();
  // The capped, scrolling picker box (the Apply Enchant precedent), not a new class.
  el.classList.add(CTX_MENU_PICKER_CLASS);
  let html = `<div class="ctx-title">${esc(
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
  const rowHeight = deps.isMobileLayout() ? 48 : 36;
  const reserveBottom = Math.min(
    80 + Math.max(1, candidates.length) * rowHeight,
    Math.round(window.innerHeight * 0.6) + 24,
  );
  deps.ctxMenu.place(el, x, y, 280, reserveBottom);
  deps.ctxMenu.bind((act) => {
    const index = slotPickerActIndex(act);
    const pick = index === null ? undefined : candidates[index];
    if (pick) onPick(pick);
  });
}
