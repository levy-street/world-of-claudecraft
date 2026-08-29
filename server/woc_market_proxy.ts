// Typed game-server client for the economy service's $WOC marketplace surface
// (the claudium_proxy.ts sibling; same service, same secret-gated internal
// API, same contract). ALL token math lives in the service: the USD to $WOC
// conversion, the oracle (a time-weighted price over one approved venue
// behind a liquidity floor, a spot-versus-average deviation limit, and
// freshness judged on the venue's publish time), the 90/3/7 split,
// transaction building, finality confirmation, and bond escrow
// refunds/forfeits. The game passes the USD figures in (the BID on bond
// quotes: the service computes and owns the bond), adopts the figures that
// come back, and repeats verdict words to players only through the screened
// vocabularies (rules.ts; unknown words collapse to 'other'). Rows and logs
// keep the verbatim word for operators.
//
// GRACEFUL DEGRADATION IS THE CONTRACT. If WOC_MARKET_SERVICE_URL or
// WOC_ECONOMY_INTERNAL_SECRET is unset, OR the service is unreachable /
// errors / times out, every method returns a typed unavailable result and
// NEVER throws up into request handling. An unavailable or unhealthy price
// pauses new purchases and settlements (woc_market.ts guardEnabledHealthy)
// while auctions keep counting down, exactly the PRD's suspension behavior.
//
// A transfer the buyer signed but the game never confirmed (a crash, a
// suspended listing) reconciles inside the SERVICE's own recovery window (the
// confirmNativeSettlement precedent): memo references make every transfer
// attributable, so orphans refund service-side without game participation.
//
// The DEV arm (createDevWocMarketEconomy) is an in-memory stand-in for local
// play and tests: fixed price, instant finality, always-successful refunds.
// It is wired ONLY when ALLOW_DEV_COMMANDS=1 AND WOC_MARKET_DEV_SERVICE=1
// (main.ts), the dev-cheat gating precedent; production never sees it.

import { KeyedCachedRead } from './cached_read';
import type {
  WocEstimate,
  WocEstimateSplit,
  WocMarketEconomy,
  WocPriceInfo,
  WocQuoteIntent,
} from './woc_market';
import { createWocPriceCache } from './woc_market_price_cache';
import {
  bondCents,
  WOC_MARKET_CONFIRM_UNAVAILABLE_REASON,
  WOC_MARKET_QUOTE_TTL_SECONDS,
} from './woc_market_rules';

const SERVICE_TIMEOUT_MS = 5000;
const CONFIRM_TIMEOUT_MS = 60_000;
/** Estimates and price reads are cached briefly: browse/bid-form traffic must
 *  never turn into a per-request service call storm. The price rides the
 *  purpose-built cache (woc_market_price_cache.ts: single-flight, short failure
 *  memo, bounded stale-while-revalidate); estimates ride the shared keyed
 *  cache (single-flight per amount, LRU bound). An UNAVAILABLE estimate is
 *  deliberately cached for the full TTL like a success: it is the typed
 *  degradation answer, and re-probing it per read during an outage is the
 *  storm the cache exists to prevent. */
const ESTIMATE_CACHE_TTL_MS = 15_000;
const ESTIMATE_CACHE_MAX_ENTRIES = 256;

/**
 * The exchange's own base URL, NOT the shared WOC_ECONOMY_SERVICE_URL.
 *
 * That variable points at `.../v1/claudium/` (see .env.example), because
 * claudium_proxy.ts sends relative paths beneath it. Reusing it here resolved
 * every marketplace call to `/v1/claudium/internal/market/...`, which is inside
 * the claudium prefix and is not where the service serves the exchange. The
 * exchange lives at `/v1/market/`, so it gets its own base, exactly the way
 * claudium has one.
 */
function serviceUrl(): string {
  return (process.env.WOC_MARKET_SERVICE_URL ?? '').trim();
}

function serviceSecret(): string {
  return process.env.WOC_ECONOMY_INTERNAL_SECRET ?? '';
}

