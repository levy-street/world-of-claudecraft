// Solana Name Service subdomains under the project-owned parent domain
// (SNS_PARENT_DOMAIN, e.g. worldofclaudecraft.sol): the PURE half. Label
// slugification, SNS name-account key derivation (sha256 + the program-derived
// address off-curve walk), registry parsing, and the hand-rolled 2-signer
// legacy transaction that combines the player's $WOC burn with the subdomain
// create instruction, partial-signed by the execution wallet.
//
// No RPC, no DB, no HTTP here: every function is deterministic given its
// inputs, so tests drive it byte-for-byte (the IO shell is server/sns_chain.ts,
// mirroring the wallet_link.ts / wallet.ts split). Like the client serializer
// src/net/woc_tx.ts this deliberately avoids @solana/web3.js: the server
// independently verifies the finalized result, so a malformed tx can only
// fail, never mis-pay. The key derivation is pinned by the public
// bonfida.sol -> Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb vector in
// tests/sns.test.ts.
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { SNS_PARENT_DOMAIN } from './woc_config';

// The SPL Name Service program and the .sol TLD root registry it hangs off.
export const NAME_PROGRAM = 'namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX';
export const ROOT_DOMAIN_ACCOUNT = '58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx';
// System program id == the all-zero pubkey == the SDK's "default" placeholder
// for an unused name class / parent slot in the create instruction.
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const HASH_PREFIX = 'SPL Name Service';
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

// Registry header: parent(32) + owner(32) + class(32); data follows.
export const REGISTRY_HEADER_LEN = 96;
// On-chain space allocated for a subdomain registry's data (SDK default). The
// player pays rent for REGISTRY_HEADER_LEN + this.
export const SUBDOMAIN_SPACE = 2_000;

// The bare parent label without the trailing .sol (derivation hashes labels).
const PARENT_LABEL = SNS_PARENT_DOMAIN.replace(/\.sol$/i, '').trim();

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Reduce a chosen display name to a valid SNS subdomain label: lowercase
 * ASCII, punctuation and spaces collapsed to single hyphens, accents stripped,
 * at most 63 chars. Returns null when nothing valid remains.
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

/** The full subdomain string, e.g. `levy.worldofclaudecraft.sol`. */
export function fullSubdomain(label: string): string {
  return `${label}.${PARENT_LABEL}.sol`;
}

function sha256(...parts: (Uint8Array | string)[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

/** SNS name hash: sha256("SPL Name Service" + name). */
export function hashedName(name: string): Uint8Array {
  return sha256(HASH_PREFIX + name);
}

// A candidate program-derived address must NOT be a valid ed25519 point.
function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodeKey(label: string, base58: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(base58);
  } catch {
    throw new Error(`${label} is not valid base58`);
  }
  if (bytes.length !== 32) throw new Error(`${label} must decode to 32 bytes`);
  return bytes;
}

/** Solana findProgramAddress: walk the bump down to the first off-curve hash. */
export function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  const program = decodeKey('programId', programId);
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = sha256(...seeds, new Uint8Array([bump]), program, PDA_MARKER);
    if (!isOnCurve(candidate)) return bs58.encode(candidate);
  }
  throw new Error('no viable program-derived address bump');
}

const ZERO32 = new Uint8Array(32);

/** SNS name-account key for a hashed name under an optional parent registry. */
export function nameAccountKey(hashed: Uint8Array, parent: string | null): string {
  const parentBytes = parent ? decodeKey('parent', parent) : ZERO32;
  return findProgramAddress([hashed, ZERO32, parentBytes], NAME_PROGRAM);
}

/**
 * The registry key of any `.sol` domain or subdomain (`x.sol` or `a.x.sol`).
 * Subdomain labels hash with the SNS "\0" prefix under their parent's key.
 */
export function domainKey(domain: string): string {
  const parts = domain
    .toLowerCase()
    .replace(/\.sol$/i, '')
    .split('.');
  if (parts.length === 1) return nameAccountKey(hashedName(parts[0]), ROOT_DOMAIN_ACCOUNT);
  if (parts.length === 2) {
    const parent = nameAccountKey(hashedName(parts[1]), ROOT_DOMAIN_ACCOUNT);
    return nameAccountKey(hashedName(`\0${parts[0]}`), parent);
  }
  throw new Error('unsupported domain depth');
}

/** The registry key of the configured parent domain. */
export function parentDomainKey(): string {
  return domainKey(`${PARENT_LABEL}.sol`);
}

/** The registry key of `label` under the configured parent domain. */
export function subdomainKey(label: string): string {
  return domainKey(fullSubdomain(label));
}

