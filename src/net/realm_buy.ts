// Client-side builder for the "buy a realm" split payment (#475). Founding a realm
// by PURCHASE (SOL or USDC) means signing ONE transaction that pays the two legs
// the server quoted: 70% to the treasury and 30% to the buyback vault, tagged with
// the quoteId as a memo so the server can bind the payment to its quote. The server
// (server/realm_buy.ts) verifies the finalized transaction's balance deltas; this
// builds the matching instructions. Pure (no wallet/network) so it is unit-testable
// and byte-pinnable, mirroring src/net/realm_escrow.ts. The wallet send wrapper is
// signAndSendRealmPurchase in src/net/wallet.ts.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, ownerTokenAccount } from './realm_escrow';

// SPL Memo program (v2). The server reads the memo via jsonParsed `spl-memo`.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

// SystemProgram transfer (instruction index 2): u32 LE tag + u64 LE lamports.
export function nativeTransferIx(from: PublicKey, to: PublicKey, lamports: bigint): TransactionInstruction {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  data.set(u64le(lamports), 4);
  return new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

// SPL Token TransferChecked (tag 12): u8 tag + u64 LE amount + u8 decimals.
export function transferCheckedIx(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  data.set(u64le(amount), 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// Associated Token Account program CreateIdempotent (tag 1): create the recipient's
// ATA if it does not exist yet, no-op if it does. The buyer funds the rent. Lets a
// purchase succeed even when the treasury / buyback vault has never held this mint.
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = ownerTokenAccount(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(Uint8Array.of(1)),
  });
}

export function memoIx(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(new TextEncoder().encode(memo)),
  });
}

export interface RealmPurchasePlan {
  buyer: PublicKey;
  native: boolean; // SOL (System transfers) vs USDC (SPL transfers)
  currencyMint: PublicKey; // the SPL mint for a token currency (ignored when native)
  currencyDecimals: number;
  treasury: PublicKey;
  buybackVault: PublicKey;
  treasuryBase: bigint;
  buybackBase: bigint;
  memo: string; // the quoteId
}

// Build the instructions for the split payment. SOL pays the two legs with System
// transfers; USDC creates the recipient ATAs idempotently then TransferChecks the
// two legs from the buyer's ATA. A memo carrying the quoteId is always last.
export function buildRealmPurchaseInstructions(plan: RealmPurchasePlan): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (plan.native) {
    ixs.push(nativeTransferIx(plan.buyer, plan.treasury, plan.treasuryBase));
    ixs.push(nativeTransferIx(plan.buyer, plan.buybackVault, plan.buybackBase));
  } else {
    const buyerAta = ownerTokenAccount(plan.buyer, plan.currencyMint);
    const treasuryAta = ownerTokenAccount(plan.treasury, plan.currencyMint);
    const buybackAta = ownerTokenAccount(plan.buybackVault, plan.currencyMint);
    ixs.push(createAtaIdempotentIx(plan.buyer, plan.treasury, plan.currencyMint));
    ixs.push(createAtaIdempotentIx(plan.buyer, plan.buybackVault, plan.currencyMint));
    ixs.push(transferCheckedIx(buyerAta, plan.currencyMint, treasuryAta, plan.buyer, plan.treasuryBase, plan.currencyDecimals));
    ixs.push(transferCheckedIx(buyerAta, plan.currencyMint, buybackAta, plan.buyer, plan.buybackBase, plan.currencyDecimals));
  }
  ixs.push(memoIx(plan.memo));
  return ixs;
}
