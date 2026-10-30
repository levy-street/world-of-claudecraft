import {
  GAME_SUBSCRIPTION_PLANS,
  type GameSubscriptionPlan,
  type SubscriptionOffer,
  type SubscriptionSnapshot,
} from '../subscription_contract';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatDateTime, formatNumber, t } from './i18n';
import { usdText } from './usd_text';

/** Every membership grants the same benefits; the badges list them under each price. */
export const MEMBERSHIP_BENEFIT_KEYS = [
  'benefitBank',
  'benefitSlots',
  'benefitArmour',
  'benefitBag',
  'benefitTax',
] as const;

const PLAN_MONTHS: Record<GameSubscriptionPlan, number> = { game_monthly: 1, game_annual: 12 };

/** Calendar months in UTC, in unix seconds. The service owns the real end date and the cap;
 *  this only predicts whether the purchase would pass the advertised limit. */
export function addMonthsSeconds(seconds: number, months: number): number {
  const date = new Date(seconds * 1000);
  date.setUTCMonth(date.getUTCMonth() + months);
  return Math.floor(date.getTime() / 1000);
}

/** Whether adding this plan's period would carry the membership past the stacking limit. */
export function stackWouldPassLimit(
  state: SubscriptionSnapshot,
  plan: GameSubscriptionPlan,
  nowSeconds: number,
): boolean {
  if (typeof state.stackLimit !== 'number') return false;
  const from = Math.max(nowSeconds, state.currentPeriodEnd ?? 0);
  return addMonthsSeconds(from, PLAN_MONTHS[plan]) > state.stackLimit;
}

/** Which purchase a plan badge offers right now. */
export function subscriptionPurchase(
  state: SubscriptionSnapshot,
  plan: GameSubscriptionPlan,
  nowSeconds: number,
): 'new' | 'stack' | 'capped' | 'unavailable' | 'billing' | 'pending' {
  if (state.canCheckout) return 'new';
  if (state.canStack === true)
    return stackWouldPassLimit(state, plan, nowSeconds) ? 'capped' : 'stack';
  if (['none', 'canceled', 'incomplete_expired'].includes(state.status)) return 'pending';
  return ['past_due', 'unpaid', 'incomplete'].includes(state.status) ? 'billing' : 'unavailable';
}

interface BadgeParts {
  id: string;
  title: string;
  price: string;
  lines: string[];
  benefits: readonly string[];
  action: string;
  current?: boolean;
}

