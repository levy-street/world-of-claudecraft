// Strongbox Charter presentation: the store card markup and the copy mappers
// that turn a spend RESULT into the sentence a player reads. Split out of
// src/ui/daily_rewards_window.ts, which owns the purchase flow and the store's
// mutable state; none of this needs any of it, so it lives here as a DOM-free
// pure core the window composes (src/ui/CLAUDE.md, pure-core plus thin painter).
//
// The window keeps everything that touches its private state: the intent
// ledger, the in-flight set, the confirm dialog, the repaint. What moved is
// exactly the part that is a function of its arguments.

import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatNumber, t } from './i18n';
import type { CharterRow, CharterSection } from './woc_store_view';

/** Charter display names are t() keys: the sim registry
 *  (src/sim/content/storage_charters.ts) is deliberately name-free. An explicit
 *  id-to-key switch keeps every key a literal the i18n scanner can see. The
 *  default arm is unreachable through the registry-derived store list and
 *  answers NEUTRALLY rather than with the category name: naming an unknown SKU
 *  "Strongbox Charters" would render a confident, wrong product name into a
 *  purchase confirmation, which is worse than admitting the name is not known. */
export function charterName(itemId: string): string {
  switch (itemId) {
    case 'strongbox_charter_1':
      return t('hudChrome.wocStore.charter.names.strongbox_charter_1');
    case 'strongbox_charter_2':
      return t('hudChrome.wocStore.charter.names.strongbox_charter_2');
    case 'strongbox_charter_3':
      return t('hudChrome.wocStore.charter.names.strongbox_charter_3');
    case 'strongbox_charter_complete':
      return t('hudChrome.wocStore.charter.names.strongbox_charter_complete');
    default:
      return t('hudChrome.dailyRewards.unknown');
  }
}

/** Keep detached purchase results attributable after the originating Store
 *  surface has gone away or moved to a different SKU. */
export function charterOffSurfaceNotice(itemId: string, message: string): string {
  return t('hudChrome.wocStore.charter.resultContext', {
    item: charterName(itemId),
    sku: itemId,
    message,
  });
}

/** Success copy for a GRANTED charter spend. Every arm here means the money
 *  moved and the purchase is real, so none of them may read as a failure or as
 *  a lost purchase. */
export function charterGrantedText(reason: string | null): string {
  switch (reason) {
    case 'already_granted':
      // The same key replayed: the slots ARE on the character, nothing was
      // charged twice. The OPPOSITE meaning of the granted-false arm below.
      return t('hudChrome.wocStore.charter.alreadyGranted');
    case 'apply_deferred':
      return t('hudChrome.wocStore.charter.applyDeferred');
    case 'grant_unresolved':
      return t('hudChrome.wocStore.charter.grantUnresolved');
    default:
      return t('hudChrome.wocStore.charter.granted');
  }
}

/** Refusal copy, and ONLY copy: which refusals keep the idempotency key is the
 *  ledger's call (src/ui/store_purchase_intent.ts), never this table's.
 *  purchase_in_progress reads like a clean refusal but is returned BEFORE the
 *  pending row for this key is read, and the concurrent attempt is usually THIS
 *  intent mid-debit, so it keeps the key while still getting its own message.
 *  The default covers the AMBIGUOUS class ('unavailable', null, or a token this
 *  build does not know). */
export function charterRefusalText(
  reason: string | null,
  surface: 'current' | 'stale' = 'current',
): string {
  switch (reason) {
    case 'purchase_in_progress':
      return t('hudChrome.wocStore.charter.inProgress');
    case 'does_not_fit':
      return t('hudChrome.wocStore.charter.doesNotFit');
    case 'already_granted':
      // granted FALSE: this key was already spent on a DIFFERENT purchase.
      return t('hudChrome.wocStore.charter.failed');
    case 'unknown_item':
    case 'not_cosmetic':
    case 'kind_mismatch':
    case 'invalid_request':
    case 'not_next_rung':
    case 'no_live_character':
      return t('hudChrome.wocStore.charter.notPurchasable');
    default:
      return t(
        surface === 'stale'
          ? 'hudChrome.wocStore.charter.outageStale'
          : 'hudChrome.wocStore.charter.outage',
      );
  }
}

/** One charter card.
 *
 *  `inFlight` is a MARKUP input rather than a DOM mutation on purpose: the store
 *  elides a repaint whose markup is byte-identical to the painted one, so a busy
 *  state that lived only on the element would be silently undone by any repaint
 *  that happened while the spend was still on the wire, handing the player an
 *  enabled Purchase button for a purchase already in flight. */
