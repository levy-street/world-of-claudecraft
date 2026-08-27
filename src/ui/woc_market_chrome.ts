// The Exchange window's small status chrome, as pure builders.
//
// A spinner, a loading line, a failed-reach line, the browse faces' control
// row and the exact end time a countdown cell carries as its tooltip: none of
// them read the window's state, so none of them belong to the window's class.
// They live here so the window stays a coordinator over its own faces and
// this markup can be asserted directly, which is the same split
// unit_portrait/unit_portrait_painter uses.
//
// DOM-free and deterministic apart from the caller's own timestamps
// (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { ItemWeaponType } from '../sim/content/weapon_skin_rules';
import type { ItemSlot } from '../sim/types';
import { weaponTypeLabel } from './armory_labels';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { guildTagHtml } from './guild_tag';
import { formatDateTime, formatDuration, formatNumber, t } from './i18n';
import { ITEM_QUALITY_LABEL_KEYS, itemQualityLabel } from './item_kind_label';
import { itemSlotLabel } from './item_slot_labels';
import { svgIcon } from './ui_icons';
import { usdDollarsText } from './usd_text';
import { walletCardKeys } from './wallet_card_keys';
import type { WalletConnectionView } from './wallet_connection_view';
import { wocTokensText } from './woc_tokens_text';

/** The browse faces' control row: the sort control LEADS the row (the 15 QA
 *  sign-off note), the filters follow it, the pager closes the row. Pure
 *  over its inputs like every builder here; the focus keys and data hooks
 *  are the ones the window's restore ladder and handlers already own. It
 *  renders on EVERY browse face so an empty page or a failed reach still
 *  leaves a way back, a live sort, and live filters. The filter values ride
 *  the server's own browse params (validated there); the item box is free
 *  text the window resolves to ids on the change event. */
/** The weapon-type and armor-slot vocabularies the subcategory select offers
 *  per category, mirrored from the stamped axes
 *  (src/sim/exchange_eligibility.ts exchangeBrowseSubcategory): weapon types
 *  are the skin vocabulary plus polearm; armor slots are the def's ItemSlot
 *  kinds an armor piece can declare (offhand covers held pieces; 'ring' is
 *  the slot KIND, never ring1/ring2). */
const BROWSE_WEAPON_TYPES: readonly ItemWeaponType[] = [
  'sword',
  'axe',
  'mace',
  'dagger',
  'staff',
  'wand',
  'bow',
  'crossbow',
  'polearm',
];
const BROWSE_ARMOR_SLOTS: readonly ItemSlot[] = [
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
  'offhand',
];

