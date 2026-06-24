// Devnet end-to-end test for EVERY player-economy transaction type, against the
// deployed job_escrow program. Produces real on-chain signatures + Solscan
// (devnet) links for: escrow open (deposit), release (pay helper), refund (pay
// payer back), a native SOL tip, and an SPL token tip.
//
// Prereqs: program deployed to devnet (JOB_ESCROW_PROGRAM_ID), and the deployer
// (SOLANA_DEVNET_DEPLOYER in .env.local) funded with a little devnet SOL.
//   node scripts/job_escrow_devnet_e2e.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  getAssociatedTokenAddressSync, getAccount,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey(process.env.JOB_ESCROW_PROGRAM_ID ?? '5X39bYGeHPSeNipQGrZRk1siKdgDXXSqhBkpWDTTQzm8');
const conn = new Connection(RPC, 'confirmed');
const links = [];
const solscan = (sig) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const record = (label, sig) => { links.push({ label, url: solscan(sig) }); console.log(`  ${label}: ${solscan(sig)}`); };

function loadDeployer() {
  const env = fs.readFileSync('/Users/futjr/woc/world-of-claudecraft/.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('SOLANA_DEVNET_DEPLOYER='));
  const raw = line.slice('SOLANA_DEVNET_DEPLOYER='.length).trim().replace(/^["']|["']$/g, '');
  return Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
}

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const DISC = { open: disc('open'), release: disc('release'), refund: disc('refund') };
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const jobPda = (jobId) => PublicKey.findProgramAddressSync([Buffer.from('job'), u64le(jobId)], PROGRAM_ID)[0];
const vaultFor = (job, mint) => getAssociatedTokenAddressSync(mint, job, true);

const send = async (ixs, signers) => {
  const tx = new Transaction({ feePayer: signers[0].publicKey, ...(await conn.getLatestBlockhash('confirmed')) });
  tx.add(...ixs);
  const sig = await conn.sendTransaction(tx, signers);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
};

function openIx({ jobId, payer, helper, settler, mint }) {
  const job = jobPda(jobId);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: helper, isSigner: false, isWritable: false },
      { pubkey: settler, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(mint, payer), isSigner: false, isWritable: true },
      { pubkey: job, isSigner: false, isWritable: true },
      { pubkey: vaultFor(job, mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC.open, u64le(jobId), u64le(arguments[0].amount)]),
  });
}
function settleIx(kind, { jobId, payer, settler, dest, mint }) {
  const job = jobPda(jobId);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: settler, isSigner: true, isWritable: false },
      { pubkey: job, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true }, // helper_token (release) | payer_token (refund)
      { pubkey: vaultFor(job, mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: kind === 'release' ? DISC.release : DISC.refund,
  });
}

const payer = loadDeployer();         // payer + fee payer + mint authority
const helper = Keypair.generate();
const settler = Keypair.generate();   // the oracle that signs release/refund
console.log(`program ${PROGRAM_ID.toBase58()}  payer ${payer.publicKey.toBase58()}`);
console.log(`helper ${helper.publicKey.toBase58()}  settler ${settler.publicKey.toBase58()}\n`);

// Fund the settler so it can pay fees + the helper's ATA rent on release/refund.
record('fund settler (SOL)', await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: settler.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })], [payer]));

// A devnet test mint (6 decimals) + the payer's funded token account.
const mint = await createMint(conn, payer, payer.publicKey, null, 6);
console.log(`test mint ${mint.toBase58()}`);
const payerAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
await mintTo(conn, payer, mint, payerAta.address, payer, 1_000_000_000n); // 1000 tokens
const decimals = 6, unit = 10n ** BigInt(decimals);

console.log('\n— Escrow RELEASE path —');
const jobA = Date.now();
record('open (deposit 100)', await send([openIx({ jobId: jobA, payer: payer.publicKey, helper: helper.publicKey, settler: settler.publicKey, mint, amount: 100n * unit })], [payer]));
const helperAta = getAssociatedTokenAddressSync(mint, helper.publicKey);
record('release → helper', await send([
  createAssociatedTokenAccountIdempotentInstruction(settler.publicKey, helperAta, helper.publicKey, mint),
  settleIx('release', { jobId: jobA, payer: payer.publicKey, settler: settler.publicKey, dest: helperAta, mint }),
], [settler]));
console.log(`  helper now holds ${(await getAccount(conn, helperAta)).amount / unit} tokens (expect 100)`);

console.log('\n— Escrow REFUND path —');
const jobB = Date.now() + 1;
record('open (deposit 50)', await send([openIx({ jobId: jobB, payer: payer.publicKey, helper: helper.publicKey, settler: settler.publicKey, mint, amount: 50n * unit })], [payer]));
record('refund → payer', await send([
  createAssociatedTokenAccountIdempotentInstruction(settler.publicKey, payerAta.address, payer.publicKey, mint),
  settleIx('refund', { jobId: jobB, payer: payer.publicKey, settler: settler.publicKey, dest: payerAta.address, mint }),
], [settler]));

console.log('\n— Tips —');
record('SOL tip → helper', await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: helper.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL })], [payer]));
record('SPL tip → helper', await send([
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, helperAta, helper.publicKey, mint),
  createTransferCheckedInstruction(payerAta.address, mint, helperAta, payer.publicKey, 5n * unit, decimals),
], [payer]));

console.log('\n=== Solscan (devnet) links ===');
for (const { label, url } of links) console.log(`- ${label}: ${url}`);
fs.mkdirSync('docs/screenshots/jobs', { recursive: true });
fs.writeFileSync('docs/screenshots/jobs/devnet-tx-links.json', JSON.stringify({ program: PROGRAM_ID.toBase58(), mint: mint.toBase58(), links }, null, 2));
console.log('\nwrote docs/screenshots/jobs/devnet-tx-links.json');
