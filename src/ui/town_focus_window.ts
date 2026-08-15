// Thin DOM consumer for the town-focus allocation panel (#1143).
//
// Paints #town-focus-window from the structured TownFocusView (town_focus_view.ts)
// and wires the +/- steppers and Save/Close actions. Owns no state; Hud stays the
// orchestrator (open/close + cross-window coordination).

import {
  MAX_FOCUS_TIER_BONUS,
  POINTS_PER_TIER_BONUS,
  RESPEC_MATERIAL_ITEM_ID,
  type RespecCost,
  type RespecPaymentTier,
} from '../sim/professions/focus';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { formatMoney, formatNumber, t } from './i18n';
import type { TownFocusView } from './town_focus_view';
import { svgIcon } from './ui_icons';

export interface TownFocusWindowDeps {
  onStep(component: string, delta: 1 | -1): void;
  onTierChange(tier: RespecPaymentTier): void;
  onSave(): void;
  onClose(): void;
}

/**
 * The #1144 re-spec cost preview: the currently CHOSEN payment tier and the
 * cost that tier prices for the panel's draft reallocation (computed by the
 * caller, which alone knows both the server-committed allocation and the
 * draft, via professions/focus.ts computeRespecCost). A plain sibling of
 * TownFocusView rather than a field on it: extending the view would pull the
 * committed baseline into buildTownFocusView and the render-signature
 * completeness pins (tests/town_focus_repaint_gate.test.ts) for state the
 * tier picker's own onTierChange already repaints synchronously, with no
 * polling gate to cover.
 */
export interface TownFocusRespecPreview {
  tier: RespecPaymentTier;
  cost: RespecCost;
}

const RESPEC_TIER_OPTIONS: ReadonlyArray<{
  readonly value: RespecPaymentTier;
  readonly labelKey: Parameters<typeof t>[0];
}> = [
  { value: 'time', labelKey: 'hudChrome.townFocus.respecTierTimeOption' },
  { value: 'timeAndPartial', labelKey: 'hudChrome.townFocus.respecTierPartialOption' },
  { value: 'instant', labelKey: 'hudChrome.townFocus.respecTierInstantOption' },
];

/** The cost line under the tier picker: "Free" for a no-op or the free tier,
 *  else the coin/material amounts, both pre-formatted (the budgetLabel/
 *  tierHint idiom: formatMoney/formatNumber run BEFORE interpolation, never a
 *  raw number spliced into the template). */
function respecCostText(cost: RespecCost): string {
  if (cost.coin <= 0 && cost.materials <= 0) return t('hudChrome.townFocus.respecCostFree');
  const materialName = tEntity({ kind: 'item', id: RESPEC_MATERIAL_ITEM_ID, field: 'name' });
  return t('hudChrome.townFocus.respecCostLine', {
    coin: formatMoney(cost.coin),
    materials: `${formatNumber(cost.materials, { maximumFractionDigits: 0 })} ${materialName}`,
  });
}

/** The stable identity of a focusable control, carried across the wipe below.
 *  A stepper is keyed by component AND direction so the rebuilt equivalent is
 *  the one the player was actually on; the tier select, Save, and Close are
 *  singletons. */
type FocusRole = 'dec' | 'inc';
const TIER_FOCUS_KEY = 'tier';
const SAVE_FOCUS_KEY = 'save';
const CLOSE_FOCUS_KEY = 'close';
const stepFocusKey = (component: string, role: FocusRole): string => `${component}:${role}`;

