import type { InvSlot } from '../sim/types';

// A side's staged offer. `items` rows are either fungible ({itemId, count}) or a
// specific non-fungible copy carrying its ItemInstancePayload (count 1); the sim
// captures the payload from the OWNER's real inventory, never from the wire.
// `claudium` is whole Claudium (integer, 0 = none). `woc` is a $WOC amount in UI
// units as a canonical decimal string ('0' = none): the sim never does arithmetic
// on it, the server converts to base units for on-chain verification, and a
// string never loses precision the way a float would.
export interface TradeOffer {
  items: InvSlot[];
  copper: number;
  claudium: number;
  woc: string;
}

// Which external-currency legs THIS player may pledge right now (feature flag +
// service wiring + wallet links for both parties, folded host-side). Pure UI
// affordance: the sim re-validates every pledge on set and the server settles
// authoritatively.
export interface TradeRails {
  claudium: boolean;
  woc: boolean;
}

// Per-leg settlement progress while phase === 'settling'. 'none' = the leg does
// not exist in this trade.
export interface TradeSettleStatus {
  claudiumMine: 'none' | 'pending' | 'done';
  claudiumTheirs: 'none' | 'pending' | 'done';
  wocMine: 'none' | 'pending' | 'done';
  wocTheirs: 'none' | 'pending' | 'done';
}

export interface TradeInfo {
  otherPid: number;
  otherName: string;
  myOffer: TradeOffer;
  theirOffer: TradeOffer;
  myAccepted: boolean;
  theirAccepted: boolean;
  // 'open' = offers editable, confirm swaps items + copper atomically in-tick.
  // 'settling' = both confirmed with an external pledge: goods are escrowed and
  // the server drives the Claudium/$WOC legs before releasing them.
  phase: 'open' | 'settling';
  rails: TradeRails;
  // Server-enriched while settling and this player owes a $WOC payment: the
  // Solana Pay transfer request for their wallet. Never set by the offline Sim.
  wocPay?: { uri: string; reference: string; amountUi: string } | null;
  // Server-enriched while settling: per-leg progress. Never set by the offline Sim.
  settle?: TradeSettleStatus | null;
}

export interface IWorldTrade {
  tradeInfo: TradeInfo | null;
  tradeRequest(targetPid: number): void;
  tradeAccept(): void;
  tradeDecline(): void;
  tradeSetOffer(items: InvSlot[], copper: number, claudium: number, woc: string): void;
  tradeConfirm(): void;
  tradeCancel(): void;
}