/**
 * The owner pubkey (base58) out of raw name-registry account data, or null
 * when the buffer is not a plausible registry.
 */
export function parseRegistryOwner(data: Uint8Array): string | null {
  if (data.length < REGISTRY_HEADER_LEN) return null;
  return bs58.encode(data.subarray(32, 64));
}

export interface SnsKeypair {
  publicKey: string;
  seed: Uint8Array;
}

/**
 * An ed25519 keypair from a base58 secret: either the 64-byte Solana keypair
 * format (seed + pubkey) or a bare 32-byte seed.
 */
export function keypairFromSecret(secretBase58: string): SnsKeypair {
  const bytes = bs58.decode(secretBase58);
  if (bytes.length === 64) {
    const seed = bytes.subarray(0, 32);
    const publicKey = bs58.encode(ed25519.getPublicKey(seed));
    const embedded = bs58.encode(bytes.subarray(32, 64));
    if (publicKey !== embedded) throw new Error('execution wallet secret is inconsistent');
    return { publicKey, seed };
  }
  if (bytes.length === 32) {
    return { publicKey: bs58.encode(ed25519.getPublicKey(bytes)), seed: bytes };
  }
  throw new Error('execution wallet secret must be a 32 or 64 byte base58 key');
}

// ── The burn + subdomain-create transaction ─────────────────────────────────

// spl-token instruction tags.
const IX_TRANSFER_CHECKED = 12;
const IX_BURN_CHECKED = 15;
// SPL Name Service instruction tag.
const IX_NAME_CREATE = 0;

