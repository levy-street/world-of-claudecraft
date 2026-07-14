import type { ClaudiumStripeIntent } from './economy_sdk';

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs | null;
  }
}

interface StripeJs {
  createEmbeddedCheckoutPage?(args: {
    fetchClientSecret: () => Promise<string>;
    onComplete?: () => void;
  }): Promise<StripeEmbeddedCheckout>;
  initEmbeddedCheckout(args: {
    clientSecret: string;
    onComplete?: () => void;
  }): Promise<StripeEmbeddedCheckout>;
}

interface StripeEmbeddedCheckout {
  mount(selector: string): void;
  destroy(): void;
}

export interface StripeCheckoutLabels {
  title: string;
  close: string;
  loading: string;
  failed: string;
}

export interface StripeCheckoutOptions {
  onComplete?(): void;
}

let stripeScriptPromise: Promise<void> | null = null;

function loadStripeScript(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  if (stripeScriptPromise) return stripeScriptPromise;
  stripeScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.stripe.com/v3/"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('stripe_load_failed')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('stripe_load_failed')), { once: true });
    document.head.append(script);
  });
  return stripeScriptPromise;
}

function removeExistingOverlay(): void {
  document.getElementById('stripe-checkout-overlay')?.remove();
}

function checkoutOverlay(labels: StripeCheckoutLabels): HTMLElement {
  removeExistingOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'stripe-checkout-overlay';
  overlay.innerHTML =
    `<div class="stripe-checkout-panel" role="dialog" aria-modal="true" aria-labelledby="stripe-checkout-title">` +
    `<div class="stripe-checkout-head"><span id="stripe-checkout-title"></span><button type="button" class="stripe-checkout-close"></button></div>` +
    `<div id="stripe-checkout-mount"><div class="stripe-checkout-loading"></div></div>` +
    `</div>`;
  const title = overlay.querySelector<HTMLElement>('#stripe-checkout-title');
  const close = overlay.querySelector<HTMLButtonElement>('.stripe-checkout-close');
  const loading = overlay.querySelector<HTMLElement>('.stripe-checkout-loading');
  if (title) title.textContent = labels.title;
  if (close) {
    close.textContent = 'x';
    close.setAttribute('aria-label', labels.close);
  }
  if (loading) loading.textContent = labels.loading;
  document.body.append(overlay);
  return overlay;
}

export async function openStripeCheckout(
  intent: ClaudiumStripeIntent,
  labels: StripeCheckoutLabels,
  options: StripeCheckoutOptions = {},
): Promise<void> {
  const overlay = checkoutOverlay(labels);
  let checkout: StripeEmbeddedCheckout | null = null;
  const close = () => {
    checkout?.destroy();
    overlay.remove();
  };
  const complete = () => {
    close();
    options.onComplete?.();
  };
  overlay
    .querySelector<HTMLButtonElement>('.stripe-checkout-close')
    ?.addEventListener('click', close);
  try {
    await loadStripeScript();
    const stripe = window.Stripe?.(intent.publishableKey);
    if (!stripe) throw new Error('stripe_unavailable');
    checkout = stripe.createEmbeddedCheckoutPage
      ? await stripe.createEmbeddedCheckoutPage({
          fetchClientSecret: async () => intent.clientSecret,
          onComplete: complete,
        })
      : await stripe.initEmbeddedCheckout({
          clientSecret: intent.clientSecret,
          onComplete: complete,
        });
    const mount = overlay.querySelector<HTMLElement>('#stripe-checkout-mount');
    if (mount) mount.textContent = '';
    checkout.mount('#stripe-checkout-mount');
  } catch (err) {
    console.warn(
      '[claudium] Stripe checkout failed',
      err instanceof Error ? err.message : String(err),
    );
    const mount = overlay.querySelector<HTMLElement>('#stripe-checkout-mount');
    if (mount) mount.textContent = labels.failed;
    throw err;
  }
}
