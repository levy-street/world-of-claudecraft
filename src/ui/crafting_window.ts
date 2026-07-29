// Thin DOM consumer for the crafting window (issue #1127).
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #crafting-window from the structured CraftingView (crafting_view.ts) and
// wires the craft/close actions. It owns no state; cross-window orchestration
// stays in Hud (open<Window>/close<Window>), same as vendor_window.ts. The
// craft tab strip is painted from the pure craftingTabs/resolveSelectedCraft
// helpers (crafting_view.ts); the selected craft lives with the HUD (the
// commission opt-in precedent) so it survives staleness repaints.
//
// Craft Cast System Phase 2: duration chip, craft-button state machine, and
// the in-window cast strip. While the crafting window is open the strip is
// the SINGLE progress surface for a craft cast (the HUD suppresses the
// overlay #castbar for CRAFT_CAST_ID only; closing the window hands the cast
// back to the overlay bar, so a cast is never invisible). The strip's
// per-frame fill/label/timer/aria writes ride a CastBarPainter instance the
// HUD rebuilds after each full paint (PainterHost elided writers, the
// family reuse rule); this painter only builds the strip DOM and paints the
// cold batch label on the full-paint path. Progress always tracks real
// entity cast fields (never a client-side outcome timer).
// Phase 3: qty stepper, Create / Create All, batch remaining on the strip.
// Announcements ride the static #crafting-live region via deps.announce (a
// region inside the rebuilt subtree is wiped by the same task that writes
// it, so assistive tech never sees the text).

import type { StationType } from '../sim/professions/stations';
import { craftNameText } from './char_window';
import {
  type CraftButtonState,
  type CraftCastSessionView,
  clampCraftQty,
  craftBatchIndicatorVisible,
  craftButtonBusy,
  craftButtonEnabled,
  craftButtonState,
  IDLE_CRAFT_CAST_SESSION,
  maxCraftsFromReagents,
} from './craft_cast_view';
import {
  type CraftDifficulty,
  type CraftingView,
  type CraftLearnHint,
  craftingTabs,
  resolveSelectedCraft,
} from './crafting_view';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { professionImageUrl } from './profession_art';
import { renderProfessionIdentityCard } from './profession_identity_card';
import type { ProfessionIdentityModel } from './profession_identity_view';
import { qualityGlowShadow } from './quality_glow';
import { svgIcon } from './ui_icons';

// Duration chip and aria: up to two decimals when non-integer (1.75s),
// whole seconds otherwise.
const DURATION_FRACTION_DIGITS = 2;

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
  /** Start a craft (or batch) for `recipeId` with the given count (clamped in sim). */
  onCraft(recipeId: string, count: number): void;
  onClose(): void;
  /** Opens the commission order board (issue #1298), the crafting window's
   *  one entry point to it: a header button beside the close button. */
  onOpenOrders(): void;
  /** Commission opt-in state (Professions 2.0), held by the HUD so
   *  it survives the window's staleness repaints: whether `recipeId` is
   *  currently opted in, and the toggle callback the per-row checkbox fires.
   *  The painter renders the control only on commissionEligible rows. */
  commissionChecked(recipeId: string): boolean;
  onToggleCommission(recipeId: string, on: boolean): void;
  /** Per-recipe qty stepper value (HUD-held so repaints keep the pick). */
  craftQty(recipeId: string): number;
  onCraftQty(recipeId: string, qty: number): void;
  /** Write one polite line into the static #crafting-live region (HUD-owned;
   *  a live region inside this rebuilt subtree would be wiped by the same
   *  task that writes it, so assistive tech never announces it). */
  announce(text: string): void;
  /** The craft tab the player last picked (null before any pick), held by the
   *  HUD like the commission set above; the painter resolves it against the
   *  live tab list (resolveSelectedCraft) so a stale pick falls back safely. */
  selectedCraft(): string | null;
  onSelectCraft(professionId: string): void;
}

/** Format a cast duration for the row chip (localized number + s unit key). */
function durationChipText(durationSec: number): string {
  const whole = Number.isInteger(durationSec);
  return t('hudChrome.crafting.durationChip', {
    seconds: formatNumber(durationSec, {
      maximumFractionDigits: whole ? 0 : DURATION_FRACTION_DIGITS,
    }),
  });
}

