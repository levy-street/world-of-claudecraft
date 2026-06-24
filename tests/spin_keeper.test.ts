import { describe, expect, it } from 'vitest';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { settlePendingSpins, KeeperDeps } from '../server/spin_keeper';
import { EngagementService } from '../server/engagement_service';
import { parseEngagementConfig } from '../server/engagement_config';
import { InMemoryEngagementDb } from './helpers/in_memory_engagement_db';

const PROGRAM = new PublicKey('So11111111111111111111111111111111111111112');
const SETTLER = new PublicKey('Stake11111111111111111111111111111111111112');
const WALLET = 'Vote111111111111111111111111111111111111111';
const cfg = parseEngagementConfig({});

function setup() {
  const db = new InMemoryEngagementDb();
  const svc = new EngagementService(db, cfg, { makeSeed: () => Buffer.alloc(32, 1), now: () => 0 });
  return { db, svc };
}

const pendingSpin = (db: InMemoryEngagementDb, accountId: number, lamports: bigint) =>
  db.insertSpin({ accountId, utcDay: 100, dayNonce: 1, clientSeed: '', prizeKey: lamports > 0n ? 'dust' : 'none', lamports });

describe('settlePendingSpins', () => {
  it('pays winners, settles zero-prize spins off-chain, and skips unlinked accounts', async () => {
    const { db, svc } = setup();
    await pendingSpin(db, 1, 1_000_000n); // winner, linked
    await pendingSpin(db, 2, 0n); // no-win, no payout needed
    await pendingSpin(db, 3, 500_000n); // winner, unlinked

    const sent: TransactionInstruction[] = [];
    const deps: KeeperDeps = {
      programId: PROGRAM,
      settler: SETTLER,
      walletForAccount: async (id) => (id === 1 ? WALLET : null),
      send: async (ix) => {
        sent.push(ix);
        return `sig-${sent.length}`;
      },
    };

    const summary = await settlePendingSpins(svc, db, deps);
    expect(summary).toEqual({ settled: 2, failed: 0, skipped: 1 });

    const s1 = await db.getSpin(1);
    expect(s1!.status).toBe('settled');
    expect(s1!.settleSig).toBe('sig-1');
    expect((await db.getSpin(2))!.status).toBe('settled'); // settled off-chain (no-payout)
    expect((await db.getSpin(2))!.settleSig).toBe('no-payout');
    expect((await db.getSpin(3))!.status).toBe('pending'); // unlinked: left for retry
    expect(sent).toHaveLength(1); // only the linked winner triggered an on-chain send
  });

  it('builds the payout to the registered wallet for the spin', async () => {
    const { db, svc } = setup();
    await pendingSpin(db, 7, 250_000n);
    let built: TransactionInstruction | null = null;
    await settlePendingSpins(svc, db, {
      programId: PROGRAM,
      settler: SETTLER,
      walletForAccount: async () => WALLET,
      send: async (ix) => {
        built = ix;
        return 'ok';
      },
    });
    expect(built).not.toBeNull();
    const keys = built!.keys;
    // settler signs; winner is the registered wallet and is writable.
    expect(keys[0].pubkey.equals(SETTLER)).toBe(true);
    expect(keys.some((k) => k.pubkey.equals(new PublicKey(WALLET)) && k.isWritable)).toBe(true);
  });

  it('marks a spin failed when the send throws, without aborting the batch', async () => {
    const { db, svc } = setup();
    await pendingSpin(db, 1, 1_000_000n);
    await pendingSpin(db, 2, 2_000_000n);

    let calls = 0;
    const summary = await settlePendingSpins(svc, db, {
      programId: PROGRAM,
      settler: SETTLER,
      walletForAccount: async () => WALLET,
      send: async () => {
        calls++;
        if (calls === 1) throw new Error('blockhash expired');
        return 'sig-ok';
      },
    });

    expect(summary).toEqual({ settled: 1, failed: 1, skipped: 0 });
    expect((await db.getSpin(1))!.status).toBe('failed');
    expect((await db.getSpin(2))!.status).toBe('settled');
  });

  it('honors the batch limit', async () => {
    const { db, svc } = setup();
    for (let i = 1; i <= 5; i++) await pendingSpin(db, i, 0n);
    const summary = await settlePendingSpins(svc, db, {
      programId: PROGRAM,
      settler: SETTLER,
      walletForAccount: async () => WALLET,
      send: async () => 'x',
      batchLimit: 2,
    });
    expect(summary.settled).toBe(2);
    expect((await db.listPendingSpins(100)).length).toBe(3);
  });
});
