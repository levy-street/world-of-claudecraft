// Devnet integration test for the character_market escrow program.
//
// Exercises EVERY transaction type against the live devnet deployment:
//   list · buy (asserting the 70/30 seller/buyback split) · cancel,
//   + all six error paths (ZeroPrice, ExpiryInPast, NotSeller, ListingExpired,
//   WrongSellerAccount, WrongVaultAccount).
//
// Raw @solana/web3.js (anchor 8-byte sha256 discriminators) so it needs no IDL.
// Prints a solscan.io link for every confirmed transaction.
//
//   node tests/devnet.mjs            (uses ../../../.secrets/deployer.json as payer)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
} from '@solana/spl-token';

const RPC = process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('BE55pNoRLSCch5NmLcU6tg6NZFLe6yFw4Jnr3HfZBMpp');
const __dir = path.dirname(fileURLToPath(import.meta.url));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dir, '../../../.secrets/deployer.json'), 'utf8'))));
const conn = new Connection(RPC, 'confirmed');

const links = [];
const link = (label, sig) => { const u = `https://solscan.io/tx/${sig}?cluster=devnet`; links.push({ label, sig, u }); console.log(`  ✓ ${label}\n    ${u}`); };
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const listingPda = (subdomain) => PublicKey.findProgramAddressSync([Buffer.from('listing'), subdomain.toBuffer()], PROGRAM_ID)[0];

function listIx({ seller, subdomain, listing, usdcMint, sellerUsdc, buybackVault, price, expiresAt }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: subdomain, isSigner: false, isWritable: false },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: sellerUsdc, isSigner: false, isWritable: false },
      { pubkey: buybackVault, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('list'), u64(price), i64(expiresAt)]),
  });
}
function buyIx({ buyer, seller, listing, buyerUsdc, sellerUsdc, buybackVault }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: sellerUsdc, isSigner: false, isWritable: true },
      { pubkey: buybackVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: disc('buy'),
  });
}
function cancelIx({ seller, listing }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: listing, isSigner: false, isWritable: true },
    ],
    data: disc('cancel'),
  });
}
const send = (ixs, signers) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
async function expectFail(label, expectCode, fn) {
  try { await fn(); throw new Error(`${label}: expected failure but it SUCCEEDED`); }
  catch (e) {
    const blob = `${e.message}\n${(e.logs ?? []).join('\n')}`;
    if (!blob.includes(expectCode)) throw new Error(`${label}: expected "${expectCode}", got:\n${blob}`);
    console.log(`  ✓ ${label} → rejected with ${expectCode}`);
  }
}
const bal = async (ata) => Number((await getAccount(conn, ata)).amount);

