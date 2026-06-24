import { describe, expect, it } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  discriminator,
  configPda,
  receiptPda,
  walletRegistryPda,
  initializeIx,
  configureIx,
  registerWalletIx,
  fundIx,
  payoutIx,
  withdrawIx,
} from '../server/woc_spin_vault_client';

const PROGRAM = new PublicKey('So11111111111111111111111111111111111111112');
const A = new PublicKey('11111111111111111111111111111112');
const SETTLER = new PublicKey('Stake11111111111111111111111111111111111112');
const WINNER = new PublicKey('Vote111111111111111111111111111111111111111');

const expectedDisc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

describe('discriminator', () => {
  it('is the first 8 bytes of sha256("global:<name>")', () => {
    for (const name of ['initialize', 'configure', 'fund', 'payout', 'withdraw']) {
      expect(discriminator(name)).toEqual(expectedDisc(name));
      expect(discriminator(name)).toHaveLength(8);
    }
  });
});

describe('PDAs', () => {
  it('config PDA uses the "spin_vault" seed', () => {
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('spin_vault')], PROGRAM);
    expect(configPda(PROGRAM).equals(expected)).toBe(true);
  });

  it('receipt PDA binds (day, account_id) as little-endian u64 seeds', () => {
    const day = 20628n;
    const accountId = 4242n;
    const dayLe = Buffer.alloc(8);
    dayLe.writeBigUInt64LE(day);
    const accLe = Buffer.alloc(8);
    accLe.writeBigUInt64LE(accountId);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('payout'), dayLe, accLe], PROGRAM);
    expect(receiptPda(PROGRAM, day, accountId).equals(expected)).toBe(true);
  });

  it('different spins map to different receipts', () => {
    expect(receiptPda(PROGRAM, 1n, 1n).equals(receiptPda(PROGRAM, 1n, 2n))).toBe(false);
    expect(receiptPda(PROGRAM, 1n, 1n).equals(receiptPda(PROGRAM, 2n, 1n))).toBe(false);
  });
});

describe('initializeIx', () => {
  it('orders accounts [authority(signer,w), config(w), system] and encodes settler + cap', () => {
    const ix = initializeIx({ programId: PROGRAM, authority: A, settler: SETTLER, maxPayout: 100_000_000n });
    expect(ix.programId.equals(PROGRAM)).toBe(true);
    expect(ix.keys).toEqual([
      { pubkey: A, isSigner: true, isWritable: true },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('initialize'));
    expect(ix.data.subarray(8, 40)).toEqual(SETTLER.toBuffer());
    expect(ix.data.readBigUInt64LE(40)).toBe(100_000_000n);
    expect(ix.data).toHaveLength(8 + 32 + 8);
  });
});

describe('configureIx', () => {
  it('authority signs but is not writable; encodes settler, cap, paused flag', () => {
    const ix = configureIx({ programId: PROGRAM, authority: A, settler: SETTLER, maxPayout: 5n, paused: true });
    expect(ix.keys).toEqual([
      { pubkey: A, isSigner: true, isWritable: false },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: true },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('configure'));
    expect(ix.data.subarray(8, 40)).toEqual(SETTLER.toBuffer());
    expect(ix.data.readBigUInt64LE(40)).toBe(5n);
    expect(ix.data[48]).toBe(1);
    expect(configureIx({ programId: PROGRAM, authority: A, settler: SETTLER, maxPayout: 5n, paused: false }).data[48]).toBe(0);
  });
});

describe('fundIx', () => {
  it('orders [funder(signer,w), config(w), system] and encodes lamports', () => {
    const ix = fundIx({ programId: PROGRAM, funder: A, lamports: 2_000_000_000n });
    expect(ix.keys).toEqual([
      { pubkey: A, isSigner: true, isWritable: true },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('fund'));
    expect(ix.data.readBigUInt64LE(8)).toBe(2_000_000_000n);
  });
});

describe('payoutIx', () => {
  it('orders [settler(signer,w), config(w), registry(r), receipt(w), winner(w), system] and encodes day/account/amount', () => {
    const ix = payoutIx({ programId: PROGRAM, settler: SETTLER, winner: WINNER, day: 20628n, accountId: 4242n, amount: 1_000_000n });
    expect(ix.keys).toEqual([
      { pubkey: SETTLER, isSigner: true, isWritable: true },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: true },
      { pubkey: walletRegistryPda(PROGRAM, 4242n), isSigner: false, isWritable: false },
      { pubkey: receiptPda(PROGRAM, 20628n, 4242n), isSigner: false, isWritable: true },
      { pubkey: WINNER, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('payout'));
    expect(ix.data.readBigUInt64LE(8)).toBe(20628n);
    expect(ix.data.readBigUInt64LE(16)).toBe(4242n);
    expect(ix.data.readBigUInt64LE(24)).toBe(1_000_000n);
    expect(ix.data).toHaveLength(8 + 24);
  });
});

describe('walletRegistryPda', () => {
  it('binds account_id as a little-endian u64 seed under "wallet"', () => {
    const accLe = Buffer.alloc(8);
    accLe.writeBigUInt64LE(4242n);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('wallet'), accLe], PROGRAM);
    expect(walletRegistryPda(PROGRAM, 4242n).equals(expected)).toBe(true);
    expect(walletRegistryPda(PROGRAM, 1n).equals(walletRegistryPda(PROGRAM, 2n))).toBe(false);
  });
});

describe('registerWalletIx', () => {
  it('orders [authority(signer,w), config(r), registry(w), system] and encodes account + wallet', () => {
    const ix = registerWalletIx({ programId: PROGRAM, authority: A, accountId: 4242n, wallet: WINNER });
    expect(ix.keys).toEqual([
      { pubkey: A, isSigner: true, isWritable: true },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: false },
      { pubkey: walletRegistryPda(PROGRAM, 4242n), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('register_wallet'));
    expect(ix.data.readBigUInt64LE(8)).toBe(4242n);
    expect(ix.data.subarray(16, 48)).toEqual(WINNER.toBuffer());
    expect(ix.data).toHaveLength(8 + 8 + 32);
  });
});

describe('withdrawIx', () => {
  it('orders [authority(signer,w), config(w)] and encodes lamports', () => {
    const ix = withdrawIx({ programId: PROGRAM, authority: A, lamports: 7n });
    expect(ix.keys).toEqual([
      { pubkey: A, isSigner: true, isWritable: true },
      { pubkey: configPda(PROGRAM), isSigner: false, isWritable: true },
    ]);
    expect(ix.data.subarray(0, 8)).toEqual(expectedDisc('withdraw'));
    expect(ix.data.readBigUInt64LE(8)).toBe(7n);
  });
});

describe('u64 range guard', () => {
  it('rejects a negative or oversized lamport amount', () => {
    expect(() => fundIx({ programId: PROGRAM, funder: A, lamports: -1n })).toThrow(/u64 out of range/);
    expect(() => fundIx({ programId: PROGRAM, funder: A, lamports: 2n ** 64n })).toThrow(/u64 out of range/);
  });
});
