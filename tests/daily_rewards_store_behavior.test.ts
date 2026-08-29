// @vitest-environment happy-dom
//
// A real DOM, for one reason: the charter purchase path now carries keyboard
// focus across its own innerHTML rebuild, and the only honest way to pin that is
// to focus a real button, drive a real refusal, and read document.activeElement.
// The pre-existing tests below keep their hand-rolled stubs (they predate this
// and exercise paint bookkeeping, not the DOM); with nothing focused,
// focusedWithin returns null at its body check and never touches a stub.
// happy-dom rather than jsdom to match tests/focus_restore.test.ts, the suite
// that owns the seam being exercised here.
import { afterEach, describe, expect, it, vi } from 'vitest';

// Counters live outside the factory so a test can assert WHEN the Armory stage
// is constructed, which is the whole point of the intent invariant below.
const armorySpy = vi.hoisted(() => ({ constructed: 0, opened: 0 }));
vi.mock('../src/ui/armory_inspect', () => ({
  ArmoryInspect: class {
    openSkinId: string | null = null;
    constructor() {
      armorySpy.constructed++;
    }
    close(): void {}
    destroy(): void {}
    open(): void {
      armorySpy.opened++;
    }
    refresh(): void {}
  },
  badgeLabel: () => '',
  rarityLabel: () => '',
  weaponTypeLabel: () => '',
}));
vi.mock('../src/ui/portrait_chip', () => ({
  hydratePortraits: () => undefined,
  portraitChipHtml: () => '',
}));

import { STORAGE_KEY_PATTERN as SERVER_STORAGE_KEY_PATTERN } from '../server/storage_purchases';
import { BANK_EXPANSION_PRICES, BANK_EXPANSION_SLOTS } from '../src/sim/bank';
import { STORAGE_SKUS } from '../src/sim/content/storage_charters';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { charterName } from '../src/ui/charter_card_view';
import { ClaudiumWindow } from '../src/ui/claudium_window';
import { DailyRewardsWindow, mintIntentKey } from '../src/ui/daily_rewards_window';
import { t } from '../src/ui/i18n';
import { StoreArmoryPurchase } from '../src/ui/store_armory_purchase';
import type { ArmorySkinRow, WocStoreItemInput } from '../src/ui/woc_store_view';
import type { DailyRewardStatus, IWorld } from '../src/world_api';

function worldStub(): IWorld {
  return {
    player: { templateId: 'warrior', mainhandItemId: null },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
  } as unknown as IWorld;
}

function rewardStatus(): DailyRewardStatus {
  return {
    enabled: true,
    day: '2026-08-25',
    resetAt: '2026-08-26T00:00:00.000Z',
    prizePoolUsd: 0,
    prizePoolSol: null,
    eligibility: {
      eligible: false,
      reason: 'no_wallet',
      banReason: null,
      walletPubkey: null,
      wocBalance: null,
      wocUsdPrice: null,
      usdValue: null,
      minUsd: 20,
    },
    score: 0,
    rank: null,
    spin: { claimed: false, points: null, outcomeKey: null, claimedAt: null },
    tasks: [],
    leaderboard: [],
    leaderboardTotal: 0,
  };
}

function rootStub(body: Record<string, unknown> | null = null): HTMLElement {
  const indicator = {
    classList: { toggle: vi.fn() },
    setAttribute: vi.fn(),
  };
  return {
    style: { display: 'block' },
    querySelector(selector: string) {
      if (selector === '.dr-body') return body;
      if (selector === '[data-woc-store-loading]') return indicator;
      return null;
    },
  } as unknown as HTMLElement;
}

interface CapturedStoreDecision {
  title: string;
  body: string;
  onOk?: () => void;
  onCancel?: () => void;
}

function interceptStoreDecisions(
  window: DailyRewardsWindow,
  capture: (decision: CapturedStoreDecision) => void,
): void {
  Object.assign(window as unknown as Record<string, unknown>, {
    showStoreDecision: (options: {
      title: string;
      body: string;
      onConfirm: () => void;
      onCancel?: () => void;
    }) => {
      capture({
        title: options.title,
        body: options.body,
        onOk: options.onConfirm,
        onCancel: options.onCancel,
      });
      return true;
    },
  });
}

describe('DailyRewardsWindow store intent', () => {
  // The invariant this branch ships: NO Armory preparation on store open, the
  // stage built only by the click that opens a card. Source walks cannot lock
  // it (an early call added inside paintStore, where the click handler is
  // wired, passed every one of them), so this drives the real path and counts
  // constructions.
  it('builds the Armory stage on a card click and on nothing else', async () => {
    armorySpy.constructed = 0;
    armorySpy.opened = 0;
    const clicks = new Map<string, () => void>();
    let html = '';
    const body = {
      dataset: {} as Record<string, string>,
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
      },
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector !== '[data-armory-skin]') return [];
        // One button per catalogue skin, exactly as the painted markup carries.
        return Object.keys(WEAPON_SKINS).map((id) => ({
          dataset: { armorySkin: id },
          addEventListener: (_type: string, handler: () => void) => clicks.set(id, handler),
        }));
      },
    };
    // A root that answers every chrome lookup rather than only the ones this
    // test cares about: syncTabs and the loading indicator both walk it, and a
    // null there throws into renderCurrent's fire-and-forget void, which is
    // silent. Unknown selectors get an inert element instead of null.
    const chrome = () => ({
      classList: { toggle: () => undefined, add: () => undefined, remove: () => undefined },
      setAttribute: () => undefined,
      focus: () => undefined,
      dataset: {} as Record<string, string>,
    });
    const intentRoot = {
      style: { display: 'block' },
      classList: chrome().classList,
      querySelector: (selector: string) => (selector === '.dr-body' ? body : chrome()),
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const window = new DailyRewardsWindow({
      // Own root stub: the shared one has no querySelectorAll, and syncTabs needs
      // it. Without it renderCurrent rejects into the fire-and-forget void and
      // the store silently never paints, which is exactly how the first version
      // of this test failed.
      root: () => intentRoot,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: async () => ({ available: true, balance: 1000, items: [] }),
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'store' });

    // Open for real: renderCurrent is NOT stubbed, so renderStore and paintStore
    // both run and the click handlers get wired.
    window.openStore();
    await vi.waitFor(() => expect(clicks.size).toBeGreaterThan(0));

    // The store is painted and interactive, and no stage exists.
    expect(armorySpy.constructed).toBe(0);
    expect(armorySpy.opened).toBe(0);

    const [firstSkinId] = [...clicks.keys()];
    clicks.get(firstSkinId)?.();

    // Exactly one build, exactly one open, and only from the click.
    expect(armorySpy.constructed).toBe(1);
    expect(armorySpy.opened).toBe(1);

    // A second card reuses the one stage rather than minting another context.
    const secondSkinId = [...clicks.keys()][1];
    clicks.get(secondSkinId)?.();
    expect(armorySpy.constructed).toBe(1);
    expect(armorySpy.opened).toBe(2);
  });
});

describe('StoreArmoryPurchase lifecycle guard', () => {
  it('holds the skin guard until the authoritative refresh finishes', async () => {
    let releaseRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => (releaseRefresh = resolve));
    const spend = vi.fn(async () => ({
      granted: true,
      balance: 800,
      costClaudium: 200,
      reason: null,
    }));
    const showDecision = vi.fn();
    const row = {
      skin: WEAPON_SKINS.cinderbrand_sword,
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    } as ArmorySkinRow;
    const purchases = new StoreArmoryPurchase({
      balance: () => 1_000,
      setBalance: vi.fn(),
      captureSurface: () => 7,
      surfaceIsCurrent: () => true,
      spend,
      showDecision,
      showNeedMore: vi.fn(),
      showResult: vi.fn(),
      needMoreText: () => 'Need more',
      setPriceChanged: vi.fn(),
      setError: vi.fn(),
      refreshStore: () => refresh,
      rebuildAndPaint: vi.fn(),
      rowById: () => row,
      refreshInspector: vi.fn(),
    });

    const first = purchases.purchase(row);
    await vi.waitFor(() => expect(spend).toHaveBeenCalledOnce());
    // spend() has settled, but the mirror is still stale until refresh resolves.
    purchases.request(row);
    void purchases.purchase(row);
    await Promise.resolve();

    expect(showDecision).not.toHaveBeenCalled();
    expect(spend).toHaveBeenCalledOnce();

    releaseRefresh();
    await first;
    purchases.request(row);
    expect(showDecision).toHaveBeenCalledOnce();
  });
});

describe('DailyRewardsWindow store refresh behavior', () => {
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = '';
  });

  function pendingRewardsHarness() {
    document.body.innerHTML = '<section id="daily-test" style="display: block"></section>';
    const root = document.getElementById('daily-test') as HTMLElement;
    let resolveStatus!: (status: DailyRewardStatus) => void;
    const status = new Promise<DailyRewardStatus>((resolve) => (resolveStatus = resolve));
    const world = {
      ...worldStub(),
      dailyRewards: () => status,
      dailyRewardHistory: async () => ({ payouts: [] }),
    } as unknown as IWorld;
    const window = new DailyRewardsWindow({
      root: () => root,
      world: () => world,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: async () => ({ available: true, balance: 1_000, items: [] }),
    });
    const internals = window as unknown as {
      tab: 'store' | 'rewards';
      paint(view: unknown): void;
    };
    internals.tab = 'rewards';
    const paint = vi.spyOn(internals, 'paint');
    return { root, window, internals, resolveStatus, paint };
  }

  it('cannot let a stale Rewards request repaint the shared body after selecting Store', async () => {
    const h = pendingRewardsHarness();
    const pending = h.window.render();

    h.window.openStore();
    h.resolveStatus(rewardStatus());
    await pending;

    expect(h.internals.tab).toBe('store');
    expect(h.paint).not.toHaveBeenCalled();
  });

  it('cannot let a stale Rewards request repaint after Store close and rapid reopen', async () => {
    const h = pendingRewardsHarness();
    const pending = h.window.render();

    h.window.close();
    h.window.openStore();
    h.resolveStatus(rewardStatus());
    await pending;

    expect(h.root.style.display).toBe('block');
    expect(h.internals.tab).toBe('store');
    expect(h.paint).not.toHaveBeenCalled();
    h.window.close();
  });

  it('lets only the newest snapshot write state or clear its loading indicator', async () => {
    type Snapshot = { available: boolean; balance: number | null; items: WocStoreItemInput[] };
    let resolveFirst!: (snapshot: Snapshot) => void;
    let resolveSecond!: (snapshot: Snapshot) => void;
    const snapshots = [
      new Promise<Snapshot>((resolve) => (resolveFirst = resolve)),
      new Promise<Snapshot>((resolve) => (resolveSecond = resolve)),
    ];
    let call = 0;
    const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: () => snapshots[call++],
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'store' });
    const internals = window as unknown as {
      renderStore(focus: null): Promise<void>;
      storeBalance: number | null;
      storeLoading: boolean;
    };

    const first = internals.renderStore(null);
    const second = internals.renderStore(null);
    resolveFirst({ available: true, balance: 111, items: [] });
    await first;
    expect(internals.storeBalance).toBeNull();
    expect(internals.storeLoading).toBe(true);

    resolveSecond({ available: true, balance: 222, items: [] });
    await second;
    expect(internals.storeBalance).toBe(222);
    expect(internals.storeLoading).toBe(false);
  });

  it('does not render wallet connection controls in the Store', () => {
    let html = '';
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    (window as unknown as { paintStore(body: HTMLElement): void }).paintStore(
      body as unknown as HTMLElement,
    );

    expect(html).not.toContain('Connect wallet');
    expect(html).not.toContain('recovery phrase or private key');
    expect(html).not.toContain('data-store-wallet');
    expect(html).not.toContain('woc-store-wallet');
  });

  it('selects and opens the Store without toggling an open window closed', () => {
    const root = rootStub();
    root.style.display = 'none';
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'rewards' });
    const toggle = vi.spyOn(window, 'toggle').mockImplementation(() => undefined);

    window.openStore();

    expect(toggle).toHaveBeenCalledOnce();
    expect((window as unknown as { tab: string }).tab).toBe('store');

    root.style.display = 'block';
    toggle.mockClear();
    const renderCurrent = vi
      .spyOn(
        window as unknown as { renderCurrent(focus: 'open' | null): Promise<void> },
        'renderCurrent',
      )
      .mockResolvedValue();
    window.openStore();

    expect(toggle).not.toHaveBeenCalled();
    expect(renderCurrent).toHaveBeenCalledWith('open');
  });

  it('does not rebuild an unchanged store body during a background refresh', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(1);
  });

  it('rebuilds the store body when its visible state changes', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    Object.assign(window as unknown as Record<string, unknown>, { storeBalance: 1_250 });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(2);
    expect(html).toContain('1,250');
  });

  it('restores unchanged store markup after the rewards tab occupied the shared body', () => {
    let writes = 0;
    const body = {
      dataset: {},
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    Object.defineProperty(body, 'innerHTML', {
      get: () => '',
      set: () => {
        writes += 1;
      },
    });
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      armorySections: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    const paintRewards = (
      window as unknown as { paint(view: { kind: 'error'; message: string }): void }
    ).paint.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintRewards({ kind: 'error', message: 'unavailable' });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(3);
  });

  it('preserves the last successful store state when a background snapshot is unavailable', async () => {
    const body = {
      innerHTML: 'existing store',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const root = rootStub(body);
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      storeSnapshot: async () => ({ available: false, balance: 100, items: [] }),
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      tab: 'store',
      storeReady: true,
      storeBalance: 750,
      storeItems: [],
      armorySections: [],
    });

    await (window as unknown as { renderStore(focus: 'open' | null): Promise<void> }).renderStore(
      null,
    );

    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(750);
    expect((window as unknown as { storeError: boolean }).storeError).toBe(false);
    expect(body.innerHTML).not.toContain('dr-error');
  });

  it('opens the top-up dialog from an authoritative insufficient-balance response', async () => {
    const root = rootStub();
    const dialog: { body: string; onOk?: () => void } = { body: '' };
    const order: string[] = [];
    const openClaudium = vi.fn(() => order.push('claudium'));
    const spendStoreItem = vi.fn(async () => ({
      granted: false,
      balance: 100,
      costClaudium: 1_000,
      reason: 'insufficient_balance',
    }));
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      spendStoreItem,
      openClaudium,
    });
    interceptStoreDecisions(window, (decision) => {
      dialog.body = decision.body;
      dialog.onOk = decision.onOk;
    });
    const row = {
      skin: WEAPON_SKINS.cinderbrand_sword,
      costClaudium: 200,
    } as ArmorySkinRow;
    Object.assign(window as unknown as Record<string, unknown>, {
      armoryInspect: { close: () => order.push('inspect') },
    });

    await (
      window as unknown as {
        armoryPurchases: { purchase(row: ArmorySkinRow): Promise<void> };
      }
    ).armoryPurchases.purchase(row);

    expect(spendStoreItem).toHaveBeenCalledWith('cinderbrand_sword', 'skin', 200);
    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(100);
    expect(dialog.body).toContain('900');
    expect(dialog.body).toContain('Cinderbrand');
    expect(dialog.onOk).toBeTypeOf('function');
    dialog.onOk?.();
    expect(openClaudium).toHaveBeenCalledOnce();
    expect(order).toEqual(['inspect', 'claudium']);
  });

  it('refreshes and requires a new confirmation when the service price changed', async () => {
    const confirmations: string[] = [];
    const spendStoreItem = vi.fn(async () => ({
      granted: false,
      balance: 2_000,
      costClaudium: 1_000,
      reason: 'price_changed',
    }));
    const window = new DailyRewardsWindow({
      root: () => rootStub(),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      spendStoreItem,
    });
    interceptStoreDecisions(window, (decision) => confirmations.push(decision.body));
    const original = {
      skin: WEAPON_SKINS.cinderbrand_sword,
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    } as ArmorySkinRow;
    const current = { ...original, costClaudium: 1_000 } as ArmorySkinRow;
    Object.assign(window as unknown as Record<string, unknown>, {
      armorySections: [],
      renderStore: async () => {
        Object.assign(window as unknown as Record<string, unknown>, {
          armorySections: [{ rows: [current] }],
        });
      },
    });

    await (
      window as unknown as {
        armoryPurchases: { purchase(row: ArmorySkinRow): Promise<void> };
      }
    ).armoryPurchases.purchase(original);

    expect(spendStoreItem).toHaveBeenCalledWith('cinderbrand_sword', 'skin', 200);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain('1,000');
  });
});

