// Proves the full stake-to-provision route logic (#475) end to end against a
// real Postgres AND a real validator: the exact functions the HTTP routes call.
// quote (name + cap + supply/tier gate, reserves a provisioning realm) -> the
// staker locks the quoted $WOC into the escrow -> confirm (verify finalized lock,
// record, activate, grant owner) -> decommission -> on-chain request/release ->
// finalize (close the realm once the PDA is gone).
//
// Gated on PG_TEST_URL + REALM_ESCROW_RPC. On devnet set REALM_TEST_FUNDER.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const PG = process.env.PG_TEST_URL;
const RPC = process.env.REALM_ESCROW_RPC;
const SOLANA_BIN = process.env.SOLANA_BIN ?? join(homedir(), '.local/share/solana/install/active_release/bin');
if (PG) process.env.DATABASE_URL ??= PG;
if (RPC) process.env.SOLANA_RPC_URL ??= RPC;
// A fixed mock $WOC mint so woc_config.WOC_MINT (read at import) is the mint we
// create on chain, which the supply read and lock both use. Only set the env
// when the suite will actually run, so a skipped collection does not pollute
// process.env for other test files in the worker.
// A fresh mock $WOC mint per run (set into WOC_MINT before the dynamic imports
// below) keeps the test re-runnable on a long-lived validator.
const mintKp = Keypair.generate();
if (PG && RPC) {
  process.env.WOC_MINT = mintKp.publicKey.toBase58();
  process.env.VITE_WOC_MINT = mintKp.publicKey.toBase58();
  process.env.REALM_UNSTAKE_TIMELOCK_SECONDS ??= '5'; // short UI timelock hint for the test
}

const run = PG && RPC ? describe : describe.skip;

