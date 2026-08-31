// The economy-service vocabulary for the $WOC Exchange: quote legs, price and
// estimate readouts, the quote intent, and the WocMarketEconomy seam itself.
// A leaf types module (the woc_market_monitor_types.ts pattern), re-exported
// by server/woc_market.ts so consumers keep one import home.
/** Token-side quote leg: the base-unit string is exact, the tokens number is
 *  the service-computed display value. The game renders both verbatim. */
export interface WocQuoteLeg {
  base: string;
  tokens: number;
}

export interface WocPriceInfo {
  available: boolean;
  healthy: boolean;
  reason: string | null;
  /** Service-computed display rate (tokens per 1 USD); null when down. */
  tokensPerUsd: number | null;
  asOfMs: number | null;
}

/** The fee split for an amount, in USD CENTS, as computed by the economy
 *  service. The game NEVER derives these: the real split rounds each fee leg up
 *  and gives the seller the remainder, so a percentage recomputed here would
 *  disagree with the settlement by a cent. Null whenever the estimate is
 *  unavailable, and also on an older service build that does not send it. */
export interface WocEstimateSplit {
  sellerCents: number;
  burnCents: number;
  treasuryCents: number;
}

export interface WocEstimate {
  available: boolean;
  usdCents: number;
  amount: WocQuoteLeg | null;
  asOfMs: number | null;
  split: WocEstimateSplit | null;
}

export interface WocQuoteIntent {
  ok: boolean;
  reference: string | null;
  /** The full transfer the buyer signs (service-built transaction). */
  transactionBase64: string | null;
  /** Whether the buyer must sign it. False only under the service's dev chain,
   *  whose stand-in transaction no wallet can sign. Defaults TRUE on anything
   *  the service does not say, so a missing field can never skip a signature. */
  signatureRequired: boolean;
  amount: WocQuoteLeg | null;
  seller: WocQuoteLeg | null;
  burn: WocQuoteLeg | null;
  treasury: WocQuoteLeg | null;
  /** The SERVICE-computed bond for a bond quote (pure bps ceil of the bid,
   *  clamped): the game renders and persists this figure, it never derives
   *  the money. Null on settlement quotes. Also carried on a
   *  bond_amount_drift refusal, so the caller can adopt the expected figure
   *  and re-quote instead of stranding the bid. */
  bondCents: number | null;
  expiresAtMs: number | null;
  reason: string | null;
}

/**
 * The economy-service seam. Everything on it is REFERENCE-keyed: the service
 * can legitimately hold TWO settled quotes for one memoRef (its entry
 * adoption re-settles a superseded quote that a ledger-proven payment backs,
 * beside the fresh quote), so no consumer may assume one settled row per
 * memo, enumerate by memo, or treat a memoRef as a settlement identity. The
 * game stores exactly one live reference per row (bond_reference /
 * quote_reference) and asks only about that; a re-quote that retires a
 * stored reference leaves the operator trace quoteFor logs.
 */
export interface WocMarketEconomy {
  price(): Promise<WocPriceInfo>;
  estimate(usdCents: number): Promise<WocEstimate>;
  bondQuote(args: {
    memoRef: string;
    /** The BID being bonded: the service computes the bond from it. */
    bidCents: number;
    /** Optional echo of the bond the caller expects (the stored figure on a
     *  refresh). A mismatch refuses bond_amount_drift carrying the service's
     *  bondCents; never the request's bond input. */
    usdCents?: number;
    buyerWallet: string;
  }): Promise<WocQuoteIntent>;
  settlementQuote(args: {
    memoRef: string;
    usdCents: number;
    buyerWallet: string;
    sellerWallet: string;
  }): Promise<WocQuoteIntent>;
  confirm(
    reference: string,
    signature: string,
  ): Promise<{ settled: boolean; pending: boolean; reason: string | null }>;
  refundBond(reference: string): Promise<{ done: boolean; reason: string | null }>;
  forfeitBond(reference: string): Promise<{ done: boolean; reason: string | null }>;
  /** Ops introspection for the price cache (proxy only; the dev economy has
   *  no cache): ages of the held success and failure memos, so a stale-served
   *  or blanked price is a NUMBER on the internal stuck readout rather than
   *  invisible (the cached_read stale-serve warn's spirit; this cache logs
   *  nothing itself). */
  priceCacheAges?(): { successAgeMs: number | null; failureAgeMs: number | null };
}
