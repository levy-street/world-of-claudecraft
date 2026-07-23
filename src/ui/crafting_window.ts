// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts. The
// craft tab strip is painted from the pure craftingTabs/resolveSelectedCraft
// helpers (crafting_view.ts); the selected craft lives with the HUD (the
// commission opt-in precedent) so it survives staleness repaints.

import type { StationType } from '../sim/professions/stations';
import { craftNameText } from './char_window';
import {
  type CraftDifficulty,
  type CraftingView,
  type CraftLearnHint,
  craftingTabs,
  resolveSelectedCraft,
} from './crafting_view';
import { itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { professionImageUrl } from './profession_art';
import { renderProfessionIdentityCard } from './profession_identity_card';
import type { ProfessionIdentityModel } from './profession_identity_view';
import { qualityGlowShadow } from './quality_glow';
import { svgIcon } from './ui_icons';

// Skill-gain difficulty labels, the classic four-color recipe intuition
// orange = full gains, yellow = reduced, green = minimal,
// gray = none. The tints live in CSS (`.crafting-difficulty[data-difficulty]`
// over the --color-craft-* tokens in tokens.css), keyed by the data attribute
// painted here. A tint is only ever a HINT: the adjacent difficulty LABEL and
// the aria text carry the same information, and both are identical on every
// graphics preset/tier (docs/design/graphics-settings-fairness.md).
const DIFFICULTY_LABEL_KEY: Record<CraftDifficulty, TranslationKey> = {
  full: 'hudChrome.crafting.difficultyFull',
  reduced: 'hudChrome.crafting.difficultyReduced',
  minimal: 'hudChrome.crafting.difficultyMinimal',
  none: 'hudChrome.crafting.difficultyNone',
} as const;

// Station display names (Professions 2.0): StationType id -> the
// localized station name, same id-to-key table shape as craftNameText
// (char_window.ts) so the deny toast (hud.ts) and the window rows below
// never drift. Full literal keys on purpose (the key scanner reads them).
const STATION_NAME_KEY: Record<StationType, TranslationKey> = {
  forge: 'hudChrome.crafting.stationName.forge',
  kitchens: 'hudChrome.crafting.stationName.kitchens',
  apothecary: 'hudChrome.crafting.stationName.apothecary',
  tannery: 'hudChrome.crafting.stationName.tannery',
  loom: 'hudChrome.crafting.stationName.loom',
  toolworks: 'hudChrome.crafting.stationName.toolworks',
};

/** The localized display name of one station type. */
export function stationNameText(type: StationType): string {
  return t(STATION_NAME_KEY[type]);
}

export interface CraftingWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onCraft(recipeId: string): void;
  onClose(): void;
  /** Commission opt-in state (Professions 2.0), held by the HUD so
   *  it survives the window's staleness repaints: whether `recipeId` is
   *  currently opted in, and the toggle callback the per-row checkbox fires.
   *  The painter renders the control only on commissionEligible rows. */
  commissionChecked(recipeId: string): boolean;
  onToggleCommission(recipeId: string, on: boolean): void;
  /** The craft tab the player last picked (null before any pick), held by the
   *  HUD like the commission set above; the painter resolves it against the
   *  live tab list (resolveSelectedCraft) so a stale pick falls back safely. */
  selectedCraft(): string | null;
  onSelectCraft(professionId: string): void;
}

/** Paint the crafting panel from a prepared view. `learnHints` maps a
 *  craft id to the station + master where the viewer can learn recipes they have
 *  not learned; the selected craft renders its "learnable at a master" hint iff
 *  its craft is present. */
