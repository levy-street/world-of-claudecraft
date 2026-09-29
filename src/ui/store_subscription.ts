import { DESKTOP_APP } from '../client_origin';
import {
  SUBSCRIPTION_OFF,
  type SubscriptionStoreHooks,
  subscriptionLink,
} from '../subscription_contract';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { t } from './i18n';
import { mintIntentKey } from './purchase_intent_key';
import { usdText } from './usd_text';

/** Cold store section. Status refreshes on user entry/refresh, never the store polling timer. */
export class StoreSubscription {
  private state = { ...SUBSCRIPTION_OFF };
  private flight: Promise<void> | null = null;
  private busy = false;
  private owner: SubscriptionStoreHooks | undefined;
  private checkoutKey = mintIntentKey();
  constructor(private readonly hooks: () => SubscriptionStoreHooks | undefined) {}

  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = Promise.resolve()
      .then(async () => {
        const hooks = this.hooks();
        const state = (await hooks?.snapshot()) ?? { ...SUBSCRIPTION_OFF };
        if (hooks !== this.hooks()) return;
        if (this.owner !== hooks || this.state.status !== state.status)
          this.checkoutKey = mintIntentKey();
        this.owner = hooks;
        this.state = state;
      })
      .catch(() => {
        this.state = { ...SUBSCRIPTION_OFF };
      })
      .finally(() => {
        this.flight = null;
      });
    return this.flight;
  }

  html(): string {
    if (!this.state.available || this.owner !== this.hooks()) return '';
    const action = this.state.canManage ? 'portal' : this.state.canCheckout ? 'checkout' : null;
    const label = action === 'portal' ? 'manage' : 'subscribe';
    return (
      `<section class="ui-card" data-subscription-section><div class="charter-body"><h2 class="ui-h">${esc(t('hudChrome.wocStore.subscription.title'))}</h2>` +
      `<p>${esc(t('hudChrome.wocStore.subscription.price', { price: usdText(500) }))}</p>` +
      `<p>${esc(t('hudChrome.wocStore.subscription.terms'))}</p>` +
      `<p>${esc(t(this.state.cancelAtPeriodEnd ? 'hudChrome.wocStore.subscription.ending' : `hudChrome.wocStore.subscription.status.${this.state.status}`))}</p>` +
      (action
        ? `<button type="button" class="ui-btn ui-btn--lg" data-subscription-action="${action}"${focusKeyAttr('subscription-action')}${this.busy ? ' disabled' : ''}>${esc(t(`hudChrome.wocStore.subscription.${label}`))}</button>`
        : '') +
      `<p data-subscription-error role="status"></p></div></section>`
    );
  }

  bind(body: HTMLElement): void {
    const button = body.querySelector<HTMLButtonElement>('[data-subscription-action]');
    if (!button) return;
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
        const result = subscriptionLink(
          await hooks.link(action, action === 'checkout' ? this.checkoutKey : mintIntentKey()),
          action,
        );
        if (!result.ok || !result.url) throw new Error('subscription unavailable');
        if (hooks !== this.hooks()) throw new Error('account changed');
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
          const current = body.querySelector<HTMLButtonElement>('[data-subscription-action]');
          if (current) current.disabled = false;
        }
      }
    };
  }
}
