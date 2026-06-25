// Pure (IO-free) helpers for non-custodial Ethereum/EVM wallet linking: address
// validation + EIP-55 checksum, the EIP-4361 (Sign-In-with-Ethereum) challenge
// message, and EIP-191 `personal_sign` signature recovery for externally-owned
// accounts. Kept separate from server/wallet_evm.ts (which does DB + HTTP and the
// EIP-1271 smart-contract-wallet branch that needs an `eth_call`) so the crypto is
// unit-testable without a database or RPC.
//
// This mirrors server/wallet_link.ts (the Solana ed25519 equivalent): the server
// picks the exact message, stores it, and verifies a single-use signature over it.
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';

// A 20-byte hex address with the 0x prefix. Casing is not validated here (we
// store lower-cased and compare case-insensitively); checksum is a render concern.
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True for a syntactically valid 0x-prefixed 20-byte EVM address. */
export function isEvmAddress(s: unknown): s is string {
  return typeof s === 'string' && EVM_ADDRESS.test(s);
}

/** Canonical storage form: lower-cased 0x address. Caller must pass a valid one. */
export function normalizeEvmAddress(s: string): string {
  return s.toLowerCase();
}

/** EIP-55 mixed-case checksum address (the form wallets display). */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i];
  }
  return out;
}

/**
 * The exact EIP-4361 (Sign-In-with-Ethereum) message the wallet is asked to sign.
 * The line order and blank lines are load-bearing for SIWE-aware wallets; the
 * server stores this verbatim and recovers the signer over it, so a client can
 * never choose what gets signed. The address is rendered EIP-55 checksummed (the
 * spec requires it) but verification is case-insensitive.
 */
export function buildEvmLinkMessage(opts: {
  domain: string;
  uri: string;
  accountId: number;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${opts.domain} wants you to sign in with your Ethereum account:`,
    toChecksumAddress(opts.address),
    '',
    `Link this wallet to World of ClaudeCraft account #${opts.accountId}. Signing is free, proves you control this wallet, and authorizes no transaction.`,
    '',
    `URI: ${opts.uri}`,
    'Version: 1',
    `Chain ID: ${opts.chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
    `Expiration Time: ${opts.expiresAt}`,
  ].join('\n');
}

/** The EIP-191 `personal_sign` digest: keccak256 over the prefixed preimage. */
export function personalSignDigest(message: string): Uint8Array {
  const body = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak_256(concatBytes(prefix, body));
}

/**
 * Recover the signer address (lower-cased 0x) from an EIP-191 `personal_sign`
 * signature over `message`, or null if the signature is malformed. secp256k1
 * throws on out-of-range points / bad recovery ids, and the input is
 * attacker-controlled, so the recovery is wrapped: a garbage signature must read
 * as "no signer", never crash the request. Only externally-owned accounts (EOAs)
 * recover this way; smart-contract wallets are handled by the EIP-1271 path in
 * server/wallet_evm.ts.
 */
export function recoverEvmSigner(message: string, signatureHex: string): string | null {
  const hex = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (hex.length !== 130 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const sig = hexToBytes(hex);
  // v is 27/28 (or the legacy 0/1). Anything else is not a recoverable EOA sig.
  const v = sig[64]!;
  const recovery = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1;
  if (recovery < 0) return null;
  try {
    const digest = personalSignDigest(message);
    const point = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(digest);
    const pub = point.toRawBytes(false); // 65 bytes: 0x04 || X || Y
    return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
  } catch {
    return null;
  }
}

/**
 * Verify that `signatureHex` is a valid EIP-191 EOA signature of `message` by
 * `address` (any casing). Returns false on any malformation. This does NOT cover
 * EIP-1271 smart-contract wallets; the shell falls through to an on-chain
 * `isValidSignature` check when this returns false and the address has code.
 */
export function verifyEvmEoaSignature(message: string, signatureHex: string, address: string): boolean {
  if (!isEvmAddress(address)) return false;
  const signer = recoverEvmSigner(message, signatureHex);
  return signer !== null && signer === normalizeEvmAddress(address);
}

// --- EIP-1271 (smart-contract wallet) magic value + calldata --------------------

/** The success return of EIP-1271 `isValidSignature(bytes32,bytes)`. */
export const EIP1271_MAGIC_VALUE = '0x1626ba7e';

/**
 * ABI-encode an `isValidSignature(bytes32 hash, bytes signature)` call. Pure so
 * the shell can hand the calldata to its `eth_call`. `hash` is the 32-byte
 * personal_sign digest; `signature` is the raw 65-byte sig the wallet returned.
 */
export function encodeIsValidSignatureCall(digest: Uint8Array, signatureHex: string): string {
  const selector = bytesToHex(keccak_256(utf8ToBytes('isValidSignature(bytes32,bytes)')).slice(0, 4));
  const sigHex = (signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex).toLowerCase();
  const sigBytes = sigHex.length / 2;
  const word = (hex: string): string => hex.padStart(64, '0');
  // head: hash (32), offset to the bytes arg (0x40). tail: length + right-padded data.
  const head = word(bytesToHex(digest)) + word((0x40).toString(16));
  const padded = sigHex + '0'.repeat((64 - (sigHex.length % 64)) % 64);
  const tail = word(sigBytes.toString(16)) + padded;
  return `0x${selector}${head}${tail}`;
}

/** True when an `eth_call` to `isValidSignature` returned the EIP-1271 magic value
 *  in its first 32-byte word (the value is left-aligned in the bytes4 return). */
export function isEip1271Valid(callResult: string | null): boolean {
  if (!callResult) return false;
  const hex = callResult.startsWith('0x') ? callResult.slice(2) : callResult;
  if (hex.length < 8) return false;
  return `0x${hex.slice(0, 8).toLowerCase()}` === EIP1271_MAGIC_VALUE;
}