// ── Strongbox Charters: rendering, the result contract, and the money pin ────
//
// These drive the REAL painter and purchase paths over hand-rolled stubs (the
// harness style the file already uses), because the invariants they protect are
// behavioral: which idempotency key leaves the client on a retry, and whether a
// paid-but-not-yet-applied purchase reads as success or as a lost purchase.

interface SpendResult {
  granted: boolean;
  balance: number | null;
  costClaudium: number | null;
  reason: string | null;
}

interface SpendCall {
  itemId: string;
  kind: string;
  cost: number;
  key: string | undefined;
}

const CHARTER_ITEMS: WocStoreItemInput[] = [
  { itemId: 'strongbox_charter_1', name: 'c1', kind: 'storage', costClaudium: 500, owned: false },
  { itemId: 'strongbox_charter_2', name: 'c2', kind: 'storage', costClaudium: 900, owned: false },
  { itemId: 'strongbox_charter_3', name: 'c3', kind: 'storage', costClaudium: 1_500, owned: false },
  {
    itemId: 'strongbox_charter_complete',
    name: 'c4',
    kind: 'storage',
    costClaudium: 2_000,
    owned: false,
  },
  // A ladder rung sitting in the SAME service snapshot. It must never become a
  // card: the store list is the registry minus everything with a ladderIndex.
  { itemId: 'strongbox_rung_01', name: 'rung', kind: 'storage', costClaudium: 100, owned: false },
];

// Derived, never hardcoded: a ladder retune (a longer BANK_EXPANSION_PRICES, a
// different rung size, a re-costed charter) must move these tests with the
// content instead of leaving a stale 72 behind that still passes.
const LADDER_CEILING_SLOTS = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
const CHARTER_GRANTS = Object.values(STORAGE_SKUS)
  .filter((sku) => sku.ladderIndex === undefined)
  .map((sku) => sku.grantSlots)
  .sort((a, b) => a - b);
const SMALLEST_CHARTER_GRANT = CHARTER_GRANTS[0];

function charterHarness(
  options: {
    results?: SpendResult[];
    balance?: number;
    /** The character's ladder position, as the ALWAYS-available owner-only read
     *  reports it (src/world_api/bank.ts bankPurchasedSlots). null is "not
     *  observable yet", which the pure core reads as "no fit gate ran". Before
     *  Bank Storage phase 15 this was staged through the banker-gated bankInfo,
     *  which the store no longer reads at all. */
    purchasedSlots?: number | null;
    items?: WocStoreItemInput[];
    /** Runs before the result is returned, so a test can move the catalog price
     *  exactly when the service would have noticed it. */
    onSpend?(call: number, items: WocStoreItemInput[]): void;
    /** Omit spendStoreItem entirely (the offline / hookless store). */
    noSpendHook?: boolean;
    /** Reject after the optional gate, modeling a transport outage. */
    rejectSpend?: boolean;
    /** Hold the spend open until the test resolves it, for the in-flight guard. */
    gate?: { wait: Promise<void> };
    /** Exercise the real StoreDecisionPrompts path instead of recording the
     *  decision, for prompt-stack ownership and collision coverage. */
    realDecisions?: boolean;
    /** Give the stub world an identity, which is what turns DURABILITY on
     *  (src/ui/purchase_intent_durability.ts derives the storage row from
     *  `<class>_<name>` and writes nothing at all when the name is empty).
     *  Omitted by default ON PURPOSE: every other arm in this file predates
     *  phase 16 and must keep running against an inert durable layer, or a
     *  record written by one test would be restored by the next. */
    scope?: { playerClass: string; name: string };
  } = {},
) {
  const results = options.results ?? [];
  const spendCalls: SpendCall[] = [];
  const dialogs: { title: string; body: string; onOk?: () => void; onCancel?: () => void }[] = [];
  const claudiumReturns: ((() => void) | undefined)[] = [];
  const state = {
    snapshots: 0,
    // Live, so a test can fill the ladder between the spend and the refresh the
    // way a real grant does.
    purchasedSlots: options.purchasedSlots ?? null,
    // DEEP copy: onSpend mutates a row to move a price, and a shallow spread
    // would write that through to the shared CHARTER_ITEMS objects and leak the
    // moved price into every later harness in the file.
    items: (options.items ?? CHARTER_ITEMS).map((item) => ({ ...item })),
  };
  // A REAL root, not a stub. The charter path carries keyboard focus across its
  // own innerHTML rebuild, so these tests need real buttons, a real
  // document.activeElement, and a real disabled property. The shell markup here
  // is the part ensureShell() paints once and replaceStoreBody never touches:
  // the loading indicator and the persistent live region both live outside the
  // rebuilt body on purpose.
  const root = document.createElement('div');
  if (!document.getElementById('prompt-stack')) {
    const promptStack = document.createElement('div');
    promptStack.id = 'prompt-stack';
    document.body.appendChild(promptStack);
  }
  root.innerHTML =
    '<div class="woc-store-tabs">' +
    '<span data-woc-store-loading></span>' +
    '<span class="visually-hidden" data-charter-live role="status" aria-live="polite"></span>' +
    // The shell chrome an ERROR body has to hand focus to, since the error body
    // itself carries no control at all (Bank Storage phase 17). Both are painted
    // by titleHtml / tabsHtml in the real shell and both survive every
    // replaceStoreBody wipe, which is the property the fix depends on.
    '<button type="button" data-close>x</button>' +
    '<button type="button" data-woc-store-tab="store">Store</button>' +
    '</div>' +
    '<div id="woc-store-panel" class="dr-body woc-store-body"></div>';
  root.style.display = 'block';
  document.body.appendChild(root);
  const body = root.querySelector<HTMLElement>('.dr-body') as HTMLElement;
  const window_ = new DailyRewardsWindow({
    root: () => root,
    world: () =>
      ({
        player: {
          templateId: 'warrior',
          mainhandItemId: null,
          ...(options.scope ? { name: options.scope.name } : {}),
        },
        ...(options.scope ? { cfg: { playerClass: options.scope.playerClass } } : {}),
        accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
        get bankPurchasedSlots() {
          return state.purchasedSlots;
        },
      }) as unknown as IWorld,
    closeOthers: () => undefined,
    captureFocus: () => null,
    restoreFocus: () => undefined,
    storeEnabled: () => true,
    storeSnapshot: async () => {
      state.snapshots += 1;
      return { available: true, balance: options.balance ?? 5_000, items: [...state.items] };
    },
    spendStoreItem: options.noSpendHook
      ? undefined
      : async (itemId, kind, cost, key) => {
          spendCalls.push({ itemId, kind, cost, key });
          options.onSpend?.(spendCalls.length, state.items);
          if (options.gate) await options.gate.wait;
          if (options.rejectSpend) throw new Error('transport unavailable');
          return (
            results[spendCalls.length - 1] ?? {
              granted: true,
              balance: 1_000,
              costClaudium: cost,
              reason: null,
            }
          );
        },
    openClaudium: (onClosed) => claudiumReturns.push(onClosed),
  });
  if (!options.realDecisions) {
    interceptStoreDecisions(window_, (decision) => dialogs.push(decision));
  }
  const internals = window_ as unknown as {
    renderStore(focus: 'open' | null, opts?: { background?: boolean }): Promise<void>;
    purchaseCharter(itemId: string): Promise<void>;
    requestCharterPurchase(itemId: string): void;
    charterNotice: { tone: string; text: string } | null;
    storeError: boolean;
    charterIntents: { isOpen(itemId: string): boolean };
    tab: 'store' | 'rewards';
    storeReady: boolean;
    charterFocus: { arm(key: string | null): void; peek(): string | null };
    repaintStore(): void;
    purchaseArmorySkin(row: unknown): Promise<void>;
    setCharterBusy(itemId: string, busy: boolean): void;
  };
  const armoryPurchases = (
    window_ as unknown as { armoryPurchases: { purchase(row: unknown): Promise<void> } }
  ).armoryPurchases;
  internals.purchaseArmorySkin = (row) => armoryPurchases.purchase(row);
  const buyButton = (itemId: string) =>
    root.querySelector<HTMLButtonElement>(`[data-charter-buy="${itemId}"]`);
  // A PAINT counter, because the DOM cannot answer "did it repaint": the window
  // elides an innerHTML write whose markup is byte-identical (replaceStoreBody),
  // so a poll that rebuilt the whole store body for nothing leaves the tree, and
  // even the element identities, untouched. An own property shadows the
  // prototype method, so the window's internal `this.paintStore(...)` calls land
  // here too. Without this, every "does nothing" arm below measures the elision
  // rather than the guard it claims to pin.
  const paints: { count: number; opts: Array<{ background?: boolean } | undefined> } = {
    count: 0,
    opts: [],
  };
  type PaintFn = (body: HTMLElement, opts?: { background?: boolean }) => void;
  const protoPaint = (Object.getPrototypeOf(window_) as { paintStore: PaintFn }).paintStore;
  // Forward EVERY argument. A spy that took only the first would silently drop
  // the `background` flag and make the focus arms below test a path the code
  // never actually runs.
  (window_ as unknown as { paintStore: PaintFn }).paintStore = function paintStore(
    this: unknown,
    ...args: Parameters<PaintFn>
  ) {
    paints.count++;
    // Record the OPTIONS too, so an arm can assert what a call site passed
    // rather than inferring it from a focus side effect three layers down.
    paints.opts.push(args[1]);
    return protoPaint.apply(this, args);
  };
  return {
    window: window_,
    paints,
    internals,
    state,
    spendCalls,
    dialogs,
    claudiumReturns,
    root,
    body,
    buyButton,
    html: () => body.innerHTML,
    buttons: () => [...root.querySelectorAll<HTMLButtonElement>('[data-charter-buy]')],
    click: (itemId: string) => buyButton(itemId)?.click(),
    live: () => root.querySelector<HTMLElement>('[data-charter-live]')?.textContent ?? '',
  };
}