export function renderCraftingWindow(
  el: HTMLElement,
  view: CraftingView,
  deps: CraftingWindowDeps,
  identity?: ProfessionIdentityModel,
  learnHints: ReadonlyMap<string, CraftLearnHint> = new Map(),
): void {
  deps.hideTooltip();
  const scrollTop = el.querySelector('.crafting-body')?.scrollTop ?? 0;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.crafting.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.crafting.close'))}">${svgIcon('close')}</button></div>`;

  if (identity) renderProfessionIdentityCard(el, identity);

  if (view.recipes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('hudChrome.crafting.empty');
    el.appendChild(empty);
  }

  // Group rows by profession (#1701): a flat list of 13+ recipes is unscannable.
  // recipes.ts is NOT strictly contiguous per craft (COMBO_RECIPES revisit a
  // craft that already appeared earlier in the array, interleaving with other
  // crafts in between), so this groups by professionId rather than by
  // run-length. The groups drive the tab strip (craftingTabs preserves the
  // same order-of-first-appearance the old stacked sections used); only the
  // SELECTED craft's rows paint below the strip.
  const sections = new Map<string, (typeof view.recipes)[number][]>();
  for (const row of view.recipes) {
    const rows = sections.get(row.professionId);
    if (rows) rows.push(row);
    else sections.set(row.professionId, [row]);
  }

  const tabs = craftingTabs(view);
  const selected = resolveSelectedCraft(tabs, deps.selectedCraft());
  if (tabs.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'crafting-tabs';
    for (const tab of tabs) {
      const name = craftNameText(tab.professionId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `crafting-tab${tab.professionId === selected ? ' sel' : ''}`;
      btn.setAttribute('aria-pressed', tab.professionId === selected ? 'true' : 'false');
      btn.dataset.craft = tab.professionId;
      const art = professionImageUrl(`prof_${tab.professionId}`);
      btn.innerHTML = `${art ? `<img class="crafting-tab-icon" src="${esc(art)}" alt="" draggable="false">` : ''}<span class="crafting-tab-label">${esc(name)}</span><span class="crafting-tab-count">${formatNumber(tab.recipeCount, { maximumFractionDigits: 0 })}</span>`;
      btn.addEventListener('click', () => {
        if (tab.professionId !== selected) deps.onSelectCraft(tab.professionId);
      });
      strip.appendChild(btn);
    }
    el.appendChild(strip);
  }

  const body = document.createElement('div');
  body.className = 'crafting-body';
  el.appendChild(body);

  const rows = selected !== null ? (sections.get(selected) ?? []) : [];
  if (selected !== null) {
    const sectionName = craftNameText(selected);
    const sectionImageUrl = professionImageUrl(`prof_${selected}`);
    const section = document.createElement('div');
    section.className = 'vendor-section-title crafting-section-title';
    section.setAttribute('role', 'heading');
    section.setAttribute('aria-level', '3');
    if (sectionImageUrl) {
      const icon = document.createElement('img');
      icon.className = 'crafting-section-icon';
      icon.src = sectionImageUrl;
      icon.alt = '';
      icon.draggable = false;
      section.appendChild(icon);
    }
    const sectionLabel = document.createElement('span');
    sectionLabel.textContent = sectionName;
    section.appendChild(sectionLabel);
    body.appendChild(section);

    // The "learnable at a master" hint: shown once under the craft header
    // when the viewer has unlearned trainer recipes for this craft, naming the
    // resident master (entity i18n) and their station. Informational text (no
    // tap target), identical on every graphics preset (never tier-gated).
    const learnHint = learnHints.get(selected);
    if (learnHint) {
      const hint = document.createElement('div');
      hint.className = 'crafting-learn-hint';
      hint.textContent = t('hudChrome.crafting.learnMoreAtStation', {
        master: tEntity({ kind: 'npc', id: learnHint.masterNpcId, field: 'name' }),
        station: stationNameText(learnHint.stationType),
        craft: craftNameText(selected),
      });
      body.appendChild(hint);
    }

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
      // The inline reagent list marks each unsatisfied reagent (a class the
      // CSS tints): redundant with the have/required counts the text already
      // carries, so the color is a hint, never the only signal (fairness).
      const reagentHtml = row.reagents
        .map(
          (r) =>
            `<span class="crafting-reagent${r.satisfied ? '' : ' unsat'}">${esc(
              t('hudChrome.crafting.reagentLine', {
                name: r.item ? itemDisplayName(r.item) : r.itemId,
                have: formatNumber(r.have, { maximumFractionDigits: 0 }),
                required: formatNumber(r.required, { maximumFractionDigits: 0 }),
              }),
            )}</span>`,
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

      // Legibility: the skill-req line, the skill-gain difficulty
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
        row.station && !row.station.inRange
          ? t('hudChrome.crafting.stationOutOfRangeNamed', {
              station: stationNameText(row.station.type),
            })
          : '';
      const stationAccessible = row.station
        ? `. ${stationLabel}${stationOutOfRange ? `. ${stationOutOfRange}` : ''}`
        : '';

      // The result icon sits in a fixed socket whose glow derives from the
      // item's quality color (the showcase paperdoll idiom, quality_glow.ts);
      // the icon img keeps its own .q-* quality border class.
      const icon = row.result ? deps.itemIcon(row.result) : '';
      const glow = row.result?.quality ? qualityGlowShadow(QUALITY_COLOR[row.result.quality]) : '';
      const socket = `<span class="crafting-recipe-socket"${glow ? ` style="box-shadow:${glow}"` : ''}>${icon}</span>`;
      const craftBtn = document.createElement('button');
      craftBtn.type = 'button';
      craftBtn.className = 'vendor-item crafting-recipe-btn';
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
      // The reagent line is shown inline (not only on hover/aria, #1701): a
      // player can see at a glance which reagents and counts a recipe needs, and
      // the :disabled opacity (components.css .vendor-item:disabled) makes an
      // unaffordable recipe visually distinct without hovering.
      const stationBadgeHtml = row.station
        ? `<span class="crafting-station-badge${row.station.inRange ? '' : ' out-of-range'}">${esc(stationLabel)}</span>`
        : '';
      craftBtn.innerHTML = `${socket}<span class="vi-name"><span class="crafting-recipe-name">${esc(resultName)}${esc(resultCountSuffix)}</span><span class="vi-sub crafting-reagent-line">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${reagentHtml}</span><span class="vi-sub crafting-skill-line">${esc(skillLine)} <span class="crafting-difficulty" data-difficulty="${esc(row.difficulty)}">${esc(difficultyLabel)}</span>${stationBadgeHtml}</span></span><span class="vi-price crafting-craft-chip">${esc(t('hudChrome.crafting.craft'))}</span>`;
      craftBtn.addEventListener('click', () => {
        if (row.craftable) deps.onCraft(row.recipeId);
      });
      deps.attachTooltip(
        craftBtn,
        () =>
          `<div class="tt-profession-header">${sectionImageUrl ? `<img src="${esc(sectionImageUrl)}" alt="" draggable="false">` : ''}<span>${esc(sectionName)}</span></div>${row.result ? deps.itemTooltip(row.result) : ''}<div class="tt-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</div><div class="tt-sub">${esc(skillLine)} ${esc(difficultyLabel)}</div>${row.station ? `<div class="tt-sub">${esc(stationLabel)}${stationOutOfRange ? ` ${esc(stationOutOfRange)}` : ''}</div>` : ''}${comboLine ? `<div class="tt-sub">${esc(comboLine)} ${esc(comboStatus)}</div>` : ''}`,
      );
      item.appendChild(craftBtn);
      // Commission opt-in (the Maker's Bond): a per-recipe pill toggle-chip
      // in the card's chip language, right-aligned in the card footer so it
      // stacks under the gold Craft chip as one action column. Rendered ONLY
      // for the ruled-in equipment output kinds (crafting_view.ts
      // commissionEligible, the sim's own predicate). An aria-pressed toggle
      // button: the accessible name stays the commission label and the state
      // rides the toggle semantics. Armed state lives with the HUD
      // (deps.commissionChecked) so a staleness repaint never unticks it;
      // the click handler mirrors the flip locally instead of repainting.
      if (row.commissionEligible) {
        const commissionRow = document.createElement('div');
        commissionRow.className = 'crafting-commission-row';
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'crafting-commission-chip';
        chip.setAttribute('aria-pressed', deps.commissionChecked(row.recipeId) ? 'true' : 'false');
        chip.innerHTML = `<span class="crafting-commission-pip" aria-hidden="true"></span>${esc(t('hudChrome.crafting.commissionToggle'))}`;
        chip.addEventListener('click', () => {
          const next = chip.getAttribute('aria-pressed') !== 'true';
          deps.onToggleCommission(row.recipeId, next);
          chip.setAttribute('aria-pressed', next ? 'true' : 'false');
        });
        deps.attachTooltip(
          chip,
          () => `<div class="tt-sub">${esc(t('hudChrome.crafting.commissionToggleHint'))}</div>`,
        );
        commissionRow.appendChild(chip);
        item.appendChild(commissionRow);
      }
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
      body.appendChild(item);
    }
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'flex';
  body.scrollTop = scrollTop;
}
