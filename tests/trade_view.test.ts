import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { buildTradeView, type StagedTradeOffer, type TradeItemLookup } from '../src/ui/trade_view';
import type { TradeInfo } from '../src/world_api';

// The trade core maps the sim-authoritative TradeInfo snapshot (null with no
// open trade) plus the locally staged offer buffer into a render model. Both
// hosts (offline Sim, online ClientWorld) expose the identical TradeInfo shape
// (ClientWorld.tradeInfo is a plain snapshot-mirrored field, src/net/online.ts),
// so a single well-formed TradeInfo fixture exercises both without a
// host-specific branch; the tests below construct the fixture directly, which
// is exactly what each host hands the core.

const ITEMS: Record<string, { quality?: string }> = {
  sword: { quality: 'rare' },
  potion: { quality: 'common' },
  bread: {},
  signed_blade: { quality: 'epic' },
};
const lookup: TradeItemLookup = (id) => ITEMS[id];

function stagedOf(over: Partial<StagedTradeOffer> = {}): StagedTradeOffer {
  return { items: [], copper: 0, claudium: 0, woc: '0', ...over };
}

function offer(over: Partial<TradeInfo['myOffer']> = {}): TradeInfo['myOffer'] {
  return { items: [], copper: 0, claudium: 0, woc: '0', ...over };
}

function tradeInfo(over: Partial<TradeInfo> = {}): TradeInfo {
  return {
    otherPid: 2,
    otherName: 'Bet',
    myOffer: offer(),
    theirOffer: offer(),
    myAccepted: false,
    theirAccepted: false,
    phase: 'open',
    rails: { claudium: false, woc: false },
    ...over,
  };
}

