// The bank's bonus-slot breakdown footer: the KNOWN account-source table and
// the markup it projects a BankBonusModel into.
//
// Extracted from src/ui/bank_window.ts by Bank Storage phase 17, which is the
// extraction that file's own ratchet row named ("a pure function of a
// BankBonusRowModel that needs none of the window's private mutable state").
// It is exactly that: no window state, no deps bag, no DOM. The painter keeps
// one call.
//
// STRING BUILDING, not element building, which is the seam this window already
// has one door over (bankRungResultHtml in src/ui/bank_rung_view.ts): a
// registered pure core may not name `document`, so the markup comes back as
// text and the painter mounts it. The one thing that changes with the form is
// that every interpolation now needs esc(); nothing here is server text or
// player text (every string is a t() value from the shipped catalog and every
// number goes through formatCount), so the escaping is locale-authoring
// hygiene rather than an injection boundary, and it is pinned both ways in
// tests/bank_bonus_view.test.ts: mechanically, that no `${t(` reaches the
// markup unescaped, and behaviourally, through a real innerHTML round trip.

import type { BankBonusModel, BankBonusRowModel } from './bank_view';
import { formatCount } from './count_format';
import { esc } from './esc';
import type { TranslationKey } from './i18n';
import { t } from './i18n';

/** The KNOWN bonus-source ids (server-stamped into BankInfo.bonusSources) with their
 *  localized label and the advert shown while unearned; the referral row uses `advert`
 *  as its always-on explainer detail line. A source id ABSENT from this map is SKIPPED
 *  by bankBonusSectionHtml (forward compat: a future X/Twitch row arrives as a new
 *  server id and must never render a raw key or an English fallback). */
export const BANK_BONUS_SOURCE_KEYS: Record<
  string,
  { label: TranslationKey; advert: TranslationKey }
> = {
  email: {
    label: 'hudChrome.bank.bonusSourceEmail',
    advert: 'hudChrome.bank.bonusAdvertEmail',
  },
  discord: {
    label: 'hudChrome.bank.bonusSourceDiscord',
    advert: 'hudChrome.bank.bonusAdvertDiscord',
  },
  wallet: {
    label: 'hudChrome.bank.bonusSourceWallet',
    advert: 'hudChrome.bank.bonusAdvertWallet',
  },
  referral: {
    label: 'hudChrome.bank.bonusSourceReferral',
    advert: 'hudChrome.bank.bonusReferralExplainer',
  },
};

/** One compact source row. A source carrying progress numbers (referral, the only
 *  v1 one) shows {count}/{cap}; otherwise an earned source shows '+N' and an
 *  unearned one shows its advert line. The referral row carries its explainer
 *  (invite a friend, they reach level 10, you both keep playing) as a wrapping
 *  detail line under the label/status pair. */
export function bankBonusRowHtml(
  row: BankBonusRowModel,
  meta: { label: TranslationKey; advert: TranslationKey },
): string {
  const hasProgress = row.count !== undefined && row.cap !== undefined;
  const status = hasProgress
    ? t('hudChrome.bank.bonusReferralProgress', {
        count: formatCount(row.count as number),
        cap: formatCount(row.cap as number),
      })
    : row.earned
      ? t('hudChrome.bank.bonusStatusEarned', { count: formatCount(row.slots) })
      : t(meta.advert);
  const detail = hasProgress ? `<div class="bank-bonus-detail">${esc(t(meta.advert))}</div>` : '';
  return (
    `<div class="bank-bonus-row${row.earned ? ' earned' : ''}">` +
    `<span class="bank-bonus-label">${esc(t(meta.label))}</span>` +
    `<span class="bank-bonus-status">${esc(status)}</span>` +
    `${detail}</div>`
  );
}

/** The bonus-slot breakdown footer: a header (title + the earned total like '+6')
 *  over one compact row per KNOWN account source. Earned link sources show '+N';
 *  unearned ones advertise what linking grants. Static text only (no tooltip
 *  deps), all localized through t(). Returns the EMPTY STRING offline (no
 *  bonusSources) so the whole section stays hidden there, which is a no-op at
 *  the painter's one mount call.
 *
 *  Grouped and labelled for AT; every earned/unearned state is conveyed in TEXT
 *  (the '+N' / advert / progress line), never color alone. */
export function bankBonusSectionHtml(bonus: BankBonusModel): string {
  if (!bonus.show) return '';
  const rows = bonus.rows
    .map((row) => {
      const meta = BANK_BONUS_SOURCE_KEYS[row.id];
      // Unknown source id (a future X/Twitch row landing before its label ships):
      // SKIP it. Never render a raw key or an English fallback (forward compat).
      return meta ? bankBonusRowHtml(row, meta) : '';
    })
    .join('');
  return (
    `<div class="bank-bonus" role="group"` +
    ` aria-label="${esc(t('hudChrome.bank.bonusSectionAria'))}">` +
    `<div class="bank-bonus-head">` +
    `<span class="bank-bonus-title">${esc(t('hudChrome.bank.bonusTitle'))}</span>` +
    `<span class="bank-bonus-total">` +
    `${esc(t('hudChrome.bank.bonusEarned', { count: formatCount(bonus.total) }))}</span>` +
    `</div>${rows}</div>`
  );
}
