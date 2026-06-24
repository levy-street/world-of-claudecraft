// Server-side client for the on-chain job_escrow program (player "paid bodyguard"
// contracts). This is the settler/oracle seam: it builds the payer's deposit
// transaction (the payer signs + submits — non-custodial), and it signs + submits
// the release/refund the milestone engine decides. The settler key can only move
// a job's escrow to the helper (release) or back to the payer (refund); it can
// never divert funds. Server-only IO module — no SQL, no client import.
//
// We hand-encode Anchor instructions (8-byte discriminator + borsh args) rather
// than pull in @coral-xyz/anchor, mirroring how server/sns.ts composes raw
// instructions and keeping the server's dependency set tiny.
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  SOLANA_RPC_URL, WOC_MINT, WOC_DECIMALS, USDC_MINT, USDC_DECIMALS,
  JOBS_ENABLED, JOB_ESCROW_PROGRAM_ID, JOB_ESCROW_SETTLER_SECRET,
} from './woc_config';
import { getFinalizedTx, txSucceeded, usesToken2022, ownerSpentBase } from './solana_tx';

// Currencies that escrow cleanly as SPL tokens. SOL is supported for direct tips
// (see src/net/wallet) but not for held escrow in v1 — escrowing native SOL needs
// wSOL wrap/unwrap, a separate path; WOC and USDC are the $WOC-economy tokens that
// matter for paid help.
export type EscrowCurrency = 'WOC' | 'USDC';

export function escrowCurrencyInfo(currency: EscrowCurrency): { mint: string; decimals: number } {
  return currency === 'USDC'
    ? { mint: USDC_MINT, decimals: USDC_DECIMALS }
    : { mint: WOC_MINT, decimals: WOC_DECIMALS };
}

export function isEscrowCurrency(value: unknown): value is EscrowCurrency {
  return value === 'WOC' || value === 'USDC';
}

/** Convert a human reward amount to integer base units for the currency. */
export function rewardToBase(human: number, decimals: number): bigint {
  if (!Number.isFinite(human) || human <= 0) return 0n;
  // Build the integer from the decimal string so large amounts don't lose
  // precision through Number multiplication.
  const fixed = human.toFixed(decimals);
  const [whole, frac = ''] = fixed.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

const PROGRAM_ID = new PublicKey(JOB_ESCROW_PROGRAM_ID);

// Anchor instruction discriminators: sha256("global:<name>")[0..8].
function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
const DISC = {
  open: discriminator('open'),
  release: discriminator('release'),
  refund: discriminator('refund'),
};

function u64le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

let _connection: Connection | null = null;
function connection(): Connection {
  if (!_connection) _connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  return _connection;
}

let _settler: Keypair | null = null;
/** The settler/oracle keypair. Throws if the secret isn't configured. */
export function settlerKeypair(): Keypair {
  if (_settler) return _settler;
  if (!JOB_ESCROW_SETTLER_SECRET) {
    throw new Error('JOB_ESCROW_SETTLER_SECRET is not set — job escrow is unavailable');
  }
  const raw = JOB_ESCROW_SETTLER_SECRET;
  const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  _settler = Keypair.fromSecretKey(bytes);
  return _settler;
}

/** True once escrow can actually run (flag on + settler configured). */
export function jobEscrowReady(): boolean {
  return JOBS_ENABLED && JOB_ESCROW_SETTLER_SECRET.length > 0;
}

/** The job PDA for a server-assigned job id (seed = "job" || u64le(id)). */
export function jobPda(jobId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('job'), u64le(jobId)], PROGRAM_ID)[0];
}

/**
 * Whether the job's on-chain account still exists. release()/refund() close it,
 * so `false` means the escrow has already been settled — used for idempotent
 * crash recovery (don't double-settle if the server died after the chain op but
 * before persisting the result).
 */
export async function jobAccountExists(jobId: bigint): Promise<boolean> {
  const info = await connection().getAccountInfo(jobPda(jobId), 'confirmed');
  return info !== null;
}

/** The escrow vault (the job PDA's associated token account for the mint). */
function vaultFor(job: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, job, true);
}

export interface OpenArgs {
  jobId: bigint;
  payer: string;     // the payer's wallet (fee payer + funder)
  helper: string;    // the helper's wallet (release recipient; recorded on-chain)
  mint: string;
  amountBase: bigint;
}

/**
 * Build the unsigned deposit transaction that locks the reward. The payer is the
 * fee payer and the only required signer; the client signs + submits it. Returns
 * the base64 tx plus the derived job/vault addresses for the DB record.
 */
