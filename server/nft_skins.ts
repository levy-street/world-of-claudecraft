// NFT-PFP skin claim orchestration (docs/prd/woc/nft-pfp-skins.md). Ties together
// the allow-list, server-authoritative ownership, trait inference, and the portrait
// proxy into one claim, then grants the cosmetic. No SQL here (it calls db.ts); no
// crypto here (it calls nft_ownership / nft_trait_profiles). Mirrors the listing
// helpers in marketplace.ts.
import { createHash } from 'node:crypto';
import {
  getNftCollection, getCreatorSkin, upsertCreatorSkin, grantNftSkin,
  listNftGrantsForAccount, evmWalletForAccount, walletForAccount,
  type CreatorSkinRow,
} from './db';
import {
  ownsNft, nftMetadata, isTrustedGatewayUrl,
  type NftChain, type NftStandard, type NftCollectionRef,
} from './nft_ownership';
import { designSpecForTraits } from './nft_trait_profiles';
import { loadAtlasBytes, validatePortraitImage } from './skin_assets';

// Free cosmetic: the NFT is the gate. Bounded per account against spam (same
// ceiling as the creator-listing cap).
export const MAX_NFT_SKINS_PER_ACCOUNT = 24;
const NAME_MAX = 40;

export type NftClaimReason =
  | 'invalid_chain' | 'invalid_token' | 'collection_not_supported'
  | 'link_evm_wallet_first' | 'link_solana_wallet_first'
  | 'ownership_unverified' | 'not_owner' | 'too_many_nft_skins' | 'metadata_unavailable';

export type NftClaimResult =
  | { ok: true; id: string }
  | { ok: false; reason: NftClaimReason };

function asChain(chain: string): NftChain | null {
  return chain === 'ethereum' || chain === 'solana' ? chain : null;
}

/** Stable, deterministic, bounded skin id for an NFT (<= MAX_COSMETIC_SKIN_ID_LEN). */
export function nftSkinId(chain: string, contract: string, tokenId: string): string {
  const h = createHash('sha256').update(`${chain}:${contract}:${tokenId}`).digest('hex').slice(0, 40);
  return `cs_nft_${h}`;
}

function skinName(collectionName: string, chain: NftChain, tokenId: string): string {
  const base = collectionName || 'NFT';
  const full = chain === 'ethereum' ? `${base} #${tokenId}` : base;
  return full.length > NAME_MAX ? full.slice(0, NAME_MAX) : full;
}

/** Resolve + validate the portrait image once, returning the cache key (sha256)
 *  and the server-only origin URL to persist, or null when there is no usable
 *  image (the skin then renders body-only). */
async function resolvePortrait(imageUrl: string | null): Promise<{ sha256: string; originUrl: string } | null> {
  if (!imageUrl) return null;
  const trusted = isTrustedGatewayUrl(imageUrl);
  const bytes = await loadAtlasBytes({
    key: `nftimg:${imageUrl}`,
    gatewayUrl: trusted ? imageUrl : null,
    originUrl: trusted ? null : imageUrl,
  }).catch(() => null);
  if (!bytes) return null;
  const v = validatePortraitImage(bytes);
  return v.ok ? { sha256: v.sha256, originUrl: imageUrl } : null;
}

/**
 * Claim an NFT as a skin: verify the linked wallet for the chain owns the token in
 * an allow-listed collection, infer the body look from traits, proxy the portrait,
 * upsert the skin row, and grant it. Idempotent: re-claiming the same token (e.g.
 * after a tier sweep restore) refreshes the look and re-grants. Returns the skin id
 * so the caller can apply a live grant + invalidate the registry cache.
 */
export async function claimNftSkin(params: {
  accountId: number;
  chain: string;
  contract: string;
  tokenId: string;
}): Promise<NftClaimResult> {
  const chain = asChain(params.chain);
  if (!chain) return { ok: false, reason: 'invalid_chain' };
  const contract = chain === 'ethereum' ? params.contract.trim().toLowerCase() : params.contract.trim();
  const tokenId = params.tokenId.trim();
  if (!contract || !tokenId) return { ok: false, reason: 'invalid_token' };

  const collection = await getNftCollection(chain, contract);
  if (!collection || !collection.enabled) return { ok: false, reason: 'collection_not_supported' };

  const address = chain === 'ethereum'
    ? (await evmWalletForAccount(params.accountId))?.address ?? null
    : (await walletForAccount(params.accountId))?.pubkey ?? null;
  if (!address) return { ok: false, reason: chain === 'ethereum' ? 'link_evm_wallet_first' : 'link_solana_wallet_first' };

  const ref: NftCollectionRef = { chain, contract, standard: collection.standard as NftStandard };
  const owns = await ownsNft(ref, tokenId, address, true);
  if (owns === null) return { ok: false, reason: 'ownership_unverified' }; // fail-closed
  if (!owns) return { ok: false, reason: 'not_owner' };

  const skinId = nftSkinId(chain, contract, tokenId);
  const grants = await listNftGrantsForAccount(params.accountId);
  const alreadyGranted = grants.some((g) => g.skinId === skinId);
  if (!alreadyGranted && grants.filter((g) => !g.revoked).length >= MAX_NFT_SKINS_PER_ACCOUNT) {
    return { ok: false, reason: 'too_many_nft_skins' };
  }

  const meta = await nftMetadata(ref, tokenId);
  if (!meta) return { ok: false, reason: 'metadata_unavailable' };
  const design = designSpecForTraits(collection.profileId, meta.attributes);

  const existing = await getCreatorSkin(skinId);
  const portrait = await resolvePortrait(meta.image)
    ?? (existing?.portraitSha256 && existing.originUrl ? { sha256: existing.portraitSha256, originUrl: existing.originUrl } : null);

  const row: CreatorSkinRow = {
    id: skinId,
    creatorAccountId: params.accountId,
    creatorWallet: address,
    name: skinName(collection.name, chain, tokenId),
    description: '',
    skinCatalog: 'class',
    fallbackSkin: 0,
    targetClass: null,
    assetUrl: 'procedural', // body look is the trait-derived design
    emissiveUrl: null,
    design,
    source: 'nft',
    originUrl: portrait?.originUrl ?? null, // server-only portrait image URL
    ipfsCid: null,
    reviewStatus: 'approved', // allow-listed collection is pre-vetted
    overflowHidden: false,
    priceUsdc: 1n, // not for sale (price_usdc CHECK > 0); claim, not buy
    status: 'live',
    sha256: null,
    nftChain: chain,
    nftContract: contract,
    nftTokenId: tokenId,
    portraitSha256: portrait?.sha256 ?? null,
  };
  await upsertCreatorSkin(row);
  await grantNftSkin(params.accountId, skinId);
  return { ok: true, id: skinId };
}

/** Load an NFT skin's portrait bytes for the serve route (cached by sha256), or
 *  null. Follows redirects only for trusted gateways; arbitrary origins are
 *  SSRF-vetted with redirects refused. */
export async function loadNftPortrait(skin: CreatorSkinRow): Promise<Buffer | null> {
  if (skin.source !== 'nft' || !skin.originUrl || !skin.portraitSha256) return null;
  const trusted = isTrustedGatewayUrl(skin.originUrl);
  return loadAtlasBytes({
    key: skin.portraitSha256,
    gatewayUrl: trusted ? skin.originUrl : null,
    originUrl: trusted ? null : skin.originUrl,
  }).catch(() => null);
}
