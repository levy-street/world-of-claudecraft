// Thin DOM consumer for the recipe-training window (Professions 2.0 Phase 9).
//
// The consumer half of the pure-core + thin-consumer split (reference
// vendor_window.ts): paints the station master's teaching ladder from the
// structured TrainView and reports train/close clicks back through the
// injected callbacks. Reuses the vendor window's CSS classes (.vendor-item,
// .vi-name, .vi-price, .vi-sub, .vendor-section-title) so the trainer reads
// as the same window family. It owns no state. Locked rows always render
// (grayed, with their named requirement): the visible ladder is a deliberate
// decision, never hidden.

import { craftNameText } from '../../char_window';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatMoney, formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { TrainRow, TrainView } from './train_view';

export interface TrainWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onTrain(recipeId: string): void;
  onClose(): void;
}

function rowName(row: TrainRow): string {
  return row.item ? itemDisplayName(row.item) : row.resultItemId;
}

function feeLabel(row: TrainRow): string {
  return row.feeCopper === 0 ? t('hudChrome.training.free') : formatMoney(row.feeCopper);
}

const STATE_LABEL_KEY = {
  known: 'hudChrome.training.stateKnown',
  teachable: 'hudChrome.training.stateTeachable',
  locked: 'hudChrome.training.stateLocked',
} as const;

/** Paint the training panel from a prepared view. */
export function renderTrainWindow(
  el: HTMLElement,
  masterName: string,
  view: TrainView,
  deps: TrainWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  // A standalone trapping window (the mailbox shape), not the vendor's docked
  // bags pairing: announce it as a labeled dialog for the focus contract.
  markDialogRoot(el, { label: t('hudChrome.training.title', { name: masterName }) });
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.training.title', { name: masterName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.training.close'))}">${svgIcon('close')}</button></div>`;

  if (view.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('hudChrome.training.empty');
    el.appendChild(empty);
  }

  // Rows arrive sorted by craft, then skillReq, then id (train_view.ts), so
  // each craft renders as one contiguous section, the crafting-window idiom.
  let sectionCraft: string | null = null;
  for (const row of view.rows) {
    if (row.professionId !== sectionCraft) {
      sectionCraft = row.professionId;
      const section = document.createElement('div');
      section.className = 'vendor-section-title';
      section.textContent = craftNameText(row.professionId);
      el.appendChild(section);
    }

    const name = rowName(row);
    const stateLabel = t(STATE_LABEL_KEY[row.state]);
    const stateHtml = `<span class="train-state">${esc(stateLabel)}</span>`;
    const iconHtml = row.item ? deps.itemIcon(row.item) : '';

    let node: HTMLElement;
    if (row.state === 'teachable') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vendor-item train-row train-teachable';
      button.disabled = !row.affordable;
      const fee = feeLabel(row);
      button.setAttribute('aria-label', t('hudChrome.training.trainAria', { name, fee }));
      button.innerHTML = `${iconHtml}<span class="vi-name">${esc(name)}</span>${stateHtml}<span class="vi-price${row.affordable ? '' : ' unaffordable'}">${esc(fee)}</span>`;
      button.addEventListener('click', () => deps.onTrain(row.recipeId));
      node = button;
    } else if (row.state === 'locked') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vendor-item train-row train-locked';
      button.disabled = true;
      const requirementText = row.requirement
        ? t('hudChrome.training.requirement', {
            craft: craftNameText(row.requirement.craft),
            skill: formatNumber(row.requirement.skill, { maximumFractionDigits: 0 }),
          })
        : '';
      button.innerHTML = `${iconHtml}<span class="vi-name">${esc(name)}${requirementText ? `<span class="vi-sub">${esc(requirementText)}</span>` : ''}</span>${stateHtml}<span class="vi-price">${esc(feeLabel(row))}</span>`;
      node = button;
    } else {
      const div = document.createElement('div');
      div.className = 'vendor-item train-row train-known';
      div.innerHTML = `${iconHtml}<span class="vi-name">${esc(name)}</span>${stateHtml}`;
      node = div;
    }
    if (row.item) {
      const item = row.item;
      deps.attachTooltip(node, () => deps.itemTooltip(item));
    }
    el.appendChild(node);
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