/** Paint the crafting panel from a prepared view. `learnHints` maps a
 *  craft id to the station + master where the viewer can learn recipes they have
 *  not learned; the selected craft renders its "learnable at a master" hint iff
 *  its craft is present. `session` is the live craft-cast state (idle when
 *  no craft cast is running). */
export function renderCraftingWindow(
  el: HTMLElement,
  view: CraftingView,
  deps: CraftingWindowDeps,
  identity?: ProfessionIdentityModel,
  learnHints: ReadonlyMap<string, CraftLearnHint> = new Map(),
  session: CraftCastSessionView = IDLE_CRAFT_CAST_SESSION,
  // The recipe whose cast JUST ended, for the focus degrade ladder: a repaint
  // on the cast-end edge hides the strip the player may be standing on, and
  // this names the row button focus should land back on.
  focusReturnRecipeId = '',
): void {
  deps.hideTooltip();
  // A standalone trapping window (the train/professions shape), not the
  // vendor's docked bags pairing: announce it as a labeled dialog for the
  // focus contract (src/ui/CLAUDE.md).
  markDialogRoot(el, { label: t('hudChrome.crafting.title') });
  const focusKey = captureFocusKey(el);
  const scrollTop = el.querySelector('.crafting-body')?.scrollTop ?? 0;
  // The tab strip is its own horizontal scroller on mobile (hud.mobile.css
  // `.crafting-tabs { overflow-x: auto }`) and is rebuilt with everything
  // else, so carry its offset across too: a repaint the player did not ask
  // for must not scroll the craft they are reading off the screen.
  const tabScrollLeft = el.querySelector('.crafting-tabs')?.scrollLeft ?? 0;
  // The identity card's capped skill list (264px, components.css) is the
  // window's third scroll region and rebuilds with the rest, so carry its
  // offset AND its focus across: a single craft repaints this window three
  // times (optimistic, craftResult, the slow-band skill signature), and
  // without the carry each one yanks a scrolled reader back to row one and
  // drops keyboard focus to body. On mobile the CARD is the one scroller
  // (hud.mobile.css lifts the list cap), so its offset carries too.
  const oldSkillList = el.querySelector('.profession-skill-list');
  const skillListScrollTop = oldSkillList?.scrollTop ?? 0;
  const skillListHadFocus = oldSkillList !== null && document.activeElement === oldSkillList;
  const cardScrollTop = el.querySelector('.profession-identity-card')?.scrollTop ?? 0;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.crafting.title'))}</span><button type="button" class="crafting-orders-btn" data-open-orders data-skip-open-focus data-focus-key="orders" aria-label="${esc(t('hudChrome.commissionBoard.openButtonAria'))}">${esc(t('hudChrome.commissionBoard.openButton'))}</button><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('hudChrome.crafting.close'))}">${svgIcon('close')}</button></div>`;
  el.querySelector('[data-open-orders]')?.addEventListener('click', () => deps.onOpenOrders());

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
    strip.scrollLeft = tabScrollLeft;
  }

  // In-window cast strip: a header band ABOVE the scrollable body (a strip
  // inside the scroller could scroll the live cast out of view), the SINGLE
  // craft-cast progress surface while this window is open. Structure follows
  // the DESIGN.md 10.5 progress-bar grammar: dark inset track, gold hardcast
  // fill, parchment label centered in the bar, tabular timer right, batch
  // chip beside the track. display:none at rest; the HUD's CastBarPainter
  // instance owns show/hide + fill/label/timer/aria-valuenow per frame, and
  // this full paint owns only the COLD batch label. tabindex -1 so the focus
  // ladder can park keyboard focus here while every row control is disabled
  // mid-cast (programmatic focus only, never in the Tab cycle).
  const progress = document.createElement('div');
  progress.className = 'crafting-cast-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', t('hudChrome.crafting.progressAria'));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.tabIndex = -1;
  progress.dataset.focusKey = 'cast-strip';
  progress.innerHTML =
    `<div class="crafting-cast-progress-track"><div class="crafting-cast-progress-fill"></div><span class="crafting-cast-progress-label"></span><span class="crafting-cast-progress-timer"></span></div>` +
    `<span class="crafting-cast-progress-batch"></span>`;
  // Rendered SYNCHRONOUSLY when a cast is live: the focus ladder below may
  // pick the strip, and focus() on a display:none element is a no-op in a
  // real browser (focus would fall to body and the Tab trap would let go).
  // The HUD's CastBarPainter writes the same 'flex' a moment later through
  // the elided writers; this inline write is the build-time precondition.
  if (session.active) progress.style.display = 'flex';
  el.appendChild(progress);
  const batchEl = progress.querySelector<HTMLElement>('.crafting-cast-progress-batch');
  if (batchEl) {
    if (craftBatchIndicatorVisible(session)) {
      batchEl.hidden = false;
      batchEl.textContent = t('hudChrome.crafting.batchRemaining', {
        remaining: formatNumber(session.batchRemaining, { maximumFractionDigits: 0 }),
        total: formatNumber(session.batchTotal, { maximumFractionDigits: 0 }),
      });
      batchEl.setAttribute(
        'aria-label',
        t('hudChrome.crafting.batchRemainingAria', {
          remaining: formatNumber(session.batchRemaining, { maximumFractionDigits: 0 }),
          total: formatNumber(session.batchTotal, { maximumFractionDigits: 0 }),
        }),
      );
    } else {
      batchEl.hidden = true;
    }
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
      // The fine-substitution suffix (the UX pass): stated in words on both
      // the visible line and the aria fold, never color alone.
      const fineSubText = (count: number): string =>
        count > 0
          ? ` ${t('hudChrome.crafting.reagentFineSub', {
              count: formatNumber(count, { maximumFractionDigits: 0 }),
            })}`
          : '';
      const reagentLines = row.reagents
        .map(
          (r) =>
            t('hudChrome.crafting.reagentLine', {
              name: r.item ? itemDisplayName(r.item) : r.itemId,
              have: formatNumber(r.have, { maximumFractionDigits: 0 }),
              required: formatNumber(r.required, { maximumFractionDigits: 0 }),
            }) + fineSubText(r.fineSubstituted),
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
            )}${
              r.fineSubstituted > 0
                ? `<span class="crafting-fine-sub">${esc(fineSubText(r.fineSubstituted))}</span>`
                : ''
            }</span>`,
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
      const btnState: CraftButtonState = craftButtonState(row, session);
      const canCraft = craftButtonEnabled(btnState);
      const castingActive = session.active;
      const matsFit = maxCraftsFromReagents(row.reagents);
      const qty = clampCraftQty(deps.craftQty(row.recipeId), matsFit);
      const durationText = durationChipText(row.durationSec);
      const craftBtn = document.createElement('button');
      craftBtn.type = 'button';
      craftBtn.className = `vendor-item crafting-recipe-btn${btnState === 'casting' ? ' casting' : ''}`;
      craftBtn.disabled = !canCraft;
      craftBtn.dataset.focusKey = `craft:${row.recipeId}`;
      if (craftButtonBusy(btnState)) craftBtn.setAttribute('aria-busy', 'true');
      else craftBtn.removeAttribute('aria-busy');
      // Folds the reagent requirements into the accessible name (not just the hover
      // tooltip, which keyboard, screen-reader, and mobile no-hover users never reach).
      // Duration is actionable pace info (fairness): always in the name, never color-only.
      craftBtn.setAttribute(
        'aria-label',
        `${t('hudChrome.crafting.resultAria', { name: resultName })}. ${t('hudChrome.crafting.durationAria', { seconds: formatNumber(row.durationSec, { maximumFractionDigits: DURATION_FRACTION_DIGITS }) })}. ${t('hudChrome.crafting.reagentsNeeded')} ${reagentLines}. ${skillLine}. ${difficultyLabel}${stationAccessible}${comboAccessible}`,
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
      const chipLabel =
        btnState === 'casting' ? t('hudChrome.crafting.crafting') : t('hudChrome.crafting.create');
      craftBtn.innerHTML = `${socket}<span class="vi-name"><span class="crafting-recipe-name">${esc(resultName)}${esc(resultCountSuffix)}</span><span class="vi-sub crafting-reagent-line">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${reagentHtml}</span><span class="vi-sub crafting-skill-line">${esc(skillLine)} <span class="crafting-difficulty" data-difficulty="${esc(row.difficulty)}">${esc(difficultyLabel)}</span>${stationBadgeHtml} <span class="crafting-duration-chip">${esc(durationText)}</span></span></span><span class="vi-price crafting-craft-chip">${esc(chipLabel)}</span>`;
      craftBtn.addEventListener('click', () => {
        if (canCraft) deps.onCraft(row.recipeId, qty);
      });
      deps.attachTooltip(
        craftBtn,
        () =>
          `<div class="tt-profession-header">${sectionImageUrl ? `<img src="${esc(sectionImageUrl)}" alt="" draggable="false">` : ''}<span>${esc(sectionName)}</span></div>${row.result ? deps.itemTooltip(row.result) : ''}<div class="tt-sub">${esc(t('hudChrome.crafting.reagentsNeeded'))} ${esc(reagentLines)}</div><div class="tt-sub">${esc(skillLine)} ${esc(difficultyLabel)}</div><div class="tt-sub">${esc(t('hudChrome.crafting.durationAria', { seconds: formatNumber(row.durationSec, { maximumFractionDigits: DURATION_FRACTION_DIGITS }) }))}</div>${row.station ? `<div class="tt-sub">${esc(stationLabel)}${stationOutOfRange ? ` ${esc(stationOutOfRange)}` : ''}</div>` : ''}${comboLine ? `<div class="tt-sub">${esc(comboLine)} ${esc(comboStatus)}</div>` : ''}`,
      );
      item.appendChild(craftBtn);

      // Phase 3 batch controls: qty stepper + Create All. Disabled while any
      // craft cast is running so the player cannot change mid-batch qty.
      const batchRow = document.createElement('div');
      batchRow.className = 'crafting-batch-row';
      const qtyGroup = document.createElement('div');
      qtyGroup.className = 'crafting-qty-row';
      qtyGroup.setAttribute('role', 'group');
      qtyGroup.setAttribute('aria-label', t('hudChrome.crafting.qtyRowAria'));
      const qtyCount = formatNumber(qty, { maximumFractionDigits: 0 });
      // A bare span exposes no accessible name, so the CURRENT value rides
      // the two buttons' labels instead ({count} param), and every change is
      // echoed through the polite live region below: the pragmatic fold the
      // a11y review chose over a composite spinbutton widget.
      const decBtn = document.createElement('button');
      decBtn.type = 'button';
      decBtn.className = 'crafting-qty-btn';
      decBtn.dataset.focusKey = `qty-dec:${row.recipeId}`;
      decBtn.textContent = '-';
      decBtn.setAttribute(
        'aria-label',
        t('hudChrome.crafting.qtyDecreaseAria', { count: qtyCount }),
      );
      decBtn.disabled = castingActive || qty <= 1;
      decBtn.addEventListener('click', () => {
        if (castingActive) return;
        const next = clampCraftQty(qty - 1, matsFit);
        deps.announce(
          t('hudChrome.crafting.qtyValueAria', {
            count: formatNumber(next, { maximumFractionDigits: 0 }),
          }),
        );
        deps.onCraftQty(row.recipeId, next);
      });
      const qtyValue = document.createElement('span');
      qtyValue.className = 'crafting-qty-value';
      qtyValue.textContent = qtyCount;
      qtyValue.setAttribute('aria-hidden', 'true');
      const incBtn = document.createElement('button');
      incBtn.type = 'button';
      incBtn.className = 'crafting-qty-btn';
      incBtn.dataset.focusKey = `qty-inc:${row.recipeId}`;
      incBtn.textContent = '+';
      incBtn.setAttribute(
        'aria-label',
        t('hudChrome.crafting.qtyIncreaseAria', { count: qtyCount }),
      );
      // Ceiling is min(50, mats-fit); when mats-fit is 0 the stepper still shows 1.
      const maxQty = clampCraftQty(matsFit > 0 ? matsFit : 1, matsFit > 0 ? matsFit : 1);
      incBtn.disabled = castingActive || qty >= maxQty;
      incBtn.addEventListener('click', () => {
        if (castingActive) return;
        const next = clampCraftQty(qty + 1, matsFit);
        deps.announce(
          t('hudChrome.crafting.qtyValueAria', {
            count: formatNumber(next, { maximumFractionDigits: 0 }),
          }),
        );
        deps.onCraftQty(row.recipeId, next);
      });
      qtyGroup.appendChild(decBtn);
      qtyGroup.appendChild(qtyValue);
      qtyGroup.appendChild(incBtn);
      batchRow.appendChild(qtyGroup);
      const createAllBtn = document.createElement('button');
      createAllBtn.type = 'button';
      createAllBtn.className = 'crafting-create-all-btn';
      createAllBtn.dataset.focusKey = `create-all:${row.recipeId}`;
      createAllBtn.textContent = t('hudChrome.crafting.createAll');
      createAllBtn.setAttribute('aria-label', t('hudChrome.crafting.createAllAria'));
      createAllBtn.disabled = !canCraft || matsFit < 1;
      createAllBtn.addEventListener('click', () => {
        if (!canCraft || matsFit < 1) return;
        const all = clampCraftQty(matsFit, matsFit);
        deps.onCraftQty(row.recipeId, all);
        deps.onCraft(row.recipeId, all);
      });
      batchRow.appendChild(createAllBtn);
      item.appendChild(batchRow);
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
  // After display:flex like body.scrollTop above: a display:none subtree has
  // no scroll extent, so an earlier write would clamp to 0.
  const newSkillList = el.querySelector<HTMLElement>('.profession-skill-list');
  if (newSkillList) {
    newSkillList.scrollTop = skillListScrollTop;
    if (skillListHadFocus) newSkillList.focus();
  }
  const newCard = el.querySelector<HTMLElement>('.profession-identity-card');
  if (newCard) newCard.scrollTop = cardScrollTop;
  // Focus across rebuild, with the per-window degrade ladder (#2528 shape):
  // 1. the same control (skipped by restoreFirstEnabled when the rebuild
  //    disabled it, which is every row control while a cast runs);
  // 2. the ACTIVE cast strip (tabindex -1), so Enter on Create never lands
  //    on Close and closes the window with the next keypress;
  // 3. the row button of the cast that just ended (focusReturnRecipeId),
  //    handing focus back where the player started;
  // 4. the orders button, then Close, the calm last resorts.
  if (focusKey !== null) {
    const keyed = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')];
    const exact = keyed.find((node) => node.dataset.focusKey === focusKey) ?? null;
    const stripCandidate = session.active ? progress : null;
    const returnRow = focusReturnRecipeId
      ? (keyed.find((node) => node.dataset.focusKey === `craft:${focusReturnRecipeId}`) ?? null)
      : null;
    restoreFirstEnabled([
      exact === progress && !session.active ? null : exact,
      stripCandidate,
      returnRow,
      el.querySelector<HTMLElement>('[data-open-orders]'),
      el.querySelector<HTMLElement>('[data-close]'),
    ]);
  }
  // Announce craft start only on the idle-to-active edge (re-announcing on
  // every full paint would spam "Crafting {name}" on bag/reagent-driven
  // rebuilds mid-cast). Complete and cancel lines come from the HUD event
  // arms. When no display name resolves, say nothing: a raw internal id read
  // aloud is worse than silence.
  const prevSig = el.dataset.craftLiveStartSig ?? '';
  const nextSig = session.active ? `start:${session.recipeId}` : '';
  if (session.active && nextSig !== prevSig) {
    const activeRow = view.recipes.find((r) => r.recipeId === session.recipeId);
    const name = activeRow?.result ? itemDisplayName(activeRow.result) : '';
    if (name) deps.announce(t('hudChrome.crafting.announceStart', { name }));
  }
  el.dataset.craftLiveStartSig = nextSig;
}

/** The cast strip's element set for the HUD's per-frame CastBarPainter
 *  instance (bar / fill / label / timer, the CastBarElements shape), re-read
 *  after every full paint because the rebuild replaces the nodes. Null when
 *  the window has never painted. The painter owns show/hide (display flex /
 *  none), fill width, the label (the recipe's display name), the timer, and
 *  aria-valuenow, all through the PainterHost elided writers; the batch chip
 *  is painted cold by renderCraftingWindow. */
export function craftCastStripElements(
  el: HTMLElement,
): { bar: HTMLElement; fill: HTMLElement; label: HTMLElement; timer: HTMLElement } | null {
  const bar = el.querySelector<HTMLElement>('.crafting-cast-progress');
  const fill = el.querySelector<HTMLElement>('.crafting-cast-progress-fill');
  const label = el.querySelector<HTMLElement>('.crafting-cast-progress-label');
  const timer = el.querySelector<HTMLElement>('.crafting-cast-progress-timer');
  if (!bar || !fill || !label || !timer) return null;
  return { bar, fill, label, timer };
}
