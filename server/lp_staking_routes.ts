// HTTP glue for the LP staking tx-builder endpoints (POST /api/woc/lp/tx/*).
// Kept out of main.ts per module-first: pure request validation + service
// calls, unit-testable with a fake service. The endpoints return UNSIGNED
// base64 transactions for the staker's own wallet to sign (non-custodial: the
// server never holds a staker key and cannot move principal).
import type * as http from 'node:http';
import { PublicKey, type Transaction } from '@solana/web3.js';
import { json, readBody } from './http_util';
import { isSolanaAddress } from './wallet_link';

export interface LpTxBuilder {
  buildStakeTx(owner: PublicKey, amountBase: bigint, lockSeconds: number): Promise<Transaction>;
  buildUnstakeTx(owner: PublicKey, amountBase: bigint): Promise<Transaction>;
  buildExtendLockTx(owner: PublicKey, lockSeconds: number): Promise<Transaction>;
  buildClosePositionTx(owner: PublicKey): Promise<Transaction>;
}

/** Parse a client-supplied base-unit amount into a positive bigint, or null if malformed. */
export function parseAmountBase(raw: unknown): bigint | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || raw.length > 20) return null;
  const v = BigInt(raw);
  return v <= 0xffffffffffffffffn ? v : null; // must fit the program's u64
}

/** Parse a lock duration in seconds (integer >= 0), or null if malformed. */
export function parseLockSeconds(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && /^[0-9]{1,10}$/.test(raw)) return Number(raw);
  return null;
}

const encode = (tx: Transaction): string =>
  tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

export async function handleLpTxBuild(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  svc: LpTxBuilder,
  path: string,
): Promise<void> {
  const body = await readBody(req);
  const owner = body?.owner;
  if (!isSolanaAddress(owner)) return json(res, 400, { error: 'owner must be a Solana address' });
  const ownerKey = new PublicKey(owner);
  try {
    if (path === '/api/woc/lp/tx/stake') {
      const amount = parseAmountBase(body?.amountBase);
      const lock = parseLockSeconds(body?.lockSeconds ?? 0);
      if (amount === null)
        return json(res, 400, { error: 'amountBase must be a positive base-unit string' });
      if (lock === null)
        return json(res, 400, { error: 'lockSeconds must be a non-negative integer' });
      return json(res, 200, { tx: encode(await svc.buildStakeTx(ownerKey, amount, lock)) });
    }
    if (path === '/api/woc/lp/tx/unstake') {
      const amount = parseAmountBase(body?.amountBase);
      if (amount === null)
        return json(res, 400, { error: 'amountBase must be a positive base-unit string' });
      return json(res, 200, { tx: encode(await svc.buildUnstakeTx(ownerKey, amount)) });
    }
    if (path === '/api/woc/lp/tx/extend') {
      const lock = parseLockSeconds(body?.lockSeconds);
      if (lock === null || lock === 0)
        return json(res, 400, { error: 'lockSeconds must be a positive integer' });
      return json(res, 200, { tx: encode(await svc.buildExtendLockTx(ownerKey, lock)) });
    }
    if (path === '/api/woc/lp/tx/close') {
      return json(res, 200, { tx: encode(await svc.buildClosePositionTx(ownerKey)) });
    }
  } catch (err) {
    // The builders throw on out-of-range args (defense in depth behind the
    // parsers above) and on RPC failures; neither should 500 with internals.
    return json(res, 400, {
      error: err instanceof Error ? err.message : 'could not build transaction',
    });
  }
  return json(res, 404, { error: 'unknown endpoint' });
}
