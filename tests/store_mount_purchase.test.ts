// The store-mount purchase controller (src/ui/store_mount_purchase.ts), the
// Machine Stable twin of the weapon-skin controller. Each arm drives the
// controller through fake window seams and asserts the seam calls, so the
// window's own DOM never enters: the one-spend guard, the need-more handoff,
// the confirm prompt, and every authoritative outcome (granted, already
// granted, price_changed with its reconfirm, insufficient_balance with the
// service's own cost, a plain refusal, a thrown spend) on both a current and a
// stale store surface.

import { describe, expect, it, vi } from 'vitest';
import { STORE_MOUNT_ITEM_IDS } from '../src/sim/content/store_mounts';
import type { StoreSpendResult } from '../src/ui/claudium_purchase_bridge';
import { t } from '../src/ui/i18n';
import { storeMountName } from '../src/ui/store_mount_card_view';
import { StoreMountPurchase, type StoreMountPurchaseDeps } from '../src/ui/store_mount_purchase';
import type { WocStoreItemInput } from '../src/ui/woc_store_view';

const REINS = STORE_MOUNT_ITEM_IDS[0];
const NAME = storeMountName(REINS);

function service(over: Partial<WocStoreItemInput> = {}): WocStoreItemInput {
  return { itemId: REINS, name: 'x', kind: 'item', costClaudium: 1200, owned: false, ...over };
}

function result(over: Partial<StoreSpendResult> = {}): StoreSpendResult {
  return { granted: false, balance: null, costClaudium: null, reason: null, ...over };
}

interface Harness {
  controller: StoreMountPurchase;
  deps: { [K in keyof StoreMountPurchaseDeps]: ReturnType<typeof vi.fn> };
  /** What the next refreshStore re-projects the rows from. */
  next: { balance: number | null; items: WocStoreItemInput[]; owned: string[] };
  surface: { current: boolean };
}

function harness(
  balance: number | null,
  items: WocStoreItemInput[],
  owned: string[] = [],
  spend: StoreMountPurchaseDeps['spend'] = async () => result({ granted: true }),
): Harness {
  const surface = { current: true };
  const next = { balance, items, owned };
  let liveBalance = balance;
  const deps = {
    balance: vi.fn(() => liveBalance),
    setBalance: vi.fn((b: number) => {
      liveBalance = b;
    }),
    captureSurface: vi.fn(() => 7),
    surfaceIsCurrent: vi.fn(() => surface.current),
    spend: vi.fn(spend),
    showDecision: vi.fn(),
    showNeedMore: vi.fn(),
    showResult: vi.fn(),
    needMoreText: vi.fn(
      (item: string, cost: number, bal: number | null) => `${item}|${cost}|${bal}`,
    ),
    setPriceChanged: vi.fn(),
    setError: vi.fn(),
    refreshStore: vi.fn(async () => {
      controller.rebuild(next.balance, next.items, next.owned);
    }),
    rebuildAndPaint: vi.fn(),
  };
  const controller = new StoreMountPurchase(deps as unknown as StoreMountPurchaseDeps);
  controller.rebuild(balance, items, owned);
  return { controller, deps: deps as unknown as Harness['deps'], next, surface };
}