export function membershipBadgeHtml(badge: BadgeParts): string {
  return (
    `<article class="membership-badge${badge.current ? ' membership-badge--current' : ''}" data-membership-badge="${badge.id}">` +
    `<header class="membership-badge-head"><h3>${esc(badge.title)}</h3><p class="membership-badge-price">${esc(badge.price)}</p></header>` +
    badge.lines.map((line) => `<p>${esc(line)}</p>`).join('') +
    (badge.benefits.length
      ? `<h4>${esc(t('hudChrome.wocStore.subscription.benefitsTitle'))}</h4><ul class="membership-badge-benefits">${badge.benefits.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
      : '') +
    `<div class="membership-badge-action">${badge.action}</div></article>`
  );
}

export function membershipBenefits(): string[] {
  return MEMBERSHIP_BENEFIT_KEYS.map((key) => t(`hudChrome.wocStore.subscription.${key}`));
}

function planBadgeHtml(
  offer: SubscriptionOffer,
  state: SubscriptionSnapshot,
  busy: boolean,
  nowSeconds: number,
): string {
  const annual = offer.plan === 'game_annual';
  const price = usdText(offer.price.unitAmount);
  const purchase = subscriptionPurchase(state, offer.plan, nowSeconds);
  const lines = [
    t(
      annual
        ? 'hudChrome.wocStore.subscription.annualTerms'
        : 'hudChrome.wocStore.subscription.terms',
    ),
  ];
  if (purchase === 'new' && state.trialEligible)
    lines.push(
      t('hudChrome.wocStore.subscription.trialTerms', {
        days: formatNumber(state.trialDays ?? 7),
        price,
      }),
    );
  const benefits = membershipBenefits();
  if (annual) benefits.push(t('hudChrome.wocStore.subscription.annualMount'));
  let action = '';
  if (purchase === 'new' || purchase === 'stack' || purchase === 'capped') {
    const label =
      purchase === 'new'
        ? state.trialEligible
          ? 'hudChrome.wocStore.subscription.startTrial'
          : 'hudChrome.wocStore.subscription.subscribe'
        : annual
          ? 'hudChrome.wocStore.subscription.addYear'
          : 'hudChrome.wocStore.subscription.addMonth';
    action = `<button type="button" class="ui-btn ui-btn--lg" data-subscription-action="checkout" data-subscription-checkout-plan="${offer.plan}"${focusKeyAttr(`subscription-${offer.plan}`)}${busy || purchase === 'capped' ? ' disabled' : ''}>${esc(t(label))}</button>`;
  }
  const note =
    purchase === 'stack'
      ? 'hudChrome.wocStore.subscription.stackTerms'
      : purchase === 'capped'
        ? 'hudChrome.wocStore.subscription.stackCapped'
        : purchase === 'unavailable'
          ? 'hudChrome.wocStore.subscription.stackUnavailable'
          : purchase === 'billing'
            ? 'hudChrome.wocStore.subscription.billingBlocked'
            : purchase === 'pending'
              ? 'hudChrome.wocStore.subscription.checkoutPending'
              : null;
  if (note) action += `<p class="membership-badge-note">${esc(t(note))}</p>`;
  return membershipBadgeHtml({
    id: offer.plan,
    title: t(
      annual
        ? 'hudChrome.wocStore.subscription.annualTitle'
        : 'hudChrome.wocStore.subscription.monthlyTitle',
    ),
    price: t(
      annual
        ? 'hudChrome.wocStore.subscription.annualPrice'
        : 'hudChrome.wocStore.subscription.price',
      { price },
    ),
    lines,
    benefits,
    action,
    current:
      ['active', 'trialing', 'past_due'].includes(state.status) &&
      (state.plan ?? 'game_monthly') === offer.plan,
  });
}

function statusLine(state: SubscriptionSnapshot): string {
  const end = state.currentPeriodEnd;
  if (end !== null && ['active', 'trialing'].includes(state.status)) {
    const date = formatDateTime(end * 1000, { dateStyle: 'medium' });
    return t(
      state.cancelAtPeriodEnd
        ? 'hudChrome.wocStore.subscription.endsOn'
        : 'hudChrome.wocStore.subscription.renewsOn',
      { date },
    );
  }
  return t(
    state.cancelAtPeriodEnd
      ? 'hudChrome.wocStore.subscription.ending'
      : `hudChrome.wocStore.subscription.status.${state.status}`,
  );
}

/** The Memberships tab: one badge per plan (plus the token badge the caller owns), then the
 *  account's membership status, billing management and the annual mount collection. */
export function subscriptionOffersHtml(
  state: SubscriptionSnapshot,
  busy: boolean,
  pendingAnnual: boolean,
  deliveredAnnual: boolean,
  canDiscoverAnnual: boolean,
  tokenBadge: string,
  nowSeconds: number,
): string {
  const offers = state.plans ?? [GAME_SUBSCRIPTION_PLANS.game_monthly];
  const badges = offers.map((offer) => planBadgeHtml(offer, state, busy, nowSeconds)).join('');
  const status =
    subscriptionPurchase(state, state.plan ?? 'game_monthly', nowSeconds) === 'pending'
      ? t('hudChrome.wocStore.subscription.checkoutPending')
      : t(`hudChrome.wocStore.subscription.status.${state.status}`);
  return (
    `<div class="membership-badges" data-subscription-section>${badges}${tokenBadge}</div>` +
    `<section class="ui-card membership-status" data-membership-status><div class="charter-body"><h2 class="ui-h">${esc(t('hudChrome.wocStore.subscription.title'))}</h2>` +
    `<p data-membership-summary>${esc(status)}</p>` +
    (['active', 'trialing'].includes(state.status) || state.cancelAtPeriodEnd
      ? `<p>${esc(statusLine(state))}</p>`
      : '') +
    (state.canManage
      ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-action="portal"${focusKeyAttr('subscription-manage')}${busy ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.manage'))}</button>`
      : '') +
    (pendingAnnual || canDiscoverAnnual
      ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-mount-claim${focusKeyAttr('subscription-mount-claim')}${busy || deliveredAnnual ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.annualClaim'))}</button>`
      : '') +
    `<p data-subscription-mount-status role="status">${deliveredAnnual ? esc(t('hudChrome.wocStore.subscription.annualDelivered')) : pendingAnnual ? esc(t('hudChrome.wocStore.subscription.annualPending')) : ''}</p>` +
    `<p>${esc(t('hudChrome.wocStore.subscription.benefitExpiry'))}</p>` +
    `<p data-subscription-error role="status"></p></div></section>`
  );
}
