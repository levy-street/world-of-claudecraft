import { describe, expect, it } from 'vitest';
import { GAME_SUBSCRIPTION_PLANS, SUBSCRIPTION_OFF } from '../src/subscription_contract';
import {
  addMonthsSeconds,
  annualMonthlyValue,
  MEMBERSHIP_ART_DIR,
  subscriptionOffersHtml,
  subscriptionPurchase,
} from '../src/ui/store_subscription_offers';

const NOW = Date.UTC(2026, 9, 26) / 1000;
const DAY = 86_400;
const plans = Object.values(GAME_SUBSCRIPTION_PLANS);
const badge = (html: string, id: string): string =>
  html.split(`data-membership-badge="${id}"`)[1]?.split('</article>')[0] ?? '';

describe('membership plan badges', () => {
  it.each(['none', 'canceled', 'incomplete_expired'] as const)(
    'describes a blocked %s checkout as pending, not a payment-method failure',
    (status) => {
      const state = { ...SUBSCRIPTION_OFF, available: true, status, plans, canManage: true };
      expect(subscriptionPurchase(state, 'game_monthly', NOW)).toBe('pending');
      const html = subscriptionOffersHtml(state, false, false, false, '', NOW);
      expect(html).toContain('Checkout pending');
      expect(html).not.toContain('Update your payment details');
      expect(html).not.toContain('Not subscribed');
      expect(html).not.toContain('data-subscription-action="checkout"');
    },
  );
  it('shows one priced badge per plan with benefits, annual mount and trial terms', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        canCheckout: true,
        plans,
        trialEligible: true,
        trialDays: 7,
      },
      false,
      false,
      false,
      '',
      NOW,
    );
    for (const text of [
      '$5.00 per month',
      '$50.00 for 12 months',
      'Renews yearly',
      'once per account',
      'payment method is required',
      'Nightwing Chimaera mount for every character on your account',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Claudium');
    expect(badge(html, 'game_monthly')).not.toContain('Nightwing');
    expect(badge(html, 'game_monthly')).toContain('Unlock 10 additional character slots.');
    // Annual: every monthly benefit by reference, the cheaper monthly rate, and the mount.
    expect(badge(html, 'game_annual')).not.toContain('Unlock 10 additional character slots.');
    expect(badge(html, 'game_annual')).toContain('All the benefits of a monthly membership.');
    expect(badge(html, 'game_annual')).toContain(
      'Just $4.17 per month, saving 17% compared with paying monthly.',
    );
    for (const id of ['game_monthly', 'game_annual'])
      expect(badge(html, id)).toContain('Start 7-day free trial');
    expect(html).not.toContain('$60.00');
    expect(html.match(/data-subscription-action="checkout"/g)).toHaveLength(2);
  });

  it('does not promise trial or rewards through a legacy monthly service', () => {
    const html = subscriptionOffersHtml(
      { ...SUBSCRIPTION_OFF, available: true, canCheckout: true },
      false,
      false,
      false,
      '',
      NOW,
    );
    expect(html).not.toContain('Claudium');
    expect(html).not.toContain('free trial');
    expect(html).not.toContain('game_annual');
  });

  it('lets a live member add a month or a year and shows the renewal date', () => {
    const state = {
      ...SUBSCRIPTION_OFF,
      available: true,
      status: 'trialing' as const,
      plan: 'game_monthly' as const,
      plans,
      trialEligible: false,
      trialDays: 7 as const,
      currentPeriodEnd: NOW + 5 * DAY,
      canStack: true,
      stackLimit: NOW + 730 * DAY,
      canManage: true,
    };
    const html = subscriptionOffersHtml(state, false, false, false, '', NOW);
    expect(badge(html, 'game_monthly')).toContain('Add 1 month');
    // A monthly member's annual purchase reads as the upgrade it is.
    expect(badge(html, 'game_annual')).toContain('Upgrade to 12 months');
    expect(html).toContain('added to the end of your current membership');
    expect(html).toContain('Renews on');
    expect(html).toContain('data-subscription-action="portal"');
    expect(html).not.toContain('Resume checkout');
    expect(html).not.toMatch(/data-subscription-action="checkout"[^>]*disabled/);
    expect(html).toContain('membership-badge--current" data-membership-badge="game_monthly"');
    expect(html).not.toContain('membership-badge--current" data-membership-badge="game_annual"');
  });

  it('disables a stack that would pass the two-year limit', () => {
    const state = {
      ...SUBSCRIPTION_OFF,
      available: true,
      status: 'active' as const,
      plan: 'game_annual' as const,
      plans,
      trialEligible: false,
      trialDays: 7 as const,
      currentPeriodEnd: NOW + 400 * DAY,
      canStack: true,
      stackLimit: NOW + 730 * DAY,
    };
    expect(subscriptionPurchase(state, 'game_monthly', NOW)).toBe('stack');
    expect(subscriptionPurchase(state, 'game_annual', NOW)).toBe('capped');
    const html = subscriptionOffersHtml(state, false, false, false, '', NOW);
    expect(badge(html, 'game_annual')).toMatch(/data-subscription-action="checkout"[^>]*disabled/);
    expect(badge(html, 'game_annual')).toContain('up to 2 years of membership');
    expect(badge(html, 'game_annual')).toContain('Add 12 months');
    expect(badge(html, 'game_monthly')).not.toContain('disabled');
  });

  it('sends a member with a billing problem to Manage subscription instead of checkout', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'past_due',
        plan: 'game_monthly',
        plans,
        trialEligible: false,
        trialDays: 7,
        canManage: true,
      },
      false,
      false,
      false,
      '',
      NOW,
    );
    expect(html).not.toContain('data-subscription-action="checkout"');
    expect(html).toContain('Update your payment details in Manage subscription');
    expect(html).toContain('data-subscription-action="portal"');
  });

  it('puts each column art first, then the purchase controls, then the description', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        canCheckout: true,
        plans,
        trialEligible: false,
        trialDays: 7,
      },
      false,
      false,
      false,
      '',
      NOW,
    );
    const columns: [string, string, string][] = [
      ['game_monthly', 'monthly.webp', 'beside the winged courier donkey'],
      ['game_annual', 'annual.webp', 'with the courier donkey and the Nightwing Chimaera mount'],
    ];
    for (const [id, art, alt] of columns) {
      const column = badge(html, id);
      expect(column).toContain(`src="${MEMBERSHIP_ART_DIR}/${art}"`);
      expect(column).toContain(alt);
      const order = [
        'membership-badge-art',
        'membership-badge-price',
        'data-subscription-action',
        'membership-badge-details',
      ].map((marker) => column.indexOf(marker));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('values the annual plan from the advertised prices', () => {
    expect(annualMonthlyValue(5000, 500)).toEqual({ perMonthCents: 417, saving: 1 - 5000 / 6000 });
    expect(annualMonthlyValue(6000, 500).saving).toBe(0);
    expect(annualMonthlyValue(7000, 500).saving).toBe(0);
  });

  it('has no collect buttons; the status reports the annual mount delivery', () => {
    const html = subscriptionOffersHtml(
      {
        ...SUBSCRIPTION_OFF,
        available: true,
        status: 'active',
        plan: 'game_annual',
        plans,
        canManage: true,
      },
      true,
      true,
      false,
      '<article data-membership-badge="membership_token"></article>',
      NOW,
    );
    expect(html).not.toContain('data-subscription-mount-claim');
    expect(html).toContain('data-membership-badge="membership_token"');
    expect(html).toContain('Your mount reins appear in a loot window');
  });

  it('adds calendar months in UTC seconds', () => {
    expect(addMonthsSeconds(Date.UTC(2026, 0, 15) / 1000, 12)).toBe(Date.UTC(2027, 0, 15) / 1000);
    expect(addMonthsSeconds(Date.UTC(2026, 10, 1) / 1000, 1)).toBe(Date.UTC(2026, 11, 1) / 1000);
  });
});