function confirm(h: Harness): Promise<void> {
  const options = h.deps.showDecision.mock.calls.at(-1)?.[0] as { onConfirm(): void } | undefined;
  if (!options) throw new Error('no decision prompt was shown');
  options.onConfirm();
  // purchase() is fire-and-forget behind onConfirm; settle it.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('StoreMountPurchase.request', () => {
  it('opens the confirm prompt with the catalog name and the service price', () => {
    const h = harness(5000, [service()]);
    h.controller.request(REINS);
    expect(h.deps.showDecision).toHaveBeenCalledTimes(1);
    const options = h.deps.showDecision.mock.calls[0][0] as { title: string; body: string };
    expect(options.title).toBe(t('hudChrome.wocStore.confirmTitle'));
    expect(options.body).toContain(NAME);
    expect(options.body).toMatch(/1\D?200/);
    expect(h.deps.spend).not.toHaveBeenCalled();
  });

  it('hands an unaffordable row to the need-more dialog instead of a prompt', () => {
    const h = harness(100, [service()]);
    h.controller.request(REINS);
    expect(h.deps.showDecision).not.toHaveBeenCalled();
    expect(h.deps.showNeedMore).toHaveBeenCalledWith(NAME, 1200, 100, 7);
  });

  it('refuses an owned, unpriced, unknown, or missing id without any prompt', () => {
    const owned = harness(5000, [service()], ['mech_bird']);
    owned.controller.request(REINS);
    const unpriced = harness(5000, []);
    unpriced.controller.request(REINS);
    const unknown = harness(5000, [service()]);
    unknown.controller.request('not_a_reins');
    unknown.controller.request(undefined);
    for (const h of [owned, unpriced, unknown]) {
      expect(h.deps.showDecision).not.toHaveBeenCalled();
      expect(h.deps.showNeedMore).not.toHaveBeenCalled();
    }
  });
});

describe('StoreMountPurchase.purchase outcomes on a current surface', () => {
  it('spends with kind item semantics (the row id and its price) and refreshes the store', async () => {
    const h = harness(5000, [service()]);
    h.next.owned = ['mech_bird'];
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.setPriceChanged).toHaveBeenCalledWith(false);
    expect(h.deps.spend).toHaveBeenCalledWith(REINS, 1200);
    expect(h.deps.refreshStore).toHaveBeenCalledTimes(1);
    expect(h.deps.setError).not.toHaveBeenCalled();
    expect(h.deps.showResult).not.toHaveBeenCalled();
    expect(h.controller.rowById(REINS)?.owned).toBe(true);
  });

  it('holds the one-spend guard until the outcome refresh completes', async () => {
    let release!: (value: StoreSpendResult) => void;
    const pending = new Promise<StoreSpendResult>((resolve) => (release = resolve));
    const h = harness(5000, [service()], [], () => pending);
    h.controller.request(REINS);
    await confirm(h);
    // A second click while the first spend is in flight: no second prompt.
    h.controller.request(REINS);
    expect(h.deps.showDecision).toHaveBeenCalledTimes(1);
    h.next.owned = ['mech_bird'];
    release(result({ granted: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.deps.spend).toHaveBeenCalledTimes(1);
  });

  it('reads already_granted as ownership, not as an error', async () => {
    const h = harness(5000, [service()], [], async () =>
      result({ granted: false, reason: 'already_granted' }),
    );
    h.next.items = [service({ owned: true })];
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.setError).not.toHaveBeenCalled();
  });

  it('reads already_granted as the error state when the refreshed row is still unowned', async () => {
    // The skin controller's rule: on the live surface the row proves ownership,
    // an already_granted answer alone does not (the mirror may not have landed).
    const h = harness(5000, [service()], [], async () =>
      result({ granted: false, reason: 'already_granted' }),
    );
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.refreshStore).toHaveBeenCalledTimes(1);
    expect(h.deps.setError).toHaveBeenCalledTimes(1);
    expect(h.deps.showResult).not.toHaveBeenCalled();
  });

  it('marks the error state when a refusal leaves the row unowned after the refresh', async () => {
    const h = harness(5000, [service()], [], async () => result({ reason: 'unavailable' }));
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.refreshStore).toHaveBeenCalledTimes(1);
    expect(h.deps.setError).toHaveBeenCalledTimes(1);
  });

  it('marks the error state when the spend itself throws', async () => {
    const h = harness(5000, [service()], [], async () => {
      throw new Error('network');
    });
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.setError).toHaveBeenCalledTimes(1);
    expect(h.deps.refreshStore).not.toHaveBeenCalled();
  });

  it('on price_changed: flags it, takes the balance, refreshes, and re-prompts at the new price', async () => {
    const h = harness(5000, [service()], [], async () =>
      result({ reason: 'price_changed', balance: 4900 }),
    );
    h.next.items = [service({ costClaudium: 1500 })];
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.setPriceChanged).toHaveBeenLastCalledWith(true);
    expect(h.deps.setBalance).toHaveBeenCalledWith(4900);
    expect(h.deps.refreshStore).toHaveBeenCalledTimes(1);
    // The re-prompt quotes the refreshed price, so the player confirms the new number.
    expect(h.deps.showDecision).toHaveBeenCalledTimes(2);
    const reprompt = h.deps.showDecision.mock.calls[1][0] as { body: string };
    expect(reprompt.body).toMatch(/1\D?500/);
  });

  it('on price_changed with the SAME price after refresh, does not loop on the prompt', async () => {
    const h = harness(5000, [service()], [], async () => result({ reason: 'price_changed' }));
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.showDecision).toHaveBeenCalledTimes(1);
  });

  it("on insufficient_balance: takes the balance, repaints, and quotes the service's own cost", async () => {
    const h = harness(5000, [service()], [], async () =>
      result({ reason: 'insufficient_balance', balance: 300, costClaudium: 1300 }),
    );
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.setBalance).toHaveBeenCalledWith(300);
    expect(h.deps.rebuildAndPaint).toHaveBeenCalledTimes(1);
    expect(h.deps.showNeedMore).toHaveBeenCalledWith(NAME, 1300, 300, 7);
    expect(h.deps.refreshStore).not.toHaveBeenCalled();
  });

  it('on insufficient_balance with no usable service cost, quotes the sent cost', async () => {
    const h = harness(5000, [service()], [], async () =>
      result({ reason: 'insufficient_balance', balance: 300, costClaudium: 0 }),
    );
    h.controller.request(REINS);
    await confirm(h);
    expect(h.deps.showNeedMore).toHaveBeenCalledWith(NAME, 1200, 300, 7);
  });
});

