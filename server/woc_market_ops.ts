import type { WocDirectedOfferRow, WocListingLifecycle, WocListingRow } from './woc_market';

export type WocOpsListingStatus = WocListingLifecycle | 'sold' | 'cancelled' | 'all';

/** A public listing plus sale provenance for the internal operator view. */
export interface WocOpsListingRow extends WocListingRow {
  buyerAccount: number | null;
  buyerName: string | null;
  soldAtMs: number | null;
}

/** A directed offer plus the outcome it reached, for the operator p2p view. */
export interface WocOpsP2pTradeRow extends WocDirectedOfferRow {
  settledAmountBase: string | null;
  txSignature: string | null;
}
