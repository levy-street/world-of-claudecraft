// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts.

import { craftNameText } from './char_window';
import type { CraftDifficulty, CraftingView } from './crafting_view';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { renderProfessionIdentityCard } from './profession_identity_card';
import type { ProfessionIdentityModel } from './profession_identity_view';
import { svgIcon } from './ui_icons';

// Skill-gain difficulty tint, reusing the static quality palette the HUD's
// item surfaces already share (icons.ts): the classic recipe-color intuition
// (orange = full gains, green = some, gray = none). A tint is only ever a
// HINT here: the adjacent difficulty LABEL and the aria text carry the same
// information, and both are identical on every graphics preset/tier
// (docs/design/graphics-settings-fairness.md).
const DIFFICULTY_TINT: Record<CraftDifficulty, string> = {
  full: QUALITY_COLOR.legendary,
  reduced: QUALITY_COLOR.uncommon,
  none: QUALITY_COLOR.poor,
};

const DIFFICULTY_LABEL_KEY = {
  full: 'hudChrome.crafting.difficultyFull',
  reduced: 'hudChrome.crafting.difficultyReduced',
  none: 'hudChrome.crafting.difficultyNone',
} as const;

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
  identity?: ProfessionIdentityModel,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.crafting.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.crafting.close'))}">${svgIcon('close')}</button></div>`;

  if (identity) renderProfessionIdentityCard(el, identity);

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
  // sections. The section headers render the craft display name (e.g.
  // "Engineering"), so the engineering-only hub-tier TOOL_RECIPES group under
  // "Engineering" alongside the rest of that craft. Reuses craftNameText
  // (char_window.ts) for the header text: same id-to-name table the character
  // window's hobby line uses, so the two surfaces never drift.
  const sections = new Map<string, (typeof view.recipes)[number][]>();
  for (const row of view.recipes) {
    const rows = sections.get(row.professionId);
    if (rows) rows.push(row);
    else sections.set(row.professionId, [row]);
  }

  for (const [professionId, rows] of sections) {
    const section = document.createElement('div');
    section.className = 'vendor-section-title';
    section.textContent = craftNameText(professionId);
    el.appendChild(section);

    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'vendor-item crafting-recipe-item';
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
      const comboLine = row.comboRequirement
        ? t('hudChrome.crafting.comboRequires', {
            craftA: craftNameText(row.comboRequirement.craftA),
            craftB: craftNameText(row.comboRequirement.craftB),
            tier: formatNumber(row.comboRequirement.minTier, { maximumFractionDigits: 0 }),
          })
        : '';
      // tier_unmet names ONLY the under-tier craft(s) (the acceptance
      // criterion: the player can tell WHICH craft to raise from the row
      // alone); the localized names join like the reagent list above. The
      // param-less comboTierUnmet stays the defensive fallback for an
      // eligibility result that names no craft.
      const comboStatus = row.comboRequirement
        ? row.comboRequirement.reason === 'tier_unmet' &&
          row.comboRequirement.unmetCrafts.length > 0
          ? t('hudChrome.crafting.comboTierUnmetNamed', {
              crafts: row.comboRequirement.unmetCrafts.map((c) => craftNameText(c)).join(', '),
              tier: formatNumber(row.comboRequirement.minTier, { maximumFractionDigits: 0 }),
            })
          : t(
              row.comboRequirement.reason === null
                ? 'hudChrome.crafting.comboMet'
                : row.comboRequirement.reason === 'syncing'
                  ? 'hudChrome.crafting.comboSyncing'
                  : row.comboRequirement.reason === 'not_attuned'
                    ? 'hudChrome.crafting.comboNotAttuned'
                    : row.comboRequirement.reason === 'wrong_pair'
                      ? 'hudChrome.crafting.comboWrongPair'
                      : 'hudChrome.crafting.comboTierUnmet',
            )
        : '';
      const comboAccessible = comboLine ? `. ${comboLine} ${comboStatus}` : '';

      // Phase 6 legibility: the skill-req line, the skill-gain difficulty
      // label, and the hub-station badge. All three are actionable info, so
      // each is TEXT (tint is a redundant hint), folded into the aria name,
      // and identical on every graphics preset/tier.
      const skillLine = t('hudChrome.crafting.skillReqLine', {
        craft: craftNameText(row.professionId),
        skill: formatNumber(row.skillReq, { maximumFractionDigits: 0 }),
      });
      const difficultyLabel = t(DIFFICULTY_LABEL_KEY[row.difficulty]);
      const stationLabel = row.station ? t('hudChrome.crafting.stationBadge') : '';
      const stationOutOfRange =
        row.station && !row.station.inRange ? t('hudChrome.crafting.stationOutOfRange') : '';
      const stationAccessible = row.station
        ? `. ${stationLabel}${stationOutOfRange ? `. ${stationOutOfRange}` : ''}`
        : '';

      const icon = row.result ? deps.itemIcon(row.result) : '';
      const craftBtn = document.createElement('button');
      craftBtn.type = 'button';
      craftBtn.className = 'vendor-item';
      craftBtn.disabled = !row.craftable;
      // Folds the reagent requirements into the accessible name (not just the hover
      // tooltip, which keyboard, screen-reader, and mobile no-hover users never reach).
      craftBtn.setAttribute(
        'aria-label',
        `${t('hudChrome.crafting.resultAria', { name: resultName })}. ${t('hudChrome.crafting.reagentsNeeded')} ${reagentLines}. ${skillLine}. ${difficultyLabel}${stationAccessible}${comboAccessible}`,
      );
      const resultCountSuffix =
        row.resultCount > 1
          ? ` x${formatNumber(row.resultCount, { maximumFractionDigits: 0 })}`
          : '';
      // The reagent line is now shown inline (not only on hover/aria, #1701): a
      // player can see at a glance which reagents and counts a recipe needs, and
      // the :disabled opacity (components.css .vendor-item:disabled) makes an
      // unaffordable recipe visually distinct without hovering.
      const stationBadgeHtml = row.station
        ? `<span class="crafting-station-badge${row.station.inRange ? '' : ' out-of-range'}">${esc(stationLabel)}</span>`
        : '';
      craftBtn.innerHTML = `${icon}<span class="vi-name">${esc(resultName)}${esc(resultCountSuffix)}<span class="vi-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</span><span class="vi-sub crafting-skill-line">${esc(skillLine)} <span class="crafting-difficulty" data-difficulty="${esc(row.difficulty)}" style="color:${DIFFICULTY_TINT[row.difficulty]}">${esc(difficultyLabel)}</span>${stationBadgeHtml}</span></span><span class="vi-price">${esc(t('hudChrome.crafting.craft'))}</span>`;
      craftBtn.addEventListener('click', () => {
        if (row.craftable) deps.onCraft(row.recipeId);
      });
      deps.attachTooltip(
        craftBtn,
        () =>
          `${row.result ? deps.itemTooltip(row.result) : ''}<div class="tt-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</div><div class="tt-sub">${esc(skillLine)} ${esc(difficultyLabel)}</div>${row.station ? `<div class="tt-sub">${esc(stationLabel)}${stationOutOfRange ? ` ${esc(stationOutOfRange)}` : ''}</div>` : ''}${comboLine ? `<div class="tt-sub">${esc(comboLine)} ${esc(comboStatus)}</div>` : ''}`,
      );
      item.appendChild(craftBtn);
      if (comboLine) {
        // Keep the reason outside the disabled button's whole-element opacity so
        // unattuned/wrong-pair/tier guidance retains readable contrast.
        const comboNote = document.createElement('div');
        comboNote.className = 'crafting-combo-requirement';
        comboNote.setAttribute('aria-hidden', 'true');
        comboNote.textContent = `${comboLine} ${comboStatus}`;
        item.appendChild(comboNote);
      }
      if (stationOutOfRange) {
        // Same pattern as the combo note above: a station-disabled Craft button
        // must never read as a bare disabled button, so the reason sits
        // adjacent, outside the button's :disabled opacity. aria-hidden because
        // the button's aria-label already carries the same sentence.
        const stationNote = document.createElement('div');
        stationNote.className = 'crafting-combo-requirement crafting-station-requirement';
        stationNote.setAttribute('aria-hidden', 'true');
        stationNote.textContent = stationOutOfRange;
        item.appendChild(stationNote);
      }
      el.appendChild(item);
    }
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
