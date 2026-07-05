// Dependency-free serializer for the one Solana transaction this client ever
// builds: the $WOC identity payment (burnChecked + optional transferChecked to
// the treasury + the quote memo). Hand-rolled legacy-format serialization so
// the game bundle does not carry @solana/web3.js; the server independently
// verifies the finalized result, so a malformed tx can only fail, never
// mis-pay. Pure module (no DOM, no network): tests decode the emitted bytes.
//
// Legacy wire format (see the Solana tx docs):
//   tx      = compact-u16 sig count, then 64-byte signatures, then message
//   message = header(3 bytes) + compact-u16 keys + 32-byte keys each
//           + 32-byte recent blockhash + compact-u16 instructions
//   ix      = program key index (u8) + compact-u16 account indices (u8 each)
//           + compact-u16 data length + data bytes
import bs58 from 'bs58';

export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// spl-token instruction tags (u8), from the SPL Token program's instruction enum.
const IX_TRANSFER_CHECKED = 12;
const IX_BURN_CHECKED = 15;

export interface WocPaymentTxInput {
  /** The paying wallet (fee payer, token owner, burn authority). Base58. */
  payer: string;
  /** The payer's $WOC token account (server-resolved). Base58. */
  payerTokenAccount: string;
  /** The $WOC mint. Base58. */
  mint: string;
  /** Mint decimals (burnChecked/transferChecked verify them on-chain). */
  decimals: number;
  /** Amount to burn, base units. */
  burnBase: bigint;
  /** Treasury's token account (base58) when a treasury split is configured. */
  treasuryTokenAccount: string | null;
  /** Amount to transfer to the treasury, base units. */
  treasuryBase: bigint;
  /** The quote id; carried verbatim as an SPL memo so the server can bind the payment. */
  memo: string;
  /** Recent blockhash (base58) fetched by the server pay-context endpoint. */
  recentBlockhash: string;
}

/** Compact-u16 (shortvec) encoding used throughout the legacy tx format. */
export function encodeCompactU16(n: number): number[] {
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

interface Ix {
  programIndex: number;
  accountIndices: number[];
  data: Uint8Array;
}

/**
 * Build the unsigned $WOC payment transaction: one required signature (the
 * payer) with a zeroed placeholder the wallet fills when it signs. The result
 * is what Wallet Standard's signAndSendTransaction expects as `transaction`.
 */
export function buildWocPaymentTx(input: WocPaymentTxInput): Uint8Array {
  if (input.burnBase <= 0n) throw new Error('burn amount must be positive');
  if (input.treasuryBase > 0n && !input.treasuryTokenAccount) {
    throw new Error('treasury split requires a treasury token account');
  }
  if (input.memo.length === 0 || input.memo.length > 566) throw new Error('bad memo length');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 18) {
    throw new Error('bad decimals');
  }

  // Account table order (legacy rules): writable signers, then writable
  // non-signers, then readonly non-signers. The payer is the fee payer and the
  // only signer; the token accounts + mint are written; the programs are read.
  const withTreasury = input.treasuryBase > 0n && !!input.treasuryTokenAccount;
  const keyLabels: [string, string][] = [
    ['payer', input.payer],
    ['payerTokenAccount', input.payerTokenAccount],
    ['mint', input.mint],
    ...(withTreasury
      ? ([['treasuryTokenAccount', input.treasuryTokenAccount as string]] as [string, string][])
      : []),
    ['tokenProgram', SPL_TOKEN_PROGRAM],
    ['memoProgram', MEMO_PROGRAM],
  ];
  const seen = new Set<string>();
  for (const [label, key] of keyLabels) {
    if (seen.has(key)) throw new Error(`duplicate account in payment tx (${label})`);
    seen.add(key);
  }
  const keys = keyLabels.map(([label, key]) => decodeKey(label, key));
  const index = new Map(keyLabels.map(([, key], i) => [key, i]));
  const at = (key: string): number => index.get(key) as number;

  const numRequiredSignatures = 1;
  const numReadonlySigned = 0;
  const numReadonlyUnsigned = 2; // the two programs

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

  // Unsigned envelope: one zeroed 64-byte signature slot for the payer.
  const tx = new Uint8Array(1 + 64 + message.length);
  tx[0] = 1; // compact-u16(1)
  tx.set(message, 1 + 64);
  return tx;
}
