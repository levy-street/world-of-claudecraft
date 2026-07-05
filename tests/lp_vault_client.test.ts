// Pins the woc_lp_vault wire format: every encoder's discriminator, borsh arg
// layout, and account list (order, signer, writable) must match the program's
// #[derive(Accounts)] structs in solana/programs/woc_lp_vault/src/lib.rs, and
// the account decoders must match the on-chain field order. A layout change on
// either side must change both.
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  closePositionIx,
  decodePool,
  decodePosition,
  extendLockIx,
  initPoolIx,
  openPositionIx,
  POOL_ACCOUNT_SIZE,
  POSITION_ACCOUNT_SIZE,
  poolPda,
  positionPda,
  positionVault,
  setPausedIx,
  stakeIx,
  unstakeIx,
} from '../server/lp_vault_client';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  vaultAta,
} from '../server/woc_escrow_client';

const programId = new PublicKey('9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6');
const lpMint = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const disc = (name: string) =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const flags = (ix: { keys: { isSigner: boolean; isWritable: boolean }[] }) =>
  ix.keys.map((k) => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);

describe('PDAs', () => {
  it('pool PDA is deterministic and mint-specific', () => {
    expect(poolPda(programId, lpMint).equals(poolPda(programId, lpMint))).toBe(true);
    expect(poolPda(programId, lpMint).equals(poolPda(programId, owner))).toBe(false);
  });
  it('position PDA is owner-specific under one pool', () => {
    const pool = poolPda(programId, lpMint);
    expect(
      positionPda(programId, pool, owner).equals(positionPda(programId, pool, authority)),
    ).toBe(false);
  });
  it('positionVault is the ATA of the position PDA', () => {
    const pool = poolPda(programId, lpMint);
    expect(
      positionVault(programId, lpMint, owner).equals(
        vaultAta(positionPda(programId, pool, owner), lpMint),
      ),
    ).toBe(true);
  });
});

