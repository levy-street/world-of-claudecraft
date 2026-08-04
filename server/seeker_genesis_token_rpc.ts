import bs58 from 'bs58';
import { MAX_SEEKER_TOKEN_ACCOUNTS, MAX_SEEKER_TOKEN_MINTS } from './seeker_entitlement_limits';
import {
  isSeekerGenesisToken,
  SEEKER_GENESIS_TOKEN_GROUP_ADDRESS,
  SEEKER_GENESIS_TOKEN_METADATA_ADDRESS,
  SEEKER_GENESIS_TOKEN_MINT_AUTHORITY,
} from './seeker_genesis_token';
import { seekerRpcResult } from './seeker_rpc_transport';

const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT_BASE_SIZE = 82;
const TOKEN_ACCOUNT_BASE_SIZE = 165;
const MINT_ACCOUNT_TYPE = 1;
const METADATA_POINTER_EXTENSION = 18;
const TOKEN_GROUP_MEMBER_EXTENSION = 23;
const METADATA_POINTER_SIZE = 64;
const TOKEN_GROUP_MEMBER_SIZE = 72;
const MAX_MINT_ACCOUNT_BYTES = 16 * 1024;
const MINT_BATCH_SIZE = 100;

export { MAX_SEEKER_TOKEN_ACCOUNTS, MAX_SEEKER_TOKEN_MINTS } from './seeker_entitlement_limits';

interface ParsedTokenAccount {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: unknown;
          tokenAmount?: { amount?: unknown };
        };
      };
    };
  };
}

interface RpcAccountInfo {
  data?: unknown;
  owner?: unknown;
}

interface TokenAccountsResult {
  context?: { slot?: unknown };
  value?: unknown;
}

interface MultipleAccountsResult {
  value?: unknown;
}

export interface VerifiedSeekerGenesisToken {
  mint: string;
  slot: number | null;
}

function canonicalPublicKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const bytes = bs58.decode(value);
    return bytes.length === 32 ? bs58.encode(bytes) : null;
  } catch {
    return null;
  }
}

function publicKeyAt(data: Buffer, offset: number): string | null {
  if (offset < 0 || offset + 32 > data.length) return null;
  return bs58.encode(data.subarray(offset, offset + 32));
}

function extensionData(tlv: Buffer, wantedType: number): Buffer | null {
  let offset = 0;
  while (offset + 4 <= tlv.length) {
    const type = tlv.readUInt16LE(offset);
    const length = tlv.readUInt16LE(offset + 2);
    const dataOffset = offset + 4;
    const nextOffset = dataOffset + length;
    if (nextOffset > tlv.length) return null;
    if (type === wantedType) return tlv.subarray(dataOffset, nextOffset);
    offset = nextOffset;
  }
  return null;
}

function accountData(account: RpcAccountInfo): Buffer | null {
  if (!Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== 'base64') {
    return null;
  }
  const encoded = account.data[0];
  if (typeof encoded !== 'string' || encoded.length > MAX_MINT_ACCOUNT_BYTES * 2) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length > MAX_MINT_ACCOUNT_BYTES || decoded.toString('base64') !== encoded) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function decodeSeekerGenesisMint(mintAddress: string, value: unknown): boolean {
  const canonicalMint = canonicalPublicKey(mintAddress);
  if (!canonicalMint || !value || typeof value !== 'object') return false;
  const account = value as RpcAccountInfo;
  if (account.owner !== TOKEN_2022_PROGRAM_ID) return false;
  const data = accountData(account);
  if (
    !data ||
    data.length <= TOKEN_ACCOUNT_BASE_SIZE ||
    data.length < MINT_BASE_SIZE ||
    data[TOKEN_ACCOUNT_BASE_SIZE] !== MINT_ACCOUNT_TYPE
  ) {
    return false;
  }

  const mintAuthorityOption = data.readUInt32LE(0);
  if (mintAuthorityOption !== 0 && mintAuthorityOption !== 1) return false;
  const mintAuthority = mintAuthorityOption === 1 ? publicKeyAt(data, 4) : null;
  const tlv = data.subarray(TOKEN_ACCOUNT_BASE_SIZE + 1);
  const metadata = extensionData(tlv, METADATA_POINTER_EXTENSION);
  const member = extensionData(tlv, TOKEN_GROUP_MEMBER_EXTENSION);
  if (
    !metadata ||
    metadata.length !== METADATA_POINTER_SIZE ||
    !member ||
    member.length !== TOKEN_GROUP_MEMBER_SIZE
  ) {
    return false;
  }

  const memberMint = publicKeyAt(member, 0);
  if (memberMint !== canonicalMint) return false;
  return isSeekerGenesisToken({
    mintAddress: canonicalMint,
    ownerAmount: '1',
    mintAuthority,
    metadataPointerAuthority: publicKeyAt(metadata, 0),
    metadataAddress: publicKeyAt(metadata, 32),
    groupAddress: publicKeyAt(member, 32),
  });
}