run('stake-to-provision route logic, end to end', () => {
  let db: typeof import('../server/db');
  let provision: typeof import('../server/realm_provision');
  let realmDb: typeof import('../server/realm_db');
  let stakeDb: typeof import('../server/realm_stake_db');
  let quoteDb: typeof import('../server/realm_quote_db');
  let escrow: typeof import('../server/realm_escrow');

  // describe.skip still runs this body during collection, so default the URL
  // when unset (the connection is only used inside the gated test body).
  const conn = new Connection(RPC ?? 'http://127.0.0.1:8899', 'confirmed');
  const tmp = mkdtempSync(join(tmpdir(), 'woc-flow-'));
  const FUNDER = process.env.REALM_TEST_FUNDER;
  const staker = FUNDER
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(FUNDER, 'utf8'))))
    : Keypair.generate();
  const stakerFile = join(tmp, 'staker.json');
  const mintFile = join(tmp, 'mint.json');
  const mint = mintKp.publicKey;
  let accountId: number;
  let stakerAta: PublicKey;
  let stakeBase: bigint;

  function spl(args: string[]): string {
    return execFileSync(join(SOLANA_BIN, 'spl-token'), [...args, '--url', RPC as string], { encoding: 'utf8' });
  }
  async function send(...ixs: Parameters<Transaction['add']>): Promise<string> {
    return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [staker], { commitment: 'confirmed' });
  }
  async function waitFinalized(sig: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
      if (st.value?.confirmationStatus === 'finalized') return;
      if (Date.now() > deadline) throw new Error(`finalization timeout: ${sig}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  beforeAll(async () => {
    db = await import('../server/db');
    provision = await import('../server/realm_provision');
    realmDb = await import('../server/realm_db');
    stakeDb = await import('../server/realm_stake_db');
    quoteDb = await import('../server/realm_quote_db');
    escrow = await import('../server/realm_escrow');

    await db.pool.query('DROP TABLE IF EXISTS realm_quotes, realm_stakes, realm_roles, realms CASCADE');
    await db.ensureSchema();
    accountId = (await db.createAccount(`founder_${Date.now()}`, 'hash')).id;
    // Link the staker wallet to the account (provision requires a linked wallet).
    await db.pool.query('INSERT INTO wallet_links (account_id, pubkey, linked_at) VALUES ($1, $2, now())', [accountId, staker.publicKey.toBase58()]);

    writeFileSync(stakerFile, JSON.stringify(Array.from(staker.secretKey)));
    writeFileSync(mintFile, JSON.stringify(Array.from(mintKp.secretKey)));
    if (!FUNDER) {
      await conn.confirmTransaction(await conn.requestAirdrop(staker.publicKey, 5_000_000_000), 'confirmed');
    }
    // Create the mock $WOC mint (1e9 tokens) and give it all to the staker.
    spl(['create-token', mintFile, '--decimals', '6', '--fee-payer', stakerFile, '--mint-authority', staker.publicKey.toBase58()]);
    spl(['create-account', mint.toBase58(), '--fee-payer', stakerFile, '--owner', staker.publicKey.toBase58()]);
    spl(['mint', mint.toBase58(), '1000000000', '--mint-authority', stakerFile, '--fee-payer', stakerFile, '--recipient-owner', staker.publicKey.toBase58()]);
    stakerAta = escrow.realmVaultAddress(staker.publicKey, mint);
  }, 120_000);

  afterAll(async () => {
    await db.pool.end();
  });

  it('quotes, locks, confirms, decommissions, and finalizes a realm', async () => {
    const supply = await provision.getMintSupplyBase(mint.toBase58());
    expect(supply).not.toBeNull();
    const { minStakeBase } = await import('../server/realm_tiers');
    stakeBase = minStakeBase(supply!); // bronze: 1% of supply

    // 1) QUOTE
    const quote = await provision.prepareProvisionQuote(db.pool, {
      accountId,
      ownerWallet: staker.publicKey.toBase58(),
      name: `Founders ${Date.now() % 100000}`,
      type: 'PvP',
      amountBase: stakeBase,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.tier).toBe(1);
    expect(BigInt(quote.amountBase)).toBe(stakeBase);
    expect((await realmDb.getRealmById(db.pool, quote.realmId))?.status).toBe('provisioning');

    // 2) LOCK the quoted amount into the escrow vault, on chain
    const lockSig = await send(
      escrow.buildLockIx({ staker: staker.publicKey, realmId: quote.realmId, amount: stakeBase, mint, stakerToken: stakerAta }),
    );
    await waitFinalized(lockSig);

    // 3) CONFIRM
    const confirmed = await provision.confirmProvisionQuote(db.pool, { accountId, quoteId: quote.quoteId, lockSig });
    expect(confirmed.ok).toBe(true);

    // realm online, stake recorded, owner role granted, quote consumed
    expect((await realmDb.getRealmById(db.pool, quote.realmId))?.status).toBe('active');
    expect((await stakeDb.getActiveStakeByRealm(db.pool, quote.realmId))?.amountBase).toBe(stakeBase);
    expect(await realmDb.rolesForAccountOnRealm(db.pool, quote.realmId, accountId)).toContain('owner');
    expect(await quoteDb.getRealmQuote(db.pool, quote.quoteId)).toBeNull();

    // 4) DECOMMISSION (server marks decommissioning + stake releasing)
    const dec = await provision.requestRealmDecommission(db.pool, { accountId, realmId: quote.realmId });
    expect(dec.ok).toBe(true);
    expect((await realmDb.getRealmById(db.pool, quote.realmId))?.status).toBe('decommissioning');
    expect((await stakeDb.getActiveStakeByRealm(db.pool, quote.realmId))?.status).toBe('releasing');

    // 5) on-chain request_decommission + (timelock) + release, closing the PDA
    await send(escrow.buildRequestDecommissionIx({ owner: staker.publicKey, realmId: quote.realmId }));
    const stakeAcct = await conn.getAccountInfo(escrow.realmStakePda(quote.realmId));
    const eligible = escrow.decodeRealmStake(stakeAcct!.data).unlockEligibleSlot;
    while (BigInt(await conn.getSlot('confirmed')) < eligible) await new Promise((r) => setTimeout(r, 1000));
    const releaseSig = await send(escrow.buildReleaseIx({ owner: staker.publicKey, realmId: quote.realmId, mint, ownerToken: stakerAta }));
    await waitFinalized(releaseSig);

    // 6) FINALIZE (server confirms the PDA is gone, closes the realm)
    const fin = await provision.finalizeRealmRelease(db.pool, { accountId, realmId: quote.realmId });
    expect(fin.ok).toBe(true);
    expect((await realmDb.getRealmById(db.pool, quote.realmId))?.status).toBe('closed');
    // the staker has the full principal back
    const bal = await conn.getTokenAccountBalance(stakerAta, 'confirmed');
    expect(BigInt(bal.value.amount)).toBe(1_000_000_000n * 1_000_000n);
  }, 180_000);

  it('rejects a stake below the bronze minimum and an unlinked name reuse', async () => {
    const supply = (await provision.getMintSupplyBase(mint.toBase58()))!;
    const { minStakeBase } = await import('../server/realm_tiers');
    const tooSmall = await provision.prepareProvisionQuote(db.pool, {
      accountId,
      ownerWallet: staker.publicKey.toBase58(),
      name: `Tiny ${Date.now() % 100000}`,
      type: 'Normal',
      amountBase: minStakeBase(supply) - 1n,
    });
    expect(tooSmall).toMatchObject({ ok: false, status: 400, error: 'stake_below_minimum' });
  });
});