describe('init_pool', () => {
  const ix = initPoolIx({ programId, lpMint, authority });
  it('targets the program with the init_pool discriminator and no args', () => {
    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.data.equals(disc('init_pool'))).toBe(true);
  });
  it('has the 4 accounts in lib.rs order with correct flags', () => {
    expect(flags(ix)).toEqual(['sw', '-w', '--', '--']);
    expect(ix.keys[0].pubkey.equals(authority)).toBe(true);
    expect(ix.keys[1].pubkey.equals(poolPda(programId, lpMint))).toBe(true);
    expect(ix.keys[2].pubkey.equals(lpMint)).toBe(true);
    expect(ix.keys[3].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

describe('open_position', () => {
  const ix = openPositionIx({ programId, lpMint, owner });
  it('has the 8 accounts in lib.rs order with correct flags', () => {
    expect(ix.data.equals(disc('open_position'))).toBe(true);
    expect(flags(ix)).toEqual(['sw', '--', '-w', '--', '-w', '--', '--', '--']);
    expect(ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[6].pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[7].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

describe('stake', () => {
  const ix = stakeIx({ programId, lpMint, owner, amountBase: 5_000_000n, lockSeconds: 86_400 });
  it('encodes amount u64 then lock_seconds u32 after the discriminator', () => {
    expect(ix.data.length).toBe(8 + 8 + 4);
    expect(ix.data.subarray(0, 8).equals(disc('stake'))).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(5_000_000n);
    expect(ix.data.readUInt32LE(16)).toBe(86_400);
  });
  it('has the 6 accounts in lib.rs order with correct flags', () => {
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '-w', '--']);
    const pool = poolPda(programId, lpMint);
    const position = positionPda(programId, pool, owner);
    expect(ix.keys[1].pubkey.equals(pool)).toBe(true);
    expect(ix.keys[2].pubkey.equals(position)).toBe(true);
    expect(ix.keys[3].pubkey.equals(vaultAta(position, lpMint))).toBe(true);
    expect(ix.keys[4].pubkey.equals(vaultAta(owner, lpMint))).toBe(true);
  });
});

describe('extend_lock', () => {
  const ix = extendLockIx({ programId, lpMint, owner, lockSeconds: 7 * 86_400 });
  it('encodes lock_seconds u32 and lists owner (signer, read-only), pool, position', () => {
    expect(ix.data.length).toBe(8 + 4);
    expect(ix.data.subarray(0, 8).equals(disc('extend_lock'))).toBe(true);
    expect(ix.data.readUInt32LE(8)).toBe(7 * 86_400);
    expect(flags(ix)).toEqual(['s-', '--', '-w']);
  });
});

describe('unstake', () => {
  const ix = unstakeIx({ programId, lpMint, owner, amountBase: 1n });
  it('encodes amount u64 and mirrors the stake account list', () => {
    expect(ix.data.length).toBe(8 + 8);
    expect(ix.data.subarray(0, 8).equals(disc('unstake'))).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(1n);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '-w', '--']);
  });
});

describe('close_position', () => {
  const ix = closePositionIx({ programId, lpMint, owner });
  it('has owner, pool, position, vault, token program', () => {
    expect(ix.data.equals(disc('close_position'))).toBe(true);
    expect(flags(ix)).toEqual(['sw', '--', '-w', '-w', '--']);
  });
});

describe('set_paused', () => {
  it('encodes the bool arg both ways', () => {
    const on = setPausedIx({ programId, lpMint, authority, paused: true });
    const off = setPausedIx({ programId, lpMint, authority, paused: false });
    expect(on.data.equals(Buffer.concat([disc('set_paused'), Buffer.from([1])]))).toBe(true);
    expect(off.data.equals(Buffer.concat([disc('set_paused'), Buffer.from([0])]))).toBe(true);
    expect(flags(on)).toEqual(['s-', '-w']);
  });
});

describe('account decoders', () => {
  it('round-trips a Pool account image', () => {
    const data = Buffer.alloc(POOL_ACCOUNT_SIZE);
    createHash('sha256').update('account:Pool').digest().copy(data, 0, 0, 8);
    lpMint.toBuffer().copy(data, 8);
    authority.toBuffer().copy(data, 40);
    data.writeBigUInt64LE(123_456_789n, 72);
    data.writeUInt8(1, 80);
    data.writeUInt8(254, 81);
    const pool = decodePool(data);
    expect(pool.lpMint.equals(lpMint)).toBe(true);
    expect(pool.authority.equals(authority)).toBe(true);
    expect(pool.totalStaked).toBe(123_456_789n);
    expect(pool.paused).toBe(true);
    expect(pool.bump).toBe(254);
  });

  it('round-trips a Position account image, including negative-safe i64 reads', () => {
    const pool = poolPda(programId, lpMint);
    const data = Buffer.alloc(POSITION_ACCOUNT_SIZE);
    createHash('sha256').update('account:Position').digest().copy(data, 0, 0, 8);
    pool.toBuffer().copy(data, 8);
    owner.toBuffer().copy(data, 40);
    data.writeBigUInt64LE(42n, 72);
    data.writeBigInt64LE(1_900_000_000n, 80);
    data.writeBigInt64LE(1_800_000_000n, 88);
    data.writeUInt8(255, 96);
    const p = decodePosition(data);
    expect(p.pool.equals(pool)).toBe(true);
    expect(p.owner.equals(owner)).toBe(true);
    expect(p.amount).toBe(42n);
    expect(p.lockedUntil).toBe(1_900_000_000n);
    expect(p.stakedAt).toBe(1_800_000_000n);
    expect(p.bump).toBe(255);
  });

  it('rejects wrong-size or wrong-discriminator buffers', () => {
    expect(() => decodePool(Buffer.alloc(10))).toThrow();
    expect(() => decodePosition(Buffer.alloc(POSITION_ACCOUNT_SIZE))).toThrow();
  });
});