export function positiveTokenMintAddresses(accounts: unknown): string[] {
  if (!Array.isArray(accounts)) return [];
  const unique = new Set<string>();
  for (const value of accounts) {
    if (!value || typeof value !== 'object') continue;
    const account = value as ParsedTokenAccount;
    const info = account.account?.data?.parsed?.info;
    if (typeof info?.mint !== 'string' || typeof info.tokenAmount?.amount !== 'string') continue;
    if (!/^\d+$/.test(info.tokenAmount.amount) || BigInt(info.tokenAmount.amount) <= 0n) continue;
    const mint = canonicalPublicKey(info.mint);
    if (mint) unique.add(mint);
  }
  return [...unique];
}

export function boundedPositiveTokenMintAddresses(accounts: unknown): string[] | null {
  if (!Array.isArray(accounts) || accounts.length > MAX_SEEKER_TOKEN_ACCOUNTS) return null;
  const mints = positiveTokenMintAddresses(accounts);
  return mints.length <= MAX_SEEKER_TOKEN_MINTS ? mints : null;
}

export async function findSeekerGenesisTokens(
  walletAddress: string,
  rpcUrl = process.env.SOLANA_RPC_URL ?? '',
  signal?: AbortSignal,
  requiredMint?: string,
): Promise<VerifiedSeekerGenesisToken[] | null> {
  const owner = canonicalPublicKey(walletAddress);
  const canonicalRequiredMint =
    requiredMint === undefined ? undefined : canonicalPublicKey(requiredMint);
  if (!rpcUrl || !owner || (requiredMint !== undefined && !canonicalRequiredMint)) return null;

  let mints: string[];
  let slot: number | null;
  try {
    const result = (await seekerRpcResult(
      rpcUrl,
      'getTokenAccountsByOwner',
      [
        owner,
        { programId: TOKEN_2022_PROGRAM_ID },
        { commitment: 'confirmed', encoding: 'jsonParsed' },
      ],
      signal,
    )) as TokenAccountsResult;
    const addresses = boundedPositiveTokenMintAddresses(result?.value);
    if (!addresses) return null;
    if (canonicalRequiredMint) {
      if (!addresses.includes(canonicalRequiredMint)) return null;
      mints = [canonicalRequiredMint];
    } else {
      mints = [...addresses].sort();
    }
    slot = Number.isSafeInteger(result?.context?.slot) ? (result.context?.slot as number) : null;
  } catch {
    return null;
  }

  const verified: VerifiedSeekerGenesisToken[] = [];
  for (let offset = 0; offset < mints.length; offset += MINT_BATCH_SIZE) {
    const batch = mints.slice(offset, offset + MINT_BATCH_SIZE);
    try {
      const result = (await seekerRpcResult(
        rpcUrl,
        'getMultipleAccounts',
        [batch, { commitment: 'confirmed', encoding: 'base64' }],
        signal,
      )) as MultipleAccountsResult;
      if (!Array.isArray(result?.value) || result.value.length !== batch.length) return null;
      for (let i = 0; i < batch.length; i++) {
        const mint = batch[i];
        if (mint && decodeSeekerGenesisMint(mint, result.value[i])) verified.push({ mint, slot });
      }
    } catch {
      return null;
    }
  }
  return verified;
}

export async function findSeekerGenesisToken(
  walletAddress: string,
  rpcUrl = process.env.SOLANA_RPC_URL ?? '',
  signal?: AbortSignal,
  requiredMint?: string,
): Promise<VerifiedSeekerGenesisToken | null> {
  const tokens = await findSeekerGenesisTokens(walletAddress, rpcUrl, signal, requiredMint);
  return tokens?.[0] ?? null;
}

export const seekerGenesisTokenIdentity = {
  mintAuthority: SEEKER_GENESIS_TOKEN_MINT_AUTHORITY,
  metadataAddress: SEEKER_GENESIS_TOKEN_METADATA_ADDRESS,
  groupAddress: SEEKER_GENESIS_TOKEN_GROUP_ADDRESS,
} as const;
