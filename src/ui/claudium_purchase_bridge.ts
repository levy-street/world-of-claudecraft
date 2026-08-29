// The Claudium purchase bridge: the members every Claudium-spending window
// needs from the HUD coordinator, built once and spread whole into each
// window's deps.
//
// WHY IT EXISTS. Until Bank Storage phase 13 exactly one window spent
// Claudium, so its spend closure, its enabled check and its top-up opener were
// written inline in the `new DailyRewardsWindow({...})` deps literal in
// src/ui/hud.ts. The banker's dual-price rung purchase is the second spender,
// and copying the money-handling closure into a second deps literal is exactly
// the shape that drifts: the balance write on one side and
// not the other, the caller-held idempotency key threaded through one hook and
// dropped by the next. There is now ONE spend seam and both windows consume it.
//
// It is a thin consumer, not a pure core: everything here needs the
// coordinator's private mutable state (the live hooks reference, the launcher
// balance latch, the Claudium window). That state arrives through the host
// interface below, which is why this module has no import from src/ui/hud.ts
// and can be exercised without one.
//
// THE MONEY CONTRACT THE SPEND MEMBER CARRIES, and it is load-bearing:
// `idempotencyKey` is OPTIONAL and CALLER-HELD. A repeatable 'storage' SKU
// writes no grant row and the economy service dedupes on that key ALONE, so a
// retry under a fresh key is a SECOND REAL CHARGE. Callers that spend on
// storage hold one key per purchase INTENT (src/ui/store_purchase_intent.ts)
// and pass it on every retry; the weapon-skin caller omits it and main.ts
// mints one per attempt, which is safe there because a skin writes a grant row
// and replays.

/** The result of one Claudium spend, as every client surface sees it. Mirrors
 *  `ClaudiumSpend` in src/net/economy_sdk.ts, whose off/unreachable fallback
 *  (`granted: false, reason: 'unavailable'`) is what a network failure
 *  produces rather than a thrown rejection. */
export interface StoreSpendResult {
  granted: boolean;
  balance: number | null;
  costClaudium: number | null;
  reason: string | null;
}

/** The spend kinds the economy service accepts. 'storage' is the repeatable
 *  one and the reason the key above is caller-held. */
export type ClaudiumSpendKind = 'cosmetic' | 'skin' | 'item' | 'storage';

/** The narrow slice of the economy hooks this bridge calls. Declared
 *  structurally rather than imported from src/ui/hud.ts so the dependency
 *  points one way only: hud.ts builds a bridge, the bridge knows nothing of
 *  hud.ts. `ClaudiumHooks` satisfies it. */
export interface ClaudiumSpendHooks {
  spend(
    itemId: string,
    kind: ClaudiumSpendKind,
    expectedCostClaudium: number,
    idempotencyKey?: string,
  ): Promise<StoreSpendResult>;
}

/** What the bridge needs from the coordinator, all lazy: the hooks reference
 *  is null offline and until main.ts attaches it, and it is replaced rather
 *  than mutated, so every member reads it at CALL time. */
export interface ClaudiumPurchaseHost {
  /** The attached economy hooks, or null (offline, native build, never
   *  attached). This is the single source of the enabled answer. */
  hooks(): ClaudiumSpendHooks | null;
  /** The last known balance, from the coordinator's launcher latch. null when
   *  it has never been read. Reading it may kick a throttled refresh; a
   *  caller painting a price tag wants the cached number, not a round trip. */
  cachedBalance(): number | null;
  /** Route an authoritative balance into that same latch, so every surface
   *  showing a balance converges on one write seam. */
  setBalance(balance: number): void;
  /** Open the Claudium top-up window; `onClosed` fires at most once, when it
   *  closes, which is the return path out of an insufficient-balance handoff. */
  openClaudium(onClosed?: () => void): void;
  /** The coordinator's shared confirm dialog. Part of this bundle because
   *  spending money always has a confirm step (the packet's no-modals rule
   *  bans UNPROMPTED interruptions, never the explicit purchase confirmation),
   *  and because the insufficient-balance handoff is itself a confirm. */
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
    onCancel?: () => void,
  ): void;
}

/** The members a Claudium-spending window's deps carry. Spread whole into a
 *  window's deps literal. */
export interface ClaudiumPurchaseFacet {
  storeEnabled(): boolean;
  claudiumBalance(): number | null;
  spendStoreItem(
    itemId: string,
    kind: ClaudiumSpendKind,
    expectedCostClaudium: number,
    idempotencyKey?: string,
  ): Promise<StoreSpendResult>;
  openClaudium(onClosed?: () => void): void;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
    onCancel?: () => void,
  ): void;
}

/** The spend answer when there are no hooks at all. Deliberately the SAME
 *  shape and the same 'unavailable' token the network client's own off-path
 *  returns, so "no hooks" and "the request never came back" are indistinguishable
 *  to a caller, which is correct: both are AMBIGUOUS and both must retain the
 *  caller's idempotency key rather than close its intent. */
const NO_HOOKS_SPEND: StoreSpendResult = {
  granted: false,
  balance: null,
  costClaudium: null,
  reason: 'unavailable',
};

export function createClaudiumPurchaseFacet(host: ClaudiumPurchaseHost): ClaudiumPurchaseFacet {
  return {
    storeEnabled: () => host.hooks() !== null,
    claudiumBalance: () => host.cachedBalance(),
    spendStoreItem: async (itemId, kind, expectedCostClaudium, idempotencyKey) => {
      const result = await host.hooks()?.spend(itemId, kind, expectedCostClaudium, idempotencyKey);
      // A null balance means the service did not say, not that the player has
      // nothing: overwriting the latch with it would blank a number every
      // surface is displaying.
      if (result?.balance !== null && result?.balance !== undefined) {
        host.setBalance(result.balance);
      }
      return result ?? NO_HOOKS_SPEND;
    },
    openClaudium: (onClosed) => host.openClaudium(onClosed),
    confirmDialog: (title, body, okText, cancelText, onOk, onCancel) =>
      host.confirmDialog(title, body, okText, cancelText, onOk, onCancel),
  };
}