describe('WOC Store Strongbox charters', () => {
  // Every harness mounts its root on document.body and paintStore reads
  // focusedWithin(document) over the WHOLE document, so a control left focused
  // by an earlier arm would flip focusWentNowhere and change a later plan.
  // Clearing here makes that structural rather than a per-arm discipline.
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.innerHTML = '';
    // The durable purchase row is per ORIGIN and outlives a test by design, so
    // it has to be cleared here or an intent one arm persisted would be restored
    // by the next one and mint nothing. TARGETED rather than clear(), which would
    // also wipe unrelated keys these arms never touch.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('woc_purchase_intents')) localStorage.removeItem(key);
    }
  });

  it('the affordability gate lets the FROZEN cost through when it is the LOWER one', async () => {
    // THE DEFECT PHASE 17 FOUND by asking phase 16's open question from the other
    // end. `row.affordable` is computed from the LIVE catalog price, and after a
    // restore that is not what the wire carries. Frozen at 400, catalog since
    // moved to 500, balance 450: the player can afford the purchase that will
    // actually happen, and the old order sent them to the top-up window to spend
    // real money they did not need to spend.
    const scope = { playerClass: 'warrior', name: 'Cheaper' };
    localStorage.setItem(
      `woc_purchase_intents_${scope.playerClass}_${scope.name}`,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        intents: {
          [CHARTER_ITEMS[0].itemId]: {
            key: 'intent-frozen-cheaper',
            costClaudium: 400,
            mintedAtMs: Date.now() - 1_000,
          },
        },
      }),
    );
    const h = charterHarness({ scope, purchasedSlots: 0, balance: 450 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);

    // A CONFIRM, not a top-up handoff. Told apart by the TITLE, because both go
    // through the same confirmDialog dep and a body substring could match either.
    expect(h.dialogs, 'exactly one dialog opened').toHaveLength(1);
    expect(h.dialogs[0].title).toBe(t('hudChrome.wocStore.charter.confirmTitle'));
    expect(h.dialogs[0].title).not.toBe(t('hudChrome.wocStore.needMoreTitle'));
    expect(h.dialogs[0].body, 'and it quotes the frozen cost').toBe(
      t('hudChrome.wocStore.charter.confirmBody', {
        item: charterName(CHARTER_ITEMS[0].itemId),
        cost: '400',
      }),
    );
    h.dialogs[0].onOk?.();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.spendCalls, 'the purchase went out rather than being refused locally').toHaveLength(1);
    expect(h.spendCalls[0].cost).toBe(400);
    expect(h.spendCalls[0].key).toBe('intent-frozen-cheaper');
  });

  it('a frozen cost the balance cannot cover still CONFIRMS while the live price fits', async () => {
    // The direction the review round caught, and it is the reason the gate reads
    // BOTH costs. Frozen 600, catalog since retuned DOWN to 500, balance 550: the
    // frozen cost does not fit and the live one does, and the purchase really is
    // reachable, because a frozen cost the catalog has moved past comes back as a
    // definitive price_changed that mints afresh at the new price. Refusing here
    // would send the player to buy real money for a product their balance already
    // covers.
    const scope = { playerClass: 'warrior', name: 'Dearer' };
    localStorage.setItem(
      `woc_purchase_intents_${scope.playerClass}_${scope.name}`,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        intents: {
          [CHARTER_ITEMS[0].itemId]: {
            key: 'intent-frozen-dearer',
            costClaudium: 600,
            mintedAtMs: Date.now() - 1_000,
          },
        },
      }),
    );
    const h = charterHarness({ scope, purchasedSlots: 0, balance: 550 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);

    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].title).toBe(t('hudChrome.wocStore.charter.confirmTitle'));
    // It still quotes the FROZEN cost, because that is what goes on the wire
    // first; the round trip is what converts it.
    expect(h.dialogs[0].body).toBe(
      t('hudChrome.wocStore.charter.confirmBody', {
        item: charterName(CHARTER_ITEMS[0].itemId),
        cost: '600',
      }),
    );
  });

  it('a first UNAFFORDABLE click MINTS and persists, so the top-up round trip carries ONE key', async () => {
    // The side effect the reorder's own reasoning rests on and nothing asserted:
    // the mint now happens above the gate, so an unaffordable click writes a
    // durable record where none was written before. Both halves matter. It is
    // what makes the round trip carry one key instead of a fresh one per attempt,
    // and it is the thing a reader should be able to check against the "the save
    // rides the mint" residual rather than take on trust.
    const scope = { playerClass: 'warrior', name: 'Skint' };
    const row = `woc_purchase_intents_${scope.playerClass}_${scope.name}`;
    expect(localStorage.getItem(row), 'nothing carried in from another arm').toBeNull();
    const h = charterHarness({ scope, purchasedSlots: 0, balance: 10 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);

    expect(h.dialogs[0].title).toBe(t('hudChrome.wocStore.needMoreTitle'));
    const stored = JSON.parse(localStorage.getItem(row) ?? 'null');
    const entry = stored?.intents?.[CHARTER_ITEMS[0].itemId];
    expect(entry, 'the click minted and persisted an intent').toBeTruthy();
    expect(entry.costClaudium).toBe(CHARTER_ITEMS[0].costClaudium);

    // ...and the SECOND click after a top-up reuses it rather than minting again.
    const firstKey = entry.key;
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);
    const again = JSON.parse(localStorage.getItem(row) ?? 'null')?.intents?.[
      CHARTER_ITEMS[0].itemId
    ];
    expect(again.key, 'one key across the whole top-up round trip').toBe(firstKey);
  });

  it('refuses locally only when NEITHER cost is reachable, and quotes the LOWER one', async () => {
    // The negative control for both directional arms: a gate that simply stopped
    // running would satisfy them and fail here. Frozen 600, catalog 500, balance
    // 450: nothing gets there, and the shortfall the player is asked to cover is
    // against the cheaper route (500 - 450 = 50), not the dearer one.
    const scope = { playerClass: 'warrior', name: 'Broke' };
    localStorage.setItem(
      `woc_purchase_intents_${scope.playerClass}_${scope.name}`,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        intents: {
          [CHARTER_ITEMS[0].itemId]: {
            key: 'intent-frozen-unreachable',
            costClaudium: 600,
            mintedAtMs: Date.now() - 1_000,
          },
        },
      }),
    );
    const h = charterHarness({ scope, purchasedSlots: 0, balance: 450 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);

    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].title).toBe(t('hudChrome.wocStore.needMoreTitle'));
    // Asserted as the whole resolved sentence rather than a substring: '50' is a
    // substring of '500' and of '150', so a containment check here would pass for
    // the wrong number.
    expect(h.dialogs[0].body).toBe(
      t('hudChrome.wocStore.needMoreBody', {
        item: charterName(CHARTER_ITEMS[0].itemId),
        shortfall: '50',
      }),
    );
    expect(h.spendCalls, 'nothing went out').toHaveLength(0);
  });

  it('with NO restored intent the gate is unchanged: the catalog price is the sent price', async () => {
    // The ordinary path, pinned so the reorder cannot have moved it. Balance 450
    // against a 500 catalog charter still refuses, and the handoff quotes the
    // catalog shortfall.
    const h = charterHarness({ purchasedSlots: 0, balance: 450 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].title).toBe(t('hudChrome.wocStore.needMoreTitle'));
    expect(h.dialogs[0].body).toBe(
      t('hudChrome.wocStore.needMoreBody', {
        item: charterName(CHARTER_ITEMS[0].itemId),
        shortfall: '50',
      }),
    );
    expect(h.spendCalls).toHaveLength(0);
  });

  it('RESTORES a persisted intent, so the key that survived the page is the key that goes out', async () => {
    // THE WIRING PIN. Everything else about durability is proven against the
    // ledger and the record core directly; this is the only arm that fails if
    // this window is reverted to a memory-only ledger, which is the one edit
    // that reopens ruling 19 in the product.
    const scope = { playerClass: 'warrior', name: 'Borin' };
    const survived = 'intent-survived-the-page';
    localStorage.setItem(
      `woc_purchase_intents_${scope.playerClass}_${scope.name}`,
      JSON.stringify({
        v: 1,
        scope: `${scope.playerClass}_${scope.name}`,
        intents: {
          [CHARTER_ITEMS[0].itemId]: {
            key: survived,
            // The FROZEN cost, deliberately different from the catalog price the
            // harness serves, so the assertion below cannot pass by coincidence.
            costClaudium: 321,
            mintedAtMs: Date.now() - 1_000,
          },
        },
      }),
    );
    const h = charterHarness({ scope, purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase(CHARTER_ITEMS[0].itemId);
    expect(h.dialogs).toHaveLength(1);
    h.dialogs[0].onOk?.();
    // purchaseCharter is fired and forgotten by the dialog, so drain the
    // microtask queue rather than assert into an unresolved promise.
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.spendCalls).toHaveLength(1);
    expect(h.spendCalls[0].key, 'the SURVIVING key, not a fresh mint').toBe(survived);
    expect(h.spendCalls[0].cost, 'and its FROZEN cost, not the live catalog price').toBe(321);
  });

  it('renders every charter from the service snapshot and no ladder rung', async () => {
    const h = charterHarness();
    await h.internals.renderStore(null);

    expect(h.html()).toContain('charter-section');
    for (const id of [
      'strongbox_charter_1',
      'strongbox_charter_2',
      'strongbox_charter_3',
      'strongbox_charter_complete',
    ]) {
      expect(h.html()).toContain(`data-charter-buy="${id}"`);
    }
    expect(h.html()).not.toContain('strongbox_rung');
    // The service price, not a computed one, and the shared economy disclaimer.
    expect(h.html()).toContain('2,000');
    expect(h.html()).toContain('Prices may change with the game economy.');
    expect(h.html()).toContain(
      'A charter expands the bank of this character only. The bursar sells the same slots for gold.',
    );
    // No gold-to-Claudium equivalence anywhere in the painted category.
    expect(h.html()).not.toMatch(/cheaper|equivalent|exchange rate/i);
    // The cards are wired: a click reaches the purchase request.
    expect(h.buttons()).toHaveLength(4);
  });

  it('renders the unavailable treatment, not a price, for a charter the service is missing', async () => {
    // Drop two charters from the snapshot: the core still lists them (the
    // registry is the catalog) but with no usable price, so the card shows the
    // shared unavailable label and its button cannot start a purchase.
    const partial = charterHarness({
      items: CHARTER_ITEMS.filter((item) => item.itemId === 'strongbox_charter_1'),
    });
    await partial.internals.renderStore(null);

    expect(partial.html()).toContain('charter-cost unavailable');
    expect(partial.html()).toContain('Unavailable');
    // The real property, not the serialized attribute: this is what actually
    // stops a click and what restoreFirstEnabled skips.
    expect(partial.buyButton('strongbox_charter_complete')?.disabled).toBe(true);
    expect(partial.buyButton('strongbox_charter_1')?.disabled).toBe(false);
    // The priced one keeps its price and stays enabled, with a per-card name.
    expect(partial.html()).toContain('aria-label="Purchase Lesser Strongbox Charter"');
    expect(partial.html()).toContain('Lesser Strongbox Charter');
    expect(partial.html()).toContain('500');
    // A disabled card cannot open a confirm dialog even if its click is fired.
    partial.internals.requestCharterPurchase('strongbox_charter_complete');
    expect(partial.dialogs).toHaveLength(0);
    partial.internals.requestCharterPurchase('strongbox_charter_1');
    expect(partial.dialogs).toHaveLength(1);
  });

  it('explains itself when the fit gate ran and cleared every row', async () => {
    // purchasedSlots at the ceiling: every grant overflows, so no card can be
    // offered. The category must still say WHY. A category that simply vanishes
    // reads as a bug to someone who came here to spend.
    const h = charterHarness({ purchasedSlots: LADDER_CEILING_SLOTS });
    await h.internals.renderStore(null);

    expect(h.html()).toContain('charter-section');
    expect(h.html()).toContain('Strongbox Charters');
    expect(h.html()).toContain('The bank of this character has no room left for a charter.');
    expect(h.html()).not.toContain('data-charter-buy');
    // No price furniture on a category that sells nothing.
    expect(h.html()).not.toContain('charter-grid');
    expect(h.html()).not.toContain('Prices may change with the game economy.');
  });

  it('never claims "no room" when the fit gate could not run', async () => {
    // The ladder read is null before the first snapshot lands (and offline).
    // Nothing is known about this character's room, so the category lists every
    // charter and must NOT assert a fit answer either way.
    // (Rows come from the registry, not the service, so they are never empty
    // here even with an empty service snapshot: the reachable failure is
    // claiming "no room" on an unknown count, and that is what this pins.)
    for (const items of [undefined, [] as WocStoreItemInput[]]) {
      const h = charterHarness({ purchasedSlots: null, items });
      await h.internals.renderStore(null);

      expect(h.html()).toContain('charter-section');
      expect(h.html()).not.toContain('no room left');
      expect(h.buttons()).toHaveLength(4);
    }
  });

  // The ceiling the window passes to the pure core had NO value pin: every
  // mutant ceiling below the ladder top survived, and the two most plausible
  // edits (Math.min for Math.max, or STORE_CHARTERS[0].grantSlots) both yield
  // the smallest grant. In production that silently hides charters that DO fit,
  // from paying players, with no error anywhere. These two arms bracket it.
  it('lists exactly the charters that still fit at one grant below the ceiling', async () => {
    // Room for exactly the smallest charter: it renders, and nothing larger does.
    // Fails for any ceiling below the ladder top (the row would be hidden) and
    // for any ceiling a full grant above it (a larger charter would appear).
    const h = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT,
    });
    await h.internals.renderStore(null);

    const rendered = [...h.html().matchAll(/data-charter-buy="([^"]+)"/g)].map((m) => m[1]);
    const expected = Object.values(STORAGE_SKUS)
      .filter((sku) => sku.ladderIndex === undefined && sku.grantSlots === SMALLEST_CHARTER_GRANT)
      .map((sku) => sku.id);
    expect(rendered).toEqual(expected);
    expect(rendered).toHaveLength(1);
  });

  it('lists no charter at all one slot past the last that fits', async () => {
    // One slot tighter than the arm above: even the smallest grant overshoots,
    // so the category disappears. This is the upper bracket, and together with
    // the arm above it pins the ceiling to exactly the ladder top.
    const h = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT + 1,
    });
    await h.internals.renderStore(null);

    expect(h.html()).not.toContain('data-charter-buy');
    // The fit gate RAN here (a known count), so the category explains itself
    // rather than vanishing; what this arm pins is that no card is offered.
    // The ladder is NOT full at this count, so the honest sentence is the one
    // that says no CHARTER fits and points at the bursar, not the one that
    // claims the bank is out of room: eleven slots are still on sale for gold.
    expect(h.html()).toContain('No charter fits the room left in the bank of this character.');
    expect(h.html()).not.toContain('has no room left for a charter');
    // The gold pointer survives the empty arm. It is MOST useful here, which is
    // exactly where it used to be suppressed.
    expect(h.html()).toContain('The bursar sells the same slots for gold.');
  });

  it('explains hidden rungs on a NON-empty list, and only there (per-arm)', async () => {
    const hiddenLine =
      'Charters too large for the room left in the bank of this character are not shown.';
    // 0 hidden: everything fits, so nothing needs explaining.
    const allFit = charterHarness({ purchasedSlots: 0 });
    await allFit.internals.renderStore(null);
    expect(allFit.buttons()).toHaveLength(4);
    expect(allFit.html()).not.toContain(hiddenLine);

    // Some hidden: one rung renders while larger ones are fit-gated away; the
    // section must say so instead of silently showing a shorter ladder.
    const someHidden = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT,
    });
    await someHidden.internals.renderStore(null);
    expect(someHidden.buttons()).toHaveLength(1);
    expect(someHidden.html()).toContain(hiddenLine);

    // All hidden: the EMPTY arm already explains itself (no-charter-fits), so
    // the hidden line stays off it.
    const allHidden = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT + 1,
    });
    await allHidden.internals.renderStore(null);
    expect(allHidden.html()).toContain(
      'No charter fits the room left in the bank of this character.',
    );
    expect(allHidden.html()).not.toContain(hiddenLine);
  });

  it('repaints the transition into a hidden-rung state behind an identical row set', async () => {
    // The file's own markup-identity rule: every flag that changes what is
    // VISIBLE must reach the section string. The hidden line's presence is
    // part of the returned HTML, so two sections with the same rows but a
    // different hidden count can never be elided as byte-identical paints.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const before = h.html();
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;
    await h.internals.renderStore(null);
    expect(h.html()).not.toEqual(before);
    expect(h.html()).toContain(
      'Charters too large for the room left in the bank of this character are not shown.',
    );
  });

  it('says the bank is out of room only when the ladder is actually full', async () => {
    // The other half of the empty branch, and the discriminator between the two
    // sentences: at the ceiling nothing can EVER fit, so "no room left" is true
    // here and only here. Without a per-arm case the two states collapse and a
    // player with room left is told there is none.
    const h = charterHarness({ purchasedSlots: LADDER_CEILING_SLOTS });
    await h.internals.renderStore(null);

    expect(h.html()).not.toContain('data-charter-buy');
    expect(h.html()).toContain('The bank of this character has no room left for a charter.');
    expect(h.html()).not.toContain('No charter fits the room left');
    // And NO gold pointer here: at the ceiling the bursar has nothing left to
    // sell either, so the scope line would read as an invitation to a purchase
    // that cannot happen. It rides the other empty arm, where it is actionable.
    expect(h.html()).not.toContain('The bursar sells the same slots for gold.');
  });

  it('names each charter from its own t() key on the painted card', async () => {
    const h = charterHarness();
    await h.internals.renderStore(null);

    // All four switch arms, not just the one the other tests happen to click.
    const expected: [string, string][] = [
      ['strongbox_charter_1', 'Lesser Strongbox Charter'],
      ['strongbox_charter_2', 'Greater Strongbox Charter'],
      ['strongbox_charter_3', 'Grand Strongbox Charter'],
      ['strongbox_charter_complete', 'Complete Strongbox Charter'],
    ];
    for (const [id, name] of expected) {
      expect(h.html()).toContain(`data-charter-buy="${id}"`);
      expect(h.html()).toContain(name);
      expect(h.html()).toContain(`aria-label="Purchase ${name}"`);
    }
    // Distinct names, so a switch collapsing to one arm cannot pass.
    expect(new Set(expected.map(([, name]) => name)).size).toBe(4);
  });

  it('starts the purchase for the charter whose card was actually clicked', async () => {
    const h = charterHarness();
    await h.internals.renderStore(null);

    // The click edge itself, not just the listener count: fire the recorded
    // handler for one card and check the confirm dialog names THAT charter.
    h.click('strongbox_charter_3');

    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].title).toBe('Confirm Charter Purchase');
    expect(h.dialogs[0].body).toContain('Grand Strongbox Charter');
    expect(h.dialogs[0].body).toContain('1,500');
    expect(h.dialogs[0].body).not.toContain('Lesser');
  });

  it('refreshes the store after a granted purchase', async () => {
    const h = charterHarness({
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: null }],
    });
    await h.internals.renderStore(null);
    const before = h.state.snapshots;

    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.spendCalls[0].kind).toBe('storage');
    expect(h.state.snapshots).toBe(before + 1);
    expect(h.internals.charterNotice?.tone).toBe('success');
    expect(h.internals.storeError).toBe(false);
  });

  for (const reason of ['apply_deferred', 'grant_unresolved', 'already_granted'] as const) {
    it(`reads a granted "${reason}" result as success, never as a lost purchase`, async () => {
      const h = charterHarness({
        results: [{ granted: true, balance: 4_500, costClaudium: 500, reason }],
      });
      await h.internals.renderStore(null);

      await h.internals.purchaseCharter('strongbox_charter_1');

      // The pin: the failure/error state is NOT set on any granted arm.
      expect(h.internals.storeError).toBe(false);
      expect(h.internals.charterNotice?.tone).toBe('success');
      expect(h.html()).toContain('charter-notice success');
      expect(h.html()).not.toContain('charter-notice failure');
      // The intent is finished: money moved, so a later purchase mints a new key.
      expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
    });
  }

  it('gives purchase_in_progress and does_not_fit their own distinct messages', async () => {
    const inProgress = charterHarness({
      results: [
        { granted: false, balance: 5_000, costClaudium: 500, reason: 'purchase_in_progress' },
      ],
    });
    await inProgress.internals.renderStore(null);
    await inProgress.internals.purchaseCharter('strongbox_charter_1');

    const doesNotFit = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'does_not_fit' }],
    });
    await doesNotFit.internals.renderStore(null);
    await doesNotFit.internals.purchaseCharter('strongbox_charter_1');

    const first = inProgress.internals.charterNotice;
    const second = doesNotFit.internals.charterNotice;
    expect(first?.tone).toBe('failure');
    expect(second?.tone).toBe('failure');
    expect(first?.text).not.toBe(second?.text);
    expect(first?.text).toContain('still being completed');
    expect(second?.text).toContain('cannot fit');
    expect(inProgress.html()).toContain(first?.text ?? '<missing>');
    expect(doesNotFit.html()).toContain(second?.text ?? '<missing>');
  });

  it('reads a granted-FALSE already_granted as a failure, the opposite of the replay', async () => {
    // The one token in the whole result contract whose meaning INVERTS on the
    // granted flag: granted true is a successful replay of THIS purchase, and
    // granted false is the same key reused for a DIFFERENT one, which bought
    // this player nothing. Sharing a message between the two arms would tell a
    // player whose purchase failed that their slots are already applied.
    const failed = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'already_granted' }],
    });
    await failed.internals.renderStore(null);
    await failed.internals.purchaseCharter('strongbox_charter_1');

    const replayed = charterHarness({
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: 'already_granted' }],
    });
    await replayed.internals.renderStore(null);
    await replayed.internals.purchaseCharter('strongbox_charter_1');

    expect(failed.internals.charterNotice?.tone).toBe('failure');
    expect(failed.internals.charterNotice?.text).toBe('The purchase could not be completed.');
    expect(replayed.internals.charterNotice?.tone).toBe('success');
    expect(replayed.internals.charterNotice?.text).toContain('not charged again');
    expect(failed.internals.charterNotice?.text).not.toBe(replayed.internals.charterNotice?.text);
    // Both arms are DEFINITIVE, so both close the intent.
    expect(failed.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
    expect(replayed.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
  });

  it('stops offering a charter the server has already refused as overshooting', async () => {
    // With no count observable the client fit gate cannot run and every charter
    // lists. The server's does_not_fit is then the only fit answer there is:
    // without remembering it the same guaranteed-to-fail card repaints enabled
    // and the player can loop the identical refusal.
    const h = charterHarness({
      purchasedSlots: null,
      results: [{ granted: false, balance: 5_000, costClaudium: 900, reason: 'does_not_fit' }],
    });
    await h.internals.renderStore(null);
    expect(h.buttons()).toHaveLength(4);

    await h.internals.purchaseCharter('strongbox_charter_2');

    // The refused grant AND everything larger go: a grant that overshoots proves
    // every bigger grant overshoots too.
    const offered = h.buttons().map((button) => button.dataset.charterBuy);
    expect(offered).toEqual(['strongbox_charter_1']);
    expect(h.html()).toContain('cannot fit the full grant');
  });

  // -------------------------------------------------------------------------
  // The slow-band refresh (Bank Storage phase 15, ruling 21). The fit gate is
  // re-projected at PAINT time and paints are event-driven, so before this an
  // open store never noticed the ladder moving behind it: the reachable case is
  // the store and the bank open together at a bursar while a copper rung is
  // bought in the bank.
  // -------------------------------------------------------------------------
  it('repaints an open store when the ladder moves behind it', async () => {
    const h = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT,
    });
    await h.internals.renderStore(null);
    expect(h.buttons().map((b) => b.dataset.charterBuy)).toEqual(['strongbox_charter_1']);

    // A rung bought in the bank window: nothing in the store observes it, and no
    // store event fires. The mirror moves, then the slow band comes round.
    h.state.purchasedSlots = LADDER_CEILING_SLOTS;
    expect(h.buttons()).toHaveLength(1); // still stale, as it must be before the poll

    const before = h.paints.count;
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(before + 1);
    expect(h.buttons()).toHaveLength(0);
    expect(h.html()).toContain('no room left');

    // ...and ONCE. A signature stamped with the wrong value (null, or read
    // before rebuildCharterSection consults the world) still repaints on the
    // first poll and then on every poll after it, which is the 2 Hz armory
    // rebuild the gate exists to prevent.
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(before + 1);
  });

  it('does NOTHING on a poll where the ladder has not moved', async () => {
    // The negative arm, and the one that fails without the signature: a poll
    // that repainted unconditionally would rebuild the whole armory grid's
    // markup at 2 Hz for as long as the store is open. It has to be read off the
    // PAINT counter, not the DOM: replaceStoreBody elides an identical write, so
    // the tree (and even the element identities) would look the same either way.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const before = h.html();
    const paintsAfterRender = h.paints.count;

    for (let i = 0; i < 5; i++) h.window.refreshIfChanged();

    expect(h.paints.count).toBe(paintsAfterRender);
    expect(h.html()).toBe(before);
  });

  it('does not repaint a store that is closed, or one on the rewards tab', async () => {
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    // A REAL move, so every poll below has work waiting: a guard tested against
    // an unmoved ladder would pass on the signature check alone.
    h.state.purchasedSlots = LADDER_CEILING_SLOTS;
    const quiet = h.paints.count;

    h.root.style.display = 'none'; // closed
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(quiet);

    h.root.style.display = 'block';
    h.internals.tab = 'rewards';
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(quiet);

    h.internals.tab = 'store';
    h.internals.storeReady = false;
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(quiet);

    // ...and the same poll DOES land once all three hold, so the guards above
    // are gating rather than simply broken.
    h.internals.storeReady = true;
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(quiet + 1);
    expect(h.buttons()).toHaveLength(0);
  });

  it('a background poll that DOES paint neither spends the focus stash nor pulls focus', async () => {
    // The reachable path, and the one an earlier version of this arm missed by
    // parking the window on the rewards tab, where refreshIfChanged returns at
    // its first guard and the paint under test never runs at all. Here the store
    // is open, ready, on the store tab, and the ladder really moves, so the poll
    // paints. paintStore consumes the stash and restores focus on EVERY other
    // entry point; the background flag is what exempts this one, because the
    // player did not ask for the repaint.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const paintsBefore = h.paints.count;
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    // Focus nowhere, which is exactly the state the stash exists for (disabling
    // the focused buy button drops the player to <body>).
    (document.activeElement as HTMLElement | null)?.blur();
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;

    h.window.refreshIfChanged();

    expect(h.paints.count).toBe(paintsBefore + 1); // it really painted
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');
    // Pin the precondition: buyButton returns null for an absent card, and
    // `<body> !== null` would pass this vacuously.
    expect(h.buyButton('strongbox_charter_1')).not.toBeNull();
    expect(document.activeElement).not.toBe(h.buyButton('strongbox_charter_1'));
  });

  it('a cosmetics repaint from ANOTHER session is background too', async () => {
    // Same class as the poll and the same exposure window (mid charter spend the
    // confirm is gone, focus is on <body>, the stash is armed), so exempting
    // only the poll would have left this door open. Found by review, not by the
    // first pass, which is why it has its own arm rather than riding the one
    // above.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const paintsBefore = h.paints.count;
    const markupBefore = h.html();
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    (document.activeElement as HTMLElement | null)?.blur();
    // The paint has to actually WRITE, not just be called. The stash is spent
    // below the markup identity check (an elided paint destroyed no control, so
    // it must not consume the stash), which means an arm whose markup came back
    // byte-identical would pass with the background flag deleted.
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;

    h.window.onCosmeticsChanged();

    expect(h.paints.count).toBe(paintsBefore + 1); // it really painted
    expect(h.html()).not.toBe(markupBefore); // and the write was not elided
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');
    expect(h.buyButton('strongbox_charter_1')).not.toBeNull();
    expect(document.activeElement).not.toBe(h.buyButton('strongbox_charter_1'));
  });

  it('the 15 second SERVICE poll is background too, the third call site', async () => {
    // toggle() arms a 15 second setInterval that re-fetches the store and
    // repaints through renderStore. Phase 15 exempted the ladder refresh, then a
    // review round caught onCosmeticsChanged; this one was still foreground, and
    // its exposure is the widest of the three: the stash is armed from the moment
    // a buyer presses Enter (before the confirm dialog opens) until the outcome
    // repaints, so a player who reads the dialog for fifteen seconds loses it.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const paintsBefore = h.paints.count;
    const markupBefore = h.html();
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    (document.activeElement as HTMLElement | null)?.blur();
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;

    await h.internals.renderStore(null, { background: true });

    expect(h.paints.count).toBe(paintsBefore + 1);
    expect(h.html()).not.toBe(markupBefore);
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');
    expect(h.buyButton('strongbox_charter_1')).not.toBeNull();
    expect(document.activeElement).not.toBe(h.buyButton('strongbox_charter_1'));
  });

  it('the 15 second interval that toggle arms really passes the background flag', async () => {
    // The arm above proves the plumbing; this one proves the CALL SITE uses it.
    // Mutation said so: dropping { background: true } from the interval survived
    // every other arm in this file, which is the same "one call site short"
    // shape the phase's own fix round was caught by.
    vi.useFakeTimers();
    try {
      const h = charterHarness({ purchasedSlots: 0 });
      type RenderFn = (focus: 'open' | null, opts?: { background?: boolean }) => Promise<void>;
      const calls: Array<{ focus: 'open' | null; opts?: { background?: boolean } }> = [];
      const proto = (Object.getPrototypeOf(h.window) as { renderCurrent: RenderFn }).renderCurrent;
      (h.window as unknown as { renderCurrent: RenderFn }).renderCurrent = function renderCurrent(
        this: unknown,
        ...args: Parameters<RenderFn>
      ) {
        calls.push({ focus: args[0], opts: args[1] });
        return proto.apply(this, args);
      };

      // The harness mounts the root already displayed, which reads as OPEN, so
      // toggle() would take the close branch and arm nothing.
      h.root.style.display = 'none';
      h.window.toggle();
      await vi.advanceTimersByTimeAsync(15_000);

      // The open render is the player's own and must NOT be background; the poll
      // that follows it must be. Asserting only the last call would pass with the
      // two swapped.
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0]).toEqual({ focus: 'open', opts: undefined });
      expect(calls[calls.length - 1]).toEqual({ focus: null, opts: { background: true } });
      h.window.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a PLAYER-asked repaint still spends the stash and hands focus back', async () => {
    // The positive control for the three arms above. Without it every one of them
    // would also pass against a paintStore that had lost the stash mechanism
    // entirely, since "did not restore focus" is what they all assert.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    (document.activeElement as HTMLElement | null)?.blur();
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;

    await h.internals.renderStore(null);

    expect(h.internals.charterFocus.peek()).toBeNull();
    expect(document.activeElement).toBe(h.buyButton('strongbox_charter_1'));
  });

  it('an ELIDED foreground repaint keeps the stash, because it destroyed nothing', async () => {
    // replaceStoreBody returns early when the markup is byte-identical, so the
    // control the stash names is still mounted and still the right place to
    // return a buyer to. Clearing above that check spent the stash on a paint
    // that never happened, and the outcome repaint then had nothing to restore.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const paintsBefore = h.paints.count;
    const markupBefore = h.html();
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    (document.activeElement as HTMLElement | null)?.blur();
    const activeBefore = document.activeElement;

    // Nothing moved, so this paint elides.
    await h.internals.renderStore(null);

    expect(h.paints.count).toBe(paintsBefore + 1); // paintStore really ran
    expect(h.html()).toBe(markupBefore); // and wrote nothing
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');
    // And focus is left exactly where it was. Restoring here would be a focus
    // MOVE on a paint that changed nothing, which is the opposite of the rule.
    expect(document.activeElement).toBe(activeBefore);
  });

  it('a background repaint that loses the focused card does NOT drag focus to the top', async () => {
    // The degrade ladder walks to the first keyed control in DOM order, which is
    // an armory card at the TOP of the scroller while the charter grid is the
    // LAST section, and focus() scrolls its target into view. That is right after
    // a purchase and wrong on a repaint nobody asked for.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    const card = h.buyButton('strongbox_charter_complete');
    expect(card).not.toBeNull();
    card?.focus();
    expect(document.activeElement).toBe(card);
    // The biggest charter stops fitting, so the control focus is on disappears.
    h.state.purchasedSlots = SMALLEST_CHARTER_GRANT;

    h.window.refreshIfChanged();

    expect(h.buyButton('strongbox_charter_complete')).toBeNull();
    // It lands on a surviving CHARTER card, never on the armory grid above it
    // and never on the top-up button, both of which sit at the top of the
    // scroller. Focusing nothing would be worse for the keyboard player this
    // exists for; jumping sections is the scroll jump the rule avoids.
    expect(h.buttons().length).toBeGreaterThan(0);
    expect(h.buttons()).toContain(document.activeElement);
    expect(document.activeElement).not.toBe(h.root.querySelector('[data-buy-claudium]'));
    expect(
      (document.activeElement as HTMLElement | null)?.dataset.focusKey?.startsWith('charter-'),
    ).toBe(true);
  });

  it('refreshIfChanged tells paintStore the paint is BACKGROUND', async () => {
    // Asserted from the call, not inferred from a focus side effect three layers
    // down: the spy records the options every call site passed.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;
    const before = h.paints.opts.length;

    h.window.refreshIfChanged();

    expect(h.paints.opts.length).toBe(before + 1);
    expect(h.paints.opts[before]).toEqual({ background: true });
    // The control: the player's own repaint passes no such flag.
    h.state.purchasedSlots = 0;
    await h.internals.renderStore(null);
    // renderStore defaults its options to {}, so the control is the ABSENCE of
    // the flag rather than the absence of an options object.
    expect(h.paints.opts[h.paints.opts.length - 1]).toEqual({});
  });

  it('the ERROR body carries keyboard focus out to the shell, and settles the stash', async () => {
    // THE REACHABLE HARM, corrected in the review round. Only the armory-skin
    // outage repaint sets storeError mid-visit, and on that path ALONE the player
    // is standing in the armory inspect overlay, which mounts on document.body
    // and which this wipe does not touch: nothing is taken and nothing must move
    // (the arm below pins that). What DOES take something is the overlap, driven
    // here: a charter purchase is in flight, so its own busy disable has already
    // dropped focus to <body> and parked the return key in the stash, and the
    // armory error then destroys the control that key points at.
    const h = charterHarness({
      purchasedSlots: 0,
      results: [{ granted: false, balance: 1_000, costClaudium: 200, reason: 'unavailable' }],
    });
    await h.internals.renderStore(null);
    const buy = h.buyButton('strongbox_charter_1');
    buy?.focus();
    expect(document.activeElement).toBe(buy);
    // The charter flow's own in-flight guard: park the return key, then disable
    // the focused button, which is what drops focus to <body>. Staged through the
    // window's own methods rather than by hand, so the state is the product's.
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    // jsdom does NOT drop focus when a focused element is disabled; a real
    // browser does, and store_focus_policy.ts's `focusWentNowhere` input exists
    // for exactly that. The blur stands in for the one step the environment will
    // not take on its own, and it comes BEFORE the disable for the same reason:
    // jsdom will not blur a disabled element either.
    buy?.blur();
    h.internals.setCharterBusy('strongbox_charter_1', true);
    expect(buy?.disabled, 'the product really disabled the button').toBe(true);
    expect(document.activeElement, 'focus really went nowhere').toBe(document.body);

    await h.internals.purchaseArmorySkin({
      skin: { id: 'cinderbrand_sword' },
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    });

    expect(h.html(), 'the error body really did paint').toContain('dr-error');
    expect(
      (document.activeElement as HTMLElement | null)?.dataset.wocStoreTab,
      'focus landed on the shell rather than <body>',
    ).toBe('store');
    expect(
      h.internals.charterFocus.peek(),
      'the stash was spent by the paint that happened',
    ).toBeNull();
  });

  it('the armory-outage path ALONE moves focus nowhere, because it took nothing', async () => {
    // The correction's own negative control, and the reason the arm above had to
    // change: requestArmoryPurchase is reachable only from the inspect overlay's
    // buy button (src/ui/armory_inspect.ts mounts that overlay on document.body),
    // so at the wipe the player is standing on a control OUTSIDE .dr-body that
    // survives it. Moving focus here would yank them out of a panel they are
    // still using.
    const h = charterHarness({
      purchasedSlots: 0,
      results: [{ granted: false, balance: 1_000, costClaudium: 200, reason: 'unavailable' }],
    });
    await h.internals.renderStore(null);
    const overlayButton = document.createElement('button');
    overlayButton.dataset.armoryBuy = '';
    document.body.appendChild(overlayButton);
    overlayButton.focus();

    await h.internals.purchaseArmorySkin({
      skin: { id: 'cinderbrand_sword' },
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    });

    expect(h.html()).toContain('dr-error');
    expect(document.activeElement, 'the inspect overlay keeps the player').toBe(overlayButton);
    overlayButton.remove();
  });

  it('an error paint that takes focus from NOBODY moves focus nowhere', async () => {
    // The negative control for the arm above: without it, an implementation that
    // focused the tab on every error paint would pass it perfectly, and a poll
    // erroring in the background would yank a player out of whatever they were
    // doing elsewhere on the page.
    const h = charterHarness({
      purchasedSlots: 0,
      results: [{ granted: false, balance: 1_000, costClaudium: 200, reason: 'unavailable' }],
    });
    await h.internals.renderStore(null);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    await h.internals.purchaseArmorySkin({
      skin: { id: 'cinderbrand_sword' },
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    });

    expect(h.html()).toContain('dr-error');
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('an ELIDED error repaint destroys nothing, so it spends neither the stash nor focus', async () => {
    // The rule the normal path already states, applied to the error branch:
    // replaceStoreBody elides a byte-identical write, and a paint that destroyed
    // no control has no business consuming the return target of a purchase the
    // player is still in the middle of, or moving focus at all.
    //
    // RESTORED after the fix round's own slice replacement deleted this arm and
    // the one below it: both had already been proved decisive by mutation, and a
    // gate cannot see a test that is not there. That is the same class of loss
    // this phase spent a round hunting, arriving through the diff rather than
    // through the code.
    const h = charterHarness({
      purchasedSlots: 0,
      results: [{ granted: false, balance: 1_000, costClaudium: 200, reason: 'unavailable' }],
    });
    await h.internals.renderStore(null);
    await h.internals.purchaseArmorySkin({
      skin: { id: 'cinderbrand_sword' },
      costClaudium: 200,
      purchasable: true,
      owned: false,
      affordable: true,
    });
    expect(h.html(), 'the error body is up').toContain('dr-error');

    // A purchase is mid-flight again, and something parks focus outside the body.
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    // The SAME error markup: replaceStoreBody elides it.
    h.internals.repaintStore();

    expect(h.internals.charterFocus.peek(), 'the stash survived an elided paint').toBe(
      'charter-strongbox_charter_1',
    );
    expect(document.activeElement, 'and focus was not moved').toBe(outside);
    outside.remove();
  });

  it('a BACKGROUND error paint that WIPES does not spend the stash', async () => {
    // The false branch of `if (!opts.background) this.charterFocus.clear()`, which
    // no other arm reaches: the elided arm above returns at `if (!wiped) return;`
    // and the two focus arms are foreground. Driven through onCosmeticsChanged,
    // which passes background:true and, unlike refreshIfChanged, carries no
    // storeError guard.
    //
    // The error flag is set DIRECTLY rather than driven through an armory outage,
    // which is what leaves the paint memo holding the NORMAL store markup: that is
    // the state a background error paint actually meets in production when the
    // outage lands after a healthy paint, and it is what makes this paint a real
    // WIPE rather than an elision, with no private memo write anywhere.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    h.internals.storeError = true;
    const paintsBefore = h.paints.count;

    h.window.onCosmeticsChanged();

    expect(h.paints.count, 'a background paint really ran').toBe(paintsBefore + 1);
    expect(h.html(), 'and it wiped to the error body').toContain('dr-error');
    expect(
      h.internals.charterFocus.peek(),
      'a paint nobody asked for must not drop the return target of a live purchase',
    ).toBe('charter-strongbox_charter_1');
  });

  it('refreshIfChanged does not repaint an ERROR body, which could never converge', async () => {
    // paintStore returns on the error branch BEFORE rebuildCharterSection, the
    // only writer of the ladder signature, so without this guard the poll would
    // rebuild the error markup on every slow tick until a refetch cleared the
    // flag.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.storeError = true;
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;
    const paintsBefore = h.paints.count;

    h.window.refreshIfChanged();
    h.window.refreshIfChanged();
    h.window.refreshIfChanged();

    expect(h.paints.count).toBe(paintsBefore);
    // The positive control: clear the error and the very next poll paints once.
    h.internals.storeError = false;
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(paintsBefore + 1);
    h.window.refreshIfChanged();
    expect(h.paints.count).toBe(paintsBefore + 1);
  });

  it('a CANCELLED confirm drops the focus stash it armed', async () => {
    // The attempt ends with no paint, so nothing else would spend it. Left armed,
    // it survives into whatever repaints next and moves focus into the charter
    // grid on a paint the player never connected to a purchase.
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.buyButton('strongbox_charter_1')?.focus();
    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');

    h.dialogs[h.dialogs.length - 1].onCancel?.();

    expect(h.internals.charterFocus.peek()).toBeNull();
  });

  it('abandons the exact unsent charter intent when a competing confirm owns the stack', async () => {
    const scope = { playerClass: 'warrior', name: 'PromptCollision' };
    const rowName = `woc_purchase_intents_${scope.playerClass}_${scope.name}`;
    const h = charterHarness({ purchasedSlots: 0, scope, realDecisions: true });
    await h.internals.renderStore(null);
    h.buyButton('strongbox_charter_1')?.focus();

    // A global confirmation already owns the one dialog id. StoreDecisionPrompts
    // must refuse a second modal instead of hiding or replacing that decision.
    const competing = document.createElement('div');
    competing.id = 'confirm-dialog';
    document.body.appendChild(competing);

    h.internals.requestCharterPurchase('strongbox_charter_1');

    expect(document.getElementById('confirm-dialog')).toBe(competing);
    expect(document.querySelector('.woc-store-prompt')).toBeNull();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
    expect(h.internals.charterFocus.peek()).toBeNull();
    expect(localStorage.getItem(rowName), 'the durable unsent intent was removed').toBeNull();
    expect(h.spendCalls).toHaveLength(0);
  });

  it('keeps the intent and focus armed when the Store prompt opens successfully', async () => {
    const scope = { playerClass: 'warrior', name: 'PromptOpened' };
    const rowName = `woc_purchase_intents_${scope.playerClass}_${scope.name}`;
    const h = charterHarness({ purchasedSlots: 0, scope, realDecisions: true });
    await h.internals.renderStore(null);
    h.buyButton('strongbox_charter_1')?.focus();

    h.internals.requestCharterPurchase('strongbox_charter_1');

    const prompt = document.querySelector<HTMLElement>('#confirm-dialog.woc-store-prompt');
    expect(prompt).not.toBeNull();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    expect(h.internals.charterFocus.peek()).toBe('charter-strongbox_charter_1');
    expect(localStorage.getItem(rowName)).toContain('strongbox_charter_1');
    expect(h.root.inert).toBe(true);
    expect(h.spendCalls).toHaveLength(0);

    prompt?.querySelector<HTMLButtonElement>('[data-store-prompt-cancel]')?.click();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
    expect(h.internals.charterFocus.peek()).toBeNull();
    expect(h.root.inert).toBe(false);
    expect(document.getElementById('confirm-dialog')).toBeNull();
  });

  it('close() bounds the focus stash to one visit, as it already bounds the refusals', async () => {
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.charterFocus.arm('charter-strongbox_charter_1');

    h.window.close();

    expect(h.internals.charterFocus.peek()).toBeNull();
  });

  it('a ladder count that moves DOWN drops the server refusals it invalidated', async () => {
    // The count is monotone only while one character stays resident on one realm
    // process. A fresh join that reloads a durable row written before the last
    // rung brings a LOWER count back into the same open window, and every
    // refusal was derived from the higher one, so keeping them would hide a
    // charter that now FITS.
    const h = charterHarness({
      purchasedSlots: 0,
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'does_not_fit' }],
    });
    await h.internals.renderStore(null);
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;
    h.window.refreshIfChanged();
    await h.internals.purchaseCharter('strongbox_charter_1');
    expect(h.buyButton('strongbox_charter_1')).toBeNull();

    // The realm restarts and the character rejoins from a row written before the
    // last rung: the same window now sees a lower count.
    h.state.purchasedSlots = 0;
    h.window.refreshIfChanged();

    expect(h.buyButton('strongbox_charter_1')).not.toBeNull();
  });

  it('a paint the player DID ask for still spends the stash, so the exemption is scoped', async () => {
    // The positive control for the arm above: without it, deleting the whole
    // stash mechanism would pass both. It has to render first, because an
    // unrendered store paints its error body and returns before the stash logic
    // (which is how the first version of this control passed for the wrong
    // reason).
    const h = charterHarness({ purchasedSlots: 0 });
    await h.internals.renderStore(null);
    h.internals.charterFocus.arm('charter-strongbox_charter_1');
    (document.activeElement as HTMLElement | null)?.blur();
    // Move the ladder so the markup really differs and the paint is not elided.
    h.state.purchasedSlots = LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT;

    h.internals.repaintStore();

    expect(h.internals.charterFocus.peek()).toBeNull();
    // ...and it used the stash rather than dropping it on the floor: focus
    // landed back on the card the key named.
    expect(document.activeElement).toBe(h.buyButton('strongbox_charter_1'));
  });

  it('drops remembered fit refusals when the store closes', async () => {
    // The verdict is about the acting character, and nothing here observes a
    // character change, so
    // the belief is bounded to one store visit. The safe direction: at worst one
    // wasted click after a reopen, never a charter that DOES fit kept hidden.
    const h = charterHarness({
      purchasedSlots: null,
      results: [{ granted: false, balance: 5_000, costClaudium: 2_000, reason: 'does_not_fit' }],
    });
    await h.internals.renderStore(null);
    await h.internals.purchaseCharter('strongbox_charter_complete');
    expect(h.buttons()).toHaveLength(3);

    h.window.close();
    h.window.openStore();
    await h.internals.renderStore(null);

    expect(h.buttons()).toHaveLength(4);
  });

  it('never re-arms a result band for a store the player already closed', async () => {
    // The spend is a round trip: close the window mid-flight and the result
    // still lands. close() has already cleared the band, so re-arming it here
    // paints a stale purchase result on the NEXT open, attached to nothing the
    // player just did. Reproduced live against a real server before this pin.
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: null }],
    });
    await h.internals.renderStore(null);

    const pending = h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    h.window.close();
    release();
    await pending;

    expect(h.internals.charterNotice).toBeNull();
    const resultText = document.querySelector('.woc-store-global-result')?.textContent ?? '';
    expect(resultText).toContain('charter was applied');
    expect(resultText).toContain('Lesser Strongbox Charter');
    expect(resultText).toContain('strongbox_charter_1');
    // The negative arm is load-bearing: with the window OPEN the same result
    // must still arm the band, or this guard would be silently swallowing every
    // outcome rather than only the orphaned ones.
    const open = charterHarness({
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: null }],
    });
    await open.internals.renderStore(null);
    await open.internals.purchaseCharter('strongbox_charter_1');
    expect(open.internals.charterNotice?.tone).toBe('success');
  });

  it('never opens the top-up modal over a store the player already closed', async () => {
    // hud.confirmDialog appends an aria-modal focus trap to document.body
    // unconditionally, so an insufficient_balance landing after the close would
    // trap the player in a prompt about a window they already dismissed.
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [{ granted: false, balance: 10, costClaudium: 500, reason: 'insufficient_balance' }],
    });
    await h.internals.renderStore(null);

    const pending = h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    h.window.close();
    release();
    await pending;

    expect(h.dialogs).toHaveLength(0);
    const detachedResult = document.querySelector('.woc-store-global-result')?.textContent ?? '';
    expect(detachedResult).toContain('490 more Claudium');
    expect(detachedResult).toContain('Lesser Strongbox Charter');
    expect(detachedResult).toContain('strongbox_charter_1');
    // Open, the same refusal DOES raise the top-up prompt.
    const open = charterHarness({
      results: [{ granted: false, balance: 10, costClaudium: 500, reason: 'insufficient_balance' }],
    });
    await open.internals.renderStore(null);
    await open.internals.purchaseCharter('strongbox_charter_1');
    expect(open.dialogs).toHaveLength(1);
    expect(open.dialogs[0].title).toContain('More Claudium');
  });

  it('announces a price_changed refusal instead of leaving only the silent banner', async () => {
    // The shared banner is written into the same innerHTML as its own text,
    // which this window documents as the shape that is never announced. A
    // refused purchase that a screen-reader user cannot hear is the failure.
    const h = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 900, reason: 'price_changed' }],
    });
    await h.internals.renderStore(null);

    await h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();

    const announced =
      'The price changed before the purchase completed. Review the refreshed price and confirm again.';
    expect(h.internals.charterNotice?.tone).toBe('failure');
    expect(h.internals.charterNotice?.text).toBe(announced);
    expect(h.live()).toBe(announced);
    // The silent banner is still painted (it is the shared store treatment);
    // what this pins is that it is no longer the ONLY thing a refused buyer
    // gets, because the band routes through the persistent live region.
    expect(h.html()).toContain('charter-notice failure');
  });

  it('keeps the scroll position across a forced repaint', async () => {
    // The charter grid is the LAST section, below the whole armory, and every
    // purchase outcome forces a repaint: without this the player is thrown back
    // to the top of a long scroller, away from the card they just used.
    //
    // happy-dom does NOT zero scrollTop when innerHTML is assigned, so a plain
    // read-back passes with or without the restore (verified: the mutation that
    // deletes the restore survived that shape). The browser behaviour is staged
    // here instead, which is what makes this arm decisive.
    const h = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'unavailable' }],
    });
    await h.internals.renderStore(null);

    let scroll = 0;
    Object.defineProperty(h.body, 'scrollTop', {
      configurable: true,
      get: () => scroll,
      set: (value: number) => {
        scroll = value;
      },
    });
    // innerHTML lives on Element.prototype, several links up the chain.
    let proto: object | null = Object.getPrototypeOf(h.body);
    let innerHtml: PropertyDescriptor | undefined;
    while (proto && !innerHtml) {
      innerHtml = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
      proto = Object.getPrototypeOf(proto);
    }
    expect(innerHtml?.set).toBeTypeOf('function');
    Object.defineProperty(h.body, 'innerHTML', {
      configurable: true,
      get(): string {
        return innerHtml?.get?.call(this) as string;
      },
      set(value: string) {
        innerHtml?.set?.call(this, value);
        scroll = 0; // what a real browser does to a wiped scroller
      },
    });
    h.body.scrollTop = 420;

    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.body.scrollTop).toBe(420);
    // The repaint really happened, so this is not a vacuous no-op arm.
    expect(h.html()).toContain('charter-notice failure');
  });

  it('holds the buy button busy in the MARKUP, not only on the element', async () => {
    // A DOM-only busy flag is undone by any repaint that lands while the spend
    // is on the wire (the store polls), handing the player an enabled Purchase
    // button for a purchase already in flight.
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: null }],
    });
    await h.internals.renderStore(null);

    const pending = h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    // Force the repaint the poll would have done, mid-flight.
    await h.internals.renderStore(null);
    expect(h.buyButton('strongbox_charter_1')?.disabled).toBe(true);
    expect(h.buyButton('strongbox_charter_1')?.getAttribute('aria-busy')).toBe('true');
    // The other three are untouched, so this is the in-flight one and not a
    // blanket disable.
    expect(h.buyButton('strongbox_charter_2')?.disabled).toBe(false);

    release();
    await pending;
    expect(h.buyButton('strongbox_charter_1')?.disabled).toBe(false);
  });

  it('lets a cancel drop an intent that never reached the service', async () => {
    // The intent is minted when the confirm dialog opens, so walking away from
    // that dialog must drop the key: it was never sent, nothing can be behind
    // it, and holding it would make the next deliberate purchase replay a
    // receipt for a purchase the player declined.
    const h = charterHarness();
    await h.internals.renderStore(null);

    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    h.dialogs[0].onCancel?.();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);

    // The OPPOSITE arm, and the one that is money-critical: once a spend HAS
    // gone out under the key, a cancel must NOT drop it. An ambiguous outcome
    // may be hiding a live debit, and the next attempt has to replay that key
    // rather than mint a second one over it.
    const sent = charterHarness({
      results: [{ granted: false, balance: null, costClaudium: null, reason: 'unavailable' }],
    });
    await sent.internals.renderStore(null);
    sent.internals.requestCharterPurchase('strongbox_charter_1');
    await sent.internals.purchaseCharter('strongbox_charter_1');
    expect(sent.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    sent.internals.requestCharterPurchase('strongbox_charter_1');
    sent.dialogs[1].onCancel?.();
    expect(sent.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
  });

  it('groups the pre-spend catalog refusals into one shared message', async () => {
    const texts = new Set<string>();
    for (const reason of [
      'unknown_item',
      'not_cosmetic',
      'kind_mismatch',
      'invalid_request',
      'not_next_rung',
      'no_live_character',
    ]) {
      const h = charterHarness({
        results: [{ granted: false, balance: 5_000, costClaudium: 500, reason }],
      });
      await h.internals.renderStore(null);
      await h.internals.purchaseCharter('strongbox_charter_1');
      expect(h.internals.charterNotice?.tone).toBe('failure');
      texts.add(h.internals.charterNotice?.text ?? '');
    }
    expect(texts.size).toBe(1);
    expect([...texts][0]).toContain('cannot be purchased right now');
  });

  it('opens the top-up dialog on insufficient_balance and returns to the store after Claudium', async () => {
    const h = charterHarness({
      results: [
        { granted: false, balance: 100, costClaudium: 1_500, reason: 'insufficient_balance' },
      ],
    });
    await h.internals.renderStore(null);

    await h.internals.purchaseCharter('strongbox_charter_1');

    // The authoritative cost wins over the row's, exactly as the skin path does.
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].body).toContain('1,400');
    h.dialogs[0].onOk?.();
    expect(h.claudiumReturns).toHaveLength(1);
    expect(h.claudiumReturns[0]).toBeTypeOf('function');

    const before = h.state.snapshots;
    h.claudiumReturns[0]?.();
    await vi.waitFor(() => expect(h.state.snapshots).toBeGreaterThan(before));
    expect((h.window as unknown as { tab: string }).tab).toBe('store');
  });

  // THE MONEY PIN. A storage SKU is repeatable and writes no grant row, so the
  // economy service dedupes ONLY on the idempotency key: a retry under a fresh
  // key is a second real charge.
  it('replays the SAME idempotency key after an ambiguous result and a NEW one after a grant', async () => {
    const h = charterHarness({
      results: [
        { granted: false, balance: null, costClaudium: null, reason: 'unavailable' },
        { granted: true, balance: 4_500, costClaudium: 500, reason: null },
        { granted: true, balance: 4_000, costClaudium: 500, reason: null },
      ],
    });
    await h.internals.renderStore(null);

    await h.internals.purchaseCharter('strongbox_charter_1');
    // Ambiguous: the debit may have landed and the reply may have been lost, so
    // the intent stays open.
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    await h.internals.purchaseCharter('strongbox_charter_1');
    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.spendCalls).toHaveLength(3);
    expect(h.spendCalls[0].key).toBeTypeOf('string');
    expect(h.spendCalls[1].key).toBe(h.spendCalls[0].key);
    expect(h.spendCalls[2].key).not.toBe(h.spendCalls[1].key);
    for (const call of h.spendCalls) {
      expect(call.kind).toBe('storage');
      expect(call.key).toMatch(/^[A-Za-z0-9_.:-]{1,200}$/);
    }
  });

  // The arm most likely to regress if someone "simplifies" the classifier:
  // purchase_in_progress READS like a clean refusal, but the server returns it
  // before it reads the pending row for this key, and the concurrent attempt is
  // ordinarily THIS intent mid-debit. Closing on it would make the next click
  // mint a fresh key and pay twice.
  it('replays the SAME idempotency key after purchase_in_progress', async () => {
    const h = charterHarness({
      results: [
        { granted: false, balance: 5_000, costClaudium: 500, reason: 'purchase_in_progress' },
        { granted: true, balance: 4_500, costClaudium: 500, reason: null },
      ],
    });
    await h.internals.renderStore(null);

    await h.internals.purchaseCharter('strongbox_charter_1');
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    // Its own message still shows: the copy and the key lifecycle are separate.
    expect(h.internals.charterNotice?.text).toContain('still being complete');

    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.spendCalls).toHaveLength(2);
    expect(h.spendCalls[1].key).toBe(h.spendCalls[0].key);
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
  });

  it('mints a FRESH key after a pre-spend refusal that provably moved no money', async () => {
    // The counterpart direction. does_not_fit and not_next_rung come from the
    // pre-spend dry run, and the one dangerous variant (a pending prior row for
    // this key) is diverted to 'unavailable' instead, so they close the intent.
    // A retry under a stale key here would replay someone else's answer.
    for (const reason of ['does_not_fit', 'not_next_rung']) {
      const h = charterHarness({
        results: [
          { granted: false, balance: 5_000, costClaudium: 500, reason },
          { granted: true, balance: 4_500, costClaudium: 500, reason: null },
        ],
      });
      await h.internals.renderStore(null);

      await h.internals.purchaseCharter('strongbox_charter_1');
      expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);
      await h.internals.purchaseCharter('strongbox_charter_1');

      expect(h.spendCalls).toHaveLength(2);
      expect(h.spendCalls[1].key).not.toBe(h.spendCalls[0].key);
    }
  });

  // THE FROZEN-COST PIN. The server checks the prior row's four-field identity
  // (account, character, item, expectedCostClaudium) and answers a mismatch with
  // a definitive-looking already_granted BEFORE it tests the row's status, so it
  // fires on a still-PENDING row too. A retry that re-read the catalog after a
  // background price move would therefore close the intent over a live debit and
  // let the next click mint a second key. The intent freezes the cost with the key.
  it('retries with the SAME key AND the SAME frozen cost after the catalog price moves', async () => {
    const h = charterHarness({
      results: [
        { granted: false, balance: null, costClaudium: null, reason: 'unavailable' },
        { granted: true, balance: 4_500, costClaudium: 500, reason: null },
      ],
      // The catalog moves between the two attempts, exactly as a background
      // refresh would deliver it.
      onSpend: (call, items) => {
        if (call !== 1) return;
        const row = items.find((item) => item.itemId === 'strongbox_charter_1');
        if (row) row.costClaudium = 875;
      },
    });
    await h.internals.renderStore(null);

    // Attempt 1 through the real entry point, which is what mints the intent.
    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.dialogs[0].body).toContain('500');
    await h.internals.purchaseCharter('strongbox_charter_1');
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);

    // The catalog has moved to 875 under the still-open intent. The retry must
    // send the frozen 500, AND must not quote 875 at the player: a number in the
    // confirmation that cannot be the outcome of the click is its own defect.
    await h.internals.renderStore(null);
    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.dialogs).toHaveLength(2);
    expect(h.dialogs[1].body).toContain('500');
    expect(h.dialogs[1].body).not.toContain('875');
    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.spendCalls).toHaveLength(2);
    expect(h.spendCalls[0].cost).toBe(500);
    expect(h.spendCalls[1].cost).toBe(500);
    expect(h.spendCalls[1].key).toBe(h.spendCalls[0].key);

    // Once the intent closes, the NEXT purchase is a new intent, and it both
    // quotes and freezes the CURRENT price.
    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.dialogs[2].body).toContain('875');
    await h.internals.purchaseCharter('strongbox_charter_1');
    expect(h.spendCalls[2].cost).toBe(875);
    expect(h.spendCalls[2].key).not.toBe(h.spendCalls[1].key);
  });

  it('re-confirms at the new price after price_changed, and only when it really moved', async () => {
    // TRUE arm: the refreshed row costs something else, so the player is asked
    // again at that price, under a fresh key (price_changed is definitive).
    const moved = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 900, reason: 'price_changed' }],
      onSpend: (call, items) => {
        if (call !== 1) return;
        const row = items.find((item) => item.itemId === 'strongbox_charter_1');
        if (row) row.costClaudium = 900;
      },
    });
    await moved.internals.renderStore(null);
    const before = moved.state.snapshots;

    await moved.internals.purchaseCharter('strongbox_charter_1');

    expect(moved.state.snapshots).toBe(before + 1); // refreshed
    expect(moved.html()).toContain('woc-store-notice'); // the price-changed banner
    expect(moved.html()).toContain('The price changed before the purchase completed.');
    expect(moved.dialogs).toHaveLength(1);
    expect(moved.dialogs[0].body).toContain('900');
    // price_changed is DEFINITIVE, so the refused intent closed and the
    // re-confirm minted a fresh one at the refreshed price. Confirming it must
    // therefore spend a NEW key: reusing the refused key would be the retry the
    // freeze exists to prevent.
    await moved.internals.purchaseCharter('strongbox_charter_1');
    expect(moved.spendCalls).toHaveLength(2);
    expect(moved.spendCalls[1].cost).toBe(900);
    expect(moved.spendCalls[1].key).not.toBe(moved.spendCalls[0].key);

    // FALSE arm: the refresh comes back at the SAME price the service just
    // refused. Re-confirming there would loop the dialog forever.
    const unmoved = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'price_changed' }],
    });
    await unmoved.internals.renderStore(null);

    await unmoved.internals.purchaseCharter('strongbox_charter_1');

    expect(unmoved.html()).toContain('The price changed before the purchase completed.');
    expect(unmoved.dialogs).toHaveLength(0);
  });

  it('falls back to the sent cost when the service returns no usable one', async () => {
    // Only the all-true arm of the finite-and-positive guard was covered. Each
    // of these must fall back to the cost actually sent (500), giving a 400
    // shortfall against the 100 balance rather than a nonsense number.
    for (const costClaudium of [null, Number.NaN, 0, -5]) {
      const h = charterHarness({
        results: [{ granted: false, balance: 100, costClaudium, reason: 'insufficient_balance' }],
      });
      await h.internals.renderStore(null);

      await h.internals.purchaseCharter('strongbox_charter_1');

      expect(h.dialogs).toHaveLength(1);
      expect(h.dialogs[0].body).toContain('400');
      expect(h.dialogs[0].body).toContain('Lesser Strongbox Charter');
      expect(h.dialogs[0].body).not.toContain('NaN');
    }
  });

  it('treats a missing spend hook as ambiguous and keeps the intent open', async () => {
    // No hook at all is indistinguishable from a lost reply, so it must render
    // the outage copy and RETAIN the key rather than read as a clean refusal.
    const h = charterHarness({ noSpendHook: true });
    await h.internals.renderStore(null);

    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(h.spendCalls).toHaveLength(0);
    expect(h.internals.charterNotice?.tone).toBe('failure');
    expect(h.internals.charterNotice?.text).toBe(t('hudChrome.wocStore.charter.outage'));
    expect(h.html()).toContain('charter-notice failure');
    expect(document.querySelector('.woc-store-global-result')).toBeNull();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
  });

  it('routes a stale-surface outage to explicit Store recovery guidance', async () => {
    for (const outage of [
      { rejectSpend: true },
      {
        results: [{ granted: false, balance: null, costClaudium: null, reason: 'unavailable' }],
      },
    ]) {
      let release: () => void = () => undefined;
      const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
      const h = charterHarness({ gate, ...outage });
      await h.internals.renderStore(null);

      const pending = h.internals.purchaseCharter('strongbox_charter_1');
      await Promise.resolve();
      h.window.close();
      release();
      await pending;

      expect(h.internals.charterNotice).toBeNull();
      const result = document.querySelector<HTMLElement>('[data-store-result-text]');
      expect(result?.textContent).toContain(t('hudChrome.wocStore.charter.outageStale'));
      expect(result?.textContent).toContain('Lesser Strongbox Charter');
      expect(result?.textContent).toContain('strongbox_charter_1');
      expect(result?.textContent).toContain(
        'Return to the Store and use the same Purchase Charter action',
      );
      expect(result?.textContent).not.toContain('this button');
      expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
      document.querySelector<HTMLButtonElement>('.woc-store-global-result button')?.click();
    }
  });

  it('names the exact charter and SKU in an off-surface retry notice', async () => {
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [
        { granted: false, balance: 5_000, costClaudium: 900, reason: 'purchase_in_progress' },
      ],
    });
    await h.internals.renderStore(null);

    const pending = h.internals.purchaseCharter('strongbox_charter_2');
    await Promise.resolve();
    h.window.close();
    release();
    await pending;

    const result = document.querySelector<HTMLElement>('[data-store-result-text]');
    expect(result?.textContent).toContain('still being completed');
    expect(result?.textContent).toContain('Greater Strongbox Charter');
    expect(result?.textContent).toContain('strongbox_charter_2');
  });

  // THE FOCUS PIN. replaceStoreBody assigns innerHTML, which destroys the control
  // the player is standing on, and this painter now fires on EVERY purchase
  // outcome. Without the capture/restore pair a keyboard buyer who pressed Enter
  // on Purchase Charter lands on <body> and has to Tab from the top of the
  // window to reach the button again.
  it('keeps keyboard focus on the buy button across a refusal repaint', async () => {
    // purchase_in_progress deliberately, not does_not_fit: a fit refusal PRUNES
    // the card (see the fit-memory arm below), which would make this pass for
    // the wrong reason by never rebuilding the button at all.
    const h = charterHarness({
      results: [
        { granted: false, balance: 5_000, costClaudium: 500, reason: 'purchase_in_progress' },
      ],
    });
    await h.internals.renderStore(null);

    const button = h.buyButton('strongbox_charter_2');
    button?.focus();
    expect(document.activeElement).toBe(button);

    await h.internals.purchaseCharter('strongbox_charter_2');

    // The node itself is gone (innerHTML was reassigned); the REBUILT button for
    // the same charter holds focus.
    const rebuilt = h.buyButton('strongbox_charter_2');
    expect(rebuilt).not.toBe(button);
    expect(document.activeElement).toBe(rebuilt);
    expect(document.activeElement).not.toBe(document.body);
    // And the refusal really did repaint, so this is not a no-op repaint.
    expect(h.html()).toContain('charter-notice failure');
  });

  it('degrades focus to another control when the one it was on cannot come back', async () => {
    // Buying the last charter that fits empties the category, so the control the
    // player was standing on does not exist in the rebuilt tree. restoreFirstEnabled
    // must walk on rather than leaving focus on <body>.
    const h = charterHarness({
      purchasedSlots: LADDER_CEILING_SLOTS - SMALLEST_CHARTER_GRANT,
      results: [{ granted: true, balance: 0, costClaudium: 500, reason: null }],
    });
    await h.internals.renderStore(null);
    expect(h.buttons()).toHaveLength(1);

    const button = h.buyButton('strongbox_charter_1');
    button?.focus();
    expect(document.activeElement).toBe(button);
    // The grant lands: the refreshed world has the ladder full, exactly as the
    // post-purchase snapshot would report it.
    h.state.purchasedSlots = LADDER_CEILING_SLOTS;

    await h.internals.purchaseCharter('strongbox_charter_1');

    // The category really did empty, so the old rung is genuinely gone.
    expect(h.buttons()).toHaveLength(0);
    expect(h.html()).toContain('no room left');
    expect(document.activeElement).not.toBe(document.body);
    expect(h.body.contains(document.activeElement)).toBe(true);
    const landed = document.activeElement as HTMLElement;
    expect(landed.dataset.focusKey !== undefined || landed.dataset.buyClaudium !== undefined).toBe(
      true,
    );
  });

  it('the REAL top-up button carries a focus key, and a repaint hands focus back to it', async () => {
    // The one arm that reads the emission off the RENDERED markup. Reverting the
    // one-line change in src/ui/daily_rewards_window.ts left every other executed
    // arm green: tests/store_focus_policy.test.ts keys its OWN fixture, the arms
    // above only assert focus is NOT the top-up, and tests/browser/ never builds
    // this window. A source-text pin alone was holding a player-visible a11y fix.
    //
    // Before the key existed, captureFocusKey read null while focus sat on a real
    // element, planStoreFocus answered "focus nothing", and any repaint that WROTE
    // dropped a keyboard player standing on Buy Claudium to <body>, to Tab from the
    // top of the DOCUMENT.
    const h = charterHarness({});
    await h.internals.renderStore(null);
    const topUp = h.root.querySelector('[data-buy-claudium]') as HTMLElement | null;
    expect(topUp, 'the store painted no top-up button').not.toBeNull();
    expect(topUp?.dataset.focusKey, 'the top-up button is unkeyed again').toBe('topup');

    topUp?.focus();
    expect(document.activeElement).toBe(topUp);
    // A FOREGROUND repaint that really WRITES: a catalog price moves, so the
    // markup differs and replaceStoreBody cannot elide it. An elided paint would
    // leave the original node mounted and still focused, and this arm would then
    // pass without ever exercising the restore, which the guard below catches.
    h.state.items[0].costClaudium = (h.state.items[0].costClaudium ?? 500) + 7;
    await h.internals.renderStore(null);
    const rebuilt = h.root.querySelector('[data-buy-claudium]') as HTMLElement | null;
    expect(rebuilt, 'the repaint elided, so this arm proves nothing').not.toBe(topUp);
    expect(document.activeElement, 'the keyboard player was dropped to <body>').toBe(rebuilt);
  });

  it('carries focus back when disabling the button dropped it to body', async () => {
    // A real browser moves focus to <body> the instant a focused control is
    // disabled, which is exactly what the in-flight guard does. The capture at
    // repaint time would then find nothing, so the key is stashed BEFORE the
    // disable. happy-dom does not reproduce that blur, so the drop is staged
    // here the one way it does reproduce (removing the focused node).
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [
        { granted: false, balance: 5_000, costClaudium: 1_500, reason: 'purchase_in_progress' },
      ],
    });
    await h.internals.renderStore(null);
    h.buyButton('strongbox_charter_3')?.focus();
    // The REAL entry point owns the stash, and this is the only moment the key
    // is observable: the confirm dialog blurs the button to <body> before its
    // onOk ever runs, so a capture taken any later reads null.
    h.internals.requestCharterPurchase('strongbox_charter_3');

    const pending = h.internals.purchaseCharter('strongbox_charter_3');
    await Promise.resolve();
    expect(h.buyButton('strongbox_charter_3')?.disabled).toBe(true);
    const parked = document.createElement('button');
    document.body.appendChild(parked);
    parked.focus();
    parked.remove();
    expect(document.activeElement).toBe(document.body);

    release();
    await pending;

    expect(document.activeElement).toBe(h.buyButton('strongbox_charter_3'));
  });

  it('yields the stash when something else took focus during the spend', async () => {
    // The other half of that rule: a stashed key must never yank focus back from
    // a control the player (or another window) moved to while the spend ran.
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'does_not_fit' }],
    });
    await h.internals.renderStore(null);
    h.buyButton('strongbox_charter_3')?.focus();

    const pending = h.internals.purchaseCharter('strongbox_charter_3');
    await Promise.resolve();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    release();
    await pending;

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('never steals focus when it was not inside the store body', async () => {
    const h = charterHarness({
      results: [{ granted: false, balance: 5_000, costClaudium: 500, reason: 'does_not_fit' }],
    });
    await h.internals.renderStore(null);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    await h.internals.purchaseCharter('strongbox_charter_1');

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('announces every result through ONE persistent live region', async () => {
    // A role="status" node created in the same innerHTML write as its own text
    // is commonly never announced, and success is the status case: the message
    // confirming that real money moved. The region lives in the shell and only
    // its text is written.
    const h = charterHarness({
      results: [
        { granted: true, balance: 4_500, costClaudium: 500, reason: 'apply_deferred' },
        { granted: false, balance: 5_000, costClaudium: 500, reason: 'does_not_fit' },
      ],
    });
    await h.internals.renderStore(null);
    const region = h.root.querySelector('[data-charter-live]');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');

    await h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    expect(h.live()).toContain('next time this character logs in');
    // The SAME node survives the body rebuild that just happened.
    expect(h.root.querySelector('[data-charter-live]')).toBe(region);
    // The visible band carries no competing role of its own.
    expect(h.html()).toContain('charter-notice');
    expect(h.html()).not.toContain('charter-notice success" role=');

    await h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    expect(h.live()).toContain('cannot fit');
    expect(h.root.querySelector('[data-charter-live]')).toBe(region);
  });

  it('holds the buy button while a spend is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const h = charterHarness({
      gate,
      results: [{ granted: true, balance: 4_500, costClaudium: 500, reason: null }],
    });
    await h.internals.renderStore(null);

    const pending = h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();

    const button = h.buyButton('strongbox_charter_1');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');

    // A second click while it is held starts NO second spend: the player would
    // otherwise be shown "another purchase is being completed" for their own
    // double-click.
    h.click('strongbox_charter_1');
    h.internals.requestCharterPurchase('strongbox_charter_1');
    void h.internals.purchaseCharter('strongbox_charter_1');
    await Promise.resolve();
    expect(h.spendCalls).toHaveLength(1);
    expect(h.dialogs).toHaveLength(0);

    release();
    await pending;

    // Released, and the rebuilt button is usable again.
    expect(h.buyButton('strongbox_charter_1')?.disabled ?? false).toBe(false);
    expect(h.buyButton('strongbox_charter_1')?.getAttribute('aria-busy')).toBeNull();
  });

  it('drops an unsent intent on cancel but keeps one a spend already used', async () => {
    const h = charterHarness({
      results: [{ granted: false, balance: null, costClaudium: null, reason: 'unavailable' }],
      balance: 5_000,
    });
    await h.internals.renderStore(null);

    // Cancel before anything is sent: no key is held, so the next deliberate
    // purchase starts a fresh intent.
    h.internals.requestCharterPurchase('strongbox_charter_1');
    expect(h.dialogs).toHaveLength(1);
    h.dialogs[0].onCancel?.();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(false);

    // After an ambiguous send, a cancel must NOT drop the key: doing so would
    // mint a second key over a possibly live debit.
    await h.internals.purchaseCharter('strongbox_charter_1');
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
    h.internals.requestCharterPurchase('strongbox_charter_1');
    h.dialogs[h.dialogs.length - 1].onCancel?.();
    expect(h.internals.charterIntents.isOpen('strongbox_charter_1')).toBe(true);
  });
});

