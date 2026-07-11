// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts.
//
// The chrome comes from the shared window-frame builder (window_frame.ts): a
// titlebar with a close control and a scrollable body (no footer: the craft
// action is per-row). The frame is stamped cold at first open and reused on later
// repaints; only the recipe sections repaint per render. The body uses the AAA
// .list-rows / .vendor-row / .item-cell grammar (the same grammar the redesigned
// vendor uses), so the crafting rows no longer consume the legacy .vendor-item /
// .vi-name / .vi-sub / .vi-price / .vendor-section-title / .vendor-empty CSS.

import type { ItemDef } from '../sim/types';
import { archetypeTitleText } from './char_window';
import type { CraftingView } from './crafting_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

// A closable, footer-less frame with no tab rail: every recipe section renders in
// one scrollable body (behavior-preserving). Title + close reuse the existing
// hudChrome.crafting.* keys (no new i18n).
const CRAFTING_FRAME: WindowFrameDescriptor = {
  id: 'crafting-window',
  titleKey: 'hudChrome.crafting.title',
  closeLabelKey: 'hudChrome.crafting.close',
};

export interface CraftingWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onCraft(recipeId: string): void;
  onClose(): void;
}

/** Stamp the shared window frame cold at first open, then reuse it. */
function ensureFrame(el: HTMLElement, deps: CraftingWindowDeps): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) return { root: mounted, body, footer: null, tabButtons: [] };
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, CRAFTING_FRAME, { onClose: () => deps.onClose() });
  el.replaceChildren(mount);
  return parts;
}

/** The rarity-bordered result icon cell (shared vendor/bags grammar). */
function iconCellHtml(item: ItemDef, deps: CraftingWindowDeps): string {
  const quality = item.quality ?? 'common';
  return `<span class="item-cell" data-quality="${esc(quality)}">${deps.itemIcon(item)}</span>`;
}

/** Paint the crafting panel from a prepared view. */
export function renderCraftingWindow(
  el: HTMLElement,
  view: CraftingView,
  deps: CraftingWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and can
  // collapse the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;

  const { body } = ensureFrame(el, deps);
  body.innerHTML = '';

  if (view.recipes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = t('hudChrome.crafting.empty');
    body.appendChild(empty);
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
    section.className = 'vendor-section';
    section.textContent = archetypeTitleText(professionId);
    body.appendChild(section);

    const list = document.createElement('div');
    list.className = 'list-rows';
    for (const row of rows) {
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

      const craftBtn = document.createElement('button');
      craftBtn.type = 'button';
      craftBtn.className = 'vendor-row';
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
      // The reagent line is shown inline (not only on hover/aria, #1701): a player
      // can see at a glance which reagents and counts a recipe needs, and the
      // :disabled opacity (components.css .window-frame .vendor-row:disabled) makes
      // an unaffordable recipe visually distinct without hovering.
      const iconCell = row.result ? iconCellHtml(row.result, deps) : '';
      craftBtn.innerHTML =
        `${iconCell}` +
        `<span class="vendor-row-name">${esc(resultName)}${esc(resultCountSuffix)}<span class="craft-reagents">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</span></span>` +
        `<span class="vendor-row-price">${esc(t('hudChrome.crafting.craft'))}</span>`;
      craftBtn.addEventListener('click', () => {
        if (row.craftable) deps.onCraft(row.recipeId);
      });
      deps.attachTooltip(
        craftBtn,
        () =>
          `${row.result ? deps.itemTooltip(row.result) : ''}<div class="tt-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</div>`,
      );
      list.appendChild(craftBtn);
    }
    body.appendChild(list);
  }

  // Keep display:block: hud.ts reads $('#crafting-window').style.display === 'block'
  // to detect the open state (renderCrafting on craft, the skill-up re-render).
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
