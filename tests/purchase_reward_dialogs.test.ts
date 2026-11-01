// @vitest-environment happy-dom
// The store purchase dialogs (src/ui/purchase_reward_dialogs.ts over the pure
// purchase_reward_view.ts): the loot window a paid parcel opens, and the membership
// congratulation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { PurchaseParcelView } from '../src/sim/mail/purchase_parcels';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { PurchaseRewardDialogs, showMembershipWelcome } from '../src/ui/purchase_reward_dialogs';
import {
  membershipWelcomeBody,
  mergePurchaseParcels,
  purchaseLootRows,
} from '../src/ui/purchase_reward_view';

const TOKEN: PurchaseParcelView = {
  mailId: 4,
  letterId: 'membership_token_delivery',
  items: [{ itemId: 'membership_token', count: 1 }],
};
const REINS: PurchaseParcelView = {
  mailId: 9,
  letterId: 'membership_annual_reward',
  items: [{ itemId: 'reins_nightwing_chimera', count: 1 }],
};

beforeEach(() => {
  document.body.innerHTML =
    '<div id="ui"><div id="prompt-stack"></div><div id="daily-rewards-window"></div></div>';
});
afterEach(() => {
  document.body.innerHTML = '';
});

const dialogs = () => document.querySelectorAll('#prompt-stack .purchase-reward-prompt');
const store = () => document.getElementById('daily-rewards-window')!;

describe('purchase reward view core', () => {
  it('lists each parcel item with its localized name and quality, once per letter', () => {
    const merged = mergePurchaseParcels([TOKEN], [TOKEN, REINS]);
    expect(merged.map((p) => p.mailId)).toEqual([4, 9]);
    const rows = purchaseLootRows(merged);
    expect(rows.map((r) => r.name)).toEqual([
      itemDisplayName(ITEMS.membership_token),
      itemDisplayName(ITEMS.reins_nightwing_chimera),
    ]);
    expect(rows.map((r) => r.quality)).toEqual(['epic', 'epic']);
    expect(rows[0].count).toBe('');
    expect(
      purchaseLootRows([{ ...TOKEN, items: [{ itemId: 'membership_token', count: 3 }] }])[0].count,
    ).toBe('3');
    expect(purchaseLootRows([{ ...TOKEN, items: [{ itemId: 'no_such_item', count: 1 }] }])).toEqual(
      [],
    );
  });

  it('names the new membership end date when the server sent one', () => {
    expect(membershipWelcomeBody(Date.UTC(2026, 11, 1))).toContain(
      'Your membership is active until',
    );
    expect(membershipWelcomeBody(null)).toBe(
      'Your membership is active. Enjoy every membership benefit, adventurer!',
    );
    expect(membershipWelcomeBody(Number.NaN)).toBe(membershipWelcomeBody(null));
  });
});

describe('purchase loot window', () => {
  it('collects every offered parcel through mailTake, into one window', () => {
    const take = vi.fn();
    const loot = new PurchaseRewardDialogs(take);
    loot.offer([TOKEN]);
    loot.offer([REINS, TOKEN]);
    expect(dialogs()).toHaveLength(1);
    const prompt = dialogs()[0] as HTMLElement;
    expect(prompt.getAttribute('role')).toBe('dialog');
    expect(prompt.textContent).toContain('Your purchase has arrived');
    expect(prompt.querySelectorAll('.purchase-loot-row')).toHaveLength(2);
    expect(prompt.querySelector('.purchase-loot-name')?.getAttribute('data-quality')).toBe('epic');
    expect(prompt.textContent).toContain('kept as overflow');
    expect(store().inert).toBe(true);
    prompt.querySelector<HTMLButtonElement>('.purchase-reward-collect')!.click();
    expect(take.mock.calls).toEqual([[4], [9]]);
    expect(dialogs()).toHaveLength(0);
    expect(store().inert).toBe(false);
    // Nothing is left to take twice.
    loot.offer([]);
    expect(dialogs()).toHaveLength(0);
  });

  it('leaves the parcels in the mailbox on Later', () => {
    const take = vi.fn();
    const loot = new PurchaseRewardDialogs(take);
    loot.offer([TOKEN]);
    dialogs()[0].querySelector<HTMLButtonElement>('.purchase-reward-later')!.click();
    expect(take).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(0);
    // A later login offers it again.
    loot.offer([TOKEN]);
    expect(dialogs()).toHaveLength(1);
  });

  it('opens nothing on a page without a prompt host', () => {
    document.body.innerHTML = '';
    const loot = new PurchaseRewardDialogs(vi.fn());
    loot.offer([TOKEN]);
    showMembershipWelcome(null);
    expect(document.querySelector('.purchase-reward-prompt')).toBeNull();
  });
});

describe('overlapping purchase dialogs', () => {
  it('keeps the store blocked until the last dialog closes', () => {
    new PurchaseRewardDialogs(vi.fn()).offer([TOKEN]);
    showMembershipWelcome(null);
    expect(dialogs()).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('.purchase-reward-ok')!.click();
    expect(store().inert).toBe(true);
    document.querySelector<HTMLButtonElement>('.purchase-reward-later')!.click();
    expect(store().inert).toBe(false);
  });
});

describe('membership congratulation', () => {
  it('congratulates in a modal dialog and closes on its button', () => {
    showMembershipWelcome(Date.UTC(2026, 11, 1));
    const prompt = document.querySelector<HTMLElement>('.membership-welcome-prompt')!;
    expect(prompt.textContent).toContain('Congratulations!');
    expect(prompt.textContent).toContain('Your membership is active until');
    expect(prompt.getAttribute('aria-modal')).toBe('true');
    const ok = prompt.querySelector<HTMLButtonElement>('.purchase-reward-ok')!;
    expect(document.activeElement).toBe(ok);
    ok.click();
    expect(document.querySelector('.membership-welcome-prompt')).toBeNull();
    expect(store().inert).toBe(false);
  });
});
