// One personal-bank item cell and its adjacent source action. Extracted from
// BankWindow so the large coordinator keeps only grid orchestration.

import { ITEMS } from '../sim/data';
import { isItemLocked } from '../sim/item_lock';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import type { IWorld } from '../world_api';
import { bagCornerMark, bagRimClasses } from './bag_corner_mark_view';
import { bagFineMark } from './bag_fine_mark_view';
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import type { BankSlotModel } from './bank_view';
import { esc } from './esc';
import { t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  cornerMarkHtml,
  INSTANCE_GLYPH_ARIA_KEYS,
  lockMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import { bankMaterialWithdrawSelection } from './material_source_storage_actions';
import {
  appendMaterialSourcesActionAfter,
  attachMaterialSourcesContextMenu,
  type MaterialSourcesDialogOpener,
} from './material_sources_dialog';
import { materialSourcesForDisplay } from './material_sources_view';
import { unknownItemIconHtml } from './unknown_item_icon';
import { wornItemCellParts } from './worn_item_cell_view';

const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

export interface PersonalBankItemCellDeps {
  world(): IWorld;
  itemIcon(item: ItemDef, quality?: ItemDef['quality']): string;
  itemTooltip(
    item: ItemDef,
    instance?: ItemInstancePayload,
    materialSources?: import('../sim/material_sources').MaterialComposition,
  ): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  openMaterialSources?: MaterialSourcesDialogOpener;
  consumePeek(): boolean;
  hideTooltip(): void;
  onInventoryChanged(): void;
}

export function buildPersonalBankItemCell(
  deps: PersonalBankItemCellDeps,
  slot: BankSlotModel,
  countLabel: string,
  onWithdraw: (slotIndex: number, partial: boolean) => void,
  render: () => void,
): HTMLElement {
  const item = knownItemDef(ITEMS, slot.itemId);
  const cell = document.createElement('button');
  cell.type = 'button';
  const fineMark = bagFineMark(slot.itemId);
  cell.className = `bank-item q-${slot.qualityKey}${bagRimClasses(null, fineMark)}`;
  cell.style.setProperty(
    '--bank-slot-quality',
    QUALITY_COLOR[slot.qualityKey] ?? QUALITY_DEFAULT_COLOR,
  );
  const glyphKind = bagInstanceGlyphKind(slot.instance);
  const cornerMark = bagCornerMark(glyphKind, null, fineMark);
  const locked = isItemLocked(slot.instance);
  const parts = item ? wornItemCellParts(item, slot.instance) : null;
  const displayedSources = materialSourcesForDisplay(slot);
  cell.setAttribute(
    'aria-label',
    parts
      ? t(
          locked
            ? 'hudChrome.bags.itemAriaLocked'
            : glyphKind
              ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
              : 'itemUi.bags.itemAria',
          { item: parts.name, count: countLabel },
        )
      : t(glyphKind ? UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind] : 'itemUi.bags.unknownItemAria', {
          id: slot.itemId,
          count: countLabel,
        }),
  );
  cell.innerHTML =
    `${item && parts ? deps.itemIcon(item, parts.quality) : unknownItemIconHtml(slot.itemId)}` +
    `${cornerMarkHtml(cornerMark)}${lockMarkHtml(locked)}` +
    `<span class="bank-count">${slot.showCount ? esc(t('itemUi.bags.stackCount', { count: countLabel })) : ''}</span>`;
  cell.addEventListener('click', (event) => {
    if (deps.consumePeek()) {
      deps.hideTooltip();
      return;
    }
    onWithdraw(slot.slotIndex, event.shiftKey);
  });
  deps.attachTooltip(cell, () => {
    const partial = slot.showCount
      ? `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawPartialHint'))}</div>`
      : '';
    const body = item
      ? deps.itemTooltip(item, slot.instance, displayedSources)
      : `<div class="tt-title">${esc(slot.itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`;
    return `${body}<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${partial}`;
  });
  const itemName = parts?.name ?? slot.itemId;
  attachMaterialSourcesContextMenu(cell, itemName, displayedSources, deps.openMaterialSources);
  if (!displayedSources || !deps.openMaterialSources) return cell;
  const wrapper = document.createElement('div');
  wrapper.className = 'material-source-item material-source-item-cell';
  wrapper.appendChild(cell);
  appendMaterialSourcesActionAfter(
    cell,
    itemName,
    displayedSources,
    deps.openMaterialSources,
    bankMaterialWithdrawSelection(deps.world(), slot.itemId, slot.slotIndex, () => {
      deps.hideTooltip();
      deps.onInventoryChanged();
      render();
    }),
  );
  return wrapper;
}
