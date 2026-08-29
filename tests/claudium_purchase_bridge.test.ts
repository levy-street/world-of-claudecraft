// The Claudium spend seam both spending windows consume, EXECUTED.
//
// WHY THIS FILE EXISTS. Until Bank Storage phase 13 this logic was a closure
// inside the `new DailyRewardsWindow({...})` deps literal in src/ui/hud.ts, and
// state.md ruling 20 recorded the consequence honestly: the idempotency-key
// passthrough was pinned only by comment-stripped, occurrence-bounded SOURCE
// text, because extracting either half to test it would have cost lines in a
// file sitting at exactly its monolith ceiling. Phase 13 needed a second window
// on the same seam, so the seam moved into its own module and the pins that
// could only ever read source can now run.
//
// The claim these arms defend is a real-money one. A repeatable 'storage' SKU
// writes no grant row, so the economy service dedupes on the caller-held key
// ALONE: a retry that arrives under a fresh key is a SECOND REAL CHARGE. The
// specific regression is invisible to the type checker, because the parameter
// is optional: drop the fourth argument at the forwarding call and everything
// still compiles, every window still works, and every retry pays again.
import { describe, expect, it } from 'vitest';
import {
  type ClaudiumPurchaseHost,
  type ClaudiumSpendHooks,
  createClaudiumPurchaseFacet,
  type StoreSpendResult,
} from '../src/ui/claudium_purchase_bridge';

interface Recorded {
  itemId: string;
  kind: string;
  cost: number;
  key: string | undefined;
}

/** Every argument of the confirm-dialog forward, recorded positionally. The
 *  whole tuple matters: this is a six-argument POSITIONAL call, so a swapped
 *  okText/cancelText, or worse a swapped onOk/onCancel, forwards fine to the
 *  type checker and would make the insufficient-balance handoff open the
 *  top-up window when the player presses CANCEL. */
interface Recorded2 {
  title: string;
  body: string;
  okText: string;
  cancelText: string;
  onOk: () => void;
  onCancel?: () => void;
}

function host(
  over: Partial<ClaudiumPurchaseHost> & { result?: StoreSpendResult; hooksNull?: boolean } = {},
): {
  host: ClaudiumPurchaseHost;
  sent: Recorded[];
  balances: number[];
  opens: (undefined | (() => void))[];
  confirms: Recorded2[];
} {
  const sent: Recorded[] = [];
  const balances: number[] = [];
  const opens: (undefined | (() => void))[] = [];
  const confirms: Recorded2[] = [];
  const hooks: ClaudiumSpendHooks = {
    spend: async (itemId, kind, cost, key) => {
      sent.push({ itemId, kind, cost, key });
      return over.result ?? { granted: true, balance: 42, costClaudium: cost, reason: null };
    },
  };
  return {
    host: {
      hooks: () => (over.hooksNull ? null : hooks),
      cachedBalance: () => 1234,
      setBalance: (b) => balances.push(b),
      openClaudium: (onClosed) => opens.push(onClosed),
      confirmDialog: (title, body, okText, cancelText, onOk, onCancel) =>
        confirms.push({ title, body, okText, cancelText, onOk, onCancel }),
      ...over,
    },
    sent,
    balances,
    opens,
    confirms,
  };
}

describe('createClaudiumPurchaseFacet: the money passthrough', () => {
  it('forwards the caller-held idempotency key VERBATIM to the hook', async () => {
    // THE regression this file exists for. Dropping the fourth argument at the
    // forwarding call type-checks and silently mints a fresh key per retry.
    const h = host();
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'intent-abc');
    expect(h.sent).toEqual([
      { itemId: 'strongbox_rung_01', kind: 'storage', cost: 250, key: 'intent-abc' },
    ]);
  });

  it('sends the SAME key on every retry of one intent, and never rewrites it', async () => {
    const h = host();
    const facet = createClaudiumPurchaseFacet(h.host);
    for (const _ of [0, 1, 2]) {
      await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'intent-abc');
    }
    expect(h.sent.map((s) => s.key)).toEqual(['intent-abc', 'intent-abc', 'intent-abc']);
  });

  it('omits the key entirely when the caller has none (the weapon-skin path)', async () => {
    // A skin writes a grant row, so a fresh key per attempt still replays and
    // debits nothing. The bridge must pass UNDEFINED through rather than
    // substituting a key of its own, which would make the two paths diverge.
    const h = host();
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('crimson_edge', 'skin', 900);
    expect(h.sent[0].key).toBeUndefined();
  });

  it('passes the declared cost through untouched', async () => {
    const h = host();
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('strongbox_rung_07', 'storage', 4237, 'k');
    expect(h.sent[0].cost).toBe(4237);
  });
});

