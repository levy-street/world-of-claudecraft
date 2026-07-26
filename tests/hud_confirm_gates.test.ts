// @vitest-environment jsdom

// The two irreversible one-click actions gated behind Hud.confirmDialog: the
// Pale Keeper revive (applies The Keeper's Toll) and Heroic Quartermaster
// marks purchases (no buyback recorded). Both handlers are exercised directly
// (the extracted named methods the tap bindings call) with a mock
// confirmDialog, mirroring tests/daily_rewards_store_behavior.test.ts: the
// pre-existing command must fire ONLY from the dialog's onOk, never from the
// bare tap, and dismissing the dialog sends nothing.

import { describe, expect, it, vi } from 'vitest';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS } from '../src/sim/data';
import { Hud } from '../src/ui/hud';

interface ConfirmCall {
  title: string;
  body: string;
  ok: string;
  cancel: string;
  onOk: () => void;
}

interface GateHarness {
  onResurrectAtSpiritHealer: (() => void) | null;
  sim: { buyHeroicVendorItem(itemId: string): void };
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  requestSpiritHealerResurrect(): void;
  requestHeroicVendorPurchase(itemId: string): void;
}

function harness() {
  const confirmations: ConfirmCall[] = [];
  const hud = Object.create(Hud.prototype) as unknown as GateHarness;
  hud.confirmDialog = (title, body, ok, cancel, onOk) => {
    confirmations.push({ title, body, ok, cancel, onOk });
  };
  return { hud, confirmations };
}

const stockOffer = HEROIC_VENDOR_STOCK[0];
if (!stockOffer) throw new Error('heroic vendor stock fixture not found');

describe('spirit healer revive confirmation', () => {
  it('opens the confirm and revives only from OK, never from the bare tap', () => {
    const { hud, confirmations } = harness();
    const revive = vi.fn();
    hud.onResurrectAtSpiritHealer = revive;

    hud.requestSpiritHealerResurrect();

    expect(revive).not.toHaveBeenCalled();
    expect(confirmations).toHaveLength(1);
    const confirm = confirmations[0];
    expect(confirm.title).toBe("Accept the Keeper's Toll?");
    expect(confirm.body).toContain("Keeper's Toll");
    expect(confirm.body).toContain('75%');
    expect(confirm.body).toContain('no penalty');
    expect(confirm.ok).toBe('Revive Me');
    expect(confirm.cancel).toBe('Cancel');

    confirm.onOk();
    expect(revive).toHaveBeenCalledOnce();
  });

  it('sends nothing when the dialog is dismissed', () => {
    const { hud, confirmations } = harness();
    const revive = vi.fn();
    hud.onResurrectAtSpiritHealer = revive;

    hud.requestSpiritHealerResurrect();

    // cancel/Escape tear the dialog down without running onOk (see
    // Hud.confirmDialog); dismissing must leave the command unsent.
    expect(confirmations).toHaveLength(1);
    expect(revive).not.toHaveBeenCalled();
  });
});

describe('heroic quartermaster purchase confirmation', () => {
  it('opens the confirm with the item name and mark cost, buying only from OK', () => {
    const { hud, confirmations } = harness();
    const buy = vi.fn();
    hud.sim = { buyHeroicVendorItem: buy };

    hud.requestHeroicVendorPurchase(stockOffer.itemId);

    expect(buy).not.toHaveBeenCalled();
    expect(confirmations).toHaveLength(1);
    const confirm = confirmations[0];
    expect(confirm.title).toBe('Confirm Purchase');
    expect(confirm.body).toContain(ITEMS[stockOffer.itemId].name);
    expect(confirm.body).toContain(String(stockOffer.marks));
    expect(confirm.body).toContain('Heroic Marks');
    expect(confirm.ok).toBe('Buy');
    expect(confirm.cancel).toBe('Cancel');

    confirm.onOk();
    expect(buy).toHaveBeenCalledExactlyOnceWith(stockOffer.itemId);
  });

  it('sends nothing when the dialog is dismissed', () => {
    const { hud, confirmations } = harness();
    const buy = vi.fn();
    hud.sim = { buyHeroicVendorItem: buy };

    hud.requestHeroicVendorPurchase(stockOffer.itemId);

    expect(confirmations).toHaveLength(1);
    expect(buy).not.toHaveBeenCalled();
  });

  it('ignores an item id that is not in the quartermaster stock', () => {
    const { hud, confirmations } = harness();
    const buy = vi.fn();
    hud.sim = { buyHeroicVendorItem: buy };

    hud.requestHeroicVendorPurchase('not_a_stock_item');

    expect(confirmations).toHaveLength(0);
    expect(buy).not.toHaveBeenCalled();
  });
});
