// Per-chain NFT ownership + metadata reads, the analog of server/woc_balance.ts:
// the one place we ask "does this address own this token right now, and what are
// its traits". Ownership is the server-authoritative gate for an `nft`-source
// skin (claim) and the lost-on-sell sweep (revoke). Reads are cached and
// FAIL-CLOSED: a transport/RPC failure is reported as `unknown`, never as
// "not owned", so an outage can never wrongly grant or revoke a skin.
//
// Ethereum: raw `eth_call` (server/eth_rpc.ts) for ERC-721 `ownerOf` and the
// non-ERC-721 CryptoPunks (native `punkIndexToAddress` + the Wrapped Punks ERC-721
// wrapper). Solana: the DAS `getAsset` API (server/solana_das.ts), which returns
// owner + collection + attributes for both standard and compressed NFTs.
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { ethCallOutcome, type EthCallOutcome } from './eth_rpc';
import { dasGetAsset, solanaDasConfigured } from './solana_das';
import { assertSafePublicUrl } from './skin_assets';
import { isSolanaAddress } from './wallet_link';
import { normalizeEvmAddress } from './wallet_link_evm';

export type NftChain = 'ethereum' | 'solana';
export type NftStandard = 'erc721' | 'cryptopunks' | 'solana';

export interface NftCollectionRef {
  chain: NftChain;
  contract: string; // lower-cased ERC-721 address; for Solana the collection id (grouping value)
  standard: NftStandard;
}

export interface NftAttribute { trait_type: string; value: string }
export interface NftMetadata { attributes: NftAttribute[]; image: string | null; collection: string | null }

// owner -> the current holder; none -> token exists but `address` is not it / no
// owner; unknown -> could not read (fail-closed: do not grant, do not revoke).
export type NftOwnership =
  | { kind: 'owner'; owner: string }
  | { kind: 'none' }
  | { kind: 'unknown' };

// CryptoPunks is a 2017 pre-ERC-721 contract; a wrapped punk is held inside the
// Wrapped Punks ERC-721. Lower-cased for case-insensitive compare.
export const CRYPTOPUNKS_NATIVE = '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb';
export const WRAPPED_PUNKS = '0xb7f7f6c52f2e2fdb1963eab30438024864c313f6';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const IPFS_GATEWAY = (process.env.NFT_IPFS_GATEWAY ?? 'https://ipfs.io').replace(/\/+$/, '');
const AR_GATEWAY = (process.env.NFT_AR_GATEWAY ?? 'https://arweave.net').replace(/\/+$/, '');
const METADATA_MAX_BYTES = 512 * 1024;
const METADATA_TIMEOUT_MS = 8000;

// --- pure ABI helpers (unit-tested) ---------------------------------------------

