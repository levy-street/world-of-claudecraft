'use strict';
/* ============================================================================
 * WOC burn-tracker model - single source of truth.
 *
 * The tracker reports burns that have ALREADY happened on-chain:
 *   - total burned  = initial supply (1e9, pump.fun fixed mint) minus the
 *     mint's current on-chain supply (getTokenSupply) - always exact;
 *   - the feed      = spl-token burn / burnChecked instructions found in the
 *     mint's transaction history - best-effort, labeled by scan coverage.
 *
 * Everything here is pure and fail-closed (malformed/non-positive -> null,
 * never a guess), mirroring the economy service's oracle style, and the node
 * test suite executes this exact file (build.js embeds it byte-for-byte).
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * Market price - the same chain the game's economy service uses
 * (svc-dexswap: claudium/oracle.ts + settlement/oracle_prices.ts): Pyth
 * Hermes v2 when a feed id is configured, else the Jupiter price API (the
 * aggregator the DEX-swap engine quotes through).
 * ------------------------------------------------------------------------ */
var PRICE_SOURCE = {
  mint: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth',            // WOC_MINT · woc_config.ts
  jupiterUrl: 'https://lite-api.jup.ag/price/v3?ids=',              // DEX-swap quotes via Jupiter · svc #17
  hermesUrl: 'https://hermes.pyth.network',                         // PYTH_HERMES_URL default shape · oracle.ts
  pythFeedId: '',                                                   // PYTH_WOC_USD_FEED_ID - env-configured; none published in repo
  maxAgeMs: 60000                                                   // CLAUDIUM_ORACLE_MAX_AGE_MS default · bootstrap.ts:166
};

/* Baked fallback for CSP-sandboxed hosts (the published artifact cannot make
 * external requests). build.js refreshes this block on every build. */
var PRICE_SNAPSHOT = /*__PRICE_SNAPSHOT_START__*/ {"usdPerWoc":0.00017699046166975,"source":"jupiter","fetchedAtMs":1784465855132} /*__PRICE_SNAPSHOT_END__*/;

/* Pyth Hermes v2 shape: { parsed: [ { price: { price, expo, publish_time } } ] }
 * Same math as the service: usdPerWoc = price * 10^expo. Staleness is the
 * caller's check (publishMs vs maxAgeMs), as in fetchWocUsdPrice. */
function parsePythV2(body) {
  if (typeof body !== 'object' || body === null) return null;
  var parsed = body.parsed;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  var price = parsed[0] && parsed[0].price;
  if (!price) return null;
  var raw = Number(price.price);
  var expo = Number(price.expo);
  var publish = Number(price.publish_time);
  if (!isFinite(raw) || expo !== Math.trunc(expo) || !isFinite(expo) || !isFinite(publish)) return null;
  var usdPerWoc = raw * Math.pow(10, expo);
  if (!(usdPerWoc > 0) || !isFinite(usdPerWoc)) return null;
  return { usdPerWoc: usdPerWoc, publishMs: publish * 1000 };
}

/* Jupiter price v3 shape: { "<mint>": { usdPrice, ... } }. No publish time in
 * the payload, so the caller stamps fetch time. */
function parseJupiterV3(body, mint) {
  if (typeof body !== 'object' || body === null) return null;
  var entry = body[mint];
  if (!entry || typeof entry !== 'object') return null;
  var usd = Number(entry.usdPrice);
  if (!(usd > 0) || !isFinite(usd)) return null;
  return { usdPerWoc: usd, publishMs: null };
}

/* --------------------------------------------------------------------------
 * Chain source - Solana JSON-RPC. The default public endpoint is rate-limited;
 * a private RPC (e.g. Helius) can be supplied via the p.rpc URL param.
 * ------------------------------------------------------------------------ */
var CHAIN_SOURCE = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  mint: PRICE_SOURCE.mint,
  initialSupply: 1e9,        // pump.fun fixed 1B mint; matches WOC_MAX_SUPPLY · holder_tier.ts:8
  decimals: 6,               // WOC_DECIMALS · woc_config.ts:34
  sigPageLimit: 50,          // signatures per history page
  explorerTxUrl: 'https://solscan.io/tx/'
};

/* Known burn authorities -> human labels. Attribution is additive: unknown
 * authorities still show in the feed as plain on-chain burns. Extend as the
 * game's mainnet keeper/treasury addresses become public. */
var ATTRIBUTION = {};

/* Baked chain snapshot (refreshed by build.js; live-refreshed by the page
 * where the host allows fetches). burns: newest-first {sig, ms, amount,
 * authority}. scannedSigs/oldestScannedMs describe feed coverage - the
 * headline total NEVER depends on the feed. */