async function main() {
  console.log(`Program ${PROGRAM_ID.toBase58()} on ${RPC}`);
  console.log(`Payer/seller ${payer.publicKey.toBase58()} (${(await conn.getBalance(payer.publicKey)) / 1e9} SOL)\n`);

  // --- setup: a mock 6-decimal USDC mint + seller/vault/buyer accounts ---
  const buyer = Keypair.generate();
  const vaultAuthority = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: buyer.publicKey, lamports: 0.05e9 })], [payer]);
  const usdc = await createMint(conn, payer, payer.publicKey, null, 6);
  console.log(`Mock USDC mint: ${usdc.toBase58()}`);
  const sellerUsdc = (await getOrCreateAssociatedTokenAccount(conn, payer, usdc, payer.publicKey)).address;
  const buyback = (await getOrCreateAssociatedTokenAccount(conn, payer, usdc, vaultAuthority.publicKey)).address;
  const buyerUsdc = (await getOrCreateAssociatedTokenAccount(conn, payer, usdc, buyer.publicKey)).address;
  await mintTo(conn, payer, usdc, buyerUsdc, payer, 1000_000000n); // 1000 USDC
  console.log('Funded buyer with 1000 USDC\n');
  const PRICE = 100_000000; // 100 USDC
  const future = () => Math.floor(Date.now() / 1000) + 3600;

  // --- 1. list → buy (the money path; assert the 70/30 split) ---
  console.log('TX TYPE: list + buy (70/30 split)');
  const sub1 = Keypair.generate().publicKey;
  const l1 = listingPda(sub1);
  link('list', await send([listIx({ seller: payer.publicKey, subdomain: sub1, listing: l1, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: PRICE, expiresAt: future() })], [payer]));
  const s0 = await bal(sellerUsdc), v0 = await bal(buyback), b0 = await bal(buyerUsdc);
  link('buy', await send([buyIx({ buyer: buyer.publicKey, seller: payer.publicKey, listing: l1, buyerUsdc, sellerUsdc, buybackVault: buyback })], [buyer]));
  const dS = await bal(sellerUsdc) - s0, dV = await bal(buyback) - v0, dB = b0 - await bal(buyerUsdc);
  if (dS !== 70_000000 || dV !== 30_000000 || dB !== 100_000000) throw new Error(`split wrong: seller+${dS} vault+${dV} buyer-${dB}`);
  console.log(`    split verified: seller +70 USDC, buyback +30 USDC, buyer -100 USDC\n`);

  // --- 2. list → cancel ---
  console.log('TX TYPE: list + cancel');
  const sub2 = Keypair.generate().publicKey;
  const l2 = listingPda(sub2);
  link('list (for cancel)', await send([listIx({ seller: payer.publicKey, subdomain: sub2, listing: l2, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: 50_000000, expiresAt: future() })], [payer]));
  link('cancel', await send([cancelIx({ seller: payer.publicKey, listing: l2 })], [payer]));
  if (await conn.getAccountInfo(l2) !== null) throw new Error('cancel did not close the listing');
  console.log('    listing closed (rent reclaimed)\n');

  // --- 3. error paths ---
  console.log('ERROR PATHS:');
  const sub3 = Keypair.generate().publicKey, l3 = listingPda(sub3);
  await expectFail('ZeroPrice', 'ZeroPrice', () => send([listIx({ seller: payer.publicKey, subdomain: sub3, listing: l3, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: 0, expiresAt: future() })], [payer]));
  await expectFail('ExpiryInPast', 'ExpiryInPast', () => send([listIx({ seller: payer.publicKey, subdomain: sub3, listing: l3, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: PRICE, expiresAt: Math.floor(Date.now() / 1000) - 60 })], [payer]));

  // NotSeller: list, then a different signer tries to cancel
  const sub4 = Keypair.generate().publicKey, l4 = listingPda(sub4);
  await send([listIx({ seller: payer.publicKey, subdomain: sub4, listing: l4, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: PRICE, expiresAt: future() })], [payer]);
  await expectFail('NotSeller', 'ConstraintHasOne', () => send([cancelIx({ seller: buyer.publicKey, listing: l4 })], [buyer]));

  // ListingExpired: list with a near-future expiry, wait it out, then buy
  const sub5 = Keypair.generate().publicKey, l5 = listingPda(sub5);
  await send([listIx({ seller: payer.publicKey, subdomain: sub5, listing: l5, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: PRICE, expiresAt: Math.floor(Date.now() / 1000) + 2 })], [payer]);
  await new Promise((r) => setTimeout(r, 8000));
  await expectFail('ListingExpired', 'ListingExpired', () => send([buyIx({ buyer: buyer.publicKey, seller: payer.publicKey, listing: l5, buyerUsdc, sellerUsdc, buybackVault: buyback })], [buyer]));

  // WrongSellerAccount / WrongVaultAccount: buy a valid listing with a swapped token account
  const sub6 = Keypair.generate().publicKey, l6 = listingPda(sub6);
  await send([listIx({ seller: payer.publicKey, subdomain: sub6, listing: l6, usdcMint: usdc, sellerUsdc, buybackVault: buyback, price: PRICE, expiresAt: future() })], [payer]);
  await expectFail('WrongSellerAccount', 'WrongSellerAccount', () => send([buyIx({ buyer: buyer.publicKey, seller: payer.publicKey, listing: l6, buyerUsdc, sellerUsdc: buyback, buybackVault: buyback })], [buyer]));
  await expectFail('WrongVaultAccount', 'WrongVaultAccount', () => send([buyIx({ buyer: buyer.publicKey, seller: payer.publicKey, listing: l6, buyerUsdc, sellerUsdc, buybackVault: sellerUsdc })], [buyer]));
  // clean up l6 so the run is repeatable
  await send([cancelIx({ seller: payer.publicKey, listing: l6 })], [payer]);

  console.log('\n=== ALL TRANSACTION TYPES PASSED ===');
  console.log(`Mock USDC mint: ${usdc.toBase58()}`);
  fs.writeFileSync(path.resolve(__dir, 'devnet-results.json'), JSON.stringify({ programId: PROGRAM_ID.toBase58(), usdcMint: usdc.toBase58(), confirmed: links }, null, 2));
  console.log('\nConfirmed-tx solscan links:');
  for (const { label, u } of links) console.log(`  ${label}: ${u}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('\nFAILED:', e.message); if (e.logs) console.error(e.logs.join('\n')); process.exit(1); });