describe('buildTradeView', () => {
  it('reports closed with no open trade (both hosts: null TradeInfo)', () => {
    expect(buildTradeView(null, stagedOf(), lookup)).toEqual({ kind: 'closed' });
  });

  it('builds an open view: item rows from the sim-confirmed offer, coin/currency inputs from the staged buffer', () => {
    const staged = stagedOf({
      items: [{ itemId: 'sword', count: 1 }],
      copper: 12345,
      claudium: 7,
      woc: '1.5',
    });
    const info = tradeInfo({
      myOffer: offer({ items: [{ itemId: 'sword', count: 1 }] }),
      theirOffer: offer({ items: [{ itemId: 'potion', count: 3 }], copper: 500 }),
      rails: { claudium: true, woc: true },
    });
    const view = buildTradeView(info, staged, lookup);
    expect(view.kind).toBe('open');
    if (view.kind !== 'open') throw new Error('expected open');
    expect(view.otherName).toBe('Bet');
    expect(view.myRows).toEqual([
      { itemId: 'sword', count: 1, showCount: false, qualityKey: 'rare', instance: undefined },
    ]);
    expect(view.theirRows).toEqual([
      { itemId: 'potion', count: 3, showCount: true, qualityKey: 'common', instance: undefined },
    ]);
    // Coin/Claudium/WOC input values come from the LOCAL staged buffer (so a
    // typed value never snaps back mid-edit), never the sim-confirmed offer.
    expect(view.myCoin).toEqual({ gold: 1, silver: 23, copper: 45 });
    expect(view.myClaudium).toBe(7);
    expect(view.myWoc).toBe('1.5');
    // Their side has no local edit buffer: read straight off the confirmed offer.
    expect(view.theirCopper).toBe(500);
    expect(view.rails).toEqual({ claudium: true, woc: true });
  });

  it('gates the rails passthrough: unavailable rails carry through as false for the painter to hide the input', () => {
    const info = tradeInfo({ rails: { claudium: false, woc: false } });
    const view = buildTradeView(info, stagedOf(), lookup);
    if (view.kind !== 'open') throw new Error('expected open');
    expect(view.rails.claudium).toBe(false);
    expect(view.rails.woc).toBe(false);
  });

  it('marks an instanced row distinctly from a fungible row of the same itemId (the data-loss regression fix)', () => {
    const instancedRow: InvSlot = {
      itemId: 'signed_blade',
      count: 1,
      instance: { signer: 'Ayla', rolled: { stats: { str: 5 } } },
    };
    const fungibleRow: InvSlot = { itemId: 'signed_blade', count: 2 };
    const info = tradeInfo({
      myOffer: offer({ items: [instancedRow, fungibleRow] }),
    });
    const view = buildTradeView(info, stagedOf(), lookup);
    if (view.kind !== 'open') throw new Error('expected open');
    expect(view.myRows).toHaveLength(2);
    expect(view.myRows[0]).toEqual({
      itemId: 'signed_blade',
      count: 1,
      showCount: false,
      qualityKey: 'epic',
      instance: { signer: 'Ayla', rolled: { stats: { str: 5 } } },
    });
    expect(view.myRows[1]).toEqual({
      itemId: 'signed_blade',
      count: 2,
      showCount: true,
      qualityKey: 'epic',
      instance: undefined,
    });
  });

  it('falls back to "common" for an item missing from the lookup table', () => {
    const info = tradeInfo({ myOffer: offer({ items: [{ itemId: 'unknown_id', count: 1 }] }) });
    const view = buildTradeView(info, stagedOf(), lookup);
    if (view.kind !== 'open') throw new Error('expected open');
    expect(view.myRows[0].qualityKey).toBe('common');
  });

  it('builds a settling view: escrowed offers (no staged passthrough), settle progress, and a mine-only wocPay', () => {
    const info = tradeInfo({
      phase: 'settling',
      myOffer: offer({
        items: [{ itemId: 'sword', count: 1 }],
        copper: 100,
        claudium: 5,
        woc: '2',
      }),
      theirOffer: offer({ copper: 200, claudium: 0, woc: '0' }),
      settle: {
        claudiumMine: 'done',
        claudiumTheirs: 'none',
        wocMine: 'pending',
        wocTheirs: 'none',
      },
      wocPay: { uri: 'solana:abc?amount=2', reference: 'ref123', amountUi: '2' },
    });
    // A staged buffer with stray edits must NOT leak into a settling view: once
    // escrowed the offer is immutable, and my* fields read the ESCROWED offer.
    const view = buildTradeView(
      info,
      stagedOf({ copper: 999999, claudium: 999, woc: '999' }),
      lookup,
    );
    expect(view.kind).toBe('settling');
    if (view.kind !== 'settling') throw new Error('expected settling');
    expect(view.myCopper).toBe(100);
    expect(view.myClaudium).toBe(5);
    expect(view.myWoc).toBe('2');
    expect(view.theirCopper).toBe(200);
    expect(view.settle).toEqual({
      claudiumMine: 'done',
      claudiumTheirs: 'none',
      wocMine: 'pending',
      wocTheirs: 'none',
    });
    expect(view.wocPay).toEqual({ uri: 'solana:abc?amount=2', reference: 'ref123', amountUi: '2' });
  });

  it('settling with no server-enriched fields (offline Sim shape) resolves settle/wocPay to null, not undefined-crash', () => {
    const info = tradeInfo({ phase: 'settling', myOffer: offer(), theirOffer: offer() });
    const view = buildTradeView(info, stagedOf(), lookup);
    if (view.kind !== 'settling') throw new Error('expected settling');
    expect(view.settle).toBeNull();
    expect(view.wocPay).toBeNull();
  });

  it('is deterministic: the same TradeInfo + staged offer input always produces an equal (deep-equal) view, whichever host built the snapshot', () => {
    const info = tradeInfo({
      myOffer: offer({ items: [{ itemId: 'potion', count: 2 }], copper: 50 }),
      theirOffer: offer({ items: [{ itemId: 'bread', count: 1 }] }),
    });
    const staged = stagedOf({ items: [{ itemId: 'potion', count: 2 }], copper: 50 });
    // A Sim-shaped call (a live TradeInfo object) and a ClientWorld-shaped call
    // (the same shape round-tripped through JSON, as the wire snapshot mirror
    // does) must agree byte-for-byte.
    const fromSim = buildTradeView(info, staged, lookup);
    const fromClientWorld = buildTradeView(
      JSON.parse(JSON.stringify(info)) as TradeInfo,
      JSON.parse(JSON.stringify(staged)) as StagedTradeOffer,
      lookup,
    );
    expect(fromClientWorld).toEqual(fromSim);
  });
});