var CHAIN_SNAPSHOT = /*__CHAIN_SNAPSHOT_START__*/ {"currentSupply":999557928.221353,"burns":[],"scannedSigs":120,"oldestScannedMs":1784441876000,"cursor":"ewKaSXgBAatSE1rjkTthF4hYajcnk7LGwahiVKQtQoEUGSiGyj3bjtxueRzuFV1GrcAoVcMXMu12MkN13kAGaEj","fetchedAtMs":1784466036339} /*__CHAIN_SNAPSHOT_END__*/;

/* getTokenSupply result shape:
 * { result: { value: { amount, decimals, uiAmount } } } */
function parseTokenSupply(body) {
  if (typeof body !== 'object' || body === null) return null;
  var v = body.result && body.result.value;
  if (!v) return null;
  var ui = Number(v.uiAmount);
  var dec = Number(v.decimals);
  if (!(ui > 0) || !isFinite(ui) || !isFinite(dec)) return null;
  return { uiAmount: ui, decimals: dec };
}

/* getSignaturesForAddress result shape:
 * { result: [ { signature, blockTime, err, ... } ] }
 * Failed transactions cannot have burned anything -> marked so callers skip
 * hydrating them. */
function parseSignatures(body) {
  if (typeof body !== 'object' || body === null) return null;
  var list = body.result;
  if (!Array.isArray(list)) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || typeof s.signature !== 'string') continue;
    out.push({
      signature: s.signature,
      blockTimeMs: isFinite(Number(s.blockTime)) ? Number(s.blockTime) * 1000 : 0,
      failed: s.err !== null && s.err !== undefined
    });
  }
  return out;
}

/* getTransaction (jsonParsed) -> burns of OUR mint inside this tx.
 * Walks top-level and inner instructions for spl-token burn / burnChecked.
 * amount: burn carries base units in info.amount; burnChecked carries
 * info.tokenAmount.uiAmount. */
function parseBurnsFromTx(body, mint, decimals) {
  if (typeof body !== 'object' || body === null) return [];
  var res = body.result;
  if (!res || !res.transaction || !res.transaction.message) return [];
  if (res.meta && res.meta.err) return []; // failed tx: nothing burned
  var instrs = res.transaction.message.instructions || [];
  var inner = [];
  var groups = (res.meta && res.meta.innerInstructions) || [];
  for (var g = 0; g < groups.length; g++) {
    var gi = groups[g].instructions || [];
    for (var j = 0; j < gi.length; j++) inner.push(gi[j]);
  }
  var all = instrs.concat(inner);
  var sig = (res.transaction.signatures && res.transaction.signatures[0]) || '';
  var ms = isFinite(Number(res.blockTime)) ? Number(res.blockTime) * 1000 : 0;
  var burns = [];
  for (var i = 0; i < all.length; i++) {
    var p = all[i] && all[i].parsed;
    if (!p || typeof p !== 'object') continue;
    if (p.type !== 'burn' && p.type !== 'burnChecked') continue;
    var info = p.info || {};
    if (info.mint !== mint) continue;
    var amount = null;
    if (p.type === 'burn' && info.amount != null) {
      var base = Number(info.amount);
      if (isFinite(base) && base > 0) amount = base / Math.pow(10, decimals);
    } else if (p.type === 'burnChecked' && info.tokenAmount) {
      var ui = Number(info.tokenAmount.uiAmount);
      if (isFinite(ui) && ui > 0) amount = ui;
    }
    if (!(amount > 0)) continue;
    burns.push({
      sig: sig,
      ms: ms,
      amount: amount,
      authority: String(info.authority || info.multisigAuthority || '')
    });
  }
  return burns;
}

/* Merge new burns into an existing list, dedupe by sig+amount, newest first. */
function mergeBurns(existing, incoming) {
  var seen = {};
  existing.forEach(function (b) { seen[b.sig + '#' + b.amount] = true; });
  var merged = existing.slice();
  incoming.forEach(function (b) {
    var k = b.sig + '#' + b.amount;
    if (!seen[k]) { seen[k] = true; merged.push(b); }
  });
  merged.sort(function (a, b) { return b.ms - a.ms; });
  return merged;
}

/* Rolling day/week/month stats over the scanned feed, ending at nowMs. */
function windowStats(burns, nowMs) {
  var W = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
  var out = {};
  Object.keys(W).forEach(function (k) {
    var lo = nowMs - W[k], woc = 0, txs = 0;
    burns.forEach(function (b) { if (b.ms >= lo && b.ms <= nowMs) { woc += b.amount; txs++; } });
    out[k] = { woc: woc, txs: txs };
  });
  out.latestMs = burns.length ? burns[0].ms : 0;
  return out;
}

/* p.rpc URL override: the only externalized-config knob the tracker takes.
 * Only https URLs are accepted - anything else is reported, never applied. */