describe('StoreMountPurchase.purchase outcomes on a stale surface', () => {
  async function stale(spend: StoreMountPurchaseDeps['spend']): Promise<Harness> {
    const h = harness(5000, [service()], [], spend);
    h.controller.request(REINS);
    h.surface.current = false;
    await confirm(h);
    return h;
  }

  it('reports a grant as a success result rather than painting a body nobody sees', async () => {
    const h = await stale(async () => result({ granted: true }));
    expect(h.deps.showResult).toHaveBeenCalledWith('success', t('hudChrome.wocStore.owned'));
    expect(h.deps.refreshStore).not.toHaveBeenCalled();
    expect(h.deps.setError).not.toHaveBeenCalled();
  });

  it('reports price_changed, insufficient_balance, and a refusal as failure results', async () => {
    const priced = await stale(async () => result({ reason: 'price_changed' }));
    expect(priced.deps.showResult).toHaveBeenCalledWith(
      'failure',
      t('hudChrome.wocStore.priceChanged'),
    );
    const short = await stale(async () =>
      result({ reason: 'insufficient_balance', balance: 50, costClaudium: 1300 }),
    );
    expect(short.deps.showResult).toHaveBeenCalledWith('failure', `${NAME}|1300|50`);
    const refused = await stale(async () => result({ reason: 'unavailable' }));
    expect(refused.deps.showResult).toHaveBeenCalledWith('failure', t('hudChrome.wocStore.error'));
    for (const h of [priced, short, refused]) expect(h.deps.setError).not.toHaveBeenCalled();
  });

  it('reports a thrown spend as a failure result, never the in-surface error state', async () => {
    const h = await stale(async () => {
      throw new Error('network');
    });
    expect(h.deps.showResult).toHaveBeenCalledWith('failure', t('hudChrome.wocStore.error'));
    expect(h.deps.setError).not.toHaveBeenCalled();
  });
});