/** The 4-byte function selector for a Solidity signature, as `0x`-prefixed hex. */
export function evmSelector(signature: string): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(signature)).slice(0, 4))}`;
}

/** A uint256 argument as a 64-hex left-padded word (no 0x). */
export function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error('uint256 cannot be negative');
  return value.toString(16).padStart(64, '0');
}

/** Decode the address from a 32-byte return word (last 20 bytes), lower-cased, or
 *  null if the data is not a single well-formed word. */
export function decodeAddressWord(data: string): string | null {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length < 64 || !/^[0-9a-fA-F]+$/.test(hex.slice(0, 64))) return null;
  return `0x${hex.slice(24, 64).toLowerCase()}`;
}

/** Decode an ABI-encoded dynamic `string` return (offset, length, bytes) to UTF-8,
 *  or null if malformed. Used for ERC-721 `tokenURI`. */
export function decodeAbiString(data: string): string | null {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length < 128 || hex.length % 2 !== 0) return null;
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)) * 2;
  if (offset + 64 > hex.length) return null;
  const len = Number(BigInt(`0x${hex.slice(offset, offset + 64)}`)) * 2;
  const start = offset + 64;
  if (start + len > hex.length) return null;
  const bytes = hex.slice(start, start + len);
  if (!/^[0-9a-fA-F]*$/.test(bytes)) return null;
  return Buffer.from(bytes, 'hex').toString('utf8');
}

const SEL_OWNER_OF = evmSelector('ownerOf(uint256)');
const SEL_PUNK_INDEX = evmSelector('punkIndexToAddress(uint256)');
const SEL_TOKEN_URI = evmSelector('tokenURI(uint256)');

function outcomeToOwnership(out: EthCallOutcome): NftOwnership {
  if (out.kind === 'error') return { kind: 'unknown' };
  if (out.kind === 'reverted') return { kind: 'none' };
  const owner = decodeAddressWord(out.data);
  if (owner === null || owner === ZERO_ADDRESS) return { kind: 'none' };
  return { kind: 'owner', owner };
}

// --- Ethereum ownership ---------------------------------------------------------

async function erc721Owner(contract: string, tokenId: bigint): Promise<NftOwnership> {
  return outcomeToOwnership(await ethCallOutcome(contract, `${SEL_OWNER_OF}${encodeUint256(tokenId)}`));
}

/** A CryptoPunk is owned either natively (`punkIndexToAddress`) or, if wrapped,
 *  via the Wrapped Punks ERC-721 (`ownerOf`). When wrapped, the native mapping
 *  points at the wrapper contract, so we follow through to the wrapper. */
async function cryptopunkOwner(tokenId: bigint): Promise<NftOwnership> {
  const native = outcomeToOwnership(await ethCallOutcome(CRYPTOPUNKS_NATIVE, `${SEL_PUNK_INDEX}${encodeUint256(tokenId)}`));
  if (native.kind === 'unknown') return native;
  if (native.kind === 'owner' && native.owner !== WRAPPED_PUNKS) return native;
  // Native owner is the wrapper (or absent): the real holder is the wrapped ERC-721 owner.
  const wrapped = await erc721Owner(WRAPPED_PUNKS, tokenId);
  if (wrapped.kind === 'owner') return wrapped;
  if (wrapped.kind === 'unknown') return wrapped;
  return native; // neither path yields a holder
}

async function ethOwnership(ref: NftCollectionRef, tokenId: bigint): Promise<NftOwnership> {
  if (ref.standard === 'cryptopunks') return cryptopunkOwner(tokenId);
  return erc721Owner(ref.contract, tokenId);
}

// --- Solana ownership (DAS) -----------------------------------------------------

async function solanaOwnership(ref: NftCollectionRef, mint: string): Promise<NftOwnership> {
  if (!solanaDasConfigured()) return { kind: 'unknown' };
  const asset = await dasGetAsset(mint);
  if (asset === null) return { kind: 'unknown' };
  if (asset.burnt) return { kind: 'none' };
  const owner = asset.ownership?.owner;
  if (typeof owner !== 'string' || !isSolanaAddress(owner)) return { kind: 'none' };
  // The mint must actually belong to the allow-listed collection.
  const inCollection = (asset.grouping ?? []).some(
    (g) => g.group_key === 'collection' && g.group_value === ref.contract,
  );
  if (!inCollection) return { kind: 'none' };
  return { kind: 'owner', owner };
}

// --- public ownership API -------------------------------------------------------

interface OwnershipCacheEntry { result: NftOwnership; at: number }
export const NFT_OWNERSHIP_TTL_MS = 5 * 60 * 1000;
export const NFT_OWNERSHIP_CACHE_MAX = 4096;
const ownershipCache = new Map<string, OwnershipCacheEntry>();

function cacheKey(ref: NftCollectionRef, tokenId: string): string {
  return `${ref.chain}|${ref.contract}|${tokenId}`;
}

export function resetNftOwnershipCacheForTests(): void {
  ownershipCache.clear();
}

/** The current owner of a token, cached per (chain, contract, token) for a short
 *  TTL. `unknown` results are never cached, so a transient failure retries; only
 *  definite `owner`/`none` answers are reused. */
export async function nftOwnership(ref: NftCollectionRef, tokenId: string, fresh = false): Promise<NftOwnership> {
  const key = cacheKey(ref, tokenId);
  const now = Date.now();
  const hit = ownershipCache.get(key);
  if (!fresh && hit && now - hit.at < NFT_OWNERSHIP_TTL_MS) {
    ownershipCache.delete(key);
    ownershipCache.set(key, hit);
    return hit.result;
  }
  let result: NftOwnership;
  if (ref.chain === 'ethereum') {
    if (!/^\d+$/.test(tokenId)) return { kind: 'none' };
    result = await ethOwnership(ref, BigInt(tokenId));
  } else {
    if (!isSolanaAddress(tokenId)) return { kind: 'none' };
    result = await solanaOwnership(ref, tokenId);
  }
  if (result.kind !== 'unknown') {
    ownershipCache.set(key, { result, at: now });
    while (ownershipCache.size > NFT_OWNERSHIP_CACHE_MAX) {
      const oldest = ownershipCache.keys().next();
      if (oldest.done) break;
      ownershipCache.delete(oldest.value);
    }
  }
  return result;
}

/**
 * Does `address` own this token right now? true / false on a definite read,
 * null when ownership could not be determined (fail-closed). EVM addresses
 * compare case-insensitively; Solana base58 compares exactly.
 */
export async function ownsNft(ref: NftCollectionRef, tokenId: string, address: string, fresh = false): Promise<boolean | null> {
  const ownership = await nftOwnership(ref, tokenId, fresh);
  if (ownership.kind === 'unknown') return null;
  if (ownership.kind === 'none') return false;
  return ref.chain === 'ethereum'
    ? ownership.owner === normalizeEvmAddress(address)
    : ownership.owner === address;
}

// --- metadata (traits + portrait image) -----------------------------------------

function coerceAttributes(raw: unknown): NftAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: NftAttribute[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const rec = a as Record<string, unknown>;
    const traitType = rec.trait_type;
    const value = rec.value;
    if (typeof traitType !== 'string' || traitType.length === 0) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    out.push({ trait_type: traitType, value: String(value) });
  }
  return out;
}

/** Resolve an `ipfs://` / `ar://` / `https://` asset URI to an http(s) URL, or
 *  null for an unsupported scheme. `data:` URIs are handled separately. */
