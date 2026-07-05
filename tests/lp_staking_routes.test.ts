// The LP tx-builder HTTP glue: request validation (owner, amounts, locks),
// base64 encoding of the unsigned transactions, and the error mapping. Driven
// with a real readBody stream and a fake service, no live server.
import { Readable } from 'node:stream';
import {
  Keypair,
  type PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  handleLpTxBuild,
  type LpTxBuilder,
  parseAmountBase,
  parseLockSeconds,
} from '../server/lp_staking_routes';

const owner = Keypair.generate().publicKey;

function fakeTx(feePayer: PublicKey): Transaction {
  const tx = new Transaction({
    feePayer,
    blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
    lastValidBlockHeight: 100,
  });
  tx.add(
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.alloc(0),
    }),
  );
  return tx;
}

function fakeService(): LpTxBuilder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async buildStakeTx(o, amount, lock) {
      calls.push(`stake:${o.toBase58()}:${amount}:${lock}`);
      return fakeTx(o);
    },
    async buildUnstakeTx(o, amount) {
      calls.push(`unstake:${amount}`);
      return fakeTx(o);
    },
    async buildExtendLockTx(o, lock) {
      calls.push(`extend:${lock}`);
      return fakeTx(o);
    },
    async buildClosePositionTx(o) {
      calls.push('close');
      return fakeTx(o);
    },
  };
}

async function call(path: string, body: unknown, svc: LpTxBuilder) {
  const req = Readable.from([JSON.stringify(body)]) as any;
  const out: { status?: number; body?: any } = {};
  const res = {
    writeHead(status: number) {
      out.status = status;
    },
    end(data: string) {
      out.body = JSON.parse(data);
    },
  } as any;
  await handleLpTxBuild(req, res, svc, path);
  return out;
}

describe('parseAmountBase', () => {
  it('accepts positive base-unit strings within u64 and rejects everything else', () => {
    expect(parseAmountBase('1')).toBe(1n);
    expect(parseAmountBase('18446744073709551615')).toBe(18446744073709551615n);
    expect(parseAmountBase('18446744073709551616')).toBeNull(); // u64 + 1
    expect(parseAmountBase('0')).toBeNull();
    expect(parseAmountBase('-5')).toBeNull();
    expect(parseAmountBase('1.5')).toBeNull();
    expect(parseAmountBase(5)).toBeNull(); // numbers lose precision; strings only
    expect(parseAmountBase('00012')).toBeNull();
    expect(parseAmountBase(null)).toBeNull();
  });
});

describe('parseLockSeconds', () => {
  it('accepts non-negative integers as number or digit string', () => {
    expect(parseLockSeconds(0)).toBe(0);
    expect(parseLockSeconds(86_400)).toBe(86_400);
    expect(parseLockSeconds('86400')).toBe(86_400);
    expect(parseLockSeconds(-1)).toBeNull();
    expect(parseLockSeconds(1.5)).toBeNull();
    expect(parseLockSeconds('1e5')).toBeNull();
    expect(parseLockSeconds({})).toBeNull();
  });
});

describe('handleLpTxBuild', () => {
  it('builds a stake tx and returns it base64-encoded', async () => {
    const svc = fakeService();
    const r = await call(
      '/api/woc/lp/tx/stake',
      { owner: owner.toBase58(), amountBase: '500', lockSeconds: 60 },
      svc,
    );
    expect(r.status).toBe(200);
    expect(svc.calls).toEqual([`stake:${owner.toBase58()}:500:60`]);
    const tx = Transaction.from(Buffer.from(r.body.tx, 'base64'));
    expect(tx.feePayer?.equals(owner)).toBe(true);
  });

  it('rejects a bad owner, bad amount, and bad lock without calling the service', async () => {
    const svc = fakeService();
    expect(
      (await call('/api/woc/lp/tx/stake', { owner: 'nope', amountBase: '1' }, svc)).status,
    ).toBe(400);
    expect(
      (await call('/api/woc/lp/tx/stake', { owner: owner.toBase58(), amountBase: '0' }, svc))
        .status,
    ).toBe(400);
    expect(
      (
        await call(
          '/api/woc/lp/tx/stake',
          { owner: owner.toBase58(), amountBase: '1', lockSeconds: -3 },
          svc,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call('/api/woc/lp/tx/unstake', { owner: owner.toBase58(), amountBase: 'x' }, svc))
        .status,
    ).toBe(400);
    expect(
      (await call('/api/woc/lp/tx/extend', { owner: owner.toBase58(), lockSeconds: 0 }, svc))
        .status,
    ).toBe(400);
    expect(svc.calls).toEqual([]);
  });

  it('routes unstake, extend, and close', async () => {
    const svc = fakeService();
    expect(
      (await call('/api/woc/lp/tx/unstake', { owner: owner.toBase58(), amountBase: '7' }, svc))
        .status,
    ).toBe(200);
    expect(
      (await call('/api/woc/lp/tx/extend', { owner: owner.toBase58(), lockSeconds: 60 }, svc))
        .status,
    ).toBe(200);
    expect((await call('/api/woc/lp/tx/close', { owner: owner.toBase58() }, svc)).status).toBe(200);
    expect(svc.calls).toEqual(['unstake:7', 'extend:60', 'close']);
  });

  it('maps a service throw to a 400 with the message, never a 500', async () => {
    const svc = fakeService();
    svc.buildStakeTx = async () => {
      throw new Error('lock duration out of range');
    };
    const r = await call(
      '/api/woc/lp/tx/stake',
      { owner: owner.toBase58(), amountBase: '1', lockSeconds: 1 },
      svc,
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('lock duration out of range');
  });

  it('unknown subpath is a 404', async () => {
    const r = await call('/api/woc/lp/tx/nope', { owner: owner.toBase58() }, fakeService());
    expect(r.status).toBe(404);
  });
});
