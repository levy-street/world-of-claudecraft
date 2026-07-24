// Thin DOM consumer for the Maker's Bond unbind window (Professions 2.0).
//
// The consumer half of the pure-core + thin-consumer split (reference
// train_window.ts): paints the station master's unbind service from the
// structured UnbindView and reports unbind/close clicks back through the
// injected callbacks. Keeps the vendor family's row classes (.vendor-item,
// .vi-name, .vi-price, .vi-sub) for anatomy while the rows ride the same
// showcase inset-card treatment as the train ladder (card fill and
// hairline, quality-glow socket, gold-gradient fee chip when affordable).
// It owns no state; the fee-confirm dialog is the HUD's ONE confirmDialog
// family (the destruction-confirm precedent), opened by the onUnbind
// callback, never a bespoke prompt here.

import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatMoney, formatNumber, t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import type { PainterHostPresentation } from '../../painter_host';
import { qualityGlowShadow } from '../../quality_glow';
import { svgIcon } from '../../ui_icons';
import type { UnbindRow, UnbindView } from './unbind_view';

export interface UnbindWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onUnbind(itemId: string, feeCopper: number): void;
  onClose(): void;
}

function rowName(row: UnbindRow): string {
  return row.item ? itemDisplayName(row.item) : row.itemId;
}

/** Paint the unbind panel from a prepared view. */
export function renderUnbindWindow(
  el: HTMLElement,
  masterName: string,
  view: UnbindView,
  deps: UnbindWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires); drop
  // the tooltip and restore the scroll, the train_window idiom.
  deps.hideTooltip();
  // A standalone trapping window (the train/mailbox shape): announce it as a
  // labeled dialog for the focus contract.
  markDialogRoot(el, { label: t('hudChrome.unbind.title', { name: masterName }) });
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.unbind.title', { name: masterName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.unbind.close'))}">${svgIcon('close')}</button></div>`;

  const intro = document.createElement('div');
  intro.className = 'vi-sub unbind-intro';
  intro.textContent = t('hudChrome.unbind.intro');
  el.appendChild(intro);

  if (view.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('hudChrome.unbind.empty');
    el.appendChild(empty);
  }

  for (const row of view.rows) {
    const name = rowName(row);
    const fee = formatMoney(row.feeCopper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vendor-item unbind-row';
    button.disabled = !row.affordable;
    button.setAttribute('aria-label', t('hudChrome.unbind.unbindAria', { name, fee }));
    const countSuffix =
      row.boundCount > 1 ? ` x${formatNumber(row.boundCount, { maximumFractionDigits: 0 })}` : '';
    // Quality-glow socket and fee treatment: the train_window idiom (gold
    // action chip when affordable, plain error-tint price when not).
    const glow = row.item?.quality ? qualityGlowShadow(QUALITY_COLOR[row.item.quality]) : '';
    const iconHtml = `<span class="crafting-recipe-socket"${glow ? ` style="box-shadow:${glow}"` : ''}>${row.item ? deps.itemIcon(row.item) : ''}</span>`;
    const feeHtml = row.affordable
      ? `<span class="vi-price-chip">${esc(fee)}</span>`
      : `<span class="vi-price unaffordable">${esc(fee)}</span>`;
    button.innerHTML = `${iconHtml}<span class="vi-name">${esc(name)}${esc(countSuffix)}<span class="vi-sub">${esc(t('hudChrome.unbind.rowSub'))}</span></span>${feeHtml}`;
    button.addEventListener('click', () => deps.onUnbind(row.itemId, row.feeCopper));
    if (row.item) {
      const item = row.item;
      deps.attachTooltip(button, () => deps.itemTooltip(item, row.instance));
    }
    el.appendChild(button);
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
