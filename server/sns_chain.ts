// SNS subdomains: the IO shell over the pure core in server/sns.ts. Owns the
// execution wallet (cached from env), availability and ownership reads over
// raw JSON-RPC (via server/solana_tx.ts, no @solana/web3.js), and the rent
// lookup for a new registry. Server-only; the chain stays the source of truth
// for subdomain ownership.
import {
  domainKey,
  keypairFromSecret,
  parseRegistryOwner,
  REGISTRY_HEADER_LEN,
  type SnsKeypair,
  subdomainKey,
} from './sns';
import { getAccountInfoResult, getRentExemptLamports } from './solana_tx';
import { EXECUTION_WALLET_SECRET, WOC_SNS_ENABLED } from './woc_config';

/** True once minting can actually run (flag on AND execution wallet configured). */
export function snsReady(): boolean {
  return WOC_SNS_ENABLED && EXECUTION_WALLET_SECRET.length > 0;
}

let _executionWallet: SnsKeypair | null = null;
/** The parent-domain authority keypair. Throws if the secret is not configured. */
export function executionWallet(): SnsKeypair {
  if (_executionWallet) return _executionWallet;
  if (!EXECUTION_WALLET_SECRET) {
    throw new Error('EXECUTION_WALLET_SECRET is not set, subdomain minting is unavailable');
  }
  _executionWallet = keypairFromSecret(EXECUTION_WALLET_SECRET);
  return _executionWallet;
}

/**
 * Whether `label` is free under the parent domain: derives the registry key
 * and checks the chain directly (an existing account means taken). Returns
 * null on a read failure so callers can distinguish "unknown" from "free".
 */
export async function subdomainAvailable(label: string): Promise<boolean | null> {
  const info = await getAccountInfoResult(subdomainKey(label));
  if (info === null) return null;
  return !info.exists;
}

/**
 * The current on-chain owner of a full domain (`label.parent.sol`), base58, or
 * null when the registry does not exist or cannot be read. This is the lazy
 * ownership probe the claim flow and the world-entry gate use to decide who
 * controls a bound character.
 */
export async function resolveSubdomainOwner(fullDomain: string): Promise<string | null> {
  let key: string;
  try {
    key = domainKey(fullDomain);
  } catch {
    return null;
  }
  const info = await getAccountInfoResult(key);
  if (info === null || !info.exists) return null;
  return parseRegistryOwner(info.data);
}

/** Rent-exempt lamports for a new subdomain registry of `space` data bytes. */
export async function rentForSubdomain(space: number): Promise<bigint | null> {
  return getRentExemptLamports(REGISTRY_HEADER_LEN + space);
}