describe('createClaudiumPurchaseFacet: the balance latch', () => {
  it('routes an authoritative balance into the one converge seam', async () => {
    const h = host({ result: { granted: true, balance: 77, costClaudium: 250, reason: null } });
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'k');
    expect(h.balances).toEqual([77]);
  });

  it('writes a ZERO balance, which is a real number and not an absence', async () => {
    // The tempting truthiness guard would drop exactly the balance that matters
    // most: the one that just ran out.
    const h = host({ result: { granted: true, balance: 0, costClaudium: 250, reason: null } });
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'k');
    expect(h.balances).toEqual([0]);
  });

  it('does NOT write a null balance over a number every surface is displaying', async () => {
    // null means the service did not say, not that the player has nothing.
    const h = host({ result: { granted: false, balance: null, costClaudium: null, reason: 'x' } });
    const facet = createClaudiumPurchaseFacet(h.host);
    await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'k');
    expect(h.balances).toEqual([]);
  });

  it('reads the cached balance rather than starting a round trip', () => {
    const h = host();
    expect(createClaudiumPurchaseFacet(h.host).claudiumBalance()).toBe(1234);
    expect(h.sent).toEqual([]);
  });
});

describe('createClaudiumPurchaseFacet: no hooks at all', () => {
  it('answers unavailable, which is AMBIGUOUS and retains the caller intent', async () => {
    // Deliberately the same shape and token the network client's own off-path
    // returns, so "no hooks" and "the reply was lost" are indistinguishable to a
    // caller. Both must retain the key rather than close an intent, and
    // 'unavailable' is exactly the token DEFINITIVE_SPEND_REFUSALS excludes.
    const h = host({ hooksNull: true });
    const facet = createClaudiumPurchaseFacet(h.host);
    const result = await facet.spendStoreItem('strongbox_rung_01', 'storage', 250, 'k');
    expect(result).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });
    expect(h.sent).toEqual([]);
    expect(h.balances).toEqual([]);
  });

  it('reports the store as disabled when the hooks are null, enabled when they are not', () => {
    expect(createClaudiumPurchaseFacet(host({ hooksNull: true }).host).storeEnabled()).toBe(false);
    expect(createClaudiumPurchaseFacet(host().host).storeEnabled()).toBe(true);
  });

  it('reads the hooks LAZILY, so a bank opened before the handshake still lights up', () => {
    // main.ts attaches the hooks after the online handshake. A facet that
    // captured the reference at construction would answer false forever for any
    // window built before that.
    let attached = false;
    const hooks: ClaudiumSpendHooks = {
      spend: async () => ({ granted: true, balance: null, costClaudium: null, reason: null }),
    };
    const facet = createClaudiumPurchaseFacet({
      hooks: () => (attached ? hooks : null),
      cachedBalance: () => null,
      setBalance: () => undefined,
      openClaudium: () => undefined,
      confirmDialog: () => undefined,
    });
    expect(facet.storeEnabled()).toBe(false);
    attached = true;
    expect(facet.storeEnabled()).toBe(true);
  });
});

describe('createClaudiumPurchaseFacet: the handoff members', () => {
  it('carries the top-up return callback through to the host', () => {
    const h = host();
    const facet = createClaudiumPurchaseFacet(h.host);
    const onClosed = (): void => undefined;
    facet.openClaudium(onClosed);
    expect(h.opens).toEqual([onClosed]);
  });

  it('opens the top-up window with no callback when the caller wants none', () => {
    const h = host();
    createClaudiumPurchaseFacet(h.host).openClaudium();
    expect(h.opens).toEqual([undefined]);
  });

  it('forwards ALL SIX confirm-dialog arguments in order, callbacks included', () => {
    // Asserting only the title would let a swapped okText/cancelText, or a
    // swapped onOk/onCancel, pass: both type-check, and the second would make
    // the insufficient-balance handoff open the top-up window when the player
    // presses CANCEL. The callbacks are distinguished by CALLING them.
    const h = host();
    const ran: string[] = [];
    createClaudiumPurchaseFacet(h.host).confirmDialog(
      'Title',
      'Body',
      'Ok',
      'Cancel',
      () => ran.push('ok'),
      () => ran.push('cancel'),
    );
    expect(h.confirms).toHaveLength(1);
    const c = h.confirms[0];
    expect([c.title, c.body, c.okText, c.cancelText]).toEqual(['Title', 'Body', 'Ok', 'Cancel']);
    c.onOk();
    expect(ran).toEqual(['ok']);
    c.onCancel?.();
    expect(ran).toEqual(['ok', 'cancel']);
  });

  it('forwards a confirm dialog that has no cancel callback as having none', () => {
    const h = host();
    createClaudiumPurchaseFacet(h.host).confirmDialog('T', 'B', 'Ok', 'Cancel', () => undefined);
    expect(h.confirms[0].onCancel).toBeUndefined();
  });
});
