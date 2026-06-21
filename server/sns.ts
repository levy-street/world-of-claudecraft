// Solana Name Service subdomains under the project-owned parent domain
// (SNS_PARENT_DOMAIN, e.g. worldofclaudecraft.sol). The chain is the source of
// truth for ownership; a server-held "execution wallet" owns the parent domain
// and co-signs subdomain creation/transfer so we can mint a *player-owned*
// subdomain in the same transaction that burns the player's $WOC.
//
// Boundary: server-only. No file under src/sim/ may import this module — all
// web3/SNS lives here. The execution wallet is the one custodial seam (it never
// touches player funds; it only authorizes subdomain operations on our domain).
import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createSubdomain, transferSubdomain, getDomainKeySync, NameRegistryState } from '@bonfida/spl-name-service';
import bs58 from 'bs58';
import { SOLANA_RPC_URL, SNS_PARENT_DOMAIN, SNS_ENABLED, EXECUTION_WALLET_SECRET } from './woc_config';

// The bare parent label without the trailing .sol (the SDK wants `label.parent`).
const PARENT_LABEL = SNS_PARENT_DOMAIN.replace(/\.sol$/i, '').trim();
// Subdomain registries are tiny; this is the on-chain account space we allocate.
const SUBDOMAIN_SPACE = 2_000;

let _connection: Connection | null = null;
function connection(): Connection {
  if (!_connection) _connection = new Connection(SOLANA_RPC_URL, 'finalized');
  return _connection;
}

let _executionWallet: Keypair | null = null;
/** The parent-domain authority keypair. Throws if the secret isn't configured. */
export function executionWallet(): Keypair {
  if (_executionWallet) return _executionWallet;
  if (!EXECUTION_WALLET_SECRET) {
    throw new Error('EXECUTION_WALLET_SECRET is not set — subdomain minting is unavailable');
  }
  _executionWallet = Keypair.fromSecretKey(bs58.decode(EXECUTION_WALLET_SECRET));
  return _executionWallet;
}

/** True once minting can actually run (flag on + execution wallet configured). */
export function snsReady(): boolean {
  return SNS_ENABLED && EXECUTION_WALLET_SECRET.length > 0;
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Reduce a chosen display name to a valid SNS subdomain label: lowercase ASCII,
 * spaces/apostrophes/punctuation collapsed to single hyphens, trimmed, ≤63
 * chars. Returns null when nothing valid remains (e.g. a name with no a-z0-9).
 */
export function slugifyLabel(name: string): string | null {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, ''); // a trailing hyphen could reappear after the slice
  return LABEL_RE.test(slug) ? slug : null;
}

/** The full subdomain string the SDK expects, e.g. `levy.worldofclaudecraft.sol`. */
export function fullSubdomain(label: string): string {
  return `${label}.${PARENT_LABEL}.sol`;
}

/**
 * Whether `label` is free under the parent domain. Derives the registry key and
 * checks the chain directly — an existing account means taken. Returns null on a
 * read failure so the caller can distinguish "unknown" from "available".
 */
export async function subdomainAvailable(label: string): Promise<boolean | null> {
  const { pubkey } = getDomainKeySync(fullSubdomain(label));
  const info = await connection().getAccountInfo(pubkey, 'finalized');
  return info === null;
}

/**
 * The on-chain owner of `subdomain` (the bare `label.worldofclaudecraft.sol`
 * form), base58, or null if the subdomain doesn't exist. This is the lazy
 * ownership probe used at character-select/login to decide who controls a bound
 * character.
 */
export async function resolveSubdomainOwner(subdomain: string): Promise<string | null> {
  const { pubkey } = getDomainKeySync(subdomain);
  const info = await connection().getAccountInfo(pubkey, 'finalized');
  if (!info) return null;
  const registry = NameRegistryState.deserialize(info.data);
  return registry.owner.toBase58();
}

/**
 * Instructions that mint `label.worldofclaudecraft.sol` and hand it to the
 * player: the execution wallet (parent owner) creates the subdomain with the
 * player as fee payer, then transfers ownership to the player — so the player
 * ends up holding it outright. Both creation and transfer are authorized by the
 * execution wallet's signature; the caller composes these with the $WOC burn and
 * partial-signs with executionWallet() before handing the tx to the player.
 */
export async function buildIssueSubdomainIxs(label: string, ownerPubkey: PublicKey): Promise<TransactionInstruction[]> {
  const exec = executionWallet().publicKey;
  const subdomain = fullSubdomain(label);
  const createIxs = await createSubdomain(connection(), subdomain, exec, SUBDOMAIN_SPACE, ownerPubkey);
  // isParentOwnerSigner=true: the parent owner (execution wallet) authorizes the
  // hand-off of the freshly created subdomain to the player.
  const transferIx = await transferSubdomain(connection(), subdomain, ownerPubkey, true);
  return [...createIxs, transferIx];
}

export { connection as snsConnection };
