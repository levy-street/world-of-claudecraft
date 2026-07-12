// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts.

import { archetypeTitleText } from './char_window';
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

  // Group rows by profession (#1701): a flat list of 13+ recipes is unscannable,
  // so each craft gets its own section, in the order its first recipe appears.
  // recipes.ts is NOT strictly contiguous per craft (COMBO_RECIPES revisit a
  // craft that already appeared earlier in the array, interleaving with other
  // crafts in between), so this groups by professionId rather than by
  // run-length, or a non-contiguous craft would render as two separate
  // sections. Note the section headers render the practitioner title (e.g.
  // "Tinkerer"), not the craft name, so the engineering-only hub-tier
  // TOOL_RECIPES group under "Tinkerer" alongside the rest of that craft.
  // Reuses archetypeTitleText (char_window.ts) for the header text: same
  // id-to-name table the character window's title uses, so the two surfaces
  // never drift.
  const sections = new Map<string, (typeof view.recipes)[number][]>();
  for (const row of view.recipes) {
    const rows = sections.get(row.professionId);
    if (rows) rows.push(row);
    else sections.set(row.professionId, [row]);
  }

  for (const [professionId, rows] of sections) {
    const section = document.createElement('div');
    section.className = 'vendor-section-title';
    section.textContent = archetypeTitleText(professionId);
    el.appendChild(section);

    for (const row of rows) {
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
        row.resultCount > 1
          ? ` x${formatNumber(row.resultCount, { maximumFractionDigits: 0 })}`
          : '';
      // The reagent line is now shown inline (not only on hover/aria, #1701): a
      // player can see at a glance which reagents and counts a recipe needs, and
      // the :disabled opacity (components.css .vendor-item:disabled) makes an
      // unaffordable recipe visually distinct without hovering.
      craftBtn.innerHTML = `${icon}<span class="vi-name">${esc(resultName)}${esc(resultCountSuffix)}<span class="vi-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</span></span><span class="vi-price">${esc(t('hudChrome.crafting.craft'))}</span>`;
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
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
