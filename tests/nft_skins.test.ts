import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundaries (db, ownership reader, image fetch/validate) — NOT the
// claim orchestration or the real trait inference (designSpecForTraits stays real).
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = vi.hoisted(() => ({
  getNftCollection: vi.fn(async (): Promise<any> => null),
  getCreatorSkin: vi.fn(async (): Promise<any> => null),
  upsertCreatorSkin: vi.fn(async (_r: any): Promise<void> => {}),
  grantNftSkin: vi.fn(async (): Promise<void> => {}),
  listNftGrantsForAccount: vi.fn(async (): Promise<any[]> => []),
  evmWalletForAccount: vi.fn(async (): Promise<any> => ({ address: '0x' + '1'.repeat(40) })),
  walletForAccount: vi.fn(async (): Promise<any> => ({ pubkey: 'So11111111111111111111111111111111111111112' })),
}));
const own = vi.hoisted(() => ({
  ownsNft: vi.fn(async (): Promise<boolean | null> => true),
  nftMetadata: vi.fn(async (): Promise<any> => ({ attributes: [{ trait_type: 'Fur', value: 'Solid Gold' }], image: 'https://cdn/x.png', collection: 'c' })),
  isTrustedGatewayUrl: vi.fn((): boolean => false),
}));
const assets = vi.hoisted(() => ({
  loadAtlasBytes: vi.fn(async (): Promise<Buffer | null> => Buffer.from([1, 2, 3])),
  validatePortraitImage: vi.fn((): any => ({ ok: true, sha256: 'deadbeef', mime: 'image/png' })),
}));
vi.mock('../server/db', () => db);
vi.mock('../server/nft_ownership', () => own);
vi.mock('../server/skin_assets', () => assets);

import { claimNftSkin, nftSkinId, MAX_NFT_SKINS_PER_ACCOUNT, parseNftCollectionsEnv } from '../server/nft_skins';

const BAYC = { chain: 'ethereum', contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', name: 'Bored Ape', standard: 'erc721', profileId: 'bayc', licenseBasis: 'yuga', enabled: true };
const CLAIM = { accountId: 7, chain: 'ethereum', contract: '0xBC4CA0EDA7647A8AB7C2061C2E118A18A936F13D', tokenId: '42' };

beforeEach(() => {
  for (const m of [...Object.values(db), ...Object.values(own), ...Object.values(assets)]) (m as ReturnType<typeof vi.fn>).mockReset?.();
  db.getNftCollection.mockResolvedValue(BAYC);
  db.getCreatorSkin.mockResolvedValue(null);
  db.upsertCreatorSkin.mockResolvedValue(undefined);
  db.grantNftSkin.mockResolvedValue(undefined);
  db.listNftGrantsForAccount.mockResolvedValue([]);
  db.evmWalletForAccount.mockResolvedValue({ address: '0x' + '1'.repeat(40) });
  own.ownsNft.mockResolvedValue(true);
  own.nftMetadata.mockResolvedValue({ attributes: [{ trait_type: 'Fur', value: 'Solid Gold' }], image: 'https://cdn/x.png', collection: 'c' });
  own.isTrustedGatewayUrl.mockReturnValue(false);
  assets.loadAtlasBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
  assets.validatePortraitImage.mockReturnValue({ ok: true, sha256: 'deadbeef', mime: 'image/png' });
});

describe('claimNftSkin — guards', () => {
  it('rejects an unknown chain', async () => {
    expect(await claimNftSkin({ ...CLAIM, chain: 'dogecoin' })).toEqual({ ok: false, reason: 'invalid_chain' });
  });
  it('rejects an off-allow-list or disabled collection', async () => {
    db.getNftCollection.mockResolvedValue(null);
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'collection_not_supported' });
    db.getNftCollection.mockResolvedValue({ ...BAYC, enabled: false });
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'collection_not_supported' });
  });
  it('requires a linked wallet for the chain', async () => {
    db.evmWalletForAccount.mockResolvedValue(null);
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'link_evm_wallet_first' });
  });
  it('rejects when the wallet does not own the token (403-worthy)', async () => {
    own.ownsNft.mockResolvedValue(false);
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'not_owner' });
  });
  it('fails closed when ownership cannot be verified', async () => {
    own.ownsNft.mockResolvedValue(null);
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'ownership_unverified' });
  });
  it('enforces the per-account cap for NEW skins only', async () => {
    db.listNftGrantsForAccount.mockResolvedValue(
      Array.from({ length: MAX_NFT_SKINS_PER_ACCOUNT }, (_, i) => ({ skinId: `cs_nft_${i}`, revoked: false })),
    );
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'too_many_nft_skins' });
    // a re-claim of an ALREADY-granted skin bypasses the cap
    const id = nftSkinId('ethereum', BAYC.contract, '42');
    db.listNftGrantsForAccount.mockResolvedValue([
      ...Array.from({ length: MAX_NFT_SKINS_PER_ACCOUNT - 1 }, (_, i) => ({ skinId: `cs_nft_${i}`, revoked: false })),
      { skinId: id, revoked: false },
    ]);
    expect((await claimNftSkin(CLAIM)).ok).toBe(true);
  });
  it('rejects when metadata cannot be read', async () => {
    own.nftMetadata.mockResolvedValue(null);
    expect(await claimNftSkin(CLAIM)).toEqual({ ok: false, reason: 'metadata_unavailable' });
  });
});

