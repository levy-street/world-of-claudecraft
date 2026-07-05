// Live-devnet proof of the woc_lp_vault program (9zSK...) end to end: init_pool
// (first run only), open_position + stake in one tx, the monotone lock rule, a
// refused early unstake (StillLocked), extend_lock, the post-expiry unstake,
// and close_position reclaiming rent. Asserts on-chain truth (Position/Pool
// decode, vault + staker token balances) and prints every signature as a
// DEVNET_LP_VAULT line for the solscan write-up.
//
// Gated on WOC_DEVNET_TEST=1 (skipped in CI / normal runs). Harness state:
// the staker keypair at /tmp/lp_staker.json holds mock LP tokens
// (4PuM...GyWF, minted via the spl-token CLI) and a little SOL for fees; the
// pool authority is the funded deployer keypair (SOLANA_DEVNET_DEPLOYER).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  closePositionIx,
  decodePool,
  decodePosition,
  extendLockIx,
  initPoolIx,
  openPositionIx,
  poolPda,
  positionPda,
  positionVault,
  stakeIx,
  unstakeIx,
} from '../server/lp_vault_client';
import { vaultAta } from '../server/woc_escrow_client';

const RUN = process.env.WOC_DEVNET_TEST === '1';
const PROGRAM = new PublicKey(
  process.env.WOC_LP_VAULT_PROGRAM_ID ?? '9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6',
);
const LP_MINT = new PublicKey(
  process.env.WOC_LP_DEVNET_MINT ?? '4PuMWqSzfJxfWvMZFC4fQoFUjzLdob6791Cx2z68GyWF',
);
const RPC = process.env.WOC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
const STAKE = 25_000_000n; // 25 mock LP

