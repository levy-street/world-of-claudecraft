import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedPositiveTokenMintAddresses,
  decodeSeekerGenesisMint,
  findSeekerGenesisToken,
  findSeekerGenesisTokens,
  MAX_SEEKER_TOKEN_ACCOUNTS,
  MAX_SEEKER_TOKEN_MINTS,
  positiveTokenMintAddresses,
} from '../server/seeker_genesis_token_rpc';

const mint = 'So11111111111111111111111111111111111111112';
const mintAuthority = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4';
const metadataAddress = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
const token2022Program = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function account(mintAddress: unknown, amount: unknown) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            mint: mintAddress,
            tokenAmount: { amount },
          },
        },
      },
    },
  };
}

function mintAddress(index: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = index & 0xff;
  bytes[1] = (index >> 8) & 0xff;
  bytes[31] = 1;
  return bs58.encode(bytes);
}

function extension(type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

function seekerMintData(address = mint): Buffer {
  const base = Buffer.alloc(166);
  base.writeUInt32LE(1, 0);
  Buffer.from(bs58.decode(mintAuthority)).copy(base, 4);
  base[45] = 1;
  base[165] = 1;

  const metadataPointer = Buffer.concat([
    Buffer.from(bs58.decode(mintAuthority)),
    Buffer.from(bs58.decode(metadataAddress)),
  ]);
  const groupMember = Buffer.concat([
    Buffer.from(bs58.decode(address)),
    Buffer.from(bs58.decode(metadataAddress)),
    Buffer.alloc(8),
  ]);
  return Buffer.concat([base, extension(18, metadataPointer), extension(23, groupMember)]);
}

function rpcMintAccount(data = seekerMintData()) {
  return {
    data: [data.toString('base64'), 'base64'],
    executable: false,
    lamports: 1,
    owner: token2022Program,
    rentEpoch: 1,
  };
}

describe('Seeker token-account RPC parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the provider-neutral Solana RPC configured for existing chain reads', () => {
    const source = readFileSync('server/seeker_genesis_token_rpc.ts', 'utf8');
    expect(source).toContain('process.env.SOLANA_RPC_URL');
    expect(source).toContain('getTokenAccountsByOwner');
    expect(source).not.toContain('HELIUS_RPC_URL');
    expect(source).not.toContain('getTokenAccountsByOwnerV2');
    expect(source).not.toContain('@solana/');
    expect(source).not.toContain('response.json()');
  });

  it('keeps unique positive Token-2022 balances only', () => {
    expect(
      positiveTokenMintAddresses([
        account(mint, '1'),
        account(mint, '2'),
        account(mint, '0'),
        account('invalid', '1'),
        account(mint, '-1'),
        account(mint, 1),
        null,
      ]),
    ).toEqual([mint]);
  });

  it('fails closed for malformed response shapes', () => {
    expect(positiveTokenMintAddresses(null)).toEqual([]);
    expect(positiveTokenMintAddresses({ accounts: [] })).toEqual([]);
    expect(positiveTokenMintAddresses([{}, account(mint, 'not-a-number')])).toEqual([]);
  });

  it('accepts responses at the account and unique-mint bounds', () => {
    const accounts = Array.from({ length: MAX_SEEKER_TOKEN_ACCOUNTS }, (_, index) =>
      account(mintAddress(index % MAX_SEEKER_TOKEN_MINTS), '1'),
    );
    expect(boundedPositiveTokenMintAddresses(accounts)).toHaveLength(MAX_SEEKER_TOKEN_MINTS);
  });

  it('fails closed when the token-account response exceeds its bound', () => {
    const accounts = Array.from({ length: MAX_SEEKER_TOKEN_ACCOUNTS + 1 }, () =>
      account(mint, '1'),
    );
    expect(boundedPositiveTokenMintAddresses(accounts)).toBeNull();
  });

  it('fails closed when unique positive mints exceed their bound', () => {
    const accounts = Array.from({ length: MAX_SEEKER_TOKEN_MINTS + 1 }, (_, index) =>
      account(mintAddress(index), '1'),
    );
    expect(boundedPositiveTokenMintAddresses(accounts)).toBeNull();
  });

  it('decodes the required Token-2022 mint extensions without a transaction SDK', () => {
    expect(decodeSeekerGenesisMint(mint, rpcMintAccount())).toBe(true);
  });

  it('rejects a mint account owned by another program', () => {
    expect(
      decodeSeekerGenesisMint(mint, {
        ...rpcMintAccount(),
        owner: '11111111111111111111111111111111',
      }),
    ).toBe(false);
  });

  it('rejects a group-member extension that names another mint', () => {
    expect(decodeSeekerGenesisMint(mint, rpcMintAccount(seekerMintData(mintAddress(7))))).toBe(
      false,
    );
  });

  it('rejects truncated and malformed TLV data', () => {
    expect(decodeSeekerGenesisMint(mint, rpcMintAccount(Buffer.alloc(165)))).toBe(false);
    expect(decodeSeekerGenesisMint(mint, rpcMintAccount(seekerMintData().subarray(0, -1)))).toBe(
      false,
    );
  });

  it('uses only the two read-only JSON-RPC methods to verify ownership', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { context: { slot: 42 }, value: [account(mint, '1')] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { value: [rpcMintAccount()] },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(findSeekerGenesisToken(mint, 'https://rpc.invalid')).resolves.toEqual({
      mint,
      slot: 42,
    });
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method)).toEqual([
      'getTokenAccountsByOwner',
      'getMultipleAccounts',
    ]);
  });

  it('returns every verified SGT in deterministic order when RPC order changes', async () => {
    const firstMint = mintAddress(7);
    const secondMint = mintAddress(8);
    const expectedMints = [firstMint, secondMint].sort();

    async function findFrom(accounts: unknown[]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: { context: { slot: 42 }, value: accounts },
            }),
          ),
        )
        .mockImplementationOnce(async (_url, init) => {
          const requested = JSON.parse(String(init?.body)).params[0] as string[];
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                value: requested.map((address) => rpcMintAccount(seekerMintData(address))),
              },
            }),
          );
        });
      vi.stubGlobal('fetch', fetchMock);
      return findSeekerGenesisTokens(mint, 'https://rpc.invalid');
    }

    const expected = expectedMints.map((address) => ({ mint: address, slot: 42 }));
    await expect(findFrom([account(firstMint, '1'), account(secondMint, '1')])).resolves.toEqual(
      expected,
    );
    await expect(findFrom([account(secondMint, '1'), account(firstMint, '1')])).resolves.toEqual(
      expected,
    );
  });

  it('verifies only the required persisted SGT when a wallet owns multiple SGTs', async () => {
    const claimedMint = mintAddress(7);
    const otherMint = mintAddress(8);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              context: { slot: 42 },
              value: [account(otherMint, '1'), account(claimedMint, '1')],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { value: [rpcMintAccount(seekerMintData(claimedMint))] },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      findSeekerGenesisToken(mint, 'https://rpc.invalid', undefined, claimedMint),
    ).resolves.toEqual({ mint: claimedMint, slot: 42 });
    const mintLookup = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(mintLookup.params[0]).toEqual([claimedMint]);
  });

  it('fails closed when the RPC returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600 } })),
        ),
    );
    await expect(findSeekerGenesisToken(mint, 'https://rpc.invalid')).resolves.toBeNull();
  });
});
