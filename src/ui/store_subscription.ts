import { DESKTOP_APP } from '../client_origin';
import { MEMBERSHIP_TOKEN_OFF } from '../membership_token_contract';
import {
  isGameSubscriptionPlan,
  SUBSCRIPTION_OFF,
  type SubscriptionStoreHooks,
  subscriptionLink,
} from '../subscription_contract';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { t } from './i18n';
import { mintIntentKey } from './purchase_intent_key';
import { subscriptionOffersHtml } from './store_subscription_offers';
import { SubscriptionCheckoutIntents } from './subscription_checkout_intents';
import { usdText } from './usd_text';

/** Cold store section. Status refreshes on user entry/refresh, never the store polling timer. */
export class StoreSubscription {
  private state = { ...SUBSCRIPTION_OFF };
  private tokenState = { ...MEMBERSHIP_TOKEN_OFF };
  private tokenKey = this.savedTokenKey();
  private savedTokenKey(): string {
    try {
      return localStorage.getItem('woc.membership-token.pending') || mintIntentKey();
    } catch {
      return mintIntentKey();
    }
  }
  private flight: Promise<void> | null = null;
  private busy = false;
  private owner: SubscriptionStoreHooks | undefined;
  private readonly intents = new SubscriptionCheckoutIntents({
    read: (key) => localStorage.getItem(key),
    write: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
    mint: mintIntentKey,
  });
  private annualDelivered = false;
  constructor(private readonly hooks: () => SubscriptionStoreHooks | undefined) {}

  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = Promise.resolve()
      .then(async () => {
        const hooks = this.hooks();
        const [state, tokenState] = await Promise.all([
          hooks?.snapshot() ?? Promise.resolve({ ...SUBSCRIPTION_OFF }),
          hooks?.tokenOffer?.() ?? Promise.resolve({ ...MEMBERSHIP_TOKEN_OFF }),
        ]);
        if (hooks !== this.hooks()) return;
        const ownerChanged = this.owner !== hooks;
        if (ownerChanged || this.state.accountId !== state.accountId) this.annualDelivered = false;
        this.intents.scope(state.accountId, ownerChanged && state.accountId === undefined);
        this.owner = hooks;
        this.state = state;
        this.tokenState = tokenState;
        if (state.available && ['active', 'trialing'].includes(state.status))
          this.intents.complete('game_monthly');
        // Return/reload only retries reward delivery; it never creates a paid checkout.
        if (state.available && this.intents.pending('game_annual') && hooks?.annualMountClaim)
          await this.collectAnnual(hooks).catch(() => false);
      })
      .catch(() => {
        this.state = { ...SUBSCRIPTION_OFF };
        this.tokenState = { ...MEMBERSHIP_TOKEN_OFF };
      })
      .finally(() => {
        this.flight = null;
      });
    return this.flight;
  }

  html(): string {
    if (this.owner !== this.hooks()) return '';
    if (!this.state.available)
      return this.tokenState.available ? this.benefitsHtml() + this.tokenHtml() : '';
    return (
      subscriptionOffersHtml(
        this.state,
        this.busy,
        this.intents.pending('game_annual'),
        this.annualDelivered,
        this.intents.pending('game_monthly'),
        !!this.hooks()?.annualMountClaim &&
          (this.state.canManage || this.state.plan === 'game_annual'),
      ) +
      this.benefitsHtml() +
      this.tokenHtml()
    );
  }

  bind(body: HTMLElement): void {
    this.bindToken(body);
    this.bindAnnual(body);
    for (const button of body.querySelectorAll<HTMLButtonElement>('[data-subscription-action]')) {
      button.onclick = async () => {
        if (this.busy) return;
        const hooks = this.hooks();
        const action = button.dataset.subscriptionAction === 'portal' ? 'portal' : 'checkout';
        if (!hooks || hooks !== this.owner) return;
        this.busy = true;
        button.disabled = true;
        // Reserve a tab during the gesture so async checkout creation is not popup-blocked.
        const tab = DESKTOP_APP ? null : window.open('about:blank', '_blank');
        if (tab) tab.opener = null;
        try {
          if (!DESKTOP_APP && !tab) throw new Error('popup blocked');
          const requested = button.dataset.subscriptionCheckoutPlan;
          const plan =
            action === 'checkout' && isGameSubscriptionPlan(requested)
              ? requested
              : (this.state.plan ?? 'game_monthly');
          const resume =
            ['none', 'incomplete'].includes(this.state.status) && this.intents.pending(plan);
          if (
            action === 'checkout' &&
            ((!this.state.canCheckout && !resume) ||
              !(this.state.plans ?? [{ plan: 'game_monthly' }]).some(
                (offer) => offer.plan === plan,
              ))
          )
            throw new Error('plan unavailable');
          const accountId = this.state.accountId;
          const key = action === 'checkout' ? this.intents.start(plan) : mintIntentKey();
          const result = subscriptionLink(await hooks.link(action, key, plan), action);
          if (hooks !== this.hooks() || accountId !== this.state.accountId)
            throw new Error('account changed');
          if (result.retryWithNewKey && action === 'checkout' && this.intents.key(plan) === key) {
            this.intents.complete(plan);
            tab?.close();
            await this.refresh();
            const error = body.querySelector<HTMLElement>('[data-subscription-error]');
            if (error && hooks === this.hooks())
              error.textContent = t('hudChrome.wocStore.subscription.checkoutClosed');
            return;
          }
          if (!result.ok || !result.url) throw new Error('subscription unavailable');
          // Electron denies BrowserWindows and sends HTTPS links to the system browser.
          if (DESKTOP_APP) window.open(result.url, '_blank', 'noopener,noreferrer');
          else tab?.location.replace(result.url);
        } catch {
          tab?.close();
          const error = body.querySelector<HTMLElement>('[data-subscription-error]');
          if (error) error.textContent = t('hudChrome.wocStore.subscription.error');
        } finally {
          this.busy = false;
          button.disabled = false;
          if (hooks === this.hooks()) {
            for (const current of body.querySelectorAll<HTMLButtonElement>(
              '[data-subscription-action]',
            ))
              current.disabled = false;
          }
        }
      };
    }
  }
  private async collectAnnual(hooks: SubscriptionStoreHooks): Promise<boolean> {
    const accountId = this.state.accountId;
    const key = this.intents.pending('game_annual') ? this.intents.key('game_annual') : undefined;
    const delivered = (await hooks.annualMountClaim?.(key))?.delivered === true;
    if (delivered && hooks === this.hooks() && accountId === this.state.accountId) {
      if (key !== undefined && this.intents.key('game_annual') === key)
        this.intents.complete('game_annual');
      this.annualDelivered = true;
      return true;
    }
    return false;
  }
  private bindAnnual(body: HTMLElement): void {
    const button = body.querySelector<HTMLButtonElement>('[data-subscription-mount-claim]');
    if (!button) return;
    button.onclick = async () => {
      const hooks = this.hooks();
      if (this.busy || !hooks?.annualMountClaim || hooks !== this.owner) return;
      this.busy = true;
      button.disabled = true;
      try {
        await this.collectAnnual(hooks);
      } catch {
        /* Keep the pending intent and offer an explicit retry. */
      } finally {
        this.busy = false;
        if (hooks === this.hooks()) {
          const current = body.querySelector<HTMLButtonElement>('[data-subscription-mount-claim]');
          if (current) current.disabled = this.annualDelivered;
          const status = body.querySelector<HTMLElement>('[data-subscription-mount-status]');
          if (status)
            status.textContent = t(
              this.annualDelivered
                ? 'hudChrome.wocStore.subscription.annualDelivered'
                : 'hudChrome.wocStore.subscription.annualPending',
            );
        }
      }
    };
  }
  private benefitsHtml(): string {
    return `<section class="ui-card" data-membership-benefits><div class="charter-body"><h2 class="ui-h">${esc(t('hudChrome.wocStore.subscription.benefitsTitle'))}</h2><ul>${(['benefitBank', 'benefitSlots', 'benefitArmour', 'benefitTax'] as const).map((key) => `<li>${esc(t(`hudChrome.wocStore.subscription.${key}`))}</li>`).join('')}</ul><p>${esc(t('hudChrome.wocStore.subscription.benefitExpiry'))}</p></div></section>`;
  }

  private tokenHtml(): string {
    if (!this.tokenState.available) return '';
    return (
      `<section class="ui-card membership-token-card" data-membership-token-section><div class="charter-body"><h2 class="ui-h">${esc(t('hudChrome.wocStore.subscription.tokenTitle'))}</h2>` +
      `<p>${esc(t('hudChrome.wocStore.subscription.tokenTerms', { price: usdText(this.tokenState.price.unitAmount) }))}</p>` +
      `<button type="button" class="ui-btn ui-btn--lg" data-membership-purchase-action="buy"${focusKeyAttr('membership-token-buy')}${this.busy || !this.tokenState.canCheckout ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.tokenBuy'))}</button> ` +
      `<button type="button" class="ui-btn ui-btn--lg" data-membership-purchase-action="claim"${focusKeyAttr('membership-token-claim')}${this.busy ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.tokenClaim'))}</button>` +
      `<p data-membership-token-status role="status"></p></div></section>`
    );
  }

  private bindToken(body: HTMLElement): void {
    for (const button of body.querySelectorAll<HTMLButtonElement>(
      '[data-membership-purchase-action]',
    )) {
      button.onclick = async () => {
        const hooks = this.hooks();
        if (this.busy || !hooks || hooks !== this.owner) return;
        const buying = button.dataset.membershipPurchaseAction === 'buy';
        if (buying && (!hooks.tokenCheckout || !this.tokenState.canCheckout)) return;
        this.busy = true;
        const disable = (busy: boolean) => {
          for (const control of body.querySelectorAll<HTMLButtonElement>(
            '[data-membership-purchase-action]',
          ))
            control.disabled =
              busy ||
              (control.dataset.membershipPurchaseAction === 'buy' && !this.tokenState.canCheckout);
        };
        disable(true);
        const tab = buying && !DESKTOP_APP ? window.open('about:blank', '_blank') : null;
        if (tab) tab.opener = null;
        let message:
          | 'hudChrome.wocStore.subscription.tokenPending'
          | 'hudChrome.wocStore.subscription.tokenDelivered'
          | 'hudChrome.wocStore.subscription.error' =
          'hudChrome.wocStore.subscription.tokenPending';
        try {
          if (buying) {
            if (!DESKTOP_APP && !tab) throw new Error('popup blocked');
            try {
              localStorage.setItem('woc.membership-token.pending', this.tokenKey);
            } catch {
              /* Storage unavailable. */
            }
            const result = subscriptionLink(await hooks.tokenCheckout!(this.tokenKey), 'checkout');
            if (hooks !== this.hooks() || !result.ok || !result.url)
              throw new Error('token checkout unavailable');
            if (DESKTOP_APP) window.open(result.url, '_blank', 'noopener,noreferrer');
            else tab?.location.replace(result.url);
          } else if (
            (await hooks.tokenClaim?.(this.tokenKey))?.delivered &&
            hooks === this.hooks()
          ) {
            message = 'hudChrome.wocStore.subscription.tokenDelivered';
            this.tokenKey = mintIntentKey();
            try {
              localStorage.removeItem('woc.membership-token.pending');
            } catch {
              /* Storage unavailable. */
            }
          }
        } catch {
          tab?.close();
          message = 'hudChrome.wocStore.subscription.error';
        } finally {
          this.busy = false;
          if (hooks === this.hooks()) {
            disable(false);
            const status = body.querySelector<HTMLElement>('[data-membership-token-status]');
            if (status) status.textContent = t(message);
          }
        }
      };
    }
  }
}
