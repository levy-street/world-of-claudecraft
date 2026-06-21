// Keystone integration test for stake-to-provision (#475): proves the whole
// server provisioning path end to end against BOTH a real Postgres and a real
// validator. A staker locks $WOC into the escrow for a provisioning realm, the
// server verifies the finalized lock on chain (verifyStakeLock), then records it
// and brings the realm online (recordProvisionedStake). Also checks the negative
// verdicts (wrong amount, wrong payer).
//
// Gated on PG_TEST_URL + REALM_ESCROW_RPC (skips in CI). Needs the program
// deployed at REALM_ESCROW_PROGRAM_ID and the Solana CLI for token setup. Run:
//   PG_TEST_URL=... REALM_ESCROW_RPC=http://127.0.0.1:8899 \
//   SOLANA_RPC_URL=http://127.0.0.1:8899 REALM_ESCROW_PROGRAM_ID=<id> \
//   SOLANA_BIN=<...> npx vitest run tests/realm_provision.localnet.test.ts

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const PG = process.env.PG_TEST_URL;
const RPC = process.env.REALM_ESCROW_RPC;
const SOLANA_BIN = process.env.SOLANA_BIN ?? join(homedir(), '.local/share/solana/install/active_release/bin');
// db.ts + solana_tx read these at import time; point both at the test backends
// before the dynamic imports below.
if (PG) process.env.DATABASE_URL ??= PG;
if (RPC) process.env.SOLANA_RPC_URL ??= RPC;

const run = PG && RPC ? describe : describe.skip;

