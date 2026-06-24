// Live devnet integration for the woc_spin_vault program: drives every
// instruction through the IDL-free encoders against the deployed program and
// asserts the on-chain guards (replay, cap, winner-binding, pause). Gated on
// RUN_DEVNET=1 so it never runs in a normal suite. Needs the deployer keypair
// (SOLANA_DEVNET_DEPLOYER -> /tmp/woc-deployer.json) and SPIN_VAULT_PROGRAM_ID.
// Captures every signature to /tmp/spin_vault_sigs.json for the Solscan links.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  type TransactionInstruction,
  type Signer,
} from '@solana/web3.js';
import {
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

const RUN = process.env.RUN_DEVNET === '1';
const suite = RUN ? describe : describe.skip;

suite('woc_spin_vault on devnet', () => {
  const conn = new Connection(process.env.DEVNET_RPC || 'https://api.devnet.solana.com', 'confirmed');
  const programId = new PublicKey(process.env.SPIN_VAULT_PROGRAM_ID || '9TPiQxpBkjUoxKtkqH1qQrG92aUaKQJj96uyZddAwRZ9');
  const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/tmp/woc-deployer.json', 'utf8'))));
  // The deployer is both authority and settler for the test; production splits them.
  const authority = deployer;
  const settler = deployer;
  const winner = Keypair.generate();
  const accountId = BigInt(Math.floor(Date.parse('2026-06-24T13:00:00Z') / 1000) % 1_000_000); // unique-ish per run
  const day = accountId; // any u64; reuse for a unique receipt seed this run

  const sigs: Record<string, string> = {};

  async function send(label: string, ixs: TransactionInstruction[], signers: Signer[]): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(...signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    sigs[label] = sig;
    return sig;
  }

  it(
    'exercises initialize, configure, register_wallet, fund, payout, withdraw and the guards',
    async () => {
      const maxPayout = BigInt(0.05 * LAMPORTS_PER_SOL);

      // initialize (idempotent across runs: skip if the config PDA already exists)
      const cfg = configPda(programId);
      const cfgInfo = await conn.getAccountInfo(cfg);
      if (!cfgInfo) {
        await send('initialize', [initializeIx({ programId, authority: authority.publicKey, settler: settler.publicKey, maxPayout })], [authority]);
      }

      // configure: re-assert settler + cap, unpaused
      await send('configure', [configureIx({ programId, authority: authority.publicKey, settler: settler.publicKey, maxPayout, paused: false })], [authority]);

      // register_wallet: bind this account_id to the winner wallet (authority only)
      await send('register_wallet', [registerWalletIx({ programId, authority: authority.publicKey, accountId, wallet: winner.publicKey })], [authority]);

      // fund the vault with 0.1 SOL
      await send('fund', [fundIx({ programId, funder: authority.publicKey, lamports: BigInt(0.1 * LAMPORTS_PER_SOL) })], [authority]);

      // payout 0.01 SOL to the registered winner
      const payAmount = BigInt(0.01 * LAMPORTS_PER_SOL);
      const beforeWinner = await conn.getBalance(winner.publicKey);
      await send('payout', [payoutIx({ programId, settler: settler.publicKey, winner: winner.publicKey, day, accountId, amount: payAmount })], [settler]);
      const afterWinner = await conn.getBalance(winner.publicKey);
      expect(afterWinner - beforeWinner).toBe(Number(payAmount));

      // GUARD: replaying the same (day, account_id) fails (receipt PDA already init'd)
      await expect(
        send('payout_replay', [payoutIx({ programId, settler: settler.publicKey, winner: winner.publicKey, day, accountId, amount: payAmount })], [settler]),
      ).rejects.toBeTruthy();

      // GUARD: over-cap payout fails (amount > max_payout)
      await expect(
        send('payout_overcap', [payoutIx({ programId, settler: settler.publicKey, winner: winner.publicKey, day: day + 1n, accountId, amount: maxPayout + 1n })], [settler]),
      ).rejects.toBeTruthy();

      // GUARD: wrong winner fails (address != registry.wallet)
      const imposter = Keypair.generate().publicKey;
      await expect(
        send('payout_wrong_winner', [payoutIx({ programId, settler: settler.publicKey, winner: imposter, day: day + 2n, accountId, amount: payAmount })], [settler]),
      ).rejects.toBeTruthy();

      // GUARD: pause blocks payout; then unpause
      await send('pause', [configureIx({ programId, authority: authority.publicKey, settler: settler.publicKey, maxPayout, paused: true })], [authority]);
      await expect(
        send('payout_paused', [payoutIx({ programId, settler: settler.publicKey, winner: winner.publicKey, day: day + 3n, accountId, amount: payAmount })], [settler]),
      ).rejects.toBeTruthy();
      await send('unpause', [configureIx({ programId, authority: authority.publicKey, settler: settler.publicKey, maxPayout, paused: false })], [authority]);

      // withdraw 0.02 SOL from the vault back to the authority
      await send('withdraw', [withdrawIx({ programId, authority: authority.publicKey, lamports: BigInt(0.02 * LAMPORTS_PER_SOL) })], [authority]);

      // Persist the successful signatures + key accounts for the Solscan links.
      const out = {
        programId: programId.toBase58(),
        configPda: configPda(programId).toBase58(),
        registryPda: walletRegistryPda(programId, accountId).toBase58(),
        receiptPda: receiptPda(programId, day, accountId).toBase58(),
        winner: winner.publicKey.toBase58(),
        sigs,
      };
      fs.writeFileSync('/tmp/spin_vault_sigs.json', JSON.stringify(out, null, 2));
      // Avoid an unused import lint and assert the vault still holds its config.
      expect((await conn.getAccountInfo(configPda(programId)))?.owner.equals(programId)).toBe(true);
      void SystemProgram.programId;
      console.log('[devnet] signatures:', JSON.stringify(out, null, 2));
    },
    240_000,
  );
});
