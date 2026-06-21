// Fee-recycling buyback-and-burn engine (PR #736 / Kintara #798 / #469 shared
// core). A keeper batches the USDC that marketplace sales route to the buyback
// vault, swaps it to $WOC on Jupiter, and burns the proceeds — turning every
// secondary-market trade into rules-based, on-chain, auditable deflation. There
// is no second token and no discretionary trading: fixed cadence, published
// keeper wallet, every swap + burn signature recorded in woc_burn_batches.
//
// Server-only. The keeper wallet is the single custodial seam; it holds only
// in-flight fee USDC plus a little SOL for fees, never player funds.
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createBurnCheckedInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  SOLANA_RPC_URL,
  WOC_MINT,
  WOC_DECIMALS,
  USDC_MINT,
  USDC_DECIMALS,
  JUPITER_API,
  BUYBACK_ENABLED,
  BUYBACK_KEEPER_SECRET,
  BUYBACK_MIN_BATCH_USDC,
  BUYBACK_SLIPPAGE_BPS,
} from './woc_config';
import { recordBurnBatch } from './db';

let _connection: Connection | null = null;
function connection(): Connection {
  if (!_connection) _connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  return _connection;
}

let _keeper: Keypair | null = null;
function keeperWallet(): Keypair {
  if (_keeper) return _keeper;
  if (!BUYBACK_KEEPER_SECRET) throw new Error('BUYBACK_KEEPER_SECRET is not set');
  _keeper = Keypair.fromSecretKey(bs58.decode(BUYBACK_KEEPER_SECRET));
  return _keeper;
}

/** True once the engine can run (flag on + keeper configured). */
export function buybackReady(): boolean {
  return BUYBACK_ENABLED && BUYBACK_KEEPER_SECRET.length > 0;
}

const TEN = 10n;
function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}
/** The minimum batch size in USDC base units. Pure — exported for testing. */
export function minBatchBase(): bigint {
  return BigInt(Math.round(BUYBACK_MIN_BATCH_USDC * Number(pow10(USDC_DECIMALS))));
}
/** Whether a vault balance is large enough to swap. Pure — exported for testing. */
export function shouldRunBuyback(usdcBalanceBase: bigint): boolean {
  return usdcBalanceBase >= minBatchBase() && usdcBalanceBase > 0n;
}

/** Current USDC balance (base units) held by the keeper's vault token account. */
export async function usdcVaultBalanceBase(): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), keeperWallet().publicKey);
  const info = await connection().getTokenAccountBalance(ata, 'confirmed');
  return BigInt(info.value.amount);
}

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  [k: string]: unknown;
}

/** Jupiter v6 quote for swapping `amountBase` of `inputMint` to `outputMint`. */
export async function jupiterQuote(inputMint: string, outputMint: string, amountBase: bigint, slippageBps: number): Promise<JupiterQuote> {
  const url = `${JUPITER_API}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountBase.toString()}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`jupiter quote failed (${res.status})`);
  return (await res.json()) as JupiterQuote;
}

/** Jupiter v6 swap transaction (base64 VersionedTransaction) for a quote. */
async function jupiterSwapTx(quote: JupiterQuote, userPublicKey: string): Promise<string> {
  const res = await fetch(`${JUPITER_API}/v6/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`jupiter swap build failed (${res.status})`);
  const data = (await res.json()) as { swapTransaction: string };
  return data.swapTransaction;
}

export type BuybackResult =
  | { status: 'disabled' }
  | { status: 'below_threshold'; usdcBalanceBase: string }
  | { status: 'burned'; usdcInBase: string; wocBurnedBase: string; swapSig: string; burnSig: string };

/**
 * One buyback cycle: if the vault holds at least the minimum batch, swap all of
 * it USDC→$WOC on Jupiter, then burn the $WOC received. Each cycle is recorded
 * with both on-chain signatures. Idempotency is at the burn-sig level (UNIQUE).
 */
export async function runBuybackBurn(): Promise<BuybackResult> {
  if (!buybackReady()) return { status: 'disabled' };
  const keeper = keeperWallet();

  const balance = await usdcVaultBalanceBase();
  if (!shouldRunBuyback(balance)) return { status: 'below_threshold', usdcBalanceBase: balance.toString() };

  // Swap the whole vault balance USDC → $WOC at the configured slippage cap.
  const quote = await jupiterQuote(USDC_MINT, WOC_MINT, balance, BUYBACK_SLIPPAGE_BPS);
  const swapB64 = await jupiterSwapTx(quote, keeper.publicKey.toBase58());
  const swapTx = VersionedTransaction.deserialize(Buffer.from(swapB64, 'base64'));
  swapTx.sign([keeper]);
  const swapSig = await connection().sendRawTransaction(swapTx.serialize());
  await connection().confirmTransaction(swapSig, 'confirmed');

  // Burn exactly the $WOC the swap produced.
  const wocReceived = BigInt(quote.outAmount);
  const wocAta = getAssociatedTokenAddressSync(new PublicKey(WOC_MINT), keeper.publicKey);
  const burnIx = createBurnCheckedInstruction(wocAta, new PublicKey(WOC_MINT), keeper.publicKey, wocReceived, WOC_DECIMALS);
  const { blockhash, lastValidBlockHeight } = await connection().getLatestBlockhash('confirmed');
  const burnTx = new Transaction({ feePayer: keeper.publicKey, blockhash, lastValidBlockHeight }).add(burnIx);
  burnTx.sign(keeper);
  const burnSig = await connection().sendRawTransaction(burnTx.serialize());
  await connection().confirmTransaction({ signature: burnSig, blockhash, lastValidBlockHeight }, 'confirmed');

  await recordBurnBatch({ usdcInBase: balance, wocOutBase: wocReceived, swapSig, burnSig });
  return { status: 'burned', usdcInBase: balance.toString(), wocBurnedBase: wocReceived.toString(), swapSig, burnSig };
}
