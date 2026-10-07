import { GAME_SUBSCRIPTION_PLANS, type SubscriptionSnapshot } from '../subscription_contract';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { formatNumber, t } from './i18n';
import { usdText } from './usd_text';

export function subscriptionOffersHtml(
  state: SubscriptionSnapshot,
  busy: boolean,
  pendingAnnual: boolean,
  deliveredAnnual: boolean,
  pendingMonthly = false,
  canDiscoverAnnual = false,
): string {
  const modern = state.plans !== undefined;
  const recoverable = ['none', 'incomplete'].includes(state.status);
  const offers =
    state.canCheckout || (recoverable && (pendingAnnual || pendingMonthly))
      ? (state.plans ?? [GAME_SUBSCRIPTION_PLANS.game_monthly])
      : [GAME_SUBSCRIPTION_PLANS[state.plan ?? 'game_monthly']];
  const cards = offers
    .map((offer) => {
      const annual = offer.plan === 'game_annual';
      const price = usdText(offer.price.unitAmount);
      const resume = recoverable && (annual ? pendingAnnual : pendingMonthly);
      const checkout = state.canCheckout || resume;
      return (
        `<div data-subscription-plan="${offer.plan}"><h3>${esc(t(annual ? 'hudChrome.wocStore.subscription.annualTitle' : 'hudChrome.wocStore.subscription.monthlyTitle'))}</h3>` +
        `<p>${esc(t(annual ? 'hudChrome.wocStore.subscription.annualPrice' : 'hudChrome.wocStore.subscription.price', { price }))}</p>` +
        `<p>${esc(t(annual ? 'hudChrome.wocStore.subscription.annualTerms' : 'hudChrome.wocStore.subscription.terms'))}</p>` +
        (modern
          ? `<p>${esc(t('hudChrome.wocStore.subscription.paidReward', { amount: formatNumber(offer.claudium), value: usdText(offer.claudium) }))}</p>`
          : '') +
        (annual ? `<p>${esc(t('hudChrome.wocStore.subscription.annualMount'))}</p>` : '') +
        (state.canCheckout && state.trialEligible
          ? `<p>${esc(t('hudChrome.wocStore.subscription.trialTerms', { days: formatNumber(state.trialDays ?? 7), price }))}</p>`
          : '') +
        (checkout
          ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-action="checkout" data-subscription-checkout-plan="${offer.plan}"${focusKeyAttr(`subscription-${offer.plan}`)}${busy ? ' disabled' : ''}>${esc(t(resume ? 'hudChrome.wocStore.subscription.resumeCheckout' : state.trialEligible ? 'hudChrome.wocStore.subscription.startTrial' : 'hudChrome.wocStore.subscription.subscribe'))}</button>`
          : '') +
        '</div>'
      );
    })
    .join('');
  return (
    `<section class="ui-card" data-subscription-section><div class="charter-body"><h2 class="ui-h">${esc(t('hudChrome.wocStore.subscription.title'))}</h2>${cards}` +
    `<p>${esc(t(state.cancelAtPeriodEnd ? 'hudChrome.wocStore.subscription.ending' : `hudChrome.wocStore.subscription.status.${state.status}`))}</p>` +
    (state.canManage
      ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-action="portal"${focusKeyAttr('subscription-manage')}${busy ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.manage'))}</button>`
      : '') +
    (pendingAnnual || canDiscoverAnnual
      ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-mount-claim${focusKeyAttr('subscription-mount-claim')}${busy || deliveredAnnual ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.annualClaim'))}</button>`
      : '') +
    `<p data-subscription-mount-status role="status">${deliveredAnnual ? esc(t('hudChrome.wocStore.subscription.annualDelivered')) : pendingAnnual ? esc(t('hudChrome.wocStore.subscription.annualPending')) : ''}</p>` +
    `<p data-subscription-error role="status"></p></div></section>`
  );
}
