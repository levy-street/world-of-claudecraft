// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts.

import type { CraftingView } from './crafting_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';

export interface CraftingWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onCraft(recipeId: string): void;
  onClose(): void;
}

/** Paint the crafting panel from a prepared view. */
export function renderCraftingWindow(
  el: HTMLElement,
  view: CraftingView,
  deps: CraftingWindowDeps,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.crafting.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.crafting.close'))}">${svgIcon('close')}</button></div>`;

  if (view.recipes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('hudChrome.crafting.empty');
    el.appendChild(empty);
  }

  for (const row of view.recipes) {
    const item = document.createElement('div');
    item.className = 'vendor-item';
    const resultName = row.result ? itemDisplayName(row.result) : row.resultItemId;
    const reagentLines = row.reagents
      .map((r) =>
        t('hudChrome.crafting.reagentLine', {
          name: r.item ? itemDisplayName(r.item) : r.itemId,
          have: formatNumber(r.have, { maximumFractionDigits: 0 }),
          required: formatNumber(r.required, { maximumFractionDigits: 0 }),
        }),
      )
      .join(', ');

    const icon = row.result ? deps.itemIcon(row.result) : '';
    const craftBtn = document.createElement('button');
    craftBtn.type = 'button';
    craftBtn.className = 'vendor-item';
    craftBtn.disabled = !row.craftable;
    // Folds the reagent requirements into the accessible name (not just the hover
    // tooltip, which keyboard, screen-reader, and mobile no-hover users never reach).
    craftBtn.setAttribute(
      'aria-label',
      `${t('hudChrome.crafting.resultAria', { name: resultName })}. ${t('hudChrome.crafting.reagentsNeeded')} ${reagentLines}`,
    );
    const resultCountSuffix =
      row.resultCount > 1 ? ` x${formatNumber(row.resultCount, { maximumFractionDigits: 0 })}` : '';
    craftBtn.innerHTML = `${icon}<span class="vi-name">${esc(resultName)}${esc(resultCountSuffix)}</span><span class="vi-price">${esc(t('hudChrome.crafting.craft'))}</span>`;
    craftBtn.addEventListener('click', () => {
      if (row.craftable) deps.onCraft(row.recipeId);
    });
    deps.attachTooltip(
      craftBtn,
      () =>
        `${row.result ? deps.itemTooltip(row.result) : ''}<div class="tt-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</div>`,
    );
    item.appendChild(craftBtn);
    el.appendChild(item);
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
