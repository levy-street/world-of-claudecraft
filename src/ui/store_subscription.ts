import { DESKTOP_APP } from '../client_origin';
import { MEMBERSHIP_TOKEN_OFF } from '../membership_token_contract';
import { openStripeCheckout } from '../net/stripe_checkout';
import {
  type GameSubscriptionPlan,
  isGameSubscriptionPlan,
  SUBSCRIPTION_OFF,
  type SubscriptionLink,
  type SubscriptionSnapshot,
  type SubscriptionStoreHooks,
  subscriptionLink,
} from '../subscription_contract';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { t } from './i18n';
import { mintIntentKey } from './purchase_intent_key';
import { showMembershipWelcome } from './purchase_reward_dialogs';
import {
  membershipBadgeHtml,
  membershipBenefits,
  subscriptionOffersHtml,
  subscriptionPurchase,
} from './store_subscription_offers';
import { SubscriptionCheckoutIntents } from './subscription_checkout_intents';
import { usdText } from './usd_text';

/** Claim retries after an embedded checkout completes, while Stripe webhooks settle. */
export const REWARD_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 40_000] as const;

/** Store section with full entry reads and a status-only background refresh. */
export class StoreSubscription {
  private state: SubscriptionSnapshot = { ...SUBSCRIPTION_OFF };
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
  private flightStatusOnly = false;
  private entryRefresh: Promise<void> | null = null;
  private busy = false;
  private owner: SubscriptionStoreHooks | undefined;
  private readonly intents = new SubscriptionCheckoutIntents({
    read: (key) => localStorage.getItem(key),
    write: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
    mint: mintIntentKey,
  });
  private annualDelivered = false;
  /** Annual members whose owed reward was already looked up by this panel. */
  private annualChecked = new Set<number | undefined>();
  /** Repaints the store once an embedded checkout completes (webhooks settle shortly after). */
  private checkoutCompleted: () => void = () => {};
  constructor(private readonly hooks: () => SubscriptionStoreHooks | undefined) {}

  get refreshBlocked(): boolean {
    return (
      this.busy ||
      this.flight !== null ||
      document.getElementById('stripe-checkout-overlay') !== null
    );
  }

  /** Embedded Checkout mounts in the game like a Claudium top-up, so no tab or popup is
   *  needed. A hosted link (a service without embedding) still opens a tab. */
  private async openCheckout(
    result: SubscriptionLink,
    onPaid: () => void = () => {},
  ): Promise<void> {
    if (result.stripe) {
      const owner = this.hooks();
      const accountId = this.state.accountId;
      const completed = () => {
        if (owner === this.hooks() && accountId === this.state.accountId) this.checkoutCompleted();
      };
      await openStripeCheckout(
        result.stripe,
        {
          title: t('hudChrome.claudium.checkoutTitle'),
          close: t('hudChrome.claudium.checkoutClose'),
          loading: t('hudChrome.claudium.checkoutLoading'),
          failed: t('hudChrome.claudium.checkoutFailed'),
        },
        {
          onComplete: () => {
            completed();
            window.setTimeout(completed, 4000);
            if (owner === this.hooks() && accountId === this.state.accountId) onPaid();
          },
        },
      );
      return;
    }
    if (!result.url) throw new Error('checkout unavailable');
    // Electron denies BrowserWindows and sends HTTPS links to the system browser.
    if (DESKTOP_APP) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const tab = window.open(result.url, '_blank');
    if (!tab) throw new Error('popup blocked');
    tab.opener = null;
  }

