// Restricted client for the standalone Exchange SPA. This surface deliberately
// cannot create listings, issue wallet step-up challenges, inspect live bags,
// or use directed offers. Keeping those methods out of this class also keeps
// their route strings out of the standalone production bundle.

import { apiUrl } from '../client_origin';
import type {
  BuyNowRequest,
  PlaceBidRequest,
  WocActivityView,
  WocBidView,
  WocBrowseRequest,
  WocEstimateView,
  WocListingView,
  WocMarketFail,
  WocMarketStatus,
  WocQuoteView,
  WocSaleView,
  WocSellerView,
  WocSettlementView,
} from './woc_market_sdk';

export interface WocExchangeClientConfig {
  token(): string | null;
  base?: string;
}

const UNAVAILABLE = 'woc_market.quote_unavailable';

export class WocExchangeClient {
  constructor(private readonly config: WocExchangeClientConfig) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: T } | WocMarketFail> {
    try {
      const token = this.config.token();
      const response = await fetch(apiUrl(path, this.config.base ?? ''), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const problem =
          data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
        const code =
          typeof problem?.code === 'string' && problem.code.length > 0 ? problem.code : undefined;
        return code ? { ok: false, code, params: problem } : { ok: false, code: UNAVAILABLE };
      }
      return data === null ? { ok: false, code: UNAVAILABLE } : { ok: true, data: data as T };
    } catch {
      return { ok: false, code: UNAVAILABLE };
    }
  }

  async status(): Promise<WocMarketStatus> {
    const result = await this.request<Omit<WocMarketStatus, 'ok'>>('GET', '/api/woc-market/status');
    if (result.ok) return { ok: true, ...result.data };
    return {
      ok: false,
      enabled: false,
      price: { available: false, healthy: false, tokensPerUsd: null, asOfMs: null },
      maxActiveListings: 0,
      durationsHours: [],
      minPriceCents: 0,
      maxPriceCents: 0,
      qualityFloor: 'epic',
      allowMounts: false,
      allowMechChromas: false,
      settlementWindowSeconds: 0,
    };
  }

  async browse(
    request: WocBrowseRequest,
  ): Promise<
    { ok: true; hasMore: boolean; page: number; listings: WocListingView[] } | WocMarketFail
  > {
    const params = new URLSearchParams({ page: String(request.page), sort: request.sort });
    if (request.quality) params.set('quality', request.quality);
    if (request.format) params.set('format', request.format);
    if (request.category) params.set('category', request.category);
    if (request.subcategory) params.set('subcategory', request.subcategory);
    if (request.itemIds?.length) params.set('itemIds', request.itemIds.join(','));
    const result = await this.request<{
      hasMore: boolean;
      page: number;
      listings: WocListingView[];
    }>('GET', `/api/woc-market/listings?${params.toString()}`);
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async detail(
    id: number,
  ): Promise<
    { ok: true; listing: WocListingView; estimate: WocEstimateView | null } | WocMarketFail
  > {
    const result = await this.request<{
      listing: WocListingView;
      estimate: WocEstimateView | null;
    }>('GET', `/api/woc-market/listings/${Math.floor(id)}`);
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async me(): Promise<{ ok: true; activity: WocActivityView } | WocMarketFail> {
    const result = await this.request<WocActivityView>('GET', '/api/woc-market/me');
    return result.ok ? { ok: true, activity: result.data } : result;
  }

  async history(itemId: string): Promise<{ ok: true; sales: WocSaleView[] } | WocMarketFail> {
    const result = await this.request<{ sales: WocSaleView[] }>(
      'GET',
      `/api/woc-market/history/${encodeURIComponent(itemId)}`,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async sellerHistory(
    name: string,
  ): Promise<{ ok: true; sales: WocSaleView[]; seller: WocSellerView | null } | WocMarketFail> {
    const result = await this.request<{ sales: WocSaleView[]; seller: WocSellerView | null }>(
      'GET',
      `/api/woc-market/seller-history/${encodeURIComponent(name)}`,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async cancelListing(id: number): Promise<{ ok: true; cancelPending?: boolean } | WocMarketFail> {
    const result = await this.request<{ cancelPending?: boolean }>(
      'POST',
      `/api/woc-market/listings/${Math.floor(id)}/cancel`,
    );
    if (!result.ok) return result;
    return result.data.cancelPending ? { ok: true, cancelPending: true } : { ok: true };
  }

  async placeBid(
    request: PlaceBidRequest,
  ): Promise<{ ok: true; bid: WocBidView; bond: WocQuoteView } | WocMarketFail> {
    const result = await this.request<{ bid: WocBidView; bond: WocQuoteView }>(
      'POST',
      `/api/woc-market/listings/${Math.floor(request.listingId)}/bids`,
      {
        characterId: request.characterId,
        amountCents: request.amountCents,
        acceptTerms: request.acceptTerms,
      },
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async bondQuote(bidId: number): Promise<{ ok: true; bond: WocQuoteView } | WocMarketFail> {
    const result = await this.request<{ bond: WocQuoteView }>(
      'POST',
      `/api/woc-market/bids/${Math.floor(bidId)}/bond-quote`,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async abandonBid(bidId: number): Promise<{ ok: true } | WocMarketFail> {
    const result = await this.request<unknown>(
      'POST',
      `/api/woc-market/bids/${Math.floor(bidId)}/abandon`,
    );
    return result.ok ? { ok: true } : result;
  }

  async confirmBond(
    bidId: number,
    signature: string,
  ): Promise<
    { ok: true; standing: boolean; pending?: boolean; reason?: string | null } | WocMarketFail
  > {
    const result = await this.request<{
      standing: boolean;
      pending?: boolean;
      reason?: string | null;
    }>('POST', `/api/woc-market/bids/${Math.floor(bidId)}/bond`, { signature });
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async buyNow(
    request: BuyNowRequest,
  ): Promise<{ ok: true; settlement: WocSettlementView; quote: WocQuoteView } | WocMarketFail> {
    const result = await this.request<{
      settlement: WocSettlementView;
      quote: WocQuoteView;
    }>('POST', `/api/woc-market/listings/${Math.floor(request.listingId)}/buy-now`, {
      characterId: request.characterId,
      acceptTerms: request.acceptTerms,
    });
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async settlementQuote(
    settlementId: number,
  ): Promise<{ ok: true; quote: WocQuoteView } | WocMarketFail> {
    const result = await this.request<{ quote: WocQuoteView }>(
      'POST',
      `/api/woc-market/settlements/${Math.floor(settlementId)}/quote`,
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }

  async confirmSettlement(
    settlementId: number,
    signature: string,
  ): Promise<{ ok: true; state: string; reason?: string | null } | WocMarketFail> {
    const result = await this.request<{ state: string; reason?: string | null }>(
      'POST',
      `/api/woc-market/settlements/${Math.floor(settlementId)}/confirm`,
      { signature },
    );
    return result.ok ? { ok: true, ...result.data } : result;
  }
}