const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(RUN ? describe : describe.skip)('woc_lp_vault: full staking lifecycle on live devnet', () => {
  const conn = new Connection(RPC, 'confirmed');
  const staker = kp('/tmp/lp_staker.json');
  const authority = kp(process.env.SOLANA_DEVNET_DEPLOYER ?? '');
  const ids = { programId: PROGRAM, lpMint: LP_MINT };
  const pool = poolPda(PROGRAM, LP_MINT);
  const position = positionPda(PROGRAM, pool, staker.publicKey);
  const vault = positionVault(PROGRAM, LP_MINT, staker.publicKey);
  const sigs: Record<string, string> = {};

  // Confirmation by HTTP polling (getSignatureStatus), NOT conn.confirmTransaction:
  // the websocket subscription path resolves rpc-websockets' browser build under
  // vitest and crashes on the missing `window` (same reason the payout keeper
  // polls signatureStatus over plain RPC).
  const confirm = async (sig: string) => {
    for (let i = 0; i < 60; i++) {
      const st = (await conn.getSignatureStatus(sig, { searchTransactionHistory: true })).value;
      if (st?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(st.err)}`);
      if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return;
      await sleep(1_000);
    }
    throw new Error(`confirmation timed out for ${sig}`);
  };
  const send = async (ixs: TransactionInstruction[], signer: Keypair) => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(
      ...ixs,
    );
    tx.sign(signer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await confirm(sig);
    return sig;
  };
  const lpBalance = async (owner: PublicKey) =>
    BigInt((await conn.getTokenAccountBalance(vaultAta(owner, LP_MINT))).value.amount);
  const positionState = async () => {
    const info = await conn.getAccountInfo(position);
    return info ? decodePosition(info.data) : null;
  };

  it('init_pool (idempotent across runs) registers the LP mint pool', async () => {
    const existing = await conn.getAccountInfo(pool);
    if (!existing) {
      sigs.initPool = await send(
        [initPoolIx({ ...ids, authority: authority.publicKey })],
        authority,
      );
    }
    const decoded = decodePool((await conn.getAccountInfo(pool))!.data);
    expect(decoded.lpMint.equals(LP_MINT)).toBe(true);
    expect(decoded.authority.equals(authority.publicKey)).toBe(true);
    expect(decoded.paused).toBe(false);
  }, 120_000);

  it('open_position + stake locks LP into the program vault with a monotone lock', async () => {
    const before = await lpBalance(staker.publicKey);
    const existing = await positionState();
    const residual = existing?.amount ?? 0n; // tolerate leftovers from an interrupted prior run
    const stake1 = stakeIx({ ...ids, owner: staker.publicKey, amountBase: STAKE, lockSeconds: 60 });
    sigs.stake = await send(
      existing ? [stake1] : [openPositionIx({ ...ids, owner: staker.publicKey }), stake1],
      staker,
    );

    const p1 = (await positionState())!;
    expect(p1.amount).toBe(residual + STAKE);
    expect(await lpBalance(staker.publicKey)).toBe(before - STAKE);
    expect(BigInt((await conn.getTokenAccountBalance(vault)).value.amount)).toBe(residual + STAKE);
    const lockedUntil1 = p1.lockedUntil;
    expect(Number(lockedUntil1)).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30);

    // a second stake with NO lock must keep the longer existing lock (monotone)
    sigs.stakeMore = await send(
      [stakeIx({ ...ids, owner: staker.publicKey, amountBase: STAKE, lockSeconds: 0 })],
      staker,
    );
    const p2 = (await positionState())!;
    expect(p2.amount).toBe(residual + STAKE * 2n);
    expect(p2.lockedUntil).toBe(lockedUntil1);
  }, 180_000);

  it('unstake before expiry is refused on-chain (StillLocked)', async () => {
    const held = (await positionState())!.amount;
    await expect(
      send([unstakeIx({ ...ids, owner: staker.publicKey, amountBase: 1n })], staker),
    ).rejects.toThrow(/custom program error|Simulation failed/i);
    expect((await positionState())!.amount).toBe(held); // nothing moved
  }, 120_000);

  it('extend_lock pushes the expiry later, never earlier', async () => {
    const before = (await positionState())!.lockedUntil;
    sigs.extend = await send(
      [extendLockIx({ ...ids, owner: staker.publicKey, lockSeconds: 90 })],
      staker,
    );
    const after = (await positionState())!.lockedUntil;
    expect(after > before).toBe(true);
    // and a shorter request than the remaining lock is refused (LockNotExtended)
    await expect(
      send([extendLockIx({ ...ids, owner: staker.publicKey, lockSeconds: 1 })], staker),
    ).rejects.toThrow(/custom program error|Simulation failed/i);
  }, 120_000);

  it('after expiry: full unstake returns the LP, close_position reclaims rent', async () => {
    const expiry = Number((await positionState())!.lockedUntil);
    const waitMs = Math.max(0, (expiry - Math.floor(Date.now() / 1000)) * 1000 + 5_000);
    await sleep(waitMs);

    const before = await lpBalance(staker.publicKey);
    const held = (await positionState())!.amount;
    sigs.unstake = await send(
      [unstakeIx({ ...ids, owner: staker.publicKey, amountBase: held })],
      staker,
    );
    expect(await lpBalance(staker.publicKey)).toBe(before + held);
    expect((await positionState())!.amount).toBe(0n);

    const lamportsBefore = await conn.getBalance(staker.publicKey);
    sigs.close = await send([closePositionIx({ ...ids, owner: staker.publicKey })], staker);
    expect(await positionState()).toBeNull(); // position PDA closed
    expect(await conn.getAccountInfo(vault)).toBeNull(); // vault ATA closed
    expect(await conn.getBalance(staker.publicKey)).toBeGreaterThan(lamportsBefore); // rent back, minus the fee

    const out = process.env.DEVNET_SIGS_OUT;
    if (out) writeFileSync(out, JSON.stringify(sigs, null, 2));
    console.log('DEVNET_LP_VAULT ' + JSON.stringify(sigs));
  }, 300_000);
});
