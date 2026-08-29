// Devnet dry-run environment setup. Idempotent: keypairs are loaded when the
// gitignored files already exist, airdrops only top up low balances, and the
// mint is created once and recorded beside the keys. Secrets stay in
// /Users/fernando/Documents/woc-rewards-service-pr31/devnet-*-keypair.json
// (all matched by .gitignore rules verified before this script existed).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';

const RPC = process.env.DEVNET_RPC || 'https://api.devnet.solana.com';
const DIR = '/Users/fernando/Documents/woc-rewards-service-pr31';
const MINT_RECORD = `${DIR}/devnet-mint-record.local.json`;
const DECIMALS = 6;

function loadOrCreate(name) {
  const path = `${DIR}/devnet-${name}-keypair.json`;
  if (existsSync(path)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`created ${path}`);
  return kp;
}

const conn = new Connection(RPC, 'confirmed');
const authority = loadOrCreate('mint-authority'); // also the fee payer for setup
const escrow = loadOrCreate('escrow');
const treasury = loadOrCreate('treasury');
const buyer = loadOrCreate('buyer');
const seller = loadOrCreate('seller');

const roster = { authority, escrow, treasury, buyer, seller };
for (const [name, kp] of Object.entries(roster)) {
  console.log(`${name}: ${kp.publicKey.toBase58()}`);
}

async function ensureSol(kp, wantSol, label) {
  // Math.round: 1.2 * LAMPORTS_PER_SOL is 1200000000.0000002 in floats, so a
  // balance of exactly the want would otherwise judge as underfunded.
  const wantLamports = Math.round(wantSol * LAMPORTS_PER_SOL);
  const bal = await conn.getBalance(kp.publicKey);
  console.log(`${label} balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (bal >= wantLamports) return true;
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
    console.log(`${label} airdrop ok: ${sig}`);
  } catch (err) {
    console.log(`${label} airdrop FAILED: ${String(err).slice(0, 200)}`);
  }
  // Re-read and judge the balance, never the airdrop's word for it: a capped
  // faucet grant below the want must not count as funded. (The public devnet
  // endpoint is load-balanced, so this re-read can transiently miss a
  // just-confirmed airdrop; a rerun of this idempotent script recovers.)
  return (await conn.getBalance(kp.publicKey)) >= wantLamports;
}

async function transferSol(from, to, sol, label) {
  const bal = await conn.getBalance(to);
  if (bal >= sol * LAMPORTS_PER_SOL) {
    console.log(`${label} already funded (${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
    return;
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Math.round(sol * LAMPORTS_PER_SOL) - bal,
    }),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [from]);
  console.log(`${label} funded: ${sig}`);
}

const funded = await ensureSol(authority, 1.2, 'authority');
if (!funded) {
  // The continue floor must clear the whole downstream spend: 0.6 SOL of
  // transfers plus mint rent, four ATA rents, and fees (~0.01), with margin.
  const bal = await conn.getBalance(authority.publicKey);
  if (bal < Math.round(0.7 * LAMPORTS_PER_SOL)) {
    console.log('NEEDS MANUAL FUNDING: send devnet SOL to', authority.publicKey.toBase58());
    process.exit(2);
  }
}
await transferSol(authority, escrow.publicKey, 0.3, 'escrow');
await transferSol(authority, buyer.publicKey, 0.2, 'buyer');
await transferSol(authority, seller.publicKey, 0.1, 'seller');

let mintPk;
if (existsSync(MINT_RECORD)) {
  mintPk = new PublicKey(JSON.parse(readFileSync(MINT_RECORD, 'utf8')).mint);
  console.log(`mint (existing): ${mintPk.toBase58()}`);
} else {
  mintPk = await createMint(conn, authority, authority.publicKey, null, DECIMALS);
  // Not atomic with the creation: a crash between the two orphans the mint
  // and a rerun creates a second one. Worthless devnet assets, so the only
  // cost is a stray pubkey; the print below is the recovery breadcrumb.
  console.log(`mint (created): ${mintPk.toBase58()}`);
  writeFileSync(MINT_RECORD, JSON.stringify({ mint: mintPk.toBase58(), decimals: DECIMALS }));
}

const buyerAta = await getOrCreateAssociatedTokenAccount(conn, authority, mintPk, buyer.publicKey);
const sellerAta = await getOrCreateAssociatedTokenAccount(
  conn,
  authority,
  mintPk,
  seller.publicKey,
);
const escrowAta = await getOrCreateAssociatedTokenAccount(
  conn,
  authority,
  mintPk,
  escrow.publicKey,
);
const treasuryAta = await getOrCreateAssociatedTokenAccount(
  conn,
  authority,
  mintPk,
  treasury.publicKey,
);
console.log('buyer ATA:', buyerAta.address.toBase58(), 'amount:', buyerAta.amount.toString());
console.log('seller ATA:', sellerAta.address.toBase58());
console.log('escrow ATA:', escrowAta.address.toBase58());
console.log('treasury ATA:', treasuryAta.address.toBase58());

const WANT_BASE = 1_000_000n * 10n ** BigInt(DECIMALS); // 1,000,000 WOC
if (buyerAta.amount < WANT_BASE) {
  const sig = await mintTo(
    conn,
    authority,
    mintPk,
    buyerAta.address,
    authority,
    WANT_BASE - buyerAta.amount,
  );
  console.log(`minted ${(WANT_BASE - buyerAta.amount).toString()} base units to buyer: ${sig}`);
}
console.log('setup complete');
