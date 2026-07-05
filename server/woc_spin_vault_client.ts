// Server-side client for the woc_spin_vault Anchor program (programs/woc-spin-vault).
// IDL-free, mirroring server/buyback.ts and the gamblefi escrow client: the
// 8-byte discriminator is sha256("global:<ix>")[:8], args are borsh
// little-endian, and each account list matches the program's #[derive(Accounts)]
// struct exactly (order, signer, writable). The encoders are pure
// (TransactionInstruction in, no IO) so the wire format is unit-tested against
// the on-chain layout without a running cluster. The keeper signs + sends these;
// the program enforces the cap, the pause, the settler pin, and single
// settlement, so the keeper key holds settle authority only, never funds.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';

// ----- encoding primitives -----

/** Anchor global-instruction discriminator: first 8 bytes of sha256("global:<name>"). */
export function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64(n: bigint): Buffer {
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${n}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function u8(n: number): Buffer {
  return Buffer.from([n & 0xff]);
}

function acc(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

// ----- PDAs -----

/** The singleton vault config PDA (seed "spin_vault"). */
export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('spin_vault')], programId)[0];
}

/** The per-spin receipt PDA (seeds "payout" + day u64 le + account_id u64 le). */
export function receiptPda(programId: PublicKey, day: bigint, accountId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('payout'), u64(day), u64(accountId)],
    programId,
  )[0];
}

/** The per-account payout-wallet registry PDA (seeds "wallet" + account_id u64 le). */
export function walletRegistryPda(programId: PublicKey, accountId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('wallet'), u64(accountId)], programId)[0];
}

// ----- instructions -----

export interface InitializeParams {
  programId: PublicKey;
  authority: PublicKey; // treasury; signs, pays config rent
  settler: PublicKey; // keeper allowed to release payouts
  maxPayout: bigint; // per-payout cap (lamports)
}
export function initializeIx(p: InitializeParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.authority, true, true),
      acc(configPda(p.programId), false, true),
      acc(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([discriminator('initialize'), p.settler.toBuffer(), u64(p.maxPayout)]),
  });
}

export interface ConfigureParams {
  programId: PublicKey;
  authority: PublicKey; // signs; pinned on-chain to config.authority
  settler: PublicKey;
  maxPayout: bigint;
  paused: boolean;
}
export function configureIx(p: ConfigureParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [acc(p.authority, true, false), acc(configPda(p.programId), false, true)],
    data: Buffer.concat([discriminator('configure'), p.settler.toBuffer(), u64(p.maxPayout), u8(p.paused ? 1 : 0)]),
  });
}

export interface RegisterWalletParams {
  programId: PublicKey;
  authority: PublicKey; // signs; pinned on-chain to config.authority
  accountId: bigint; // the player's account id
  wallet: PublicKey; // the verified payout wallet to bind to the account
}
export function registerWalletIx(p: RegisterWalletParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.authority, true, true),
      acc(configPda(p.programId), false, false),
      acc(walletRegistryPda(p.programId, p.accountId), false, true),
      acc(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([discriminator('register_wallet'), u64(p.accountId), p.wallet.toBuffer()]),
  });
}

export interface FundParams {
  programId: PublicKey;
  funder: PublicKey; // signs; sends SOL into the vault
  lamports: bigint;
}
export function fundIx(p: FundParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.funder, true, true),
      acc(configPda(p.programId), false, true),
      acc(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([discriminator('fund'), u64(p.lamports)]),
  });
}

export interface PayoutParams {
  programId: PublicKey;
  settler: PublicKey; // signs; pinned on-chain to config.settler
  winner: PublicKey; // must equal the account's registered wallet (program-checked)
  day: bigint; // UTC day index
  accountId: bigint; // the spinning account's id (binds the receipt + registry)
  amount: bigint; // lamports to pay (program caps it)
}
export function payoutIx(p: PayoutParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.settler, true, true),
      acc(configPda(p.programId), false, true),
      acc(walletRegistryPda(p.programId, p.accountId), false, false),
      acc(receiptPda(p.programId, p.day, p.accountId), false, true),
      acc(p.winner, false, true),
      acc(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([discriminator('payout'), u64(p.day), u64(p.accountId), u64(p.amount)]),
  });
}

export interface WithdrawParams {
  programId: PublicKey;
  authority: PublicKey; // signs; pinned on-chain to config.authority
  lamports: bigint;
}
export function withdrawIx(p: WithdrawParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [acc(p.authority, true, true), acc(configPda(p.programId), false, true)],
    data: Buffer.concat([discriminator('withdraw'), u64(p.lamports)]),
  });
}