/** Compact-u16 (shortvec) encoding used throughout the legacy tx format. */
function encodeCompactU16(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`bad compact-u16 value: ${n}`);
  const out: number[] = [];
  let rem = n;
  for (;;) {
    let byte = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      out.push(byte);
      return out;
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function u64le(value: bigint): number[] {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error('amount out of u64 range');
  const out: number[] = [];
  let rem = value;
  for (let i = 0; i < 8; i++) {
    out.push(Number(rem & 0xffn));
    rem >>= 8n;
  }
  return out;
}

function u32le(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('value out of u32 range');
  }
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

export interface SubdomainMintTxInput {
  /** The paying player (fee payer, token owner, burn authority, and the new subdomain owner). */
  payer: string;
  /** The player's $WOC token account (server-resolved). */
  payerTokenAccount: string;
  /** The $WOC mint. */
  mint: string;
  /** Mint decimals (burnChecked/transferChecked verify them on-chain). */
  decimals: number;
  /** Amount to burn, base units. */
  burnBase: bigint;
  /** Treasury's token account when a treasury split is configured. */
  treasuryTokenAccount: string | null;
  /** Amount to transfer to the treasury, base units. */
  treasuryBase: bigint;
  /** The quote id, carried verbatim as an SPL memo binding payment to quote. */
  memo: string;
  /** Recent finalized blockhash (base58). */
  recentBlockhash: string;
  /** The validated subdomain label to create under the parent domain. */
  label: string;
  /** Rent-exempt lamports for REGISTRY_HEADER_LEN + space (RPC-resolved). */
  rentLamports: bigint;
  /** Registry data space to allocate. */
  space: number;
  /** The execution wallet (parent-domain owner) that co-signs the create. */
  executionSecret: string;
}

interface Ix {
  programIndex: number;
  accountIndices: number[];
  data: Uint8Array;
}

/**
 * Build the atomic "burn $WOC and mint a player-owned subdomain" transaction:
 * burnChecked + optional treasury transferChecked + quote memo + the SNS
 * create instruction (player pays rent and OWNS the new registry; the
 * execution wallet authorizes creation under the parent domain). Two required
 * signatures: slot 0 (the player / fee payer) is left zeroed for the wallet,
 * slot 1 is filled here with the execution wallet's signature. Either the
 * whole transaction lands (burn AND mint) or none of it does.
 */
export function buildSubdomainMintTx(input: SubdomainMintTxInput): Uint8Array {
  if (input.burnBase <= 0n) throw new Error('burn amount must be positive');
  if (input.treasuryBase > 0n && !input.treasuryTokenAccount) {
    throw new Error('treasury split requires a treasury token account');
  }
  if (input.memo.length === 0 || input.memo.length > 566) throw new Error('bad memo length');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 18) {
    throw new Error('bad decimals');
  }
  if (slugifyLabel(input.label) !== input.label) throw new Error('bad subdomain label');
  if (input.rentLamports <= 0n) throw new Error('rent lamports must be positive');

  const exec = keypairFromSecret(input.executionSecret);
  const nameAccount = subdomainKey(input.label);
  const parentAccount = parentDomainKey();

  // Account table, legacy order: writable signers, readonly signers, writable
  // non-signers, readonly non-signers.
  const withTreasury = input.treasuryBase > 0n && !!input.treasuryTokenAccount;
  const writableSigners: [string, string][] = [['payer', input.payer]];
  const readonlySigners: [string, string][] = [['executionWallet', exec.publicKey]];
  const writableNonSigners: [string, string][] = [
    ['payerTokenAccount', input.payerTokenAccount],
    ['mint', input.mint],
    ['nameAccount', nameAccount],
    ...(withTreasury
      ? ([['treasuryTokenAccount', input.treasuryTokenAccount as string]] as [string, string][])
      : []),
  ];
  const readonlyNonSigners: [string, string][] = [
    ['systemProgram', SYSTEM_PROGRAM],
    ['parentNameAccount', parentAccount],
    ['tokenProgram', SPL_TOKEN_PROGRAM],
    ['memoProgram', MEMO_PROGRAM],
    ['nameProgram', NAME_PROGRAM],
  ];
  const keyLabels = [
    ...writableSigners,
    ...readonlySigners,
    ...writableNonSigners,
    ...readonlyNonSigners,
  ];
  const seen = new Set<string>();
  for (const [label, key] of keyLabels) {
    if (seen.has(key)) throw new Error(`duplicate account in subdomain mint tx (${label})`);
    seen.add(key);
  }
  const keys = keyLabels.map(([label, key]) => decodeKey(label, key));
  const index = new Map(keyLabels.map(([, key], i) => [key, i]));
  const at = (key: string): number => index.get(key) as number;

  const numRequiredSignatures = 2;
  const numReadonlySigned = 1;
  const numReadonlyUnsigned = readonlyNonSigners.length;

  const ixs: Ix[] = [];
  // burnChecked: [account, mint, authority]
  ixs.push({
    programIndex: at(SPL_TOKEN_PROGRAM),
    accountIndices: [at(input.payerTokenAccount), at(input.mint), at(input.payer)],
    data: Uint8Array.from([IX_BURN_CHECKED, ...u64le(input.burnBase), input.decimals]),
  });
  if (withTreasury) {
    // transferChecked: [source, mint, destination, authority]
    ixs.push({
      programIndex: at(SPL_TOKEN_PROGRAM),
      accountIndices: [
        at(input.payerTokenAccount),
        at(input.mint),
        at(input.treasuryTokenAccount as string),
        at(input.payer),
      ],
      data: Uint8Array.from([IX_TRANSFER_CHECKED, ...u64le(input.treasuryBase), input.decimals]),
    });
  }
  ixs.push({
    programIndex: at(MEMO_PROGRAM),
    accountIndices: [],
    data: new TextEncoder().encode(input.memo),
  });
  // SNS create: [system, payer, name, owner, class(default), parent, parentOwner].
  // The player is both payer and owner; the unused name class rides the default
  // (all-zero) key, which is the system program id. Data: tag u8 + hashed-name
  // Vec<u8> (u32 length + bytes) + lamports u64 + space u32.
  const hashed = hashedName(`\0${input.label}`);
  ixs.push({
    programIndex: at(NAME_PROGRAM),
    accountIndices: [
      at(SYSTEM_PROGRAM),
      at(input.payer),
      at(nameAccount),
      at(input.payer),
      at(SYSTEM_PROGRAM),
      at(parentAccount),
      at(exec.publicKey),
    ],
    data: Uint8Array.from([
      IX_NAME_CREATE,
      ...u32le(hashed.length),
      ...hashed,
      ...u64le(input.rentLamports),
      ...u32le(input.space),
    ]),
  });

  const message: number[] = [numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned];
  message.push(...encodeCompactU16(keys.length));
  for (const key of keys) message.push(...key);
  message.push(...decodeKey('recentBlockhash', input.recentBlockhash));
  message.push(...encodeCompactU16(ixs.length));
  for (const ix of ixs) {
    message.push(ix.programIndex);
    message.push(...encodeCompactU16(ix.accountIndices.length));
    message.push(...ix.accountIndices);
    message.push(...encodeCompactU16(ix.data.length));
    message.push(...ix.data);
  }

  // Envelope: two 64-byte signature slots. Slot 0 (payer) stays zeroed for the
  // player's wallet; slot 1 is the execution wallet's signature over the message.
  const messageBytes = Uint8Array.from(message);
  const execSignature = ed25519.sign(messageBytes, exec.seed);
  const tx = new Uint8Array(1 + 64 * 2 + messageBytes.length);
  tx[0] = 2; // compact-u16(2)
  tx.set(execSignature, 1 + 64);
  tx.set(messageBytes, 1 + 64 * 2);
  return tx;
}
