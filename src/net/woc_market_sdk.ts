// Typed client SDK for the game server's /api/woc-market/* routes (the
// economy_sdk.ts sibling; docs/prd/woc/marketplace.md). Same-origin by
// default via apiUrl(); every call carries the bearer token. It NEVER throws
// into render: every failure resolves to a typed { ok: false } carrying the
// server's stable woc_market.* code (or 'unavailable' when the network or a
// non-JSON body ate the response), which the window maps to player text via
// the apiError.* catalog. The client computes NO price, token, split, or
// increment values: it renders exactly what the server hands it.

import { apiUrl } from '../client_origin';
import type { InvSlot, ItemInstancePayload } from '../sim/types';

export interface WocMarketClientConfig {
  token(): string | null;
  base?: string;
}

export interface WocQuoteLegView {
  base: string;
  tokens: number;
}

export interface WocPriceView {
  available: boolean;
  healthy: boolean;
  tokensPerUsd: number | null;
  asOfMs: number | null;
}

export interface WocMarketStatus {
  ok: boolean;
  enabled: boolean;
  price: WocPriceView;
  maxActiveListings: number;
  durationsHours: readonly number[];
  minPriceCents: number;
  maxPriceCents: number;
  qualityFloor: string;
  /** Whether the realm trades the two collectible categories (mounts at any
   *  rarity, mech chroma plates at any rarity). The Sell picker mirrors these
   *  so it never offers what the server would refuse. */
  allowMounts: boolean;
  allowMechChromas: boolean;
  settlementWindowSeconds: number;
  /** The directed (p2p) payment hold in seconds: the buyer's commitment note
   *  names it. Absent from an older server (the note then names no figure). */
  directedHoldSeconds?: number;
  /** The bid-bond schedule and bond payment window, so disclosure copy
   *  resolves live figures (the server's own mirror of the service rule; the
   *  service-computed figure still arrives on every quote). Absent from an
   *  older server AND from the fail-closed stub: the copy then falls back to
   *  its figure-free sentences rather than asserting numbers it cannot know. */
  bond?: {
    rateBps: number;
    minCents: number;
    maxCents: number;
    pendingTtlSeconds: number;
  };
}

export interface WocListingView {
  id: number;
  item: InvSlot;
  itemId: string;
  quality: string;
  format: 'auction' | 'buy_now' | 'auction_buy_now';
  sellerName: string;
  mine: boolean;
  startCents: number;
  hasReserve: boolean;
  reserveMet: boolean | null;
  buyNowCents: number | null;
  offerNext: boolean;
  status: string;
  resolution: string | null;
  currentBidCents: number | null;
  minNextBidCents: number;
  minNextBidBondCents: number;
  buyNowLocked: boolean;
  /** The price a resolved-sold listing actually closed at (the sales table's
   *  figure), non-null only on the seller's own activity rows: a buy-now that
   *  outran the bidding sells above currentBidCents. Absent from an older
   *  server. */
  soldCents?: number | null;
  /** The seller asked to cancel a locked listing; it closes automatically
   *  after an unpaid window. Absent from an older server. */
  cancelPending?: boolean;
  /** A directed p2p sale minted from a trade offer, not a public auction.
   *  Absent from an older server. */
  directed?: boolean;
  endsAtMs: number;
  createdAtMs: number;
}

export interface WocEstimateView {
  available: boolean;
  usdCents: number;
  amount: WocQuoteLegView | null;
  asOfMs: number | null;
  /** The server's USD fee split for this amount. Null when unavailable or on
   *  an economy service too old to send it; ABSENT from a game server too old
   *  to serialize it (treated exactly like null): the client NEVER derives
   *  it. */
  split?: { sellerCents: number; burnCents: number; treasuryCents: number } | null;
}

/** Whether a character can be paid in $WOC, for the trade window's arm. */
export interface WocTradePartnerView {
  name: string;
  walletVerified: boolean;
}

/** A directed p2p offer, from either side. */
export interface WocOfferView {
  id: number;
  sellerName: string;
  buyerName: string;
  itemId: string | null;
  usdCents: number;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
  listingId: number | null;
  expiresAtMs: number;
  role: 'buyer' | 'seller';
  /** The directed listing's own state once one exists; drives the payment phase. */
  listingStatus: string | null;
  listingResolution: string | null;
  /** The live settlement's coarse state, so the SELLER can see a payment that is
   *  in flight rather than staring at "waiting" until the item vanishes. */
  settlementState: string | null;
  buyerAccepted: boolean;
  sellerAccepted: boolean;
}

