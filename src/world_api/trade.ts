import type { InvSlot } from '../sim/types';

export interface TradeOffer {
  /** Authoritative, presentation-ready offer. Instances are server-resolved. */
  items: InvSlot[];
  copper: number;
}

/** Client request for one offered line. instanceUid selects one generated
 * copy; clients never send an ItemInstancePayload. */
export interface TradeOfferRequestItem {
  itemId: string;
  count: number;
  instanceUid?: string;
}

export interface TradeInfo {
  otherPid: number;
  otherName: string;
  myOffer: TradeOffer;
  theirOffer: TradeOffer;
  myAccepted: boolean;
  theirAccepted: boolean;
}

export interface IWorldTrade {
  tradeInfo: TradeInfo | null;
  tradeRequest(targetPid: number): void;
  tradeAccept(): void;
  tradeSetOffer(items: TradeOfferRequestItem[], copper: number): void;
  tradeConfirm(): void;
  tradeCancel(): void;
}