  refresh(statusOnly = false): Promise<void> {
    if (this.flight) {
      // A foreground entry must still fetch offers and deliver rewards when it
      // arrives during a cheaper status-only read. Coalesce repeated entries.
      if (!statusOnly && this.flightStatusOnly) {
        this.entryRefresh ??= this.flight
          .then(() => this.refresh())
          .finally(() => {
            this.entryRefresh = null;
          });
        return this.entryRefresh;
      }
      return this.flight;
    }
    if (statusOnly && this.busy) return Promise.resolve();
    const hooks = this.hooks();
    this.flightStatusOnly = statusOnly;
    this.flight = Promise.resolve()
      .then(async () => {
        const [state, tokenState] = await Promise.all([
          hooks?.snapshot() ?? Promise.resolve({ ...SUBSCRIPTION_OFF }),
          statusOnly
            ? Promise.resolve(this.tokenState)
            : (hooks?.tokenOffer?.() ?? Promise.resolve({ ...MEMBERSHIP_TOKEN_OFF })),
        ]);
        if (hooks !== this.hooks()) return;
        // A transient failed read must not erase a confirmed membership, and a
        // poll started before a purchase must not replace its in-flight state.
        if (statusOnly && (!state.available || this.busy)) return;
        const ownerChanged = this.owner !== hooks;
        const accountChanged = ownerChanged || this.state.accountId !== state.accountId;
        if (accountChanged) this.annualDelivered = false;
        this.intents.scope(state.accountId, ownerChanged && state.accountId === undefined);
        this.owner = hooks;
        this.state = state;
        this.tokenState = statusOnly && accountChanged ? { ...MEMBERSHIP_TOKEN_OFF } : tokenState;
        if (state.available && ['active', 'trialing'].includes(state.status))
          this.intents.complete('game_monthly');
        // Return/reload only retries reward delivery; it never creates a paid checkout.
        // Rewards arrive in a loot window (purchase_reward_dialogs.ts), so there is no
        // collect button: a paid purchase retries on every store entry until it delivers,
        // and an annual member's reward bought on another device is looked up once.
        if (!statusOnly && state.available && hooks?.annualMountClaim) {
          if (this.intents.pending('game_annual'))
            await this.collectAnnual(hooks).catch(() => false);
          else if (state.plan === 'game_annual' && !this.annualChecked.has(state.accountId)) {
            await hooks
              .annualMountClaim()
              .then(() => this.annualChecked.add(state.accountId))
              .catch(() => {});
          }
        }
        if (!statusOnly && this.tokenPending() && hooks?.tokenClaim)
          await this.claimToken(hooks).catch(() => false);
      })
      .catch(() => {
        if (statusOnly || hooks !== this.hooks()) return;
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
      return this.tokenState.available
        ? `<div class="membership-badges">${this.tokenHtml()}</div>`
        : '';
    return subscriptionOffersHtml(
      this.state,
      this.busy,
      this.intents.pending('game_annual'),
      this.annualDelivered,
      this.tokenHtml(),
      Math.floor(Date.now() / 1000),
    );
  }

  bind(body: HTMLElement, repaint: () => void = () => {}): void {
    this.checkoutCompleted = repaint;
    this.bindToken(body);
    for (const button of body.querySelectorAll<HTMLButtonElement>('[data-subscription-action]')) {
      button.onclick = async () => {
        if (this.busy) return;
        const hooks = this.hooks();
        const action = button.dataset.subscriptionAction === 'portal' ? 'portal' : 'checkout';
        if (!hooks || hooks !== this.owner) return;
        this.busy = true;
        button.disabled = true;
        // Checkout is embedded in the game. The portal is Stripe-hosted only, so reserve its
        // tab during the gesture to keep async link creation from being popup-blocked.
        const tab =
          DESKTOP_APP || action === 'checkout' ? null : window.open('about:blank', '_blank');
        if (tab) tab.opener = null;
        try {
          if (action === 'portal' && !DESKTOP_APP && !tab) throw new Error('popup blocked');
          const requested = button.dataset.subscriptionCheckoutPlan;
          const plan =
            action === 'checkout' && isGameSubscriptionPlan(requested)
              ? requested
              : (this.state.plan ?? 'game_monthly');
          const purchase = subscriptionPurchase(this.state, plan, Math.floor(Date.now() / 1000));
          if (
            action === 'checkout' &&
            ((purchase !== 'new' && purchase !== 'stack') ||
              !(this.state.plans ?? [{ plan: 'game_monthly' }]).some(
                (offer) => offer.plan === plan,
              ))
          )
            throw new Error('plan unavailable');
          const accountId = this.state.accountId;
          // Every click is a new checkout: retire any earlier attempt's key first.
          if (action === 'checkout') this.intents.complete(plan);
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
          if (!result.ok) throw new Error('subscription unavailable');
          if (action === 'checkout')
            await this.openCheckout(result, () => this.afterMembershipCheckout(hooks, plan));
          else if (!result.url) throw new Error('subscription unavailable');
          // Electron denies BrowserWindows and sends HTTPS links to the system browser.
          else if (DESKTOP_APP) window.open(result.url, '_blank', 'noopener,noreferrer');
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
  /** A paid (or trial-started) membership checkout: congratulate, then poll for the
   *  annual reward while the payment settles. Delivery opens the loot window. */
  private afterMembershipCheckout(hooks: SubscriptionStoreHooks, plan: GameSubscriptionPlan): void {
    showMembershipWelcome(null);
    if (plan === 'game_annual' && hooks.annualMountClaim)
      this.retryDelivery(hooks, () => this.collectAnnual(hooks));
  }

  /** Retries a reward claim while webhooks settle, until it delivers or the account changes. */
  private retryDelivery(hooks: SubscriptionStoreHooks, attempt: () => Promise<boolean>): void {
    const accountId = this.state.accountId;
    const delays = [...REWARD_RETRY_MS];
    const next = (): void => {
      const delay = delays.shift();
      if (delay === undefined) return;
      window.setTimeout(async () => {
        if (hooks !== this.hooks() || accountId !== this.state.accountId) return;
        const delivered = await attempt().catch(() => false);
        if (delivered) this.checkoutCompleted();
        else next();
      }, delay);
    };
    next();
  }

  private tokenPending(): boolean {
    try {
      return localStorage.getItem('woc.membership-token.pending') === this.tokenKey;
    } catch {
      return false;
    }
  }

  /** Claims the paid token for this intent; delivery opens the loot window in game. */
  private async claimToken(hooks: SubscriptionStoreHooks): Promise<boolean> {
    const key = this.tokenKey;
    if (!(await hooks.tokenClaim?.(key))?.delivered || hooks !== this.hooks()) return false;
    if (this.tokenKey === key) {
      this.tokenKey = mintIntentKey();
      try {
        localStorage.removeItem('woc.membership-token.pending');
      } catch {
        /* Storage unavailable. */
      }
    }
    return true;
  }

  private tokenHtml(): string {
    if (!this.tokenState.available) return '';
    const price = usdText(this.tokenState.price.unitAmount);
    return membershipBadgeHtml({
      id: 'membership_token',
      title: t('hudChrome.wocStore.subscription.tokenTitle'),
      price: t('hudChrome.wocStore.subscription.tokenPrice', { price }),
      lines: [t('hudChrome.wocStore.subscription.tokenDescription')],
      benefits: [],
      action:
        `<button type="button" class="ui-btn ui-btn--lg" data-membership-purchase-action="buy"${focusKeyAttr('membership-token-buy')}${this.busy || !this.tokenState.canCheckout ? ' disabled' : ''}>${esc(t('hudChrome.wocStore.subscription.tokenBuy'))}</button>` +
        `<p data-membership-token-status role="status">${this.tokenPending() ? esc(t('hudChrome.wocStore.subscription.tokenArriving')) : ''}</p>`,
    });
  }

  private bindToken(body: HTMLElement): void {
    const button = body.querySelector<HTMLButtonElement>('[data-membership-purchase-action="buy"]');
    if (!button) return;
    button.onclick = async () => {
      const hooks = this.hooks();
      if (this.busy || !hooks || hooks !== this.owner) return;
      if (!hooks.tokenCheckout || !this.tokenState.canCheckout) return;
      this.busy = true;
      button.disabled = true;
      let message:
        | 'hudChrome.wocStore.subscription.tokenArriving'
        | 'hudChrome.wocStore.subscription.error'
        | null = null;
      try {
        const markPending = () => {
          try {
            localStorage.setItem('woc.membership-token.pending', this.tokenKey);
          } catch {
            /* Storage unavailable. */
          }
        };
        const result = subscriptionLink(await hooks.tokenCheckout(this.tokenKey), 'checkout');
        if (hooks !== this.hooks() || !result.ok) throw new Error('token checkout unavailable');
        // A hosted tab never reports completion, so it is claimed on later store entries;
        // an embedded checkout is only pending once it is paid, so closing it unpaid
        // leaves nothing to claim.
        if (!result.stripe) markPending();
        // Paid: the token arrives in a loot window once the payment settles.
        await this.openCheckout(result, () => {
          markPending();
          const status = body.querySelector<HTMLElement>('[data-membership-token-status]');
          if (status) status.textContent = t('hudChrome.wocStore.subscription.tokenArriving');
          this.retryDelivery(hooks, () => this.claimToken(hooks));
        });
      } catch {
        message = 'hudChrome.wocStore.subscription.error';
      } finally {
        this.busy = false;
        if (hooks === this.hooks()) {
          button.disabled = !this.tokenState.canCheckout;
          const status = body.querySelector<HTMLElement>('[data-membership-token-status]');
          if (status && message) status.textContent = t(message);
        }
      }
    };
  }
}