describe('Claudium top-up return hook', () => {
  // The store half is covered above (it hands the window one callback). This is
  // the window half: the callback is armed only by the toggle that OPENS, fires
  // exactly once on the close, and a close with nothing armed fires nothing.
  function claudiumHarness() {
    // A real root here too: under happy-dom the window's own captureBodyFocus
    // runs and calls body.contains(activeElement), which a stub cannot answer.
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="panel-title">' +
      '<span data-refresh-status></span>' +
      '<span data-cl-live-status></span>' +
      '</div><div class="cl-body"></div>';
    root.style.display = 'none';
    document.body.appendChild(root);
    const window_ = new ClaudiumWindow({
      root: () => root,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      snapshot: async () => ({ balance: 0, skus: [] }),
      buy: async () => undefined,
    });
    return { window: window_, root };
  }

  it('fires an armed return exactly once when the window closes', async () => {
    const { window } = claudiumHarness();
    let fired = 0;

    window.toggle(() => {
      fired += 1;
    });
    expect(window.isOpen).toBe(true);
    expect(fired).toBe(0);

    window.close();
    expect(fired).toBe(1);

    // A second close (already closed) cannot fire it again, and neither can a
    // fresh open-and-close with nothing armed.
    window.close();
    window.toggle();
    window.close();
    expect(fired).toBe(1);
    await Promise.resolve();
  });
});