run('stake-to-provision against real Postgres + validator', () => {
  let db: typeof import('../server/db');
  let realmDb: typeof import('../server/realm_db');
  let stakeDb: typeof import('../server/realm_stake_db');
  let escrow: typeof import('../server/realm_escrow');
  let provision: typeof import('../server/realm_provision');

  // Send + simulate at 'confirmed' so freshly-created setup accounts (mint, ATA)
  // are visible; the verify path waits for the lock to finalize separately.
  // describe.skip still runs this body during collection, so default the URL
  // when unset (the connection is only used inside the gated test bodies).
  const conn = new Connection(RPC ?? 'http://127.0.0.1:8899', 'confirmed');
  const tmp = mkdtempSync(join(tmpdir(), 'woc-provision-'));
  // Local validator: generate + airdrop. Devnet (no faucet): REALM_TEST_FUNDER.
  const FUNDER = process.env.REALM_TEST_FUNDER;
  const staker = FUNDER
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(FUNDER, 'utf8'))))
    : Keypair.generate();
  const mintKp = Keypair.generate();
  const stakerFile = join(tmp, 'staker.json');
  const mintFile = join(tmp, 'mint.json');
  const mint = mintKp.publicKey;
  const DECIMALS = 6;
  const MINTED = 1_000n * 10n ** BigInt(DECIMALS);
  const STAKE = 250n * 10n ** BigInt(DECIMALS);
  let accountId: number;
  let stakerAta: PublicKey;

  function spl(args: string[]): string {
    return execFileSync(join(SOLANA_BIN, 'spl-token'), [...args, '--url', RPC as string], { encoding: 'utf8' });
  }

  beforeAll(async () => {
    db = await import('../server/db');
    realmDb = await import('../server/realm_db');
    stakeDb = await import('../server/realm_stake_db');
    escrow = await import('../server/realm_escrow');
    provision = await import('../server/realm_provision');

    await db.pool.query('DROP TABLE IF EXISTS realm_stakes, realm_roles, realms CASCADE');
    await db.ensureSchema();
    accountId = (await db.createAccount(`staker_${Date.now()}`, 'hash')).id;

    writeFileSync(stakerFile, JSON.stringify(Array.from(staker.secretKey)));
    writeFileSync(mintFile, JSON.stringify(Array.from(mintKp.secretKey)));
    if (!FUNDER) {
      await conn.confirmTransaction(await conn.requestAirdrop(staker.publicKey, 5_000_000_000), 'confirmed');
    }
    spl(['create-token', mintFile, '--decimals', String(DECIMALS), '--fee-payer', stakerFile, '--mint-authority', staker.publicKey.toBase58()]);
    spl(['create-account', mint.toBase58(), '--fee-payer', stakerFile, '--owner', staker.publicKey.toBase58()]);
    spl(['mint', mint.toBase58(), String(MINTED / 10n ** BigInt(DECIMALS)), '--mint-authority', stakerFile, '--fee-payer', stakerFile, '--recipient-owner', staker.publicKey.toBase58()]);
    stakerAta = escrow.realmVaultAddress(staker.publicKey, mint); // generic ATA(owner, mint)
  }, 120_000);

  afterAll(async () => {
    await db.pool.end();
  });

  async function lockFor(realmId: number, amount: bigint): Promise<string> {
    const ix = escrow.buildLockIx({ staker: staker.publicKey, realmId, amount, mint, stakerToken: stakerAta });
    return sendAndConfirmTransaction(conn, new Transaction().add(ix), [staker], { commitment: 'confirmed' });
  }

  // The verify path reads finalized state, so wait for the lock to finalize.
  async function waitFinalized(sig: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
      if (st.value?.confirmationStatus === 'finalized') return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for finalization: ${sig}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  it('verifies a real lock and brings the realm online (active + stake recorded + owner role)', async () => {
    const realm = await realmDb.createProvisioningRealm(db.pool, {
      name: `Provisioned ${Date.now()}`,
      type: 'PvP',
      ownerAccountId: accountId,
      tier: 3,
    });
    expect(realm.status).toBe('provisioning');

    const sig = await lockFor(realm.realmId, STAKE);
    await waitFinalized(sig);

    const verdict = await provision.verifyStakeLock({
      lockSig: sig,
      realmId: realm.realmId,
      stakerWallet: staker.publicKey.toBase58(),
      mint: mint.toBase58(),
      expectedAmount: STAKE,
    });
    expect(verdict).toEqual({ ok: true, amountBase: STAKE });

    const stake = await provision.recordProvisionedStake(db.pool, {
      realmId: realm.realmId,
      accountId,
      stakerWallet: staker.publicKey.toBase58(),
      mint: mint.toBase58(),
      amountBase: STAKE,
      tier: 3,
      lockTxSig: sig,
    });
    expect(stake.amountBase).toBe(STAKE);

    // realm is now active, the stake is recorded, and the owner role is granted
    expect((await realmDb.getRealmById(db.pool, realm.realmId))?.status).toBe('active');
    expect((await stakeDb.getActiveStakeByRealm(db.pool, realm.realmId))?.lockTxSig).toBe(sig);
    expect(await realmDb.rolesForAccountOnRealm(db.pool, realm.realmId, accountId)).toContain('owner');

    // replay guard: re-recording the same finalized lock is rejected
    const { isUniqueViolation } = await import('../server/http_util');
    let dup: unknown;
    await provision
      .recordProvisionedStake(db.pool, { realmId: realm.realmId, accountId, stakerWallet: staker.publicKey.toBase58(), mint: mint.toBase58(), amountBase: STAKE, tier: 3, lockTxSig: sig })
      .catch((e) => {
        dup = e;
      });
    expect(isUniqueViolation(dup)).toBe(true);
  }, 120_000);

  it('rejects a lock whose amount or payer does not match the quote', async () => {
    const realm = await realmDb.createProvisioningRealm(db.pool, {
      name: `Mismatch ${Date.now()}`,
      type: 'Normal',
      ownerAccountId: accountId,
      tier: 1,
    });
    const sig = await lockFor(realm.realmId, STAKE);
    await waitFinalized(sig);

    // wrong expected amount: the vault credit does not equal the quote
    expect(
      await provision.verifyStakeLock({ lockSig: sig, realmId: realm.realmId, stakerWallet: staker.publicKey.toBase58(), mint: mint.toBase58(), expectedAmount: STAKE + 1n }),
    ).toEqual({ ok: false, reason: 'wrong_vault_amount' });

    // wrong payer: the staked wallet is not the one that funded the lock
    expect(
      await provision.verifyStakeLock({ lockSig: sig, realmId: realm.realmId, stakerWallet: Keypair.generate().publicKey.toBase58(), mint: mint.toBase58(), expectedAmount: STAKE }),
    ).toEqual({ ok: false, reason: 'wrong_payer' });
  }, 120_000);
});