export function renderTownFocusWindow(
  el: HTMLElement,
  view: TownFocusView,
  respec: TownFocusRespecPreview,
  deps: TownFocusWindowDeps,
): void {
  const scrollTop = el.scrollTop;
  // This is a full wipe, so every control the player could be standing on is
  // about to be destroyed. Scroll position was already carried across; focus
  // is the other half (#2500). A step click rebuilds the whole panel, which
  // would otherwise drop keyboard focus to <body> and leave a keyboard player
  // unable to press + a second time. Remember which control had it (by
  // component + role) so the rebuilt equivalent can reclaim it below.
  // The shared helper (#2528) owns the narrowing and, importantly, the
  // containment check, which is load-bearing rather than defensive here:
  // mailbox_window keys its parcel steppers with the SAME data-focus-key
  // attribute in the same shape, so an unguarded read would let a slow-band
  // repaint here pull focus out of another open window.
  const focusKey = captureFocusKey(el);
  // Dialog semantics for the trapped root (#2525). Hud installs the Tab trap and
  // the return-to-opener through windowFocus('#town-focus-window'); a trapped
  // window also has to ANNOUNCE itself, or a screen-reader user is cycling inside
  // an unnamed <div>. Set before the wipe, the deeds / professions ordering: these
  // attributes live on the root, which the innerHTML below never touches, and the
  // one accessible name comes from the SAME key as the visible title, so the two
  // can never drift. markDialogRoot also writes tabindex="-1", which is
  // deliberately NOT a Tab stop: FOCUSABLE_SELECTOR excludes tabindex="-1" from
  // every clause, so the root stays programmatically focusable (the focus-first
  // fallback) without joining the cycle.
  markDialogRoot(el, { label: t('hudChrome.townFocus.title') });
  el.innerHTML = `<div class="panel-title"><span>${esc(t('hudChrome.townFocus.title'))}</span><button type="button" class="x-btn" data-close data-focus-key="${CLOSE_FOCUS_KEY}" aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const hint = document.createElement('div');
  hint.className = 'town-focus-hint';
  hint.textContent = t('hudChrome.townFocus.hint');
  el.appendChild(hint);

  // Legibility hints: the tier-shift rule and the town-only rule,
  // parameterized off the real focus constants so the copy cannot rot.
  const tierHint = document.createElement('div');
  tierHint.className = 'town-focus-hint';
  tierHint.textContent = t('hudChrome.townFocus.tierHint', {
    points: formatNumber(POINTS_PER_TIER_BONUS, { maximumFractionDigits: 0 }),
    steps: formatNumber(MAX_FOCUS_TIER_BONUS, { maximumFractionDigits: 0 }),
  });
  el.appendChild(tierHint);

  const townOnlyHint = document.createElement('div');
  townOnlyHint.className = 'town-focus-hint';
  townOnlyHint.textContent = t('hudChrome.townFocus.townOnlyHint');
  el.appendChild(townOnlyHint);

  if (!view.inTown) {
    const notInTown = document.createElement('div');
    notInTown.className = 'town-focus-not-in-town';
    notInTown.textContent = t('hudChrome.townFocus.notInTownHint');
    el.appendChild(notInTown);
  }

  // Formatted, not spliced: t()'s interpolate() ends in a bare String(value),
  // which is JavaScript's own fixed number-to-string spelling and never reaches
  // Intl, so a raw number here renders the same digits for every player
  // whatever language they picked (#2530). Same option bag as the tier hint
  // above, which is the whole point: two adjacent lines rendering counts must
  // not disagree about how a count is spelled. Invisible for the shipped
  // 0..FOCUS_POINT_BUDGET range, which is exactly why it was easy to write the
  // other way.
  const budget = document.createElement('div');
  budget.className = 'town-focus-budget';
  budget.textContent = t('hudChrome.townFocus.budgetLabel', {
    remaining: formatNumber(view.remaining, { maximumFractionDigits: 0 }),
    budget: formatNumber(view.budget, { maximumFractionDigits: 0 }),
  });
  el.appendChild(budget);

  const steppers = new Map<string, { dec: HTMLButtonElement; inc: HTMLButtonElement }>();
  for (const row of view.rows) {
    const componentName = t(
      `hudChrome.corpseHarvest.components.${row.component}` as Parameters<typeof t>[0],
    );
    const rowEl = document.createElement('div');
    rowEl.className = 'town-focus-row';
    // esc() as well as formatNumber, matching the name beside it: no separator
    // any supported locale emits is HTML-special (they are U+002C, U+002E,
    // U+00A0, U+202F), so this is a no-op today and stays one for the file's
    // "every interpolation is escaped" rule rather than being an exception a
    // reader has to re-derive.
    rowEl.innerHTML = `<span class="tf-name">${esc(componentName)}</span><span class="tf-points">${esc(formatNumber(row.points, { maximumFractionDigits: 0 }))}</span>`;

    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'tf-step';
    dec.textContent = '-';
    dec.disabled = !row.canDecrease;
    dec.dataset.focusKey = stepFocusKey(row.component, 'dec');
    dec.setAttribute(
      'aria-label',
      t('hudChrome.townFocus.decreaseAria', { component: componentName }),
    );
    dec.addEventListener('click', () => deps.onStep(row.component, -1));

    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'tf-step';
    inc.textContent = '+';
    inc.disabled = !row.canIncrease;
    inc.dataset.focusKey = stepFocusKey(row.component, 'inc');
    inc.setAttribute(
      'aria-label',
      t('hudChrome.townFocus.increaseAria', { component: componentName }),
    );
    inc.addEventListener('click', () => deps.onStep(row.component, 1));

    rowEl.appendChild(dec);
    rowEl.appendChild(inc);
    el.appendChild(rowEl);
    steppers.set(row.component, { dec, inc });
  }

  // #1144: the re-spec payment-tier picker + its cost preview, above Save
  // (the control that charges it). The select disables in step with every
  // other control out of town (the panel is readable, never editable, while
  // outside the hub); its own change re-renders the whole panel, exactly like
  // a stepper click, so the cost line updates through the SAME repaint the
  // steppers already drive rather than a second write path.
  const tierRow = document.createElement('div');
  tierRow.className = 'town-focus-tier-row';
  tierRow.innerHTML = `<label for="town-focus-tier-select" class="town-focus-tier-label">${esc(t('hudChrome.townFocus.respecTierLabel'))}</label>`;
  const tierSelect = document.createElement('select');
  tierSelect.id = 'town-focus-tier-select';
  tierSelect.className = 'town-focus-tier-select';
  tierSelect.disabled = !view.inTown;
  tierSelect.dataset.focusKey = TIER_FOCUS_KEY;
  for (const option of RESPEC_TIER_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = t(option.labelKey);
    opt.selected = option.value === respec.tier;
    tierSelect.appendChild(opt);
  }
  tierSelect.addEventListener('change', () =>
    deps.onTierChange(tierSelect.value as RespecPaymentTier),
  );
  tierRow.appendChild(tierSelect);
  el.appendChild(tierRow);

  const costLine = document.createElement('div');
  costLine.className = 'town-focus-cost';
  costLine.textContent = respecCostText(respec.cost);
  el.appendChild(costLine);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'town-focus-save';
  save.textContent = t('hudChrome.townFocus.saveButton');
  save.disabled = !view.inTown;
  save.dataset.focusKey = SAVE_FOCUS_KEY;
  save.addEventListener('click', () => deps.onSave());
  el.appendChild(save);

  const close = el.querySelector<HTMLButtonElement>('[data-close]');
  close?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  // Scroll FIRST, then focus. `focus()` scrolls its target into view (the
  // helper calls it bare, and states why there), so this order lets a degraded
  // target (Save or Close, when the control the player was on came back
  // disabled) win over the restored offset. That is the wanted outcome: focus
  // must be visible (WCAG 2.4.11), and the common case cannot conflict, since
  // the control being refocused is the one the player was already looking at,
  // so it is in view and `focus()` scrolls nothing. Reversing the two would
  // trade a visible focus ring for an offset the player can no longer see the
  // focus in.
  if (focusKey !== null) restoreFocus(focusKey, steppers, tierSelect, save, close);
}

/**
 * Resolve the rebuilt equivalent of the control that had focus and hand it back.
 *
 * This is the half the shared helper deliberately does NOT own: the ladder is
 * this panel's own. The control the player just activated can legitimately come
 * back DISABLED (stepping the last point off a component disables its `-`,
 * spending the last budget point disables every `+`, and leaving town disables
 * all of them), and a disabled button cannot take focus. So the order below
 * degrades along the row the player is working in before it leaves it: the same
 * stepper, then the row's other stepper, then Save, then Close. Landing on
 * Close is still keyboard operation; landing on <body> is not. The tier select
 * (#1144) is a third singleton alongside Save/Close: choosing a tier repaints
 * the whole panel exactly like a stepper does, so its own degrade ladder
 * prefers itself, then falls to Save, then Close, the same "stay in the
 * control the player was using" shape the stepper pair follows.
 */
function restoreFocus(
  focusKey: string,
  steppers: ReadonlyMap<string, { dec: HTMLButtonElement; inc: HTMLButtonElement }>,
  tierSelect: HTMLSelectElement,
  save: HTMLButtonElement,
  close: HTMLButtonElement | null,
): void {
  const [component, role] = focusKey.split(':');
  // `pair`, never `row`: tests/town_focus_repaint_gate.test.ts scans this file
  // for every `row.<field>` read to prove the repaint signature covers them
  // all, so `row` is reserved for the view row it walks.
  const pair = steppers.get(component) ?? null;
  const preferred = pair === null ? null : role === 'dec' ? pair.dec : pair.inc;
  const other = pair === null ? null : role === 'dec' ? pair.inc : pair.dec;
  // Close first for the X, so dismissing from the keyboard never jumps the
  // player onto Save; the tier select prefers itself before falling to Save;
  // every other key walks the row outward.
  const candidates: ReadonlyArray<HTMLButtonElement | HTMLSelectElement | null> =
    focusKey === CLOSE_FOCUS_KEY
      ? [close, save]
      : focusKey === TIER_FOCUS_KEY
        ? [tierSelect, save, close]
        : [preferred, other, save, close];
  restoreFirstEnabled(candidates);
}
