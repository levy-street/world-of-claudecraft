import { describe, expect, it } from 'vitest';
import { GAME_SUBSCRIPTION_PLANS, SUBSCRIPTION_OFF } from '../src/subscription_contract';
import { subscriptionOffersHtml } from '../src/ui/store_subscription_offers';

describe('membership plan offers', () => {
  it('shows exact paid value, annual renewal and trial charges for advertised plans', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        canCheckout: true,
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
        trialEligible: true,
        trialDays: 7,
      },
      false,
      false,
      false,
    );
    for (const text of [
      '$5.00 per month',
      '$50.00 for 12 months',
      '$60.00',
      '6,000 Claudium',
      '500 Claudium',
      'Renews yearly',
      'once per account',
      'payment method is required',
      'No Claudium or bundle mount',
      'soulbound tank mount',
    ])
      expect(html).toContain(text);
    expect(html.match(/data-subscription-action="checkout"/g)).toHaveLength(2);
  });
  it('does not promise trial or rewards through a legacy monthly service', () => {
    const html = subscriptionOffersHtml(
      { ...SUBSCRIPTION_OFF, available: true, canCheckout: true },
      false,
      false,
      false,
    );
    expect(html).not.toContain('Claudium');
    expect(html).not.toContain('free trial');
    expect(html).not.toContain('game_annual');
  });
  it('offers only the saved annual checkout when the service has reserved an incomplete purchase', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'incomplete',
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
      },
      false,
      true,
      false,
    );
    expect(html.match(/data-subscription-action="checkout"/g)).toHaveLength(1);
    expect(html).toContain('data-subscription-checkout-plan="game_annual"');
    expect(html).toContain('Resume checkout');
  });
  it('shows current annual renewal and management without new checkout during a trial', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'trialing',
        plan: 'game_annual',
        plans: Object.values(GAME_SUBSCRIPTION_PLANS),
        canManage: true,
      },
      true,
      true,
      false,
    );
    expect(html).toContain('$50.00');
    expect(html).toContain('data-subscription-action="portal"');
    expect(html).not.toContain('data-subscription-action="checkout"');
    expect(html).toContain('data-subscription-mount-claim');
    expect(html).toContain(' disabled');
  });
});