export interface WocQuoteView {
  /** False only when the server says no wallet signature is possible (its dev
   *  chain). Absent is treated as TRUE by the client: a missing field must
   *  never be read as permission to skip signing. */
  signatureRequired?: boolean;
  reference: string | null;
  transactionBase64: string | null;
  amount: WocQuoteLegView | null;
  seller: WocQuoteLegView | null;
  burn: WocQuoteLegView | null;
  treasury: WocQuoteLegView | null;
  /** The SERVICE-computed bond figure on a bond quote (null on settlements;
   *  absent from an older server). Display only: the client never derives
   *  money. */
  bondCents?: number | null;
  expiresAtMs: number | null;
}

export interface WocBidView {
  id: number;
  listingId: number;
  /** The listed item this bid is for, on the Activity read; null on the
   *  mutation responses (the caller already knows the listing) and on an
   *  older server (absent reads as null). */
  itemId?: string | null;
  amountCents: number;
  status: string;
  bondCents: number;
  bondState: string;
  bondReference: string | null;
  bondQuoteExpiresAtMs: number | null;
  /** True while a submitted bond payment is still being verified on chain. The
   *  window shows progress and withholds the pay control on this, because
   *  neither `status` nor `bondState` moves when the signature is recorded. */
  bondConfirming: boolean;
  placedAtMs: number;
}

export interface WocSettlementView {
  id: number;
  listingId: number;
  /** The listed item this payment is for, on the Activity read; null on the
   *  mutation responses and on an older server (absent reads as null). */
  itemId?: string | null;
  attempt: number;
  amountCents: number;
  state: string;
  quoteReference: string | null;
  quoteExpiresAtMs: number | null;
  /** Why a failed payment failed: the server's SCREENED verdict vocabulary
   *  (an unknown service word arrives as the stable 'other'). Null while
   *  nothing failed; absent from an older server. */
  failReason?: string | null;
  deadlineAtMs: number;
  createdAtMs: number;
}

export interface WocSaleView {
  id: number;
  itemId: string;
  priceCents: number;
  sellerName: string;
  buyerName: string;
  atMs: number;
}

export interface WocActivityView {
  listings: WocListingView[];
  bids: WocBidView[];
  settlements: WocSettlementView[];
  strikes: { strikes: number; suspendedUntilMs: number | null } | null;
  termsAcceptedAtMs: number | null;
  walletLinked: boolean;
}

/** Every mutating call resolves to this: ok, or the server's stable code. */
export type WocMarketFail = {
  ok: false;
  code: string;
  /** The parsed error body, when the server sent one: code params (e.g.
   *  retryAfterSeconds) ride top-level alongside the code in the problem
   *  envelope, and the matcher (userFacingApiError) reads them from here.
   *  Mirrors ApiError.params in src/net/online.ts. */
  params?: Record<string, unknown>;
};
export const WOC_MARKET_UNAVAILABLE = 'woc_market.quote_unavailable';

export interface CreateListingRequest {
  characterId: number;
  itemIndex: number;
  itemId: string;
  expectInstance: ItemInstancePayload | null;
  /** All three are creatable. 'auction_buy_now' is an auction that also names a
   *  buy-now price, which the seller opts into by filling that field in; the
   *  form sends it rather than offering a third choice, because it is the same
   *  auction with one more number on it. */
  format: 'auction' | 'buy_now' | 'auction_buy_now';
  startCents: number;
  reserveCents: number | null;
  buyNowCents: number | null;
  durationHours: number;
  offerNext: boolean;
  /** The wallet step-up proof (B6/R1): a fresh challenge signed by the linked
   *  wallet. Omitting it refuses woc_market.stepup_required server-side. */
  stepUp?: WocStepUpProof;
}

export interface WocStepUpProof {
  nonce: string;
  signature: string;
}

/** The step-up challenge the wallet signs. The MESSAGE is server-built and
 *  shown by the wallet popup; the client never composes what gets signed. */
