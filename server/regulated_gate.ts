// Shared regulated-feature gate: the geo + OFAC + counsel screen every money
// route on a regulated realm (the RiverBoat casino) calls before executing.
// Generalized from the launchpad's money_geo_gate so the casino and the token
// launchpad screen through one verdict function with independently-versioned
// blocklists and counsel sign-offs (a gambling memo and a securities memo are
// distinct: one surface's counsel var must never satisfy another's).
//
//   - OFAC SDN screening: a payer wallet on the sanctioned-address list is
//     blocked. Loaded from OFAC_SDN_WALLETS (comma-separated) or
//     OFAC_SDN_WALLETS_FILE (one per line, '#' comments allowed); matched
//     case-sensitively (base58 is case-significant).
//   - IP geolocation: a request from a sanctioned or (for wager routes) a
//     gambling-restricted country is blocked. The country is read from the edge
//     (Cloudflare's CF-IPCountry header) and matched against the surface's
//     blocklist. An UNKNOWN country (no header, 'XX', or Tor 'T1') is blocked
//     when the gate is enforcing: a money route fails closed rather than trust
//     an unscreened origin.
//   - Cluster: on a non-mainnet cluster the money is not real, so the gate is a
//     no-op. Cluster is resolved from an EXPLICIT SOLANA_CLUSTER env when set
//     (mainnet-beta | devnet | testnet | localnet), falling back to a hostname
//     scan of SOLANA_RPC_URL only when unset. A custom mainnet RPC whose host
//     lacks the word "mainnet" would otherwise silently disable the gate, so an
//     operator running mainnet on a custom endpoint MUST set SOLANA_CLUSTER.
//   - Counsel + enforcement: on mainnet a real-money route runs only when the
//     gate is enforcing (MONEY_GEO_GATE_ENABLED=1) AND the surface's counsel
//     sign-off is recorded; a misconfigured or un-signed-off deploy fails closed.
//
// Pure verdict logic here (unit-tested with injected inputs); the thin HTTP
// applier reads the request headers.

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';

// ── Cluster resolution ────────────────────────────────────────────────────────

export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

// The active cluster. An explicit SOLANA_CLUSTER wins (the only reliable signal
// for a custom-RPC mainnet); otherwise fall back to a hostname scan of the RPC
// URL, treating an unrecognized host as NON-mainnet (a dev default), which is
// why a real mainnet deploy on a custom endpoint must set SOLANA_CLUSTER.
export function resolveCluster(env: NodeJS.ProcessEnv = process.env): SolanaCluster {
  const explicit = (env.SOLANA_CLUSTER ?? '').trim().toLowerCase();
  if (explicit === 'mainnet-beta' || explicit === 'mainnet') return 'mainnet-beta';
  if (explicit === 'devnet') return 'devnet';
  if (explicit === 'testnet') return 'testnet';
  if (explicit === 'localnet' || explicit === 'localhost') return 'localnet';
  const rpc = (env.SOLANA_RPC_URL ?? '').toLowerCase();
  if (/mainnet/.test(rpc)) return 'mainnet-beta';
  if (/testnet/.test(rpc)) return 'testnet';
  if (/devnet/.test(rpc)) return 'devnet';
  return 'localnet';
}

export function isMainnetCluster(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveCluster(env) === 'mainnet-beta';
}

// ── Enforcement + counsel ─────────────────────────────────────────────────────

export function moneyGeoGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MONEY_GEO_GATE_ENABLED ?? '').trim() === '1';
}

// A recorded counsel sign-off is a non-empty, ops-set marker (a memo id + date)
// present only after the written sign-off exists. Its presence is the gate; the
// value is logged for the audit trail. The env var NAME is the surface's own
// (RIVERBOAT_COUNSEL_SIGNOFF for the casino), so a securities sign-off can never
// satisfy the gambling gate and vice versa.
export function counselSignoffRecorded(
  envVar: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env[envVar] ?? '').trim().length > 0;
}

// ── Blocklists ────────────────────────────────────────────────────────────────

// The default sanctioned-country blocklist (ISO-3166 alpha-2, upper-cased) for
// every money route, so an operator who enables the gate without a list still
// blocks the obvious jurisdictions. The gambling-restricted list is a SEPARATE,
// counsel-supplied env applied only to wager routes (online-casino law is far
// broader than OFAC), so the two version independently.
const DEFAULT_SANCTIONED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY'];

function parseCountryList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

// The OFAC (sanctions) blocklist: MONEY_BLOCKED_COUNTRIES, defaulting to the
// sanctioned set. Applied to every money route.
export function sanctionedCountries(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const list = parseCountryList(env.MONEY_BLOCKED_COUNTRIES);
  return new Set(list.length ? list : DEFAULT_SANCTIONED_COUNTRIES);
}

// The gambling-restricted blocklist: RIVERBOAT_BLOCKED_COUNTRIES (counsel-
// supplied, no default, empty until set). Applied ONLY to wager routes, unioned
// with the sanctions list.
export function gamblingBlockedCountries(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(parseCountryList(env.RIVERBOAT_BLOCKED_COUNTRIES));
}

