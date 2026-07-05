// Proves the server's real transferWoc() moves $WOC on-chain. Creates a
// throwaway Token-2022 mint + funded treasury on a local validator, then calls
// the EXACT transferWoc the claim path uses (dynamically imported after the env
// is set, since server/devs reads WOC_MINT/SOLANA_RPC_URL at module load), and
// asserts the recipient's ATA is credited. No mainnet, no real funds.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo,
  getAssociatedTokenAddressSync, getAccount,
} from '@solana/spl-token';

const RPC = 'http://127.0.0.1:8899';
const conn = new Connection(RPC, 'confirmed');
const treasury = Keypair.generate();
const recipient = Keypair.generate();

await conn.confirmTransaction(await conn.requestAirdrop(treasury.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed');
const mint = await createMint(conn, treasury, treasury.publicKey, null, 6, undefined, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
const treasuryAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
await mintTo(conn, treasury, mint, treasuryAta.address, treasury, BigInt(1_000_000_000), [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
console.log(`mint=${mint.toBase58()} treasury=${treasury.publicKey.toBase58()} recipient=${recipient.publicKey.toBase58()}`);

// Configure the server module exactly as production would, then import + run it.
process.env.SOLANA_RPC_URL = RPC;
process.env.WOC_MINT = mint.toBase58();
const { transferWoc } = await import('../server/devs.ts');

const AMOUNT = BigInt(100_000_000); // 100 $WOC (6 decimals)
const sig = await transferWoc(treasury, recipient.publicKey.toBase58(), AMOUNT);
console.log(`transferWoc signature: ${sig}`);

// getAccount reads the ATA directly — the authoritative on-chain check.
// (Note: getTokenAccountsByOwner — which fetchWocBalance uses — is not exercised
// here because solana-test-validator doesn't build the SPL-token owner index, so
// owner-scoped queries return empty locally. fetchWocBalance's {mint} read is the
// standard, mainnet-proven path; see scripts/prove-woc-balance.mjs.)
const ata = getAssociatedTokenAddressSync(mint, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);
const acct = await getAccount(conn, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
const pass = acct.amount === AMOUNT;
console.log(`recipient on-chain balance: ${acct.amount.toString()} (expected ${AMOUNT})`);
console.log(pass ? 'PASS ✓ — transferWoc credited the recipient on-chain' : 'FAIL ✗');
process.exit(pass ? 0 : 1);