export async function buildOpenTransaction(args: OpenArgs): Promise<{ txBase64: string; jobPda: string; vault: string }> {
  const payer = new PublicKey(args.payer);
  const helper = new PublicKey(args.helper);
  const mint = new PublicKey(args.mint);
  const settler = settlerKeypair().publicKey;
  const job = jobPda(args.jobId);
  const vault = vaultFor(job, mint);
  const payerToken = getAssociatedTokenAddressSync(mint, payer);

  const data = Buffer.concat([DISC.open, u64le(args.jobId), u64le(args.amountBase)]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: helper, isSigner: false, isWritable: false },
      { pubkey: settler, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: payerToken, isSigner: false, isWritable: true },
      { pubkey: job, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(ix);
  return {
    txBase64: tx.serialize({ requireAllSignatures: false }).toString('base64'),
    jobPda: job.toBase58(),
    vault: vault.toBase58(),
  };
}

/**
 * Verify the payer's deposit actually landed in OUR escrow: the tx finalized and
 * succeeded, it isn't a Token-2022 look-alike, the payer spent at least the
 * reward, the job PDA exists under our program, and the vault holds the amount.
 */
export async function verifyDeposit(args: { signature: string; jobId: bigint; payer: string; helper: string; mint: string; amountBase: bigint }): Promise<boolean> {
  const tx = await getFinalizedTx(args.signature);
  if (!tx || !txSucceeded(tx)) return false;
  if (usesToken2022(tx, args.mint)) return false;
  if (ownerSpentBase(tx, args.payer, args.mint) < args.amountBase) return false;

  const job = jobPda(args.jobId);
  const info = await connection().getAccountInfo(job, 'finalized');
  if (!info || !info.owner.equals(PROGRAM_ID)) return false;

  // Assert the on-chain Job's terms are exactly the ones the server intended.
  // Without this, a client could ignore the server-built tx and craft their own
  // open() at the same (server-assigned) PDA with a different settler/helper —
  // the server could then never release/refund, stranding/griefing the helper.
  // Binding to the recorded settler (= ours), helper, mint, and amount closes that.
  const decoded = decodeJobAccount(info.data);
  if (!decoded) return false;
  if (!decoded.settler.equals(settlerKeypair().publicKey)) return false;
  if (!decoded.payer.equals(new PublicKey(args.payer))) return false;
  if (!decoded.helper.equals(new PublicKey(args.helper))) return false;
  if (!decoded.mint.equals(new PublicKey(args.mint))) return false;
  if (decoded.amount !== args.amountBase) return false;

  const vault = vaultFor(job, new PublicKey(args.mint));
  const bal = await connection().getTokenAccountBalance(vault, 'finalized').catch(() => null);
  return !!bal && BigInt(bal.value.amount) >= args.amountBase;
}

// Decode the Anchor `Job` account: 8-byte discriminator, then job_id u64, payer,
// helper, mint pubkeys, amount u64, settler, vault pubkeys, bump u8 — matching
// programs/job-escrow/src/lib.rs. Returns null if the buffer is too short.
function decodeJobAccount(data: Buffer): { payer: PublicKey; helper: PublicKey; mint: PublicKey; amount: bigint; settler: PublicKey; vault: PublicKey } | null {
  if (data.length < 8 + 8 + 32 + 32 + 32 + 8 + 32 + 32 + 1) return null;
  let o = 8 + 8; // skip discriminator + job_id
  const payer = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const helper = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const mint = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const amount = data.readBigUInt64LE(o); o += 8;
  const settler = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const vault = new PublicKey(data.subarray(o, o + 32));
  return { payer, helper, mint, amount, settler, vault };
}

async function signAndSendSettler(ixs: TransactionInstruction[]): Promise<string> {
  const settler = settlerKeypair();
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
  const tx = new Transaction({ feePayer: settler.publicKey, blockhash, lastValidBlockHeight });
  tx.add(...ixs);
  tx.sign(settler);
  const signature = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

/**
 * Release the escrow to the helper (settler-signed). Idempotently creates the
 * helper's token account first (the settler funds the rent), then runs the
 * program's `release`, which pays the helper and closes the vault + job. Returns
 * the confirmed signature.
 */
export async function releaseJob(args: { jobId: bigint; payer: string; helper: string; mint: string }): Promise<string> {
  const settler = settlerKeypair().publicKey;
  const payer = new PublicKey(args.payer);
  const helper = new PublicKey(args.helper);
  const mint = new PublicKey(args.mint);
  const job = jobPda(args.jobId);
  const vault = vaultFor(job, mint);
  const helperToken = getAssociatedTokenAddressSync(mint, helper);

  return signAndSendSettler([
    createAssociatedTokenAccountIdempotentInstruction(settler, helperToken, helper, mint),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: settler, isSigner: true, isWritable: false },
        { pubkey: job, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: true },
        { pubkey: helperToken, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: DISC.release,
    }),
  ]);
}

/**
 * Refund the escrow to the payer (settler-signed). Idempotently re-creates the
 * payer's token account (in case they closed it), then runs `refund`, which
 * returns the funds and closes the vault + job. Returns the confirmed signature.
 */
export async function refundJob(args: { jobId: bigint; payer: string; mint: string }): Promise<string> {
  const settler = settlerKeypair().publicKey;
  const payer = new PublicKey(args.payer);
  const mint = new PublicKey(args.mint);
  const job = jobPda(args.jobId);
  const vault = vaultFor(job, mint);
  const payerToken = getAssociatedTokenAddressSync(mint, payer);

  return signAndSendSettler([
    createAssociatedTokenAccountIdempotentInstruction(settler, payerToken, payer, mint),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: settler, isSigner: true, isWritable: false },
        { pubkey: job, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: true },
        { pubkey: payerToken, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: DISC.refund,
    }),
  ]);
}