export interface WocStepUpChallenge {
  nonce: string;
  message: string;
  expiresAtMs: number;
  /** False only under the server's dev economy (devsig). Absent is treated as
   *  TRUE: a missing field must never be read as permission to skip signing. */
  signatureRequired?: boolean;
}

export type WocStepUpChallengeRequest =
  | {
      operation: 'create_listing';
      itemId: string;
      /** The exact copy being listed (bound into the challenge so the signed
       *  message names which copy leaves the bags); null for a plain stack. */
      expectInstance: ItemInstancePayload | null;
      format: 'auction' | 'buy_now' | 'auction_buy_now';
      startCents: number;
      reserveCents: number | null;
      buyNowCents: number | null;
      durationHours: number;
      offerNext: boolean;
    }
  | { operation: 'accept_directed_offer'; offerId: number };

export interface PlaceBidRequest {
  listingId: number;
  characterId: number;
  amountCents: number;
  acceptTerms: boolean;
}

export interface BuyNowRequest {
  listingId: number;
  characterId: number;
  acceptTerms: boolean;
}

export interface WocBrowseRequest {
  page: number;
  quality: string | null;
  format: string | null;
  /** The stamped category axes (the exchangeBrowseCategory vocabulary and
   *  its finer weapon-type/armor-slot axis), server-validated. */
  category: string | null;
  subcategory: string | null;
  itemIds: readonly string[] | null;
  sort: 'ending' | 'newest' | 'price_asc' | 'price_desc';
}

/** The seller pane's public profile line, or null when the seller's name no
 *  longer resolves to a character (renamed or deleted). Only the guild tag,
 *  which the world already shows; the character creation date was dropped as
 *  an unspecced account-age disclosure. */
export interface WocSellerView {
  guildName: string | null;
}