describe('claimNftSkin — happy path', () => {
  it('upserts an nft row with the trait-derived design + portrait, then grants', async () => {
    let row: Record<string, unknown> | null = null;
    db.upsertCreatorSkin.mockImplementation(async (r: Record<string, unknown>) => { row = r; });
    const result = await claimNftSkin(CLAIM);
    expect(result).toEqual({ ok: true, id: nftSkinId('ethereum', BAYC.contract, '42') });
    expect(row).toBeTruthy();
    expect(row!.source).toBe('nft');
    expect(row!.nftChain).toBe('ethereum');
    expect(row!.nftContract).toBe(BAYC.contract); // lower-cased
    expect(row!.nftTokenId).toBe('42');
    expect(row!.portraitSha256).toBe('deadbeef');
    expect(row!.originUrl).toBe('https://cdn/x.png'); // server-only portrait url
    expect(row!.status).toBe('live');
    expect(row!.reviewStatus).toBe('approved');
    // Solid Gold fur -> metallic gold design (real trait inference, not mocked).
    expect((row!.design as { finish: string; primary: string }).finish).toBe('metallic');
    expect((row!.design as { primary: string }).primary).toBe('#d4af37');
    expect(db.grantNftSkin).toHaveBeenCalledWith(7, result.ok && result.id);
  });
  it('claims body-only when the portrait image is missing/invalid', async () => {
    own.nftMetadata.mockResolvedValue({ attributes: [{ trait_type: 'Fur', value: 'Zombie' }], image: null, collection: 'c' });
    let row: Record<string, unknown> | null = null;
    db.upsertCreatorSkin.mockImplementation(async (r: Record<string, unknown>) => { row = r; });
    expect((await claimNftSkin(CLAIM)).ok).toBe(true);
    expect(row!.portraitSha256).toBeNull();
    expect(row!.originUrl).toBeNull();
  });
  it('reads the Solana wallet for a solana claim', async () => {
    db.getNftCollection.mockResolvedValue({ chain: 'solana', contract: 'So11111111111111111111111111111111111111112', name: 'Mad Lads', standard: 'solana', profileId: 'generic', licenseBasis: '', enabled: true });
    const r = await claimNftSkin({ accountId: 7, chain: 'solana', contract: 'So11111111111111111111111111111111111111112', tokenId: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
    expect(r.ok).toBe(true);
    expect(db.walletForAccount).toHaveBeenCalledWith(7);
  });
});

describe('parseNftCollectionsEnv', () => {
  it('parses + normalizes valid rows, lower-casing ETH contracts', () => {
    const rows = parseNftCollectionsEnv(JSON.stringify([
      { chain: 'ethereum', contract: '0xBC4CA0EDA7647A8AB7C2061C2E118A18A936F13D', name: 'BAYC', standard: 'erc721', profileId: 'bayc', licenseBasis: 'yuga' },
      { chain: 'solana', contract: 'So11111111111111111111111111111111111111112', name: 'Mad Lads', standard: 'solana' },
    ]));
    expect(rows).toEqual([
      { chain: 'ethereum', contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', name: 'BAYC', standard: 'erc721', profileId: 'bayc', licenseBasis: 'yuga', enabled: true },
      { chain: 'solana', contract: 'So11111111111111111111111111111111111111112', name: 'Mad Lads', standard: 'solana', profileId: 'generic', licenseBasis: '', enabled: true },
    ]);
  });
  it('drops malformed entries and bad json without throwing', () => {
    expect(parseNftCollectionsEnv(undefined)).toEqual([]);
    expect(parseNftCollectionsEnv('not json')).toEqual([]);
    expect(parseNftCollectionsEnv('{}')).toEqual([]);
    expect(parseNftCollectionsEnv(JSON.stringify([
      { chain: 'bitcoin', contract: '0xabc', standard: 'erc721' }, // bad chain
      { chain: 'ethereum', standard: 'erc721' }, // missing contract
      { chain: 'ethereum', contract: '0xabc', standard: 'erc1155' }, // bad standard
    ]))).toEqual([]);
  });
  it('respects enabled:false', () => {
    const [row] = parseNftCollectionsEnv(JSON.stringify([{ chain: 'ethereum', contract: '0xAbC', standard: 'cryptopunks', enabled: false }]));
    expect(row.enabled).toBe(false);
    expect(row.contract).toBe('0xabc');
  });
});
