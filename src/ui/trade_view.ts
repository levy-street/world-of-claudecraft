// Pure, host-agnostic view model for the trade window (#trade-window).
//
// This is the pure-core half of the pure-core + thin-painter split (root
// CLAUDE.md Conventions; src/ui/CLAUDE.md "Authoring a new HUD component").
// Maps the proximity-free TradeInfo snapshot (null when no trade is open) plus
// the locally staged offer (the Hud-owned editable buffer for the money/
// Claudium/WOC inputs) into a render model. DOM-free and t()-free: strings
// resolve in trade_window.ts, this module returns keys/data only. Mirrors the
// bank_view.ts / vendor_view.ts split (a discriminated union keyed on the
// session's real state, 'away' vs populated for bank; 'closed'/'open'/
// 'settling' here).
//
// Row order is preserved verbatim from TradeInfo.myOffer/theirOffer.items (the
// sim's own validated offer, not the local staged buffer): the staged buffer
// only drives the coin/Claudium/WOC INPUT values so they stay responsive to
// typing, while the item rows always reflect what the sim actually holds
// (server-confirmed online, synchronous offline). This is byte-identical to
// the pre-extraction hud.ts behavior.

import type { InvSlot } from '../sim/types';
import type { TradeInfo } from '../world_api';
import { bagQualityKey } from './bags_view';

/** The item facts a trade row needs from the item table: just the quality, so
 *  the painter can tint the icon border. A miss (unknown id) is tolerated as
 *  'common' (bagQualityKey semantics). */
export type TradeItemLookup = (itemId: string) => { quality?: string } | undefined;

/** The locally staged offer Hud edits before the sim (or server) confirms it:
 *  identical shape to Hud.stagedTrade. */
export interface StagedTradeOffer {
  items: InvSlot[];
  copper: number;
  claudium: number;
  woc: string;
}

/** One offered/received row. `instance` carries the full payload when this row
 *  is a specific non-fungible copy (an enchanted/signed/rolled item), so the
 *  painter can mark it distinctly and a fungible row of the SAME itemId can
 *  render alongside it without merging (the instance-aware trading fix). */
export interface TradeItemRowModel {
  itemId: string;
  count: number;
  showCount: boolean; // count > 1 (a lone item hides its "x1")
  qualityKey: string;
  instance?: InvSlot['instance'];
}

/** Coin input parts (gold/silver/copper), matching the existing #trade-g/s/c
 *  breakdown of a copper total. */
export interface TradeCoinParts {
  gold: number;
  silver: number;
  copper: number;
}

function coinParts(copper: number): TradeCoinParts {
  const c = Math.max(0, Math.floor(copper));
  return {
    gold: Math.floor(c / 10000),
    silver: Math.floor((c % 10000) / 100),
    copper: c % 100,
  };
}

function buildRows(items: readonly InvSlot[], lookup: TradeItemLookup): TradeItemRowModel[] {
  return items.map((slot) => ({
    itemId: slot.itemId,
    count: slot.count,
    showCount: slot.count > 1,
    qualityKey: bagQualityKey(lookup(slot.itemId) ?? {}),
    instance: slot.instance,
  }));
}

/** Which external-currency pledge inputs THIS player may edit right now (the
 *  sim's own TradeInfo.rails, a pure UI affordance re-validated on every set). */
export type TradeRailsModel = TradeInfo['rails'];

/** Per-leg settlement progress while settling (TradeInfo.settle, verbatim). */
export type TradeSettleModel = NonNullable<TradeInfo['settle']>;

/** The Solana Pay request for a $WOC leg this player still owes (TradeInfo.wocPay). */
export type TradeWocPayModel = NonNullable<TradeInfo['wocPay']>;

export type TradeViewModel =
  | { kind: 'closed' }
  | {
      kind: 'open';
      otherName: string;
      myRows: TradeItemRowModel[];
      theirRows: TradeItemRowModel[];
      // Coin/Claudium/WOC input values: the LOCAL staged buffer, so a typed
      // value never snaps back mid-edit. Their side is read straight off the
      // sim/server-confirmed offer (never locally edited).
      myCoin: TradeCoinParts;
      myClaudium: number;
      myWoc: string;
      theirCopper: number;
      theirClaudium: number;
      theirWoc: string;
      myAccepted: boolean;
      theirAccepted: boolean;
      rails: TradeRailsModel;
    }
  | {
      kind: 'settling';
      otherName: string;
      myRows: TradeItemRowModel[];
      theirRows: TradeItemRowModel[];
      myCopper: number;
      theirCopper: number;
      myClaudium: number;
      theirClaudium: number;
      myWoc: string;
      theirWoc: string;
      settle: TradeSettleModel | null;
      wocPay: TradeWocPayModel | null;
    };

/**
 * Build the trade window's render model. `info` is the IWorld snapshot (null
 * with no open trade, both hosts). `staged` is Hud's locally edited offer
 * buffer, read only in the 'open' phase (it has no meaning once escrowed).
 */
export function buildTradeView(
  info: TradeInfo | null,
  staged: StagedTradeOffer,
  itemLookup: TradeItemLookup,
): TradeViewModel {
  if (!info) return { kind: 'closed' };
  const myRows = buildRows(info.myOffer.items, itemLookup);
  const theirRows = buildRows(info.theirOffer.items, itemLookup);
  if (info.phase === 'settling') {
    return {
      kind: 'settling',
      otherName: info.otherName,
      myRows,
      theirRows,
      myCopper: info.myOffer.copper,
      theirCopper: info.theirOffer.copper,
      myClaudium: info.myOffer.claudium,
      theirClaudium: info.theirOffer.claudium,
      myWoc: info.myOffer.woc,
      theirWoc: info.theirOffer.woc,
      settle: info.settle ?? null,
      wocPay: info.wocPay ?? null,
    };
  }
  return {
    kind: 'open',
    otherName: info.otherName,
    myRows,
    theirRows,
    myCoin: coinParts(staged.copper),
    myClaudium: staged.claudium,
    myWoc: staged.woc,
    theirCopper: info.theirOffer.copper,
    theirClaudium: info.theirOffer.claudium,
    theirWoc: info.theirOffer.woc,
    myAccepted: info.myAccepted,
    theirAccepted: info.theirAccepted,
    rails: info.rails,
  };
}