export function resolveAssetUri(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `${IPFS_GATEWAY}/ipfs/${path}`;
  }
  if (trimmed.startsWith('ar://')) return `${AR_GATEWAY}/${trimmed.slice('ar://'.length)}`;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  return null;
}

/** True when a URL points at one of our configured (trusted) gateways, so the
 *  portrait fetch may follow redirects; arbitrary http(s) origins are SSRF-vetted
 *  with redirects refused. */
export function isTrustedGatewayUrl(url: string): boolean {
  return url.startsWith(IPFS_GATEWAY) || url.startsWith(AR_GATEWAY);
}

function decodeDataJsonUri(uri: string): unknown {
  if (!uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const raw = header.includes('base64')
    ? Buffer.from(payload, 'base64').toString('utf8')
    : decodeURIComponent(payload);
  return JSON.parse(raw) as unknown;
}

async function fetchJsonBounded(rawUrl: string): Promise<unknown> {
  // ipfs/ar gateways are server-configured (trusted); arbitrary http(s) origins
  // from tokenURI are SSRF-vetted. The gateway hosts are constant prefixes.
  const trusted = rawUrl.startsWith(IPFS_GATEWAY) || rawUrl.startsWith(AR_GATEWAY);
  const url = trusted ? new URL(rawUrl) : await assertSafePublicUrl(rawUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), METADATA_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: trusted ? 'follow' : 'error', signal: ac.signal });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') ?? '0') > METADATA_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > METADATA_MAX_BYTES) return null;
    return JSON.parse(buf.toString('utf8')) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function ethMetadata(ref: NftCollectionRef, tokenId: bigint): Promise<NftMetadata | null> {
  const out = await ethCallOutcome(ref.contract, `${SEL_TOKEN_URI}${encodeUint256(tokenId)}`);
  if (out.kind !== 'ok') return null;
  const uri = decodeAbiString(out.data);
  if (!uri) return null;
  const json = uri.startsWith('data:') ? decodeDataJsonUri(uri) : await fetchJsonBounded(resolveAssetUri(uri) ?? '');
  if (!json || typeof json !== 'object') return null;
  const rec = json as Record<string, unknown>;
  const image = typeof rec.image === 'string' ? resolveAssetUri(rec.image) : null;
  return { attributes: coerceAttributes(rec.attributes), image, collection: ref.contract };
}

async function solanaMetadata(ref: NftCollectionRef, mint: string): Promise<NftMetadata | null> {
  if (!solanaDasConfigured()) return null;
  const asset = await dasGetAsset(mint);
  if (asset === null) return null;
  const attributes = coerceAttributes(asset.content?.metadata?.attributes);
  const rawImage = asset.content?.links?.image
    ?? asset.content?.files?.find((f) => (f.mime ?? '').startsWith('image/'))?.uri
    ?? asset.content?.files?.[0]?.uri
    ?? null;
  const image = rawImage ? resolveAssetUri(rawImage) : null;
  return { attributes, image, collection: ref.contract };
}

/** Fetch a token's trait attributes + portrait image url, or null when metadata
 *  cannot be read. Called once at claim time; the result is persisted (the
 *  derived design spec + the cached portrait), so a later metadata outage does
 *  not break a granted skin. */
export async function nftMetadata(ref: NftCollectionRef, tokenId: string): Promise<NftMetadata | null> {
  if (ref.chain === 'ethereum') {
    if (!/^\d+$/.test(tokenId)) return null;
    return ethMetadata(ref, BigInt(tokenId));
  }
  if (!isSolanaAddress(tokenId)) return null;
  return solanaMetadata(ref, tokenId);
}