// The blocklist for a route, by whether it is a wager route: the sanctions list
// always, unioned with the gambling list for wagers.
export function blockedCountriesFor(
  isWagerRoute: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const set = sanctionedCountries(env);
  if (isWagerRoute) for (const c of gamblingBlockedCountries(env)) set.add(c);
  return set;
}

// ── SDN wallet list (cached) ──────────────────────────────────────────────────

let cachedSdn: Set<string> | null = null;

export function sdnWallets(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (cachedSdn) return cachedSdn;
  const set = new Set<string>();
  for (const w of (env.OFAC_SDN_WALLETS ?? '').split(',').map((s) => s.trim())) if (w) set.add(w);
  const file = (env.OFAC_SDN_WALLETS_FILE ?? '').trim();
  if (file) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const w = line.split('#')[0].trim();
      if (w) set.add(w);
    }
  }
  cachedSdn = set;
  return set;
}

/** Reset the SDN cache (tests set the env then re-read). */
export function resetSdnCacheForTests(): void {
  cachedSdn = null;
}

// ── Pure verdict ──────────────────────────────────────────────────────────────

export type GateVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'geo_blocked' | 'sanctioned_wallet' | 'gate_required' | 'self_excluded';
    };

// The pure gate decision for a money route. Posture by cluster:
//   - not mainnet: everything passes (devnet/localnet money is not real).
//   - mainnet + (gate NOT enforcing OR counsel NOT recorded): BLOCK with
//     gate_required. A real-money route can never run on mainnet without BOTH
//     the geo/OFAC gate active AND the counsel sign-off recorded.
//   - mainnet + gate enforcing + counsel recorded: a recorded self-exclusion
//     blocks first (the player opted themselves out), then the country (fail
//     closed on unknown) and the payer wallet against the SDN list.
export function gateVerdict(args: {
  isMainnet: boolean;
  enforcing: boolean;
  counselRecorded: boolean;
  selfExcluded: boolean;
  country: string | null;
  wallet: string | null;
  blocked: Set<string>;
  sdn: Set<string>;
}): GateVerdict {
  if (!args.isMainnet) return { ok: true };
  if (!args.enforcing || !args.counselRecorded) return { ok: false, reason: 'gate_required' };
  if (args.selfExcluded) return { ok: false, reason: 'self_excluded' };
  if (args.country === null) return { ok: false, reason: 'geo_blocked' };
  if (args.blocked.has(args.country.toUpperCase())) return { ok: false, reason: 'geo_blocked' };
  if (args.wallet !== null && args.sdn.has(args.wallet)) {
    return { ok: false, reason: 'sanctioned_wallet' };
  }
  return { ok: true };
}

// The edge-resolved country: Cloudflare's CF-IPCountry header, upper-cased; null
// when absent, the placeholder 'XX' (unresolvable IP), or 'T1' (Tor exit).
export function requestCountry(req: http.IncomingMessage): string | null {
  const raw = String(req.headers['cf-ipcountry'] ?? '')
    .trim()
    .toUpperCase();
  if (!raw || raw === 'XX' || raw === 'T1') return null;
  return raw;
}

// The HTTP applier: screen a money request. `counselEnvVar` is the surface's
// counsel var (RIVERBOAT_COUNSEL_SIGNOFF for the casino). `isWagerRoute` unions
// the gambling blocklist. `wallet` is the payer's linked wallet when known
// (else null). `selfExcluded` is the caller's responsible-gambling verdict for
// this account (default false; the RG service supplies it). Returns the typed
// verdict a route serves as 403 when blocked.
export function screenMoneyRequest(
  req: http.IncomingMessage,
  opts: {
    counselEnvVar: string;
    isWagerRoute: boolean;
    wallet: string | null;
    selfExcluded?: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
): GateVerdict {
  return gateVerdict({
    isMainnet: isMainnetCluster(env),
    enforcing: moneyGeoGateEnabled(env),
    counselRecorded: counselSignoffRecorded(opts.counselEnvVar, env),
    selfExcluded: opts.selfExcluded ?? false,
    country: requestCountry(req),
    wallet: opts.wallet,
    blocked: blockedCountriesFor(opts.isWagerRoute, env),
    sdn: sdnWallets(env),
  });
}

// ── The mainnet-enablement gate (counsel + flags) ─────────────────────────────

// Whether a specific risky money feature may run on mainnet. `featureFlag` is
// the feature's own default-off flag; `counselEnvVar` its surface's counsel var.
// On a non-mainnet cluster the gates do not apply (no real money); on mainnet,
// ALL gates must pass. Can never be true by default.
export function mainnetMoneyEnabled(
  featureFlag: boolean,
  counselEnvVar: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!featureFlag) return false;
  if (!isMainnetCluster(env)) return true;
  return moneyGeoGateEnabled(env) && counselSignoffRecorded(counselEnvVar, env);
}
