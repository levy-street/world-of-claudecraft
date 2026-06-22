// Server-side client for the deployed woc_escrow Anchor program (devnet program
// Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ). Covers the #478 1v1 match-pot
// instructions; the encoders are pure (TransactionInstruction in, no I/O) so the
// wire format is unit-tested against the program's #[derive(Accounts)] structs.
//
// Anchor-compatible without an IDL: the 8-byte discriminator is
// sha256("global:<ix>")[:8], args are borsh, and each account list matches
// lib.rs exactly (order, signer, writable). Match PDA = ["match", match_id u64
// le]; the pot vault is the ATA of that PDA. Distribution (#480) encoders are
// intentionally omitted until the on-chain payout path has a server caller.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { SPL_TOKEN_PROGRAM } from './solana_rpc';

export const TOKEN_PROGRAM_ID = new PublicKey(SPL_TOKEN_PROGRAM);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ----- encoding primitives -----

const disc = (name: string): Buffer => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const acc = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

// ----- PDAs -----

/** Associated token account address for `owner` holding `mint` (canonical ATA). */
export function vaultAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
/** The match-pot PDA for `matchId` (seeds: "match" + u64 le). */
export function matchPda(programId: PublicKey, matchId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('match'), u64(matchId)], programId)[0];
}

// ----- match instructions (#478) -----

export interface OpenMatchParams {
  programId: PublicKey;
  mint: PublicKey;
  matchId: bigint;
  stakeBase: bigint;
  rakeBps: number;
  creator: PublicKey; // signs; stakes from their ATA
  settler: PublicKey; // the only key that can later report the winner
}
export function openMatchIx(p: OpenMatchParams): TransactionInstruction {
  const match = matchPda(p.programId, p.matchId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.creator, true, true),
      acc(match, false, true),
      acc(p.mint, false, false),
      acc(vaultAta(match, p.mint), false, true),
      acc(vaultAta(p.creator, p.mint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
      acc(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
      acc(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([disc('open_match'), u64(p.matchId), u64(p.stakeBase), u16(p.rakeBps), p.settler.toBuffer()]),
  });
}

export interface JoinMatchParams {
  programId: PublicKey;
  mint: PublicKey;
  matchId: bigint;
  opponent: PublicKey; // signs; matches the stake from their ATA
}
export function joinMatchIx(p: JoinMatchParams): TransactionInstruction {
  const match = matchPda(p.programId, p.matchId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.opponent, true, true),
      acc(match, false, true),
      acc(vaultAta(match, p.mint), false, true),
      acc(vaultAta(p.opponent, p.mint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('join_match'), u64(p.matchId)]),
  });
}

export interface SettleMatchParams {
  programId: PublicKey;
  mint: PublicKey;
  matchId: bigint;
  settler: PublicKey; // signs
  creator: PublicKey; // rent destination, pinned on-chain to match.creator
  winner: PublicKey; // wallet of the winning player (must be creator or opponent)
}
export function settleMatchIx(p: SettleMatchParams): TransactionInstruction {
  const match = matchPda(p.programId, p.matchId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.settler, true, true),
      acc(p.creator, false, true),
      acc(match, false, true),
      acc(p.mint, false, true),
      acc(vaultAta(match, p.mint), false, true),
      acc(vaultAta(p.winner, p.mint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('settle_match'), u64(p.matchId)]),
  });
}

export interface CancelMatchParams {
  programId: PublicKey;
  mint: PublicKey;
  matchId: bigint;
  creator: PublicKey; // signs; refunded
}
export function cancelMatchIx(p: CancelMatchParams): TransactionInstruction {
  const match = matchPda(p.programId, p.matchId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.creator, true, true),
      acc(match, false, true),
      acc(vaultAta(match, p.mint), false, true),
      acc(vaultAta(p.creator, p.mint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('cancel_match'), u64(p.matchId)]),
  });
}

export interface RefundMatchParams {
  programId: PublicKey;
  mint: PublicKey;
  matchId: bigint;
  settler: PublicKey; // signs
  creator: PublicKey; // rent destination, pinned on-chain to match.creator
  opponent: PublicKey; // refunded alongside the creator
}
export function refundMatchIx(p: RefundMatchParams): TransactionInstruction {
  const match = matchPda(p.programId, p.matchId);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.settler, true, true),
      acc(p.creator, false, true),
      acc(match, false, true),
      acc(vaultAta(match, p.mint), false, true),
      acc(vaultAta(p.creator, p.mint), false, true),
      acc(vaultAta(p.opponent, p.mint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('refund_match'), u64(p.matchId)]),
  });
}

// ----- signer + send -----

/**
 * Load a Keypair from an env var holding either a JSON byte array (the standard
 * solana-keygen file contents) or a base58 secret key. Throws if unset/invalid
 * so a misconfigured settler fails at boot, not at settle time.
 */
export function loadKeypairFromEnv(envVar: string): Keypair {
  const raw = process.env[envVar];
  if (!raw) throw new Error(`${envVar} is not set`);
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith('[') ? Uint8Array.from(JSON.parse(trimmed)) : bs58.decode(trimmed);
  return Keypair.fromSecretKey(bytes);
}

/**
 * Build, sign, send, and confirm a transaction; returns the signature. Uses the
 * fetched blockhash + lastValidBlockHeight for expiry-aware confirmation (not the
 * deprecated signature-only overload).
 */
export async function sendIx(connection: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const signature = await connection.sendTransaction(tx, signers);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}
