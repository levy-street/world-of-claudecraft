// Live-devnet proof of the LP fee-share on-chain legs against the deployed
// woc_escrow (Fn4L...): the full distribution lifecycle (open, fund, payout to
// a wallet with NO existing token account via the idempotent ATA create, an
// over-payout refused by InsufficientPool, close reclaiming dust + rent) and a
// DRIP-SPLIT settle exactly as the marketplace keeper signs it (burn main +
// fund_distribution drip in ONE transaction, split by splitDrip). Prints every
// signature as a DEVNET_LP_FEESHARE line.
//
// Gated on WOC_DEVNET_TEST=1. Harness state: the deployer keypair
// (SOLANA_DEVNET_DEPLOYER) holds mock $WOC as the distribution authority, and
// /tmp/lp_drip_vault.json plays the buyback vault (mock $WOC + fee SOL).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

// payout_keeper transitively imports db.ts, which needs DATABASE_URL at import.
process.env.DATABASE_URL ??= 'postgres://skip:skip@127.0.0.1:1/skip';
const { burnCheckedIx, splitDrip } = await import('../server/payout_keeper');
const {
  closeDistributionIx,
  createAtaIdempotentIx,
  distributionPda,
  fundDistributionIx,
  openDistributionIx,
  payoutIx,
  vaultAta,
} = await import('../server/woc_escrow_client');

const RUN = process.env.WOC_DEVNET_TEST === '1';
const PROGRAM = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const MINT = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const RPC = process.env.WOC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
const WOC = 1_000_000n; // 1 mock $WOC (6 decimals)

const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(RUN ? describe : describe.skip)('LP fee-share distribution + drip split on live devnet', () => {
  const conn = new Connection(RPC, 'confirmed');
  const authority = kp(process.env.SOLANA_DEVNET_DEPLOYER ?? '');
  const dripVault = kp('/tmp/lp_drip_vault.json');
  const recipient = Keypair.generate(); // brand new wallet: no SOL, no token account
  const seasonId = BigInt(Date.now());
  const ids = { programId: PROGRAM, mint: MINT, seasonId };
  const distribution = distributionPda(PROGRAM, seasonId);
  const vault = vaultAta(distribution, MINT);
  const sigs: Record<string, string> = {};

  // HTTP-polled confirmation (see lp_vault.devnet.test.ts for why not
  // conn.confirmTransaction: the websocket path breaks under vitest).
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
  const balance = async (ata: PublicKey) => {
    const info = await conn.getParsedAccountInfo(ata);
    const data = info.value?.data;
    if (!data || !('parsed' in data)) return 0n;
    return BigInt(data.parsed.info.tokenAmount.amount);
  };
  const supply = async () => BigInt((await conn.getTokenSupply(MINT)).value.amount);

  it('open + fund the LP season distribution', async () => {
    sigs.open = await send(
      [openDistributionIx({ ...ids, authority: authority.publicKey })],
      authority,
    );
    expect(await conn.getAccountInfo(distribution)).not.toBeNull();
    sigs.fund = await send(
      [fundDistributionIx({ ...ids, funder: authority.publicKey, amountBase: 50n * WOC })],
      authority,
    );
    expect(await balance(vault)).toBe(50n * WOC);
  }, 180_000);

  it('payout lands for a wallet with no token account (idempotent ATA create)', async () => {
    expect(await conn.getAccountInfo(vaultAta(recipient.publicKey, MINT))).toBeNull();
    sigs.payout = await send(
      [
        createAtaIdempotentIx({
          payer: authority.publicKey,
          owner: recipient.publicKey,
          mint: MINT,
        }),
        payoutIx({
          ...ids,
          authority: authority.publicKey,
          recipient: recipient.publicKey,
          amountBase: 20n * WOC,
        }),
      ],
      authority,
    );
    expect(await balance(vaultAta(recipient.publicKey, MINT))).toBe(20n * WOC);
    expect(await balance(vault)).toBe(30n * WOC);
  }, 180_000);

  it('an over-payout is refused on-chain (InsufficientPool)', async () => {
    await expect(
      send(
        [
          payoutIx({
            ...ids,
            authority: authority.publicKey,
            recipient: recipient.publicKey,
            amountBase: 100n * WOC,
          }),
        ],
        authority,
      ),
    ).rejects.toThrow(/custom program error|Simulation failed/i);
    expect(await balance(vault)).toBe(30n * WOC); // nothing moved
  }, 120_000);

  it('drip-split settle: burn the main leg + fund_distribution the drip leg in one tx', async () => {
    const settled = 10n * WOC;
    const { mainBase, dripBase } = splitDrip(settled, 3_000); // 30% drip
    expect(mainBase).toBe(7n * WOC);
    expect(dripBase).toBe(3n * WOC);
    const supplyBefore = await supply();
    const vaultBefore = await balance(vault);
    const dripAta = vaultAta(dripVault.publicKey, MINT);
    sigs.dripSettle = await send(
      [
        burnCheckedIx(dripAta, MINT, dripVault.publicKey, mainBase, 6),
        fundDistributionIx({ ...ids, funder: dripVault.publicKey, amountBase: dripBase }),
      ],
      dripVault,
    );
    expect(supplyBefore - (await supply())).toBe(mainBase); // main leg burned
    expect((await balance(vault)) - vaultBefore).toBe(dripBase); // drip leg funded
  }, 180_000);

  it('close_distribution returns the dust and the rent to the authority', async () => {
    const authorityAta = vaultAta(authority.publicKey, MINT);
    const before = await balance(authorityAta);
    const dust = await balance(vault);
    sigs.close = await send(
      [closeDistributionIx({ ...ids, authority: authority.publicKey })],
      authority,
    );
    expect((await balance(authorityAta)) - before).toBe(dust);
    expect(await conn.getAccountInfo(vault)).toBeNull();

    const out = process.env.DEVNET_SIGS_OUT;
    if (out) writeFileSync(out, JSON.stringify(sigs, null, 2));
    console.log('DEVNET_LP_FEESHARE ' + JSON.stringify(sigs));
  }, 180_000);
});
