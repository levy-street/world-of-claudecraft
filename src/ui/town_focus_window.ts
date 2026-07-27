// Thin DOM consumer for the town-focus allocation panel (#1143).
//
// Paints #town-focus-window from the structured TownFocusView (town_focus_view.ts)
// and wires the +/- steppers and Save/Close actions. Owns no state; Hud stays the
// orchestrator (open/close + cross-window coordination).

import { MAX_FOCUS_TIER_BONUS, POINTS_PER_TIER_BONUS } from '../sim/professions/focus';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { TownFocusView } from './town_focus_view';
import { svgIcon } from './ui_icons';

export interface TownFocusWindowDeps {
  onStep(component: string, delta: 1 | -1): void;
  onSave(): void;
  onClose(): void;
}

/** The stable identity of a focusable control, carried across the wipe below.
 *  A stepper is keyed by component AND direction so the rebuilt equivalent is
 *  the one the player was actually on; Save and Close are singletons. */
type FocusRole = 'dec' | 'inc';
const SAVE_FOCUS_KEY = 'save';
const CLOSE_FOCUS_KEY = 'close';
const stepFocusKey = (component: string, role: FocusRole): string => `${component}:${role}`;

export function renderTownFocusWindow(
  el: HTMLElement,
  view: TownFocusView,
  deps: TownFocusWindowDeps,
): void {
  const scrollTop = el.scrollTop;
  // This is a full wipe, so every control the player could be standing on is
  // about to be destroyed. Scroll position was already carried across; focus
  // is the other half (#2500). A step click rebuilds the whole panel, which
  // would otherwise drop keyboard focus to <body> and leave a keyboard player
  // unable to press + a second time. Remember which control had it (by
  // component + role) so the rebuilt equivalent can reclaim it below, the
  // mailbox_window parcel-stepper idiom.
  // `instanceof` rather than a cast: activeElement is typed Element, and the
  // dataset read below is only sound on an HTMLElement (focus_manager.ts
  // narrows the same way). The containment check is load-bearing, not
  // defensive: mailbox_window keys its parcel steppers with the SAME
  // data-focus-key attribute in the same shape, so an unguarded read would let
  // a slow-band repaint here pull focus out of another open window.
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement && el.contains(active) ? (active.dataset.focusKey ?? null) : null;
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
  // Scroll FIRST, then focus, and deliberately WITHOUT { preventScroll: true }.
  // `focus()` scrolls its target into view, so this order lets a degraded
  // target (Save or Close, when the control the player was on came back
  // disabled) win over the restored offset. That is the wanted outcome: focus
  // must be visible (WCAG 2.4.11), and the common case cannot conflict, since
  // the control being refocused is the one the player was already looking at,
  // so it is in view and `focus()` scrolls nothing. Reversing the two, or
  // passing preventScroll, would trade a visible focus ring for an offset the
  // player can no longer see the focus in.
  if (focusKey !== null) restoreFocus(focusKey, steppers, save, close);
}

/**
 * Hand focus back to the rebuilt equivalent of the control that had it.
 *
 * The control the player just activated can legitimately come back DISABLED
 * (stepping the last point off a component disables its `-`, spending the last
 * budget point disables every `+`, and leaving town disables all of them), and
 * a disabled button cannot take focus. So this degrades along the row the
 * player is working in before it leaves it: the same stepper, then the row's
 * other stepper, then Save, then Close. Landing on Close is still keyboard
 * operation; landing on <body> is not.
 */
function restoreFocus(
  focusKey: string,
  steppers: ReadonlyMap<string, { dec: HTMLButtonElement; inc: HTMLButtonElement }>,
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
  // player onto Save; every other key walks the row outward.
  const candidates: ReadonlyArray<HTMLButtonElement | null> =
    focusKey === CLOSE_FOCUS_KEY ? [close, save] : [preferred, other, save, close];
  for (const candidate of candidates) {
    if (candidate === null || candidate.disabled) continue;
    candidate.focus();
    return;
  }
}