export function wocBrowseStripHtml(opts: {
  page: number;
  hasMore: boolean;
  sort: string;
  quality: string | null;
  qualityOptions: readonly string[];
  format: string | null;
  category: string | null;
  subcategory: string | null;
  itemQuery: string;
}): string {
  const option =
    (selected: string | null) =>
    (value: string, label: string): string =>
      `<option value="${value}" ${selected === value || (value === '' && selected === null) ? 'selected' : ''}>${esc(label)}</option>`;
  const sortOption = option(opts.sort);
  const qualityOption = option(opts.quality);
  const formatOption = option(opts.format);
  const categoryOption = option(opts.category);
  const subcategoryOption = option(opts.subcategory);
  // The finer axis renders only while a category with one is picked, and its
  // vocabulary follows that category; the window drops an incompatible
  // subcategory when the category changes.
  const subcategorySelect =
    opts.category === 'weapon' || opts.category === 'armor'
      ? `<label class="wm-sort">${esc(t('hudChrome.wocMarket.filterSubcategory'))}` +
        `<select data-field="filter-subcategory" ${FOCUS_KEY_ATTR}="wm-filter-subcategory">` +
        subcategoryOption('', t('hudChrome.wocMarket.filterAny')) +
        (opts.category === 'weapon'
          ? BROWSE_WEAPON_TYPES.map((w) => subcategoryOption(w, weaponTypeLabel(w))).join('')
          : BROWSE_ARMOR_SLOTS.map((s) => subcategoryOption(s, itemSlotLabel(s))).join('')) +
        `</select></label>`
      : '';
  return (
    `<div class="wm-pager">` +
    `<label class="wm-sort">${esc(t('hudChrome.wocMarket.sortLabel'))}` +
    `<select data-field="sort" ${FOCUS_KEY_ATTR}="wm-sort">` +
    sortOption('ending', t('hudChrome.wocMarket.sortEnding')) +
    sortOption('newest', t('hudChrome.wocMarket.sortNewest')) +
    sortOption('price_asc', t('hudChrome.wocMarket.sortPriceAsc')) +
    sortOption('price_desc', t('hudChrome.wocMarket.sortPriceDesc')) +
    `</select></label>` +
    `<label class="wm-sort">${esc(t('hudChrome.wocMarket.filterCategory'))}` +
    `<select data-field="filter-category" ${FOCUS_KEY_ATTR}="wm-filter-category">` +
    categoryOption('', t('hudChrome.wocMarket.filterAny')) +
    categoryOption('weapon', t('hudChrome.wocMarket.filterCategoryWeapon')) +
    categoryOption('armor', t('hudChrome.wocMarket.filterCategoryArmor')) +
    categoryOption('mount', t('hudChrome.wocMarket.filterCategoryMount')) +
    `</select></label>` +
    subcategorySelect +
    `<label class="wm-sort">${esc(t('hudChrome.wocMarket.filterQuality'))}` +
    `<select data-field="filter-quality" ${FOCUS_KEY_ATTR}="wm-filter-quality">` +
    qualityOption('', t('hudChrome.wocMarket.filterAny')) +
    opts.qualityOptions
      .map((q) =>
        qualityOption(
          q,
          QUALITY_WORDS.has(q) ? itemQualityLabel(q as Parameters<typeof itemQualityLabel>[0]) : q,
        ),
      )
      .join('') +
    `</select></label>` +
    `<label class="wm-sort">${esc(t('hudChrome.wocMarket.filterFormat'))}` +
    `<select data-field="filter-format" ${FOCUS_KEY_ATTR}="wm-filter-format">` +
    formatOption('', t('hudChrome.wocMarket.filterAny')) +
    formatOption('auction', t('hudChrome.wocMarket.filterFormatAuction')) +
    formatOption('buy_now', t('hudChrome.wocMarket.filterFormatBuyNow')) +
    `</select></label>` +
    `<label class="wm-sort wm-filter-item">${esc(t('hudChrome.wocMarket.filterItemLabel'))}` +
    `<input type="text" data-field="filter-item" ${FOCUS_KEY_ATTR}="wm-filter-item" ` +
    `value="${esc(opts.itemQuery)}" placeholder="${esc(
      t('hudChrome.wocMarket.filterItemPlaceholder'),
    )}" /></label>` +
    `<button type="button" data-action="page-prev" ${FOCUS_KEY_ATTR}="wm-page-prev" ${opts.page <= 0 ? 'disabled' : ''} aria-label="${esc(t('hudChrome.wocMarket.pagePrev'))}">${svgIcon('prev')}</button>` +
    `<span>${esc(t('hudChrome.wocMarket.pageNumber', { current: formatNumber(opts.page + 1) }))}</span>` +
    `<button type="button" data-action="page-next" ${FOCUS_KEY_ATTR}="wm-page-next" ${opts.hasMore ? '' : 'disabled'} aria-label="${esc(t('hudChrome.wocMarket.pageNext'))}">${svgIcon('next')}</button>` +
    `</div>`
  );
}

/** The one shared ring, sized and coloured by .woc-spinner in the stylesheet. */
export function wocSpinnerHtml(): string {
  return `<span class="woc-spinner" aria-hidden="true"></span>`;
}

/** A reach in progress: the ring plus the announced sentence. */
export function wocLoadingStatusHtml(): string {
  return `<div class="wm-status wm-status-loading" role="status">${wocSpinnerHtml()}<span>${esc(
    t('hudChrome.wocMarket.loading'),
  )}</span></div>`;
}

/** A failed reach reads as an error: the glyph, the error voice, announced. */
export function wocErrorStatusHtml(text: string): string {
  return `<div class="wm-status wm-status-error" role="status">${svgIcon('alert')}<span>${esc(
    text,
  )}</span></div>`;
}