describe('the charter idempotency-key minter', () => {
  // A key outside the server's STORAGE_KEY_PATTERN comes back 'invalid_request',
  // which the ledger reads as DEFINITIVE and closes the intent on. A charset
  // regression is therefore a silently LOST intent, not a visible error.
  // The REAL pattern the server rejects against, imported rather than
  // re-spelled: a detached literal drifts silently, and drifting APART is the
  // dangerous direction (a key this minter accepts and the server refuses comes
  // back 'invalid_request', which the ledger reads as DEFINITIVE and closes the
  // intent on, so a charset regression is a silently lost intent, not an error).
  const STORAGE_KEY_PATTERN = SERVER_STORAGE_KEY_PATTERN;

  it('mints in-charset keys on the crypto arm', () => {
    expect(globalThis.crypto?.randomUUID).toBeTypeOf('function');
    const keys = Array.from({ length: 500 }, () => mintIntentKey());
    for (const key of keys) expect(key).toMatch(STORAGE_KEY_PATTERN);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mints in-charset keys on the FALLBACK arm', () => {
    // Force the arm a browser without crypto.randomUUID takes. It is the arm
    // no environment in CI exercises by accident, and the one built by string
    // concatenation, so it is the likelier place for a stray character.
    vi.stubGlobal('crypto', undefined);
    try {
      const keys = Array.from({ length: 500 }, () => mintIntentKey());
      for (const key of keys) expect(key).toMatch(STORAGE_KEY_PATTERN);
      // The fallback really was taken (the crypto arm emits bare hex + hyphens).
      expect(keys.every((key) => key.startsWith('intent-'))).toBe(true);
      // And it is actually a MINTER. Charset plus prefix alone would be
      // satisfied by a constant, and a constant key on the fallback arm means
      // every purchase after the first replays the first one's receipt: the
      // player pays once and the service answers already_granted forever.
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