let loggedOnce = false;
function logFailure(err: unknown): void {
  if (loggedOnce) return;
  loggedOnce = true;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[woc_market] economy service unavailable: ${message}`);
}

interface ServiceRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

/** May the shared economy secret ride PLAIN HTTP to this host? Only hosts
 *  that cannot be the open internet: loopback, a single-label docker service
 *  name, the docker host alias, an RFC1918 address, or a reserved suffix
 *  (.test/.internal/.local/.localhost). Everything else must be HTTPS, or
 *  a typo'd public URL ships the secret cleartext on every call (the
 *  validatedSeekerRpcUrl posture, adapted for the compose topologies the
 *  deploy actually uses: host.docker.internal and bare service names). */
function privateHttpHostAllowed(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
  if (hostname === 'host.docker.internal') return true;
  // A bracketed hostname is an IPv6 literal; [::1] is handled above, and every
  // other IPv6 address is unbracketed by no '.' and would otherwise slip
  // through the single-label docker-name branch below (a public [2001:db8::1]
  // has no dot). Only loopback rides plaintext.
  if (hostname.startsWith('[')) return false;
  if (!hostname.includes('.')) return true;
  if (/\.(?:test|internal|local|localhost)$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/** Null (unavailable) unless the base is safe to carry the secret: HTTPS, or
 *  HTTP to a private host, and never a URL with embedded credentials. */
function validatedServiceBase(base: string): URL | null {
  let url: URL;
  try {
    url = new URL(base.endsWith('/') ? base : `${base}/`);
  } catch {
    logFailure(new Error('WOC_MARKET_SERVICE_URL is not a valid URL'));
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    logFailure(new Error('WOC_MARKET_SERVICE_URL must not embed credentials'));
    return null;
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && privateHttpHostAllowed(url.hostname)) return url;
  logFailure(new Error('WOC_MARKET_SERVICE_URL must be https, or http to a private host'));
  return null;
}

/** The one fetch wrapper (the claudium_proxy shape): parsed JSON on 2xx, null
 *  on any failure. It NEVER throws; every caller maps null to unavailable. */
async function callService<T>(req: ServiceRequest): Promise<T | null> {
  const base = serviceUrl();
  const secret = serviceSecret();
  if (base === '' || secret === '') return null;
  const validBase = validatedServiceBase(base);
  if (validBase === null) return null;
  try {
    const url = new URL(req.path.replace(/^\//, ''), validBase);
    const headers: Record<string, string> = { 'x-woc-economy-secret': secret };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${req.method} ${req.path} -> ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    logFailure(err);
    return null;
  }
}

const PRICE_UNAVAILABLE: WocPriceInfo = {
  available: false,
  healthy: false,
  reason: 'service_unavailable',
  tokensPerUsd: null,
  asOfMs: null,
};

const QUOTE_UNAVAILABLE: WocQuoteIntent = {
  ok: false,
  reference: null,
  transactionBase64: null,
  amount: null,
  seller: null,
  burn: null,
  treasury: null,
  bondCents: null,
  expiresAtMs: null,
  signatureRequired: true,
  reason: 'service_unavailable',
};

// Wire shapes of the service's marketplace surface (SDK v1 mirror; the
// service repo owns these).
interface WirePrice {
  healthy?: boolean;
  reason?: string | null;
  tokensPerUsd?: number | null;
  asOfMs?: number | null;
}
interface WireLeg {
  base?: string;
  tokens?: number;
}
interface WireEstimate {
  ok?: boolean;
  amount?: WireLeg | null;
  asOfMs?: number | null;
  split?: { sellerCents?: number; burnCents?: number; treasuryCents?: number } | null;
}
interface WireQuote {
  ok?: boolean;
  signatureRequired?: boolean;
  reference?: string | null;
  transactionBase64?: string | null;
  amount?: WireLeg | null;
  seller?: WireLeg | null;
  burn?: WireLeg | null;
  treasury?: WireLeg | null;
  bondCents?: number | null;
  expiresAtMs?: number | null;
  reason?: string | null;
}
interface WireConfirm {
  settled?: boolean;
  pending?: boolean;
  reason?: string | null;
}
interface WireBondAction {
  done?: boolean;
  reason?: string | null;
}

function leg(value: WireLeg | null | undefined): { base: string; tokens: number } | null {
  if (!value || typeof value.base !== 'string' || typeof value.tokens !== 'number') return null;
  return { base: value.base, tokens: value.tokens };
}

/**
 * The service's fee split, accepted only when it is arithmetically usable.
 *
 * Two ways this is legitimately absent, and both must render as "no split shown"
 * rather than a wrong number: an older service build that predates the field, and
 * any response whose legs do not sum to the amount they describe. The sum check
 * is the load-bearing one, because this figure is shown to a seller as the money
 * they will receive, and a split that does not reconcile is not a rounding
 * disagreement, it is a different sale. Fail closed and the UI omits the line.
 */
/** The shared estimate is handed to every caller inside a TTL window, so it
 *  is frozen like the read-cache values (freezeShared's rationale): an
 *  in-place edit by one consumer would corrupt every sharer, and a frozen
 *  write throws in its author's own tests instead. */
function freezeEstimate(value: WocEstimate): WocEstimate {
  if (value.amount !== null) Object.freeze(value.amount);
  if (value.split !== null) Object.freeze(value.split);
  return Object.freeze(value);
}

function estimateSplit(value: WireEstimate['split'], usdCents: number): WocEstimateSplit | null {
  if (!value) return null;
  const { sellerCents, burnCents, treasuryCents } = value;
  const legs = [sellerCents, burnCents, treasuryCents];
  if (!legs.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
  if ((sellerCents as number) + (burnCents as number) + (treasuryCents as number) !== usdCents) {
    return null;
  }
  return {
    sellerCents: sellerCents as number,
    burnCents: burnCents as number,
    treasuryCents: treasuryCents as number,
  };
}

function bondCentsOf(wire: WireQuote): number | null {
  const value = wire.bondCents;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function toQuote(wire: WireQuote | null): WocQuoteIntent {
  if (!wire) return QUOTE_UNAVAILABLE;
  if (wire.ok !== true) {
    // bondCents survives the refusal arm ON PURPOSE: a bond_amount_drift
    // refusal carries the service's expected figure, and dropping it here
    // would leave the caller nothing to adopt.
    return { ...QUOTE_UNAVAILABLE, reason: wire.reason ?? 'refused', bondCents: bondCentsOf(wire) };
  }
  return {
    ok: true,
    reference: wire.reference ?? null,
    transactionBase64: wire.transactionBase64 ?? null,
    // Fail SAFE: anything other than an explicit false means sign it. A service
    // that omits the field is not saying "no signature needed".
    signatureRequired: wire.signatureRequired !== false,
    amount: leg(wire.amount),
    seller: leg(wire.seller),
    burn: leg(wire.burn),
    treasury: leg(wire.treasury),
    bondCents: bondCentsOf(wire),
    expiresAtMs: wire.expiresAtMs ?? null,
    reason: null,
  };
}

export function createWocMarketEconomyProxy(): WocMarketEconomy {
  // available:false means the TRANSPORT failed (env unset, unreachable,
  // non-2xx, timeout): that is the failure the short memo bounds. A reachable
  // service answering healthy:false is a SUCCESS (its truthful paused answer)
  // and caches for the full TTL like any other.
  const priceCache = createWocPriceCache<WocPriceInfo>(
    async () => {
      const wire = await callService<WirePrice>({ method: 'GET', path: 'price' });
      if (!wire) return PRICE_UNAVAILABLE;
      return {
        available: true,
        healthy: wire.healthy === true,
        reason: wire.reason ?? null,
        tokensPerUsd: wire.tokensPerUsd ?? null,
        asOfMs: wire.asOfMs ?? null,
      };
    },
    { isFailure: (value) => !value.available },
  );

  const estimateCache = new KeyedCachedRead<WocEstimate>(
    async (usdCents) => {
      const wire = await callService<WireEstimate>({
        method: 'POST',
        path: 'estimate',
        body: { usdCents },
      });
      return freezeEstimate(
        wire && wire.ok === true
          ? {
              available: true,
              usdCents,
              amount: leg(wire.amount),
              asOfMs: wire.asOfMs ?? null,
              split: estimateSplit(wire.split, usdCents),
            }
          : { available: false, usdCents, amount: null, asOfMs: null, split: null },
      );
    },
    { ttlMs: ESTIMATE_CACHE_TTL_MS, maxEntries: ESTIMATE_CACHE_MAX_ENTRIES },
  );

  return {
    price(): Promise<WocPriceInfo> {
      return priceCache.read();
    },

    priceCacheAges(): { successAgeMs: number | null; failureAgeMs: number | null } {
      const at = Date.now();
      const { success, failure } = priceCache.peek();
      return {
        successAgeMs: success === null ? null : at - success.at,
        failureAgeMs: failure === null ? null : at - failure.at,
      };
    },

    estimate(usdCents: number): Promise<WocEstimate> {
      return estimateCache.read(usdCents);
    },

    async bondQuote(args): Promise<WocQuoteIntent> {
      const wire = await callService<WireQuote>({
        method: 'POST',
        path: 'bond-quote',
        body: args,
      });
      return toQuote(wire);
    },

    async settlementQuote(args): Promise<WocQuoteIntent> {
      const wire = await callService<WireQuote>({
        method: 'POST',
        path: 'settlement-quote',
        body: args,
      });
      return toQuote(wire);
    },

    async confirm(reference, signature) {
      const wire = await callService<WireConfirm>({
        method: 'POST',
        path: 'confirm',
        body: { reference, signature },
        timeoutMs: CONFIRM_TIMEOUT_MS,
      });
      // The shared constant, not a literal: confirmBond's extension gate and
      // the abandon exemption both branch on this exact string.
      if (!wire)
        return { settled: false, pending: true, reason: WOC_MARKET_CONFIRM_UNAVAILABLE_REASON };
      return {
        settled: wire.settled === true,
        pending: wire.pending === true,
        reason: wire.reason ?? null,
      };
    },

    async refundBond(reference) {
      const wire = await callService<WireBondAction>({
        method: 'POST',
        path: 'bond-refund',
        body: { reference },
      });
      return { done: wire?.done === true, reason: wire?.reason ?? null };
    },

    async forfeitBond(reference) {
      const wire = await callService<WireBondAction>({
        method: 'POST',
        path: 'bond-forfeit',
        body: { reference },
      });
      return { done: wire?.done === true, reason: wire?.reason ?? null };
    },
  };
}

// ---------------------------------------------------------------------------
// Dev arm: deterministic in-memory economy for local play and tests
// ---------------------------------------------------------------------------

const DEV_TOKEN_DECIMALS = 9;
/** The service's DEFAULT schedule (3% burn, 7% treasury, 90% seller), mirrored
 *  so the dev economy renders the same breakdown a real one would. A deployment
 *  that retunes WOC_MARKET_BURN_BPS / WOC_MARKET_TREASURY_BPS on the SERVICE is
 *  not reflected here: the dev arm never talks to it, and a dev build showing
 *  the default schedule is the intended behaviour, not a drift bug. */
const DEV_BURN_BPS = 300;
const DEV_TREASURY_BPS = 700;

function devPriceMicroUsd(): number {
  const raw = Number(process.env.WOC_MARKET_DEV_PRICE_MICRO_USD ?? '1000');
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

function devLeg(usdCents: number, priceMicroUsd: number): { base: string; tokens: number } {
  // tokens = usd / price; cents * 10_000 micro-USD per cent.
  const tokens = (usdCents * 10_000) / priceMicroUsd;
  const base = BigInt(Math.round(tokens * 10 ** 6)) * BigInt(10 ** (DEV_TOKEN_DECIMALS - 6));
  return { base: base.toString(), tokens };
}

/**
 * The dev economy's stand-in for the service's fee split.
 *
 * This is the dev economy SIMULATING the service, not the game deriving money:
 * that distinction is why the arithmetic is allowed to live here at all, and it
 * is the same licence under which devLeg above fabricates a price. It reproduces
 * the service's ordering exactly (each fee leg rounds UP, the seller absorbs the
 * remainder) so a dev build shows the same numbers a real one would, including
 * the off-by-a-cent cases that a flat percentage gets wrong.
 */
function devSplit(usdCents: number): WocEstimateSplit {
  // The legs are capped at the amount so the seller remainder can never go
  // negative: below the market's own price floor the ceil legs exceed the
  // amount (devSplit(1) used to answer sellerCents -1, which the estimate
  // rendered as a negative You-receive line), and the real service's wire
  // screen refuses any negative leg, so the mirror must never mint one.
  const burnCents = Math.min(Math.ceil((usdCents * DEV_BURN_BPS) / 10_000), usdCents);
  const treasuryCents = Math.min(
    Math.ceil((usdCents * DEV_TREASURY_BPS) / 10_000),
    usdCents - burnCents,
  );
  return { sellerCents: usdCents - burnCents - treasuryCents, burnCents, treasuryCents };
}

/** The in-memory dev economy: the same interface, a fixed price, references
 *  minted locally, instant finality for any non-empty signature, refunds that
 *  always succeed. The 90/3/7 split matches the PRD's fee table so the dev UI
 *  renders realistic breakdowns. Never wired in production (main.ts gates it
 *  behind ALLOW_DEV_COMMANDS + WOC_MARKET_DEV_SERVICE). */
export function createDevWocMarketEconomy(now: () => number = Date.now): WocMarketEconomy {
  let nextRef = 1;
  const openQuotes = new Map<string, { expiresAtMs: number }>();
  const settledRefs = new Set<string>();

  const quote = (usdCents: number, split: boolean, bondCents: number | null): WocQuoteIntent => {
    const price = devPriceMicroUsd();
    const reference = `dev_woc_${nextRef++}`;
    const expiresAtMs = now() + WOC_MARKET_QUOTE_TTL_SECONDS * 1000;
    openQuotes.set(reference, { expiresAtMs });
    const amount = devLeg(usdCents, price);
    // The settlement legs reuse devSplit's ceil-and-remainder arithmetic (the
    // service's rule): the old floor-based 90/3 here disagreed with the
    // split the estimate showed by a cent on the odd amounts.
    const legs = devSplit(usdCents);
    return {
      ok: true,
      reference,
      transactionBase64: Buffer.from(`dev-tx:${reference}:${usdCents}`).toString('base64'),
      // The in-memory dev economy has no chain and no signable transaction.
      signatureRequired: false,
      amount,
      seller: split ? devLeg(legs.sellerCents, price) : null,
      burn: split ? devLeg(legs.burnCents, price) : null,
      treasury: split ? devLeg(legs.treasuryCents, price) : null,
      bondCents,
      expiresAtMs,
      reason: null,
    };
  };

  return {
    async price(): Promise<WocPriceInfo> {
      return {
        available: true,
        healthy: true,
        reason: null,
        tokensPerUsd: 1_000_000 / devPriceMicroUsd(),
        asOfMs: now(),
      };
    },
    async estimate(usdCents: number): Promise<WocEstimate> {
      return {
        available: true,
        usdCents,
        amount: devLeg(usdCents, devPriceMicroUsd()),
        asOfMs: now(),
        split: devSplit(usdCents),
      };
    },
    async bondQuote(args): Promise<WocQuoteIntent> {
      // The service contract, simulated: the BOND is computed from the bid
      // (the game's bondCents mirror IS the service rule), and a stale echo
      // refuses bond_amount_drift carrying the expected figure so the dev
      // build exercises the same adopt-and-requote path production takes.
      const bond = bondCents(args.bidCents);
      if (args.usdCents !== undefined && args.usdCents !== bond) {
        return { ...QUOTE_UNAVAILABLE, reason: 'bond_amount_drift', bondCents: bond };
      }
      return quote(bond, false, bond);
    },
    async settlementQuote(args): Promise<WocQuoteIntent> {
      return quote(args.usdCents, true, null);
    },
    async confirm(reference, signature) {
      const open = openQuotes.get(reference);
      if (!open && !settledRefs.has(reference)) {
        return { settled: false, pending: false, reason: 'unknown_reference' };
      }
      if (signature.trim() === '') {
        return { settled: false, pending: false, reason: 'bad_signature' };
      }
      if (open && open.expiresAtMs <= now() && !settledRefs.has(reference)) {
        return { settled: false, pending: false, reason: 'quote_expired' };
      }
      settledRefs.add(reference);
      return { settled: true, pending: false, reason: null };
    },
    async refundBond() {
      return { done: true, reason: null };
    },
    async forfeitBond() {
      return { done: true, reason: null };
    },
  };
}
