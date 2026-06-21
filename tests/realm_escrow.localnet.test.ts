// Live integration test for the realm_stake_escrow program (#475). Drives the
// full non-custodial flow against a real validator: lock -> request_decommission
// -> (timelock) -> release, asserting the on-chain vault balance, the RealmStake
// account state at each step, and that the principal returns in full and the
// accounts close. Proves the deployed BPF object actually works, not just that
// the Rust compiles.
//
// Gated on REALM_ESCROW_RPC so CI (no validator) skips it. Run against a local
// validator (free local SOL):
//   solana-test-validator --reset &
//   solana program deploy solana/target/deploy/realm_stake_escrow.so \
//     --program-id solana/target/deploy/realm_stake_escrow-keypair.json
//   REALM_ESCROW_RPC=http://127.0.0.1:8899 \
//     REALM_ESCROW_PROGRAM_ID=<id> SOLANA_BIN=<...> \
//     npx vitest run tests/realm_escrow.localnet.test.ts
// The same test runs against devnet by pointing REALM_ESCROW_RPC at devnet.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  buildLockIx,
  buildReleaseIx,
  buildRequestDecommissionIx,
  decodeRealmStake,
  realmStakePda,
  realmVaultAddress,
} from '../server/realm_escrow';

const RPC = process.env.REALM_ESCROW_RPC;
const SOLANA_BIN = process.env.SOLANA_BIN ?? join(homedir(), '.local/share/solana/install/active_release/bin');
const run = RPC ? describe : describe.skip;

function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

run('realm_stake_escrow on a live validator', () => {
  const conn = new Connection(RPC as string, 'confirmed');
  const tmp = mkdtempSync(join(tmpdir(), 'woc-escrow-'));
  // On a local validator we generate + airdrop the actor; on devnet (no faucet)
  // set REALM_TEST_FUNDER to a funded keypair file and it is used directly.
  const FUNDER = process.env.REALM_TEST_FUNDER;
  const actor = FUNDER
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(FUNDER, 'utf8'))))
    : Keypair.generate();
  const mintKp = Keypair.generate();
  const actorFile = join(tmp, 'actor.json');
  const mintFile = join(tmp, 'mint.json');
  // A unique per-run realm id so the global PDA never collides across runs.
  const realmId = actor.publicKey.toBuffer().readBigUInt64LE(0);
  const mint = mintKp.publicKey;
  const actorAta = ataFor(actor.publicKey, mint);
  const DECIMALS = 6;
  const MINTED = 1_000n * 10n ** BigInt(DECIMALS); // 1000 mock $WOC
  const STAKE = 250n * 10n ** BigInt(DECIMALS); // stake 250

  function spl(args: string[]): string {
    return execFileSync(join(SOLANA_BIN, 'spl-token'), [...args, '--url', RPC as string], {
      encoding: 'utf8',
    });
  }

  beforeAll(async () => {
    writeFileSync(actorFile, JSON.stringify(Array.from(actor.secretKey)));
    writeFileSync(mintFile, JSON.stringify(Array.from(mintKp.secretKey)));
    // Fund the actor (fee payer + mint authority + staker). On devnet the actor
    // is the pre-funded REALM_TEST_FUNDER, so skip the (rate-limited) faucet.
    if (!FUNDER) {
      await conn.confirmTransaction(await conn.requestAirdrop(actor.publicKey, 5_000_000_000), 'confirmed');
    }
    // Create the 6-decimal mock $WOC mint with the actor as authority, the
    // actor's ATA, and mint MINTED to it (the stake source).
    spl(['create-token', mintFile, '--decimals', String(DECIMALS), '--fee-payer', actorFile, '--mint-authority', actor.publicKey.toBase58()]);
    spl(['create-account', mint.toBase58(), '--fee-payer', actorFile, '--owner', actor.publicKey.toBase58()]);
    spl(['mint', mint.toBase58(), String(MINTED / 10n ** BigInt(DECIMALS)), '--mint-authority', actorFile, '--fee-payer', actorFile, '--recipient-owner', actor.publicKey.toBase58()]);
  }, 120_000);

  afterAll(() => {
    // best-effort temp cleanup is handled by the OS; nothing on-chain to undo.
  });

  async function send(...ixs: TransactionInstruction[]): Promise<void> {
    const tx = new Transaction().add(...ixs);
    await sendAndConfirmTransaction(conn, tx, [actor], { commitment: 'confirmed' });
  }

  async function tokenAmount(ata: PublicKey): Promise<bigint> {
    const bal = await conn.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(bal.value.amount);
  }

  it('starts with the full minted balance and no stake account', async () => {
    expect(await tokenAmount(actorAta)).toBe(MINTED);
    const stake = realmStakePda(realmId);
    expect(await conn.getAccountInfo(stake)).toBeNull();
  });

  it('lock: moves the stake into the program-owned vault and records it', async () => {
    await send(buildLockIx({ staker: actor.publicKey, realmId, amount: STAKE, mint, stakerToken: actorAta }));

    const vault = realmVaultAddress(realmStakePda(realmId), mint);
    expect(await tokenAmount(vault)).toBe(STAKE); // staked principal is in the vault
    expect(await tokenAmount(actorAta)).toBe(MINTED - STAKE); // debited from the staker

    const info = await conn.getAccountInfo(realmStakePda(realmId));
    expect(info).not.toBeNull();
    const stake = decodeRealmStake(info!.data);
    expect(stake.owner.equals(actor.publicKey)).toBe(true);
    expect(stake.mint.equals(mint)).toBe(true);
    expect(stake.amount).toBe(STAKE);
    expect(stake.realmId).toBe(realmId);
    expect(stake.status).toBe('locked');
    expect(stake.unlockEligibleSlot).toBe(0n);
  });

  it('request_decommission: starts the timelock, owner-only', async () => {
    await send(buildRequestDecommissionIx({ owner: actor.publicKey, realmId }));
    const info = await conn.getAccountInfo(realmStakePda(realmId));
    const stake = decodeRealmStake(info!.data);
    expect(stake.status).toBe('decommissioning');
    expect(stake.unlockEligibleSlot).toBeGreaterThan(stake.lockedAtSlot);
  });

  it('release: returns the full principal after the timelock and closes the accounts', async () => {
    // Wait for the on-chain timelock (UNLOCK_TIMELOCK_SLOTS) to elapse.
    const info = await conn.getAccountInfo(realmStakePda(realmId));
    const eligible = decodeRealmStake(info!.data).unlockEligibleSlot;
    const deadline = Date.now() + 90_000;
    while (BigInt(await conn.getSlot('confirmed')) < eligible) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the unstake timelock');
      await new Promise((r) => setTimeout(r, 1000));
    }

    await send(buildReleaseIx({ owner: actor.publicKey, realmId, mint, ownerToken: actorAta }));

    expect(await tokenAmount(actorAta)).toBe(MINTED); // full principal back, nothing lost
    expect(await conn.getAccountInfo(realmStakePda(realmId))).toBeNull(); // stake account closed
    expect(await conn.getAccountInfo(realmVaultAddress(realmStakePda(realmId), mint))).toBeNull(); // vault closed
  }, 120_000);
});
