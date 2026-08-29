import type { InvSlot } from '../sim/types';

export interface TradeOffer {
  items: InvSlot[];
  copper: number;
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
  tradeSetOffer(items: InvSlot[], copper: number): void;
  tradeConfirm(): void;
  tradeCancel(): void;
  /** End the session without calling it a cancellation, for when the business
   *  the window existed for has concluded elsewhere. */
  tradeClose(): void;
}