function parseRpcOverride(search, hash) {
  var qs = String(search || '').replace(/^\?/, '') + '&' + String(hash || '').replace(/^#/, '');
  var params = new URLSearchParams(qs);
  var raw = params.get('p.rpc');
  if (raw == null || raw === '') return { rpcUrl: null, warnings: [] };
  var ok = /^https:\/\/[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(raw);
  if (!ok) return { rpcUrl: null, warnings: ['ignoring p.rpc (must be an https URL): ' + raw] };
  return { rpcUrl: raw, warnings: [] };
}

/* --------------------------------------------------------------------------
 * The burn mechanics (display + provenance; the chain is the data source).
 * kind 'code' = shipped constant · 'assumption' = no code constant exists.
 * ------------------------------------------------------------------------ */
var MECHANICS = [
  { label: 'Character / guild renames, vanity, .sol subdomains', rate: '500 / 2,500 / 1,000 / 1,000 $WOC · 100% burn', kind: 'code', source: '#1496, #1499 · woc_config.ts (splitPrice, WOC_BURN_BPS=10000)' },
  { label: 'Respec + loadout slots', rate: '750 / 1,500 $WOC · 100% burn', kind: 'code', source: '#1553 · woc_config.ts:83-84' },
  { label: 'Voice NPC clone', rate: '25,000 $WOC · burn hardcoded (treasury=null)', kind: 'code', source: '#1099 · voice_npc.ts:145-147' },
  { label: 'Logol merchant wares', rate: '5k-40k + 250k flagship · 100% burn', kind: 'code', source: '#1473 · content/logol.ts:160-201' },
  { label: 'Arena wager rake', rate: '500 bps of pot, 100% burned · 1,000 bps hard cap', kind: 'code', source: '#799 · arena_wager_boot.ts:60 · woc_escrow lib.rs:32' },
  { label: 'Aldrin Club subscription', rate: '$20/mo · 50% buy-and-burn', kind: 'code', source: '#938 · aldrin_config.ts:20,35' },
  { label: 'Creator skins market', rate: '30% of USDC sales · buy-and-burn', kind: 'code', source: '#897 · marketplace.ts:56' },
  { label: 'Character market', rate: '30% of sales · buyback-and-burn keeper', kind: 'code', source: '#1497 · character_market lib.rs:21' },
  { label: 'Premium listing slots', rate: '$25 · 30% burn leg · 4 slots / 7 days', kind: 'code', source: '#1551 · premium_listings.ts:58-68' },
  { label: '$WOC-rail ads', rate: '250 $WOC/min · 50% burned after approval', kind: 'code', source: 'ads fork #1 · woc_config.ts:142,153' },
  { label: 'Talent slot fees', rate: '100% burned · tiered schedule, not in code', kind: 'assumption', source: 'talent/woc-featured-talent-program.md' },
  { label: 'Claudium $WOC rail', rate: 'burn leg, BPS set by the economy service', kind: 'assumption', source: 'claudium_proxy.ts:57-64 · svc #16' }
];

/* --------------------------------------------------------------------------
 * Formatters (pure; exercised by the tests).
 * ------------------------------------------------------------------------ */
function trimNum(x) {
  var v = Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
  return String(v);
}
var fmt = {
  n: function (n) {
    if (!isFinite(n)) return '-';
    var a = Math.abs(n);
    if (a >= 1e9) return trimNum(n / 1e9) + 'B';
    if (a >= 1e6) return trimNum(n / 1e6) + 'M';
    if (a >= 1e3) return trimNum(n / 1e3) + 'K';
    return trimNum(n);
  },
  usd: function (n) { return '$' + fmt.n(n); },
  full: function (n) { return Math.round(n).toLocaleString('en-US'); },
  full2: function (n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  pct: function (x) {
    if (x >= 10) return Math.round(x) + '%';
    if (x >= 1) return (Math.round(x * 10) / 10) + '%';
    return (Math.round(x * 1000) / 1000) + '%';
  },
  price: function (n) {
    if (!isFinite(n) || n <= 0) return '-';
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + Number(n.toPrecision(3));
  },
  ago: function (deltaMs) {
    if (!isFinite(deltaMs) || deltaMs < 0) return '-';
    var s = Math.round(deltaMs / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  },
  shortAddr: function (a) {
    a = String(a || '');
    return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
  }
};

var WocBurnModel = {
  PRICE_SOURCE: PRICE_SOURCE,
  PRICE_SNAPSHOT: PRICE_SNAPSHOT,
  parsePythV2: parsePythV2,
  parseJupiterV3: parseJupiterV3,
  CHAIN_SOURCE: CHAIN_SOURCE,
  CHAIN_SNAPSHOT: CHAIN_SNAPSHOT,
  ATTRIBUTION: ATTRIBUTION,
  parseTokenSupply: parseTokenSupply,
  parseSignatures: parseSignatures,
  parseBurnsFromTx: parseBurnsFromTx,
  mergeBurns: mergeBurns,
  windowStats: windowStats,
  parseRpcOverride: parseRpcOverride,
  MECHANICS: MECHANICS,
  fmt: fmt
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WocBurnModel;
} else if (typeof window !== 'undefined') {
  window.WocBurnModel = WocBurnModel;
}
