// Server-side client for the woc_lp_vault Anchor program (devnet program
// 9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6): pure instruction encoders and
// account decoders, no I/O, so the wire format is unit-tested against the
// program's #[derive(Accounts)] structs exactly like woc_escrow_client.ts.
//
// Anchor-compatible without an IDL: the 8-byte instruction discriminator is
// sha256("global:<ix>")[:8], the account discriminator sha256("account:<Name>")[:8],
// args are borsh, and each account list matches lib.rs (order, signer, writable).
// PDAs: pool = ["pool", lp_mint], position = ["position", pool, owner]; each
// position's vault is the ATA of the position PDA.

import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, vaultAta } from './woc_escrow_client';

// ----- encoding primitives -----

const disc = (name: string): Buffer =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const accountDisc = (name: string): Buffer =>
  createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const acc = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({
  pubkey,
  isSigner,
  isWritable,
});

// ----- PDAs -----

/** The staking pool PDA for an LP mint (seeds: "pool" + lp_mint). */
export function poolPda(programId: PublicKey, lpMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('pool'), lpMint.toBuffer()], programId)[0];
}

/** A staker's position PDA (seeds: "position" + pool + owner). */
export function positionPda(programId: PublicKey, pool: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), pool.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

/** The program-owned vault holding a position's LP tokens (ATA of the position PDA). */
export function positionVault(
  programId: PublicKey,
  lpMint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return vaultAta(positionPda(programId, poolPda(programId, lpMint), owner), lpMint);
}

// ----- instructions -----

export interface LpVaultIds {
  programId: PublicKey;
  lpMint: PublicKey;
}

export function initPoolIx(p: LpVaultIds & { authority: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.authority, true, true),
      acc(poolPda(p.programId, p.lpMint), false, true),
      acc(p.lpMint, false, false),
      acc(SystemProgram.programId, false, false),
    ],
    data: disc('init_pool'),
  });
}

export function openPositionIx(p: LpVaultIds & { owner: PublicKey }): TransactionInstruction {
  const pool = poolPda(p.programId, p.lpMint);
  const position = positionPda(p.programId, pool, p.owner);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.owner, true, true),
      acc(pool, false, false),
      acc(position, false, true),
      acc(p.lpMint, false, false),
      acc(vaultAta(position, p.lpMint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
      acc(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
      acc(SystemProgram.programId, false, false),
    ],
    data: disc('open_position'),
  });
}

export interface StakeParams extends LpVaultIds {
  owner: PublicKey;
  amountBase: bigint;
  lockSeconds: number;
}
export function stakeIx(p: StakeParams): TransactionInstruction {
  const pool = poolPda(p.programId, p.lpMint);
  const position = positionPda(p.programId, pool, p.owner);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.owner, true, true),
      acc(pool, false, true),
      acc(position, false, true),
      acc(vaultAta(position, p.lpMint), false, true),
      acc(vaultAta(p.owner, p.lpMint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('stake'), u64(p.amountBase), u32(p.lockSeconds)]),
  });
}

export function extendLockIx(
  p: LpVaultIds & { owner: PublicKey; lockSeconds: number },
): TransactionInstruction {
  const pool = poolPda(p.programId, p.lpMint);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.owner, true, false),
      acc(pool, false, false),
      acc(positionPda(p.programId, pool, p.owner), false, true),
    ],
    data: Buffer.concat([disc('extend_lock'), u32(p.lockSeconds)]),
  });
}

export function unstakeIx(
  p: LpVaultIds & { owner: PublicKey; amountBase: bigint },
): TransactionInstruction {
  const pool = poolPda(p.programId, p.lpMint);
  const position = positionPda(p.programId, pool, p.owner);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.owner, true, true),
      acc(pool, false, true),
      acc(position, false, true),
      acc(vaultAta(position, p.lpMint), false, true),
      acc(vaultAta(p.owner, p.lpMint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc('unstake'), u64(p.amountBase)]),
  });
}

export function closePositionIx(p: LpVaultIds & { owner: PublicKey }): TransactionInstruction {
  const pool = poolPda(p.programId, p.lpMint);
  const position = positionPda(p.programId, pool, p.owner);
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      acc(p.owner, true, true),
      acc(pool, false, false),
      acc(position, false, true),
      acc(vaultAta(position, p.lpMint), false, true),
      acc(TOKEN_PROGRAM_ID, false, false),
    ],
    data: disc('close_position'),
  });
}

export function setPausedIx(
  p: LpVaultIds & { authority: PublicKey; paused: boolean },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [acc(p.authority, true, false), acc(poolPda(p.programId, p.lpMint), false, true)],
    data: Buffer.concat([disc('set_paused'), Buffer.from([p.paused ? 1 : 0])]),
  });
}

// ----- account decoders -----

// Mirrors Pool in lib.rs: 8 disc + 32 lp_mint + 32 authority + 8 total_staked
// + 1 paused + 1 bump = 82 bytes. A layout change there must change this.
export const POOL_ACCOUNT_SIZE = 82;
// Mirrors Position: 8 disc + 32 pool + 32 owner + 8 amount + 8 locked_until
// + 8 staked_at + 1 bump = 97 bytes. getProgramAccounts filters on this size.
export const POSITION_ACCOUNT_SIZE = 97;
export const POSITION_DISCRIMINATOR: Buffer = accountDisc('Position');

export interface PoolAccount {
  lpMint: PublicKey;
  authority: PublicKey;
  totalStaked: bigint;
  paused: boolean;
  bump: number;
}

export function decodePool(data: Buffer): PoolAccount {
  if (data.length !== POOL_ACCOUNT_SIZE || !data.subarray(0, 8).equals(accountDisc('Pool'))) {
    throw new Error('not a woc_lp_vault Pool account');
  }
  let o = 8;
  const lpMint = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const authority = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const totalStaked = data.readBigUInt64LE(o);
  o += 8;
  const paused = data.readUInt8(o) === 1;
  o += 1;
  return { lpMint, authority, totalStaked, paused, bump: data.readUInt8(o) };
}

export interface PositionAccount {
  pool: PublicKey;
  owner: PublicKey;
  amount: bigint;
  lockedUntil: bigint; // unix seconds; 0 = never locked
  stakedAt: bigint; // unix seconds of first stake; 0 = empty position
  bump: number;
}

export function decodePosition(data: Buffer): PositionAccount {
  if (
    data.length !== POSITION_ACCOUNT_SIZE ||
    !data.subarray(0, 8).equals(POSITION_DISCRIMINATOR)
  ) {
    throw new Error('not a woc_lp_vault Position account');
  }
  let o = 8;
  const pool = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const owner = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const amount = data.readBigUInt64LE(o);
  o += 8;
  const lockedUntil = data.readBigInt64LE(o);
  o += 8;
  const stakedAt = data.readBigInt64LE(o);
  o += 8;
  return { pool, owner, amount, lockedUntil, stakedAt, bump: data.readUInt8(o) };
}