export class WocMarketClient {
  constructor(private readonly cfg: WocMarketClientConfig) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: T } | WocMarketFail> {
    try {
      const token = this.cfg.token();
      const res = await fetch(apiUrl(path, this.cfg.base ?? ''), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const body =
          data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
        // A REAL code is a non-empty string (the same test apiErrorFromBody
        // in src/net/online.ts applies): an empty code is a codeless body.
        const code =
          typeof body?.code === 'string' && body.code.length > 0
            ? (body.code as string)
            : undefined;
        // The whole parsed body rides as params (the ApiError convention:
        // code params are top-level extension members of the problem
        // envelope), and ONLY beside a real code, matching apiErrorFromBody
        // in src/net/online.ts: a codeless body declares no params.
        return code === undefined
          ? { ok: false, code: WOC_MARKET_UNAVAILABLE }
          : { ok: false, code, params: body };
      }
      if (data === null) return { ok: false, code: WOC_MARKET_UNAVAILABLE };
      return { ok: true, data: data as T };
    } catch {
      return { ok: false, code: WOC_MARKET_UNAVAILABLE };
    }
  }

  async status(): Promise<WocMarketStatus> {
    const out = await this.request<Omit<WocMarketStatus, 'ok'>>('GET', '/api/woc-market/status');
    if (!out.ok) {
      return {
        ok: false,
        enabled: false,
        price: { available: false, healthy: false, tokensPerUsd: null, asOfMs: null },
        maxActiveListings: 0,
        durationsHours: [],
        minPriceCents: 0,
        maxPriceCents: 0,
        qualityFloor: 'epic',
        // Fail CLOSED, like every other field in this stub: an unreachable
        // server must not have the picker offering categories it may refuse.
        allowMounts: false,
        allowMechChromas: false,
        settlementWindowSeconds: 0,
      };
    }
    return { ok: true, ...out.data };
  }

  async browse(
    req: WocBrowseRequest,
  ): Promise<
    { ok: true; hasMore: boolean; page: number; listings: WocListingView[] } | WocMarketFail
  > {
    const params = new URLSearchParams();
    params.set('page', String(req.page));
    params.set('sort', req.sort);
    if (req.quality) params.set('quality', req.quality);
    if (req.format) params.set('format', req.format);
    if (req.category) params.set('category', req.category);
    if (req.subcategory) params.set('subcategory', req.subcategory);
    if (req.itemIds && req.itemIds.length > 0) params.set('itemIds', req.itemIds.join(','));
    const out = await this.request<{ hasMore: boolean; page: number; listings: WocListingView[] }>(
      'GET',
      `/api/woc-market/listings?${params.toString()}`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async detail(
    id: number,
  ): Promise<
    { ok: true; listing: WocListingView; estimate: WocEstimateView | null } | WocMarketFail
  > {
    const out = await this.request<{ listing: WocListingView; estimate: WocEstimateView | null }>(
      'GET',
      `/api/woc-market/listings/${id}`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async estimate(cents: number): Promise<WocEstimateView | null> {
    const out = await this.request<WocEstimateView>(
      'GET',
      `/api/woc-market/estimate?cents=${Math.floor(cents)}`,
    );
    return out.ok ? out.data : null;
  }

  /** Can this character be paid in $WOC? A definitive no-such-character
   *  answer (the server's 404) resolves ok with a null partner, which the
   *  window treats as "cannot be paid". Every OTHER failure (the read
   *  limiter's 429, an outage) answers ok: false: that is a FAILED LOOKUP,
   *  not a verdict, and rendering it as "recipient has no wallet" asserted
   *  something the client never learned. */
  async tradePartner(
    characterName: string,
  ): Promise<{ ok: true; partner: WocTradePartnerView | null } | { ok: false }> {
    const out = await this.request<{ partner: WocTradePartnerView }>(
      'GET',
      `/api/woc-market/trade-partner?name=${encodeURIComponent(characterName)}`,
    );
    if (out.ok) return { ok: true, partner: out.data.partner };
    if (out.code === 'woc_market.not_found') return { ok: true, partner: null };
    return { ok: false };
  }

  async offers(): Promise<{ ok: true; offers: WocOfferView[] } | WocMarketFail> {
    const out = await this.request<{ offers: WocOfferView[] }>('GET', '/api/woc-market/offers');
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** The BUYER opens the deal: a price named to one seller for the EXACT copy
   *  their trade window shows (H10). The item identity is required; the server
   *  pins its fingerprint and refuses acceptance of any other copy. */
  async createOffer(req: {
    characterId: number;
    sellerCharacterName: string;
    usdCents: number;
    itemId: string;
    itemInstance?: ItemInstancePayload;
    itemCraftedRecipeId?: string;
    acceptTerms: boolean;
  }): Promise<{ ok: true; offer: WocOfferView } | WocMarketFail> {
    const out = await this.request<{ offer: WocOfferView }>('POST', '/api/woc-market/offers', req);
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** Issue a step-up challenge (B6/R1) for one intended custody move; the
   *  returned message is what the wallet signs. */
  async stepUpChallenge(
    req: WocStepUpChallengeRequest,
  ): Promise<{ ok: true; challenge: WocStepUpChallenge } | WocMarketFail> {
    const out = await this.request<{ challenge: WocStepUpChallenge }>(
      'POST',
      '/api/woc-market/step-up/challenge',
      req,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** Either side accepts. The SELLER names the copy plus the step-up proof;
   *  the buyer sends no item and no proof. A null listing means "agreed,
   *  waiting on the other side". */
  async acceptOffer(
    id: number,
    req: {
      characterId: number;
      itemIndex?: number;
      itemId?: string;
      expectInstance?: ItemInstancePayload;
      stepUp?: WocStepUpProof;
    },
  ): Promise<{ ok: true; listing: WocListingView | null } | WocMarketFail> {
    const out = await this.request<{ listing: WocListingView | null }>(
      'POST',
      `/api/woc-market/offers/${Math.floor(id)}/accept`,
      req,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** decline is the SELLER refusing the incoming offer, withdraw is the BUYER
   *  pulling the offer they made (the buyer creates the offer); the server
   *  enforces which one the caller is entitled to and answers a stranger or
   *  the wrong side not_found. */
  async resolveOffer(
    id: number,
    action: 'decline' | 'withdraw',
  ): Promise<{ ok: true } | WocMarketFail> {
    const out = await this.request<Record<string, never>>(
      'POST',
      `/api/woc-market/offers/${Math.floor(id)}/${action}`,
      {},
    );
    return out.ok ? { ok: true } : out;
  }

  async me(): Promise<{ ok: true; activity: WocActivityView } | WocMarketFail> {
    const out = await this.request<WocActivityView>('GET', '/api/woc-market/me');
    return out.ok ? { ok: true, activity: out.data } : out;
  }

  async history(itemId: string): Promise<{ ok: true; sales: WocSaleView[] } | WocMarketFail> {
    const out = await this.request<{ sales: WocSaleView[] }>(
      'GET',
      `/api/woc-market/history/${encodeURIComponent(itemId)}`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** A seller's recent completed trades (the Browse seller click-through):
   *  the same public sale rows as history, pivoted by seller name, plus
   *  their public profile line (the guild tag). */
  async sellerHistory(
    name: string,
  ): Promise<{ ok: true; sales: WocSaleView[]; seller: WocSellerView | null } | WocMarketFail> {
    const out = await this.request<{ sales: WocSaleView[]; seller: WocSellerView | null }>(
      'GET',
      `/api/woc-market/seller-history/${encodeURIComponent(name)}`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async createListing(
    req: CreateListingRequest,
  ): Promise<{ ok: true; listing: WocListingView } | WocMarketFail> {
    const out = await this.request<{ listing: WocListingView }>(
      'POST',
      '/api/woc-market/listings',
      req,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async cancelListing(id: number): Promise<{ ok: true; cancelPending?: boolean } | WocMarketFail> {
    const out = await this.request<{ ok: boolean; cancelPending?: boolean }>(
      'POST',
      `/api/woc-market/listings/${id}/cancel`,
    );
    if (!out.ok) return out;
    // cancelPending: accepted as INTENT on a locked listing; the listing
    // stays visible until the buyer's window resolves.
    return out.data.cancelPending === true ? { ok: true, cancelPending: true } : { ok: true };
  }

  async placeBid(
    req: PlaceBidRequest,
  ): Promise<{ ok: true; bid: WocBidView; bond: WocQuoteView } | WocMarketFail> {
    const out = await this.request<{ bid: WocBidView; bond: WocQuoteView }>(
      'POST',
      `/api/woc-market/listings/${req.listingId}/bids`,
      {
        characterId: req.characterId,
        amountCents: req.amountCents,
        acceptTerms: req.acceptTerms,
      },
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async bondQuote(bidId: number): Promise<{ ok: true; bond: WocQuoteView } | WocMarketFail> {
    const out = await this.request<{ bond: WocQuoteView }>(
      'POST',
      `/api/woc-market/bids/${bidId}/bond-quote`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  /** Give up on a bid whose bond was never paid, releasing the listing lock. */
  async abandonBid(bidId: number): Promise<{ ok: true } | WocMarketFail> {
    const out = await this.request<{ abandoned: boolean }>(
      'POST',
      `/api/woc-market/bids/${bidId}/abandon`,
    );
    return out.ok ? { ok: true } : out;
  }

  async confirmBond(
    bidId: number,
    signature: string,
  ): Promise<
    { ok: true; standing: boolean; pending?: boolean; reason?: string | null } | WocMarketFail
  > {
    const out = await this.request<{
      standing: boolean;
      pending?: boolean;
      /** Screened pending verdict: which pending this is (ledger-matched,
       *  nothing visible yet, or the service was unreachable). */
      reason?: string | null;
    }>('POST', `/api/woc-market/bids/${bidId}/bond`, { signature });
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async buyNow(
    req: BuyNowRequest,
  ): Promise<{ ok: true; settlement: WocSettlementView; quote: WocQuoteView } | WocMarketFail> {
    const out = await this.request<{ settlement: WocSettlementView; quote: WocQuoteView }>(
      'POST',
      `/api/woc-market/listings/${req.listingId}/buy-now`,
      { characterId: req.characterId, acceptTerms: req.acceptTerms },
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async settlementQuote(id: number): Promise<{ ok: true; quote: WocQuoteView } | WocMarketFail> {
    const out = await this.request<{ quote: WocQuoteView }>(
      'POST',
      `/api/woc-market/settlements/${id}/quote`,
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }

  async confirmSettlement(
    id: number,
    signature: string,
  ): Promise<{ ok: true; state: string; reason?: string | null } | WocMarketFail> {
    const out = await this.request<{ state: string; reason?: string | null }>(
      'POST',
      `/api/woc-market/settlements/${id}/confirm`,
      { signature },
    );
    return out.ok ? { ok: true, ...out.data } : out;
  }
}
