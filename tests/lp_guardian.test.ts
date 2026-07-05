// The server-side guardian reader: fail-closed configuration gating, the
// per-wallet cache, on-chain Position decoding through a stubbed RPC fetch,
// and the tier-0-on-failure posture (a cosmetic read must never guess).
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.WOC_LP_STAKING_ENABLED = '1';
  process.env.WOC_LP_VAULT_PROGRAM_ID = '9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6';
  process.env.WOC_LP_MINT = 'E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx';
  process.env.WOC_LP_GUARDIAN_MIN_STAKE_BASE = '10';
});

import {
  guardianFlairConfigured,
  guardianInfoForPubkey,
  resetGuardianCacheForTests,
} from '../server/lp_guardian';
import { POSITION_ACCOUNT_SIZE, poolPda, positionPda } from '../server/lp_vault_client';
import { GUARDIAN_SEASONING_SECONDS } from '../src/sim/guardian_tier';

const PROGRAM = new PublicKey('9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6');
const LP_MINT = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const owner = Keypair.generate().publicKey;

function positionImage(amount: bigint, lockedUntil: number, stakedAt: number): Buffer {
  const pool = poolPda(PROGRAM, LP_MINT);
  const data = Buffer.alloc(POSITION_ACCOUNT_SIZE);
  createHash('sha256').update('account:Position').digest().copy(data, 0, 0, 8);
  pool.toBuffer().copy(data, 8);
  owner.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(amount, 72);
  data.writeBigInt64LE(BigInt(lockedUntil), 80);
  data.writeBigInt64LE(BigInt(stakedAt), 88);
  data.writeUInt8(255, 96);
  return data;
}

function stubRpc(responder: (address: string) => Buffer | null) {
  vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}');
    expect(body.method).toBe('getAccountInfo');
    const image = responder(body.params[0]);
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { value: image ? { data: [image.toString('base64'), 'base64'] } : null },
      }),
    } as Response;
  });
}

beforeEach(() => resetGuardianCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe('guardianInfoForPubkey', () => {
  it('is configured under the test env and reads a seasoned position to a tier', async () => {
    expect(guardianFlairConfigured()).toBe(true);
    const nowSec = Math.floor(Date.now() / 1000);
    stubRpc(() =>
      positionImage(1_000n, nowSec + 360 * 86_400, nowSec - GUARDIAN_SEASONING_SECONDS - 10),
    );
    const info = await guardianInfoForPubkey(owner.toBase58());
    expect(info.tier).toBe(5); // abyssguard
    expect(info.stakedBase).toBe(1_000n);
  });

  it('asks the chain for exactly the position PDA of the wallet', async () => {
    let asked = '';
    stubRpc((address) => {
      asked = address;
      return null;
    });
    await guardianInfoForPubkey(owner.toBase58());
    expect(asked).toBe(positionPda(PROGRAM, poolPda(PROGRAM, LP_MINT), owner).toBase58());
  });

  it('caches per wallet inside the TTL (one RPC for repeated reads)', async () => {
    let calls = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    stubRpc(() => {
      calls += 1;
      return positionImage(1_000n, 0, nowSec - GUARDIAN_SEASONING_SECONDS - 10);
    });
    expect((await guardianInfoForPubkey(owner.toBase58())).tier).toBe(1);
    expect((await guardianInfoForPubkey(owner.toBase58())).tier).toBe(1);
    expect(calls).toBe(1);
  });

  it('no position, malformed wallet, or an RPC failure is tier 0 (never guess)', async () => {
    stubRpc(() => null);
    expect((await guardianInfoForPubkey(owner.toBase58())).tier).toBe(0);
    expect((await guardianInfoForPubkey('not-a-wallet')).tier).toBe(0);
    resetGuardianCacheForTests();
    vi.stubGlobal('fetch', async () => {
      throw new Error('rpc down');
    });
    expect((await guardianInfoForPubkey(owner.toBase58())).tier).toBe(0);
  });

  it('the dust floor from env applies (9 staked < floor 10)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    stubRpc(() => positionImage(9n, 0, nowSec - GUARDIAN_SEASONING_SECONDS - 10));
    expect((await guardianInfoForPubkey(owner.toBase58())).tier).toBe(0);
  });
});
