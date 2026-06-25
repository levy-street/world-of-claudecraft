import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundaries (eth_rpc, solana_das) — NOT the ownership logic under test.
const eth = vi.hoisted(() => ({ ethCallOutcome: vi.fn() }));
const das = vi.hoisted(() => ({ dasGetAsset: vi.fn(), solanaDasConfigured: vi.fn(() => true) }));
vi.mock('../server/eth_rpc', () => eth);
vi.mock('../server/solana_das', () => das);

import {
  evmSelector, encodeUint256, decodeAddressWord, decodeAbiString, resolveAssetUri,
  nftOwnership, ownsNft, nftMetadata, resetNftOwnershipCacheForTests,
  CRYPTOPUNKS_NATIVE, WRAPPED_PUNKS, type NftCollectionRef,
} from '../server/nft_ownership';
import type { EthCallOutcome } from '../server/eth_rpc';

const addrWord = (addr: string): string => `0x${'0'.repeat(24)}${addr.toLowerCase().replace(/^0x/, '')}`;
const ok = (data: string): EthCallOutcome => ({ kind: 'ok', data });
const BAYC: NftCollectionRef = { chain: 'ethereum', contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', standard: 'erc721' };
const PUNKS: NftCollectionRef = { chain: 'ethereum', contract: CRYPTOPUNKS_NATIVE, standard: 'cryptopunks' };
const HOLDER = '0x' + '1'.repeat(40);
const SOL_COLLECTION = 'So11111111111111111111111111111111111111112';
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_OWNER = 'Vote111111111111111111111111111111111111111';

beforeEach(() => {
  resetNftOwnershipCacheForTests();
  eth.ethCallOutcome.mockReset();
  das.dasGetAsset.mockReset();
  das.solanaDasConfigured.mockReturnValue(true);
});

describe('pure ABI helpers', () => {
  it('computes the canonical function selectors', () => {
    expect(evmSelector('ownerOf(uint256)')).toBe('0x6352211e');
    expect(evmSelector('punkIndexToAddress(uint256)')).toBe('0x58178168');
    expect(evmSelector('tokenURI(uint256)')).toBe('0xc87b56dd');
  });
  it('left-pads a uint256 and rejects negatives', () => {
    expect(encodeUint256(1n)).toBe('0'.repeat(63) + '1');
    expect(encodeUint256(255n)).toBe('0'.repeat(62) + 'ff');
    expect(() => encodeUint256(-1n)).toThrow();
  });
  it('decodes an address from a 32-byte word', () => {
    expect(decodeAddressWord(addrWord(HOLDER))).toBe(HOLDER.toLowerCase());
    expect(decodeAddressWord('0xshort')).toBeNull();
  });
  it('decodes an ABI dynamic string (tokenURI)', () => {
    const s = 'ipfs://QmAbc/1.json';
    const hex = Buffer.from(s, 'utf8').toString('hex');
    const data = '0x' + (0x20).toString(16).padStart(64, '0') + s.length.toString(16).padStart(64, '0') + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
    expect(decodeAbiString(data)).toBe(s);
    expect(decodeAbiString('0x00')).toBeNull();
  });
  it('resolves ipfs/ar/http URIs and rejects unknown schemes', () => {
    expect(resolveAssetUri('ipfs://QmAbc/1.png')).toBe('https://ipfs.io/ipfs/QmAbc/1.png');
    expect(resolveAssetUri('ar://xyz')).toBe('https://arweave.net/xyz');
    expect(resolveAssetUri('https://cdn/x.png')).toBe('https://cdn/x.png');
    expect(resolveAssetUri('ftp://nope')).toBeNull();
  });
});

describe('Ethereum ERC-721 ownership', () => {
  it('returns owner match true / mismatch false', async () => {
    eth.ethCallOutcome.mockResolvedValue(ok(addrWord(HOLDER)));
    expect(await ownsNft(BAYC, '42', HOLDER)).toBe(true);
    expect(await ownsNft(BAYC, '42', '0x' + '2'.repeat(40), true)).toBe(false);
  });
  it('treats a revert as definite "not owned" (false), a transport error as unknown (null)', async () => {
    eth.ethCallOutcome.mockResolvedValue({ kind: 'reverted' });
    expect(await ownsNft(BAYC, '999', HOLDER)).toBe(false);
    eth.ethCallOutcome.mockResolvedValue({ kind: 'error' });
    expect(await ownsNft(BAYC, '7', HOLDER, true)).toBeNull();
  });
  it('rejects a non-numeric ETH token id', async () => {
    expect(await ownsNft(BAYC, 'abc', HOLDER)).toBe(false);
  });
});

describe('CryptoPunks ownership — native + wrapped', () => {
  it('reads the native holder via punkIndexToAddress', async () => {
    eth.ethCallOutcome.mockImplementation(async (to: string) =>
      to === CRYPTOPUNKS_NATIVE ? ok(addrWord(HOLDER)) : ok(addrWord('0x' + '9'.repeat(40))));
    expect(await ownsNft(PUNKS, '5', HOLDER)).toBe(true);
  });
  it('follows through to Wrapped Punks when the punk is wrapped', async () => {
    eth.ethCallOutcome.mockImplementation(async (to: string) => {
      if (to === CRYPTOPUNKS_NATIVE) return ok(addrWord(WRAPPED_PUNKS)); // held by the wrapper
      if (to === WRAPPED_PUNKS) return ok(addrWord(HOLDER));
      return { kind: 'error' };
    });
    expect(await ownsNft(PUNKS, '5', HOLDER)).toBe(true);
  });
  it('fails closed (null) when the native read errors', async () => {
    eth.ethCallOutcome.mockResolvedValue({ kind: 'error' });
    expect(await ownsNft(PUNKS, '5', HOLDER)).toBeNull();
  });
});

describe('Solana ownership via DAS', () => {
  it('matches owner only when the mint is in the allow-listed collection', async () => {
    das.dasGetAsset.mockResolvedValue({ ownership: { owner: SOL_OWNER }, grouping: [{ group_key: 'collection', group_value: SOL_COLLECTION }] });
    const ref: NftCollectionRef = { chain: 'solana', contract: SOL_COLLECTION, standard: 'solana' };
    expect(await ownsNft(ref, SOL_MINT, SOL_OWNER)).toBe(true);
    expect(await ownsNft(ref, SOL_MINT, 'Stake11111111111111111111111111111111111111', true)).toBe(false);
  });
  it('returns false when the asset belongs to a different collection', async () => {
    das.dasGetAsset.mockResolvedValue({ ownership: { owner: SOL_OWNER }, grouping: [{ group_key: 'collection', group_value: 'Other11111111111111111111111111111111111111' }] });
    const ref: NftCollectionRef = { chain: 'solana', contract: SOL_COLLECTION, standard: 'solana' };
    expect(await ownsNft(ref, SOL_MINT, SOL_OWNER)).toBe(false);
  });
  it('is unknown (null) when DAS is unconfigured or the read fails', async () => {
    das.solanaDasConfigured.mockReturnValue(false);
    const ref: NftCollectionRef = { chain: 'solana', contract: SOL_COLLECTION, standard: 'solana' };
    expect(await ownsNft(ref, SOL_MINT, SOL_OWNER)).toBeNull();
    das.solanaDasConfigured.mockReturnValue(true);
    das.dasGetAsset.mockResolvedValue(null);
    expect(await ownsNft(ref, SOL_MINT, SOL_OWNER, true)).toBeNull();
  });
  it('reports a burnt asset as not owned', async () => {
    das.dasGetAsset.mockResolvedValue({ burnt: true, ownership: { owner: SOL_OWNER }, grouping: [] });
    const ref: NftCollectionRef = { chain: 'solana', contract: SOL_COLLECTION, standard: 'solana' };
    expect(await ownsNft(ref, SOL_MINT, SOL_OWNER)).toBe(false);
  });
});

describe('ownership cache', () => {
  it('caches definite answers but never caches unknown', async () => {
    eth.ethCallOutcome.mockResolvedValueOnce(ok(addrWord(HOLDER)));
    expect((await nftOwnership(BAYC, '1')).kind).toBe('owner');
    expect((await nftOwnership(BAYC, '1')).kind).toBe('owner'); // served from cache, no 2nd RPC
    expect(eth.ethCallOutcome).toHaveBeenCalledTimes(1);

    eth.ethCallOutcome.mockResolvedValue({ kind: 'error' });
    expect((await nftOwnership(BAYC, '2')).kind).toBe('unknown');
    expect((await nftOwnership(BAYC, '2')).kind).toBe('unknown'); // not cached -> retried
    expect(eth.ethCallOutcome).toHaveBeenCalledTimes(3);
  });
});

describe('nftMetadata', () => {
  it('reads ETH tokenURI -> data: JSON attributes + image', async () => {
    const meta = { image: 'ipfs://QmImg/1.png', attributes: [{ trait_type: 'Fur', value: 'Solid Gold' }, { trait_type: 'Bad' }, { trait_type: 'N', value: 3 }] };
    const json = JSON.stringify(meta);
    const uri = `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
    const hex = Buffer.from(uri, 'utf8').toString('hex');
    const data = '0x' + (0x20).toString(16).padStart(64, '0') + uri.length.toString(16).padStart(64, '0') + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
    eth.ethCallOutcome.mockResolvedValue(ok(data));
    const out = await nftMetadata(BAYC, '1');
    expect(out?.image).toBe('https://ipfs.io/ipfs/QmImg/1.png');
    expect(out?.attributes).toEqual([{ trait_type: 'Fur', value: 'Solid Gold' }, { trait_type: 'N', value: '3' }]);
  });
  it('reads Solana attributes + image from DAS', async () => {
    das.dasGetAsset.mockResolvedValue({ content: { metadata: { attributes: [{ trait_type: 'Type', value: 'Alien' }] }, links: { image: 'https://cdn/x.png' } } });
    const out = await nftMetadata({ chain: 'solana', contract: SOL_COLLECTION, standard: 'solana' }, SOL_MINT);
    expect(out).toEqual({ attributes: [{ trait_type: 'Type', value: 'Alien' }], image: 'https://cdn/x.png', collection: SOL_COLLECTION });
  });
});