/**
 * The exact end time of a listing, UTC and local, the way the detail pane
 * spells it (the countdown cells carry it as their tooltip).
 *
 * Both readings, because a listing closes at an instant that is the same for
 * everyone: the UTC stamp is the one two players in different places can
 * compare, and the local one is the clock they will actually look at.
 */
export function wocEndsAtText(endsAtMs: number): string {
  return t('hudChrome.wocMarket.detailEndsAt', {
    utc: formatDateTime(endsAtMs, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
    local: formatDateTime(endsAtMs, { dateStyle: 'medium', timeStyle: 'short' }),
  });
}

/** The known quality vocabulary, DERIVED from the exhaustive label record so
 *  a new quality flows here in the same change that names it; the /status
 *  floor word resolves to its localized name, and an unrecognized future
 *  policy word renders verbatim rather than mislabeling (the server
 *  validated it, the client just cannot name it yet). */
const QUALITY_WORDS = new Set<string>(Object.keys(ITEM_QUALITY_LABEL_KEYS));

/**
 * The empty Sell tab, with the realm's OWN policy resolved into the copy:
 * the live quality floor (localized through the shared quality-label family)
 * and a collectible sentence chosen from the realm's category switches, one
 * key per combination so no locale composes a list in code. The old caption
 * said "the realm's quality floor" and "on some realms" while the figures
 * sat one field away on /status; named figures come off the wire.
 */
export function wocSellEmptyHtml(
  policy: { qualityFloor: string; allowMounts: boolean; allowMechChromas: boolean },
  lockedNoteHtml: string,
): string {
  const floor = QUALITY_WORDS.has(policy.qualityFloor)
    ? itemQualityLabel(policy.qualityFloor as Parameters<typeof itemQualityLabel>[0])
    : policy.qualityFloor;
  const collectibles =
    policy.allowMounts && policy.allowMechChromas
      ? t('hudChrome.wocMarket.sellCollectiblesBoth')
      : policy.allowMounts
        ? t('hudChrome.wocMarket.sellCollectiblesMounts')
        : policy.allowMechChromas
          ? t('hudChrome.wocMarket.sellCollectiblesChromas')
          : null;
  return (
    `<div class="wm-sell"><div class="wm-status" role="status">` +
    `<p>${esc(t('hudChrome.wocMarket.sellEmptyFloor', { floor }))}</p>` +
    (collectibles === null ? '' : `<p>${esc(collectibles)}</p>`) +
    `</div>${lockedNoteHtml}</div>`
  );
}

/**
 * The general bond disclosures resolved from the /status figures: the
 * schedule for an arbitrary typed bid and the payment window whose lapse
 * kills the bid. Rendered only when the server sent the figures (the caller
 * gates on them), so an older server keeps the figure-free listing-specific
 * note alone.
 */
export function wocBondScheduleNotesHtml(args: {
  rateBps: number;
  minCents: number;
  maxCents: number;
  /** The pre-localized payment window (the window's countdown formatter). */
  payWindowText: string;
  /** The window's own money formatter, so both surfaces spell USD one way. */
  usd(cents: number): string;
}): string {
  return (
    `<p class="wm-note">${esc(
      t('hudChrome.wocMarket.bidBondSchedule', {
        rate: formatNumber(args.rateBps / 100),
        min: args.usd(args.minCents),
        max: args.usd(args.maxCents),
      }),
    )}</p>` +
    `<p class="wm-note">${esc(
      t('hudChrome.wocMarket.bidBondPayWindow', { duration: args.payWindowText }),
    )}</p>`
  );
}

/**
 * The standing banners under the tab strip, above the Browse filters: a paused
 * realm, and the "Solana wallet" card. Both change on an operator action or a
 * wallet event, never on a click, so the tab panel does not shift under the
 * pointer. The wallet card is the Claudium panel's card (the same title, the
 * same per-state sentence, the same Connect / Verify / Reconnect / Manage
 * button via wallet_card_keys), so a player sees one wallet story across the
 * two windows; it stands whenever the wallet feature is on, a linked and
 * connected wallet included, because "Manage wallet" is the way to change or
 * unlink it from here. The button rides the window's connect-wallet click
 * action into the shared flow the store and daily rewards buttons open, one
 * click from where the player was told to link.
 */
export function wocMarketBannersHtml(args: {
  paused: boolean;
  wallet: WalletConnectionView | null;
  tokensPerUsd?: number | null;
}): string {
  const banners =
    (args.paused
      ? `<div class="wm-banner wm-banner-paused">${esc(t('hudChrome.wocMarket.pausedBanner'))}</div>`
      : '') + wocWalletCardHtml(args.wallet, args.tokensPerUsd ?? null);
  return banners === '' ? '' : `<div class="wm-strip">${banners}</div>`;
}

export function wocWalletCardSig(wallet: WalletConnectionView): string {
  return `${wallet.kind}|${wallet.balanceVerified ? wallet.balance : ''}`;
}

function wocWalletCardHtml(
  wallet: WalletConnectionView | null,
  tokensPerUsd: number | null,
): string {
  if (wallet === null || !wallet.enabled) return '';
  const sharedKeys = walletCardKeys(wallet.kind);
  const bodyKey =
    wallet.kind === 'linked_disconnected'
      ? 'hudChrome.wocMarket.walletLinkedDisconnected'
      : wallet.kind === 'linked_connected'
        ? 'hudChrome.wocMarket.walletLinkedConnected'
        : sharedKeys.bodyKey;
  const balance = wocWalletBalanceHtml(wallet, tokensPerUsd);
  return (
    `<div class="wm-banner wm-banner-wallet" data-wallet-kind="${esc(wallet.kind)}">` +
    `<strong>${esc(t('hudChrome.wocStore.wallet.title'))}</strong>` +
    `<p>${esc(t(bodyKey))}</p>` +
    balance +
    `<button type="button" data-action="connect-wallet" ${FOCUS_KEY_ATTR}="wm-connect-wallet">${esc(
      t(sharedKeys.actionKey),
    )}</button></div>`
  );
}

function wocWalletBalanceHtml(wallet: WalletConnectionView, tokensPerUsd: number | null): string {
  if (!wallet.balanceVerified || wallet.balance === null) return '';
  const tokens = t('wallet.balanceAmount', { amount: wocTokensText(wallet.balance) });
  const usd =
    tokensPerUsd !== null && Number.isFinite(tokensPerUsd) && tokensPerUsd > 0
      ? t('hudChrome.wocMarket.walletUsdBalance', {
          amount: usdDollarsText(wallet.balance / tokensPerUsd),
        })
      : t('hudChrome.wocMarket.walletUsdUnknown');
  return `<span class="wm-wallet-balance"><strong>${esc(tokens)}</strong><span>${esc(usd)}</span></span>`;
}

/**
 * The footer status bar: the rate note rests there, and the toast strip (a
 * mutation in flight, its outcome) joins it in the SAME slot, so a notice
 * that comes and goes never moves the rows or the form above it. Under the
 * paused banner the rate reads as the last KNOWN print, with its date, never
 * a live rate. The busy line moves (the shared ring): a signed transaction
 * awaiting the chain used to be indistinguishable from a wedged panel.
 */
export function wocMarketFootHtml(args: {
  paused: boolean;
  tokensPerUsd: number | null;
  priceAsOfMs: number | null;
  /** The window's token formatter, so every surface spells $WOC one way. */
  tokens(value: number): string;
  /** The ALREADY-RESOLVED notice sentence (the window's resolveNotice), so a
   *  runtime language switch never leaves a stale-locale sentence here. */
  notice: { text: string; error: boolean } | null;
  busyText: string | null;
}): string {
  const rate =
    args.tokensPerUsd !== null && args.priceAsOfMs !== null
      ? `<div class="wm-rate">${esc(
          args.paused
            ? t('hudChrome.wocMarket.rateNotePaused', {
                tokens: args.tokens(args.tokensPerUsd),
                time: formatDateTime(args.priceAsOfMs, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('hudChrome.wocMarket.rateNote', {
                tokens: args.tokens(args.tokensPerUsd),
                time: formatDateTime(args.priceAsOfMs, { timeStyle: 'short' }),
              }),
        )}</div>`
      : '';
  const notice = args.notice
    ? `<div class="wm-notice ${args.notice.error ? 'wm-notice-error' : ''}" role="status">${
        args.notice.error ? svgIcon('alert') : ''
      }<span>${esc(args.notice.text)}</span></div>`
    : '';
  const busy =
    args.busyText === null
      ? ''
      : `<div class="wm-busy" role="status">${wocSpinnerHtml()}<span>${esc(args.busyText)}</span></div>`;
  return `<div class="wm-foot">${rate}${notice}${busy}</div>`;
}

/**
 * The bid form's commitment disclosures, BEFORE the first bond charge,
 * grouped as one well: the bond schedule for THIS listing (both figures are
 * server-computed and shipped on the row: the client computes no money, the
 * PRD rule), the binding rule with its forfeit and strike (stated once,
 * here), the closing rule, the second-chance cascade with the resolved
 * settlement window, the variable-token warning, and the payment deadline
 * (H13's pre-bid disclosure gap).
 *
 * Collapsed by default behind the toggle, never removed: the well is always
 * composed (resolved figures and all) and precedes Place bid in DOM order,
 * but eight always-open paragraphs pushed the commit control below the fold
 * on every screen (the PRD's collapsed-by-default presentation). The hidden
 * attribute needs its own CSS arm: .wm-disclosures sets display:flex, which
 * outranks the UA's [hidden] rule.
 */
export function wocBidDisclosuresHtml(args: {
  open: boolean;
  /** The bond for the minimum next bid, and that bid, both off the row. */
  bondCents: number;
  bidCents: number;
  /** The /status schedule figures, or null on an older server (the
   *  figure-free bidBondNote then stands alone). */
  schedule: {
    rateBps: number;
    minCents: number;
    maxCents: number;
    payWindowText: string;
  } | null;
  offerNext: boolean;
  /** The pre-localized settlement window (the window's countdown formatter). */
  settlementWindowText: string;
  usd(cents: number): string;
}): string {
  return (
    `<button type="button" class="wm-terms-toggle" data-action="toggle-bid-terms" ` +
    `aria-expanded="${args.open ? 'true' : 'false'}" aria-controls="wm-bid-terms" ` +
    `${FOCUS_KEY_ATTR}="wm-bid-terms-toggle">${esc(t('hudChrome.wocMarket.bidTermsToggle'))}</button>` +
    `<div class="wm-disclosures" id="wm-bid-terms"${args.open ? '' : ' hidden'}>` +
    `<p class="wm-note">${esc(
      t('hudChrome.wocMarket.bidBondNote', {
        bond: args.usd(args.bondCents),
        bid: args.usd(args.bidCents),
      }),
    )}</p>` +
    (args.schedule === null ? '' : wocBondScheduleNotesHtml({ ...args.schedule, usd: args.usd })) +
    `<p class="wm-note">${esc(t('hudChrome.wocMarket.bidBindingNote'))}</p>` +
    `<p class="wm-note">${esc(t('hudChrome.wocMarket.bidCloseNote'))}</p>` +
    (args.offerNext
      ? `<p class="wm-note">${esc(
          t('hudChrome.wocMarket.offerNextNote', { duration: args.settlementWindowText }),
        )}</p>`
      : '') +
    `<p class="wm-note">${esc(t('hudChrome.wocMarket.variableTokenWarning'))}</p>` +
    `<p class="wm-note">${esc(
      t('hudChrome.wocMarket.settlementDeadlineNote', { duration: args.settlementWindowText }),
    )}</p>` +
    `</div>`
  );
}

/**
 * The detail pane's buy-now face: the walk-away-cost disclosure (the re-claim
 * cooldown and the hourly cap) said BEFORE the button, like the bid form's
 * disclosures precede Place bid; a locked listing says WHY its button is
 * disabled (the badge lives in the table, which a phone has scrolled away);
 * then the price in tokens off buy-now's own quote, and the refusal in words
 * beside a button that is actually disabled (never colour alone).
 */
export function wocBuyNowHtml(args: {
  listingId: number;
  itemName: string;
  buyNowCents: number;
  locked: boolean;
  disabled: boolean;
  /** The buy-now price in tokens (the window's formatter), or null until its
   *  own quote lands: the detail's estimate priced the current bid, not this. */
  tokensText: string | null;
  overBalance: boolean;
  usd(cents: number): string;
}): string {
  return (
    `<div class="wm-disclosures">` +
    `<p class="wm-note">${esc(t('hudChrome.wocMarket.buyNowNote'))}</p>` +
    (args.locked ? `<p class="wm-note">${esc(t('hudChrome.wocMarket.buyNowLockedTip'))}</p>` : '') +
    `</div>` +
    `<button type="button" class="wm-primary" data-action="buy-now" data-listing="${args.listingId}" ` +
    `${args.disabled ? 'disabled' : ''} ` +
    `aria-label="${esc(
      t('hudChrome.wocMarket.buyNowAria', {
        item: args.itemName,
        usd: args.usd(args.buyNowCents),
      }),
    )}" ${FOCUS_KEY_ATTR}="wm-buy-now">` +
    `${esc(t('hudChrome.wocMarket.buyNowButton', { usd: args.usd(args.buyNowCents) }))}</button>` +
    (args.tokensText === null
      ? ''
      : `<p class="wm-bid-equiv${args.overBalance ? ' over-balance' : ''}">${esc(
          t('hudChrome.trade.woc.equivalent', { tokens: args.tokensText }),
        )}</p>`) +
    (args.overBalance
      ? `<p class="wm-over-balance">${esc(t('hudChrome.trade.woc.hintInsufficientBalance'))}</p>`
      : '')
  );
}

/**
 * The Browse seller click-through pane: a seller's recent completed trades,
 * with its own way back (the Back control leads, so the escape is never
 * below the fold). Null sales means the read is still out; [] is a real
 * empty answer, and the two faces must not look alike.
 */
export function wocSellerPaneHtml(args: {
  name: string;
  failed: boolean;
  /** The seller's public profile line, or null when the name no longer
   *  resolves to a character (renamed or deleted): the guild tag simply does
   *  not render, and the sales stand alone. */
  profile: { guildName: string | null } | null;
  sales: readonly { atMs: number; itemName: string; buyerName: string; usdText: string }[] | null;
}): string {
  const body = args.failed
    ? wocErrorStatusHtml(t('hudChrome.wocMarket.sellerError'))
    : args.sales === null
      ? `<p class="wm-sales-empty">${esc(t('hudChrome.wocMarket.detailSalesLoading'))}</p>`
      : args.sales.length === 0
        ? `<p class="wm-sales-empty">${esc(t('hudChrome.wocMarket.sellerEmpty'))}</p>`
        : `<ul class="wm-sales">${args.sales
            .map(
              (s) =>
                `<li>${esc(
                  t('hudChrome.wocMarket.sellerSaleRow', {
                    time: formatDateTime(s.atMs, { dateStyle: 'medium' }),
                    item: s.itemName,
                    buyer: s.buyerName,
                    usd: s.usdText,
                  }),
                )}</li>`,
            )
            .join('')}</ul>`;
  // The classic `<Guild>` tag (the shared builder) rides the title line beside
  // the name, the one profile fact the world already shows. The character
  // creation date was dropped as an unspecced account-age disclosure.
  return (
    `<div class="wm-seller-pane">` +
    `<button type="button" data-action="seller-back" ${FOCUS_KEY_ATTR}="wm-seller-back">${esc(
      t('hudChrome.wocMarket.sellerBack'),
    )}</button>` +
    `<h3>${esc(t('hudChrome.wocMarket.sellerTitle', { name: args.name }))}${guildTagHtml(
      args.profile?.guildName,
      'wm-seller-guild',
    )}</h3>` +
    body +
    `</div>`
  );
}

/**
 * The pending-quote face: the resolved title, the token legs (the total at
 * full weight, the fee legs named), the expiry countdown or the expired
 * face, the settlement deadline when one applies, the fixed-amount note,
 * and the three actions. The caller resolves the title and computes
 * remainingMs (this module holds no clock); a null leg renders nothing.
 */
export function wocQuoteFaceHtml(args: {
  title: string;
  amountTokens: string | null;
  sellerTokens: string | null;
  burnTokens: string | null;
  treasuryTokens: string | null;
  remainingMs: number;
  dueAtMs: number | null;
  busy: boolean;
}): string {
  const expired = args.remainingMs <= 0;
  const legs =
    (args.amountTokens === null
      ? ''
      : `<p class="wm-quote-total">${esc(t('hudChrome.wocMarket.quoteTotal', { tokens: args.amountTokens }))}</p>`) +
    (args.sellerTokens === null
      ? ''
      : `<p>${esc(t('hudChrome.wocMarket.quoteSeller', { tokens: args.sellerTokens }))}</p>`) +
    (args.burnTokens === null
      ? ''
      : `<p>${esc(t('hudChrome.wocMarket.quoteBurn', { tokens: args.burnTokens }))}</p>`) +
    (args.treasuryTokens === null
      ? ''
      : `<p>${esc(t('hudChrome.wocMarket.quoteTreasury', { tokens: args.treasuryTokens }))}</p>`);
  const countdown = expired
    ? `<p class="wm-quote-expired">${svgIcon('alert')}<span>${esc(t('hudChrome.wocMarket.quoteExpired'))}</span></p>`
    : `<p>${esc(t('hudChrome.wocMarket.quoteExpires', { duration: formatDuration(Math.ceil(args.remainingMs / 1000)) }))}</p>`;
  const dueLine =
    args.dueAtMs === null
      ? ''
      : `<p class="wm-note">${esc(
          t('hudChrome.wocMarket.paymentDueAt', {
            time: formatDateTime(args.dueAtMs, { timeStyle: 'short' }),
          }),
        )}</p>`;
  return (
    `<div class="wm-quote"><h3>${esc(t('hudChrome.wocMarket.quoteTitle'))}</h3>` +
    `<p>${esc(args.title)}</p>${legs}${countdown}${dueLine}` +
    `<p class="wm-note">${esc(t('hudChrome.wocMarket.quoteFixedNote'))}</p>` +
    `<div class="wm-quote-actions">` +
    `<button type="button" class="wm-primary" data-action="quote-sign" ${expired || args.busy ? 'disabled' : ''} ${FOCUS_KEY_ATTR}="wm-quote-sign">${esc(
      t('hudChrome.wocMarket.quoteSign'),
    )}</button>` +
    `<button type="button" data-action="quote-refresh" ${args.busy ? 'disabled' : ''} ${FOCUS_KEY_ATTR}="wm-quote-refresh">${esc(
      t('hudChrome.wocMarket.quoteRefresh'),
    )}</button>` +
    `<button type="button" data-action="quote-cancel" ${args.busy ? 'disabled' : ''} ${FOCUS_KEY_ATTR}="wm-quote-cancel">${esc(
      t('hudChrome.wocMarket.quoteCancel'),
    )}</button></div></div>`
  );
}

/**
 * The detail pane's recent-sales list. Null sales means the history round
 * trip is still out: 'still loading', never 'no recorded sales', which
 * would assert what the client does not know.
 */
export function wocSalesHistoryHtml(
  sales:
    | readonly { atMs: number; priceCents: number; sellerName: string; buyerName: string }[]
    | null,
  usd: (cents: number) => string,
): string {
  if (sales === null) {
    return `<p class="wm-sales-empty">${esc(t('hudChrome.wocMarket.detailSalesLoading'))}</p>`;
  }
  if (sales.length === 0) {
    return `<p class="wm-sales-empty">${esc(t('hudChrome.wocMarket.detailNoSales'))}</p>`;
  }
  return `<ul class="wm-sales">${sales
    .map(
      (s) =>
        `<li>${esc(
          t('hudChrome.wocMarket.detailSaleRow', {
            time: formatDateTime(s.atMs, { dateStyle: 'medium' }),
            usd: usd(s.priceCents),
            seller: s.sellerName,
            buyer: s.buyerName,
          }),
        )}</li>`,
    )
    .join('')}</ul>`;
}
