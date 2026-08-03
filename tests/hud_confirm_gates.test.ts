// @vitest-environment happy-dom

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

// ---------------------------------------------------------------------------
// The R40 per-use effect confirm (confirmToolEffectUse): rides the same
// confirm-dialog family, but unlike the two gates above its cancel PATHS all
// answer (declining still gathers), so `proceed` must fire exactly once with
// the player's answer on OK, cancel, and every no-choice dismissal.
// ---------------------------------------------------------------------------

interface EffectConfirmCall extends ConfirmCall {
  onCancel?: () => void;
}

function effectHarness() {
  const confirmations: EffectConfirmCall[] = [];
  const hud = Object.create(Hud.prototype) as unknown as GateHarness & {
    confirmToolEffectUse(
      prompt: { effectId: string; charges: number },
      proceed: (confirmed: boolean) => void,
    ): void;
  };
  (hud as unknown as Record<string, unknown>).confirmDialog = (
    title: string,
    body: string,
    ok: string,
    cancel: string,
    onOk: () => void,
    onCancel?: () => void,
  ) => {
    confirmations.push({ title, body, ok, cancel, onOk, onCancel });
  };
  return { hud, confirmations };
}

describe('the R40 per-use effect confirm (confirmToolEffectUse)', () => {
  it('OK answers confirmed exactly once; nothing fires from the bare open', () => {
    const { hud, confirmations } = effectHarness();
    const proceed = vi.fn();
    hud.confirmToolEffectUse({ effectId: 'artisans_eye', charges: 7 }, proceed);
    expect(proceed).not.toHaveBeenCalled();
    expect(confirmations).toHaveLength(1);
    const call = confirmations[0];
    // The body names the remaining charges: the marginal-spend fact.
    expect(call.body).toContain('7');
    call.onOk();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(true);
    // The answered latch: a late second callback cannot double-send.
    call.onCancel?.();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('a dismissal answers unconfirmed exactly once (declining still gathers)', () => {
    const { hud, confirmations } = effectHarness();
    const proceed = vi.fn();
    hud.confirmToolEffectUse({ effectId: 'gatherers_cache', charges: 1 }, proceed);
    const call = confirmations[0];
    expect(call.onCancel).toBeDefined();
    call.onCancel?.();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(false);
    call.onOk();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('an unknown effect id degrades to an unconfirmed answer with NO dialog', () => {
    const { hud, confirmations } = effectHarness();
    const proceed = vi.fn();
    hud.confirmToolEffectUse({ effectId: 'constructor', charges: 3 }, proceed);
    expect(confirmations).toHaveLength(0);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// The REAL confirmDialog's no-choice callback: every dismissal that is not
// the OK button fires it exactly once (cancel click, the Esc route through
// closeManagedWindow, replacement by a newer dialog). Driven over jsdom with
// the trap/window plumbing stubbed, the Object.create idiom above.
// ---------------------------------------------------------------------------

interface RealDialogHud {
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
    onCancel?: () => void,
  ): void;
  closeManagedWindow(el: HTMLElement): void;
}

function realDialogHud(): RealDialogHud {
  const hud = Object.create(Hud.prototype) as Record<string, unknown>;
  hud.focusManager = { open: () => ({ release: () => {} }) };
  hud.bringWindowToFront = () => {};
  hud.confirmTrap = null;
  hud.confirmOnCancel = null;
  return hud as unknown as RealDialogHud;
}

describe('confirmDialog no-choice callback (the R40 family contract)', () => {
  it('fires once on a cancel click and never on OK', () => {
    document.body.innerHTML = '';
    const hud = realDialogHud();
    const onOk = vi.fn();
    const onCancel = vi.fn();
    hud.confirmDialog('T', 'B', 'OK', 'Cancel', onOk, onCancel);
    const el = document.getElementById('confirm-dialog');
    if (!el) throw new Error('dialog not painted');
    (el.querySelector('.cd-actions [data-cancel]') as HTMLElement).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
    expect(document.getElementById('confirm-dialog')).toBeNull();

    const onOk2 = vi.fn();
    const onCancel2 = vi.fn();
    hud.confirmDialog('T', 'B', 'OK', 'Cancel', onOk2, onCancel2);
    (document.querySelector('#confirm-dialog [data-ok]') as HTMLElement).click();
    expect(onOk2).toHaveBeenCalledTimes(1);
    expect(onCancel2).not.toHaveBeenCalled();
  });

  it('fires on the Esc route (closeManagedWindow) and on replacement by a newer dialog', () => {
    document.body.innerHTML = '';
    const hud = realDialogHud();
    const onCancel = vi.fn();
    hud.confirmDialog('T', 'B', 'OK', 'Cancel', vi.fn(), onCancel);
    const el = document.getElementById('confirm-dialog');
    if (!el) throw new Error('dialog not painted');
    hud.closeManagedWindow(el);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.getElementById('confirm-dialog')).toBeNull();

    const replaced = vi.fn();
    hud.confirmDialog('T1', 'B', 'OK', 'Cancel', vi.fn(), replaced);
    hud.confirmDialog('T2', 'B', 'OK', 'Cancel', vi.fn());
    expect(replaced).toHaveBeenCalledTimes(1);
    // The second dialog carried no onCancel: dismissing it fires nothing more.
    const second = document.getElementById('confirm-dialog');
    if (!second) throw new Error('second dialog not painted');
    hud.closeManagedWindow(second);
    expect(replaced).toHaveBeenCalledTimes(1);
  });

  it('fires when the INPUT modal takes the shared slot (the fourth no-choice route)', () => {
    // inputDialog shares the #confirm-dialog element, so a rename prompt
    // (or any input modal) replacing an open R40 ask is a dismissal without
    // a choice: the pending callback must answer before the modal takes it.
    document.body.innerHTML = '';
    const hud = realDialogHud();
    const replaced = vi.fn();
    hud.confirmDialog('T', 'B', 'OK', 'Cancel', vi.fn(), replaced);
    (hud as unknown as { inputDialog: (opts: { title: string }) => void }).inputDialog({
      title: 'Rename',
    });
    expect(replaced).toHaveBeenCalledTimes(1);
    // The input modal itself carries no confirm callback: closing it fires
    // nothing more.
    const el = document.getElementById('confirm-dialog');
    if (!el) throw new Error('input modal not painted');
    hud.closeManagedWindow(el);
    expect(replaced).toHaveBeenCalledTimes(1);
  });
});