export function charterCardHtml(row: CharterRow, inFlight: boolean): string {
  const name = charterName(row.itemId);
  // The price is ALWAYS the service snapshot's, never computed here. A row the
  // service has no usable price for renders the shared unavailable treatment.
  const price =
    row.costClaudium === null
      ? `<span class="charter-cost unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
      : `<span class="charter-cost"><img src="/claudium/icons/claudium_coin_64.webp" alt="">` +
        `<strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
  const grant = t('hudChrome.wocStore.charter.grant', {
    slots: formatNumber(row.grantSlots, { maximumFractionDigits: 0 }),
  });
  return (
    `<article class="charter-card">` +
    `<h4>${esc(name)}</h4>` +
    `<p class="charter-grant">${esc(grant)}</p>` +
    price +
    `<button type="button" class="charter-buy" data-charter-buy="${esc(row.itemId)}"` +
    `${focusKeyAttr(`charter-${row.itemId}`)} ` +
    `aria-label="${esc(t('hudChrome.wocStore.charter.buyAria', { item: name }))}"` +
    `${inFlight ? ' aria-busy="true"' : ''}` +
    `${row.purchasable && !inFlight ? '' : ' disabled'}>` +
    `${esc(t('hudChrome.wocStore.charter.buy'))}</button>` +
    `</article>`
  );
}

/** The whole Strongbox category, header included, or the empty string when there
 *  is nothing true to say.
 *
 *  THREE SILENCES, and they are not interchangeable. `fitUnknown` means the fit
 *  gate could not run at all (bankInfo is banker-gated and the store opens
 *  anywhere, so this is the COMMON case): nothing is known, so nothing is
 *  claimed and the category is omitted, UNLESS the server-refused prune (which
 *  runs independently of the count gate) hid rows: hiddenByFit > 0 with an
 *  empty list still renders the hidden-count line, because rows were dropped
 *  and vanishing them without a word is the exact silence the line exists to
 *  break. `ladderFull` means nothing can EVER fit
 *  again. An empty list that is neither means only that no CHARTER fits the room
 *  left, and the bursar can still sell the rest for gold, which is why the scope
 *  line rides that arm and NOT the ceiling one: at the ceiling neither rail has
 *  anything left, so pointing at the bursar would read as an invitation to a
 *  purchase that cannot happen.
 *
 *  Every flag that changes what is VISIBLE has to reach this string, or the
 *  store's markup-identity check elides the repaint on the transition that
 *  changed it. */
export function charterSectionHtml(section: CharterSection, inFlight: ReadonlySet<string>): string {
  const header =
    `<section class="charter-section">` +
    `<header><div><span>${esc(t('hudChrome.wocStore.charter.eyebrow'))}</span>` +
    `<h3>${esc(t('hudChrome.wocStore.charter.title'))}</h3></div></header>`;
  if (section.rows.length === 0) {
    if (section.fitUnknown) {
      // The refusal prune runs even with the count gate off, so an all-pruned
      // list under fitUnknown still has something TRUE to say: rows were
      // hidden. Only the nothing-known-nothing-hidden case stays silent.
      if (section.hiddenByFit === 0) return '';
      return (
        `${header}<div class="charter-body">` +
        `<p class="charter-scope">${esc(t('hudChrome.wocStore.charter.scope'))}</p>` +
        `<p class="charter-scope">${esc(t('hudChrome.wocStore.charter.someHiddenByFit'))}</p>` +
        `</div></section>`
      );
    }
    if (section.ladderFull) {
      return (
        `${header}<div class="charter-body">` +
        `<p class="charter-empty">${esc(t('hudChrome.wocStore.charter.noRoom'))}</p>` +
        `</div></section>`
      );
    }
    return (
      `${header}<div class="charter-body">` +
      `<p class="charter-empty">${esc(t('hudChrome.wocStore.charter.noCharterFits'))}</p>` +
      `<p class="charter-scope">${esc(t('hudChrome.wocStore.charter.scope'))}</p>` +
      `</div></section>`
    );
  }
  const cards = section.rows.map((row) => charterCardHtml(row, inFlight.has(row.itemId))).join('');
  // A NON-empty list can still be silently missing rungs (the fit gates drop
  // per charter), so the hidden count gets its own explanatory line. It rides
  // the returned markup, per this function's own rule above: presence flips
  // with the count, so the markup-identity check repaints the transition.
  const hidden =
    section.hiddenByFit > 0
      ? `<p class="charter-scope">${esc(t('hudChrome.wocStore.charter.someHiddenByFit'))}</p>`
      : '';
  return (
    `${header}<div class="charter-body">` +
    `<p class="charter-scope">${esc(t('hudChrome.wocStore.charter.scope'))}</p>` +
    `<div class="charter-grid">${cards}</div>` +
    hidden +
    `<p class="charter-disclaimer">${esc(t('hudChrome.bank.priceDisclaimer'))}</p>` +
    `</div></section>`
  );
}
