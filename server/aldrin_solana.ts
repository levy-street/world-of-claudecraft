// Solana IO shell for the Aldrin Club: read a finalized transaction over raw JSON
// RPC and reduce it to the pure ParsedOnchainPayment that server/aldrin_club.ts
// judges, plus a Jupiter FX quote so a USD price can be pinned in SOL or $WOC.
// Raw JSON-RPC (no @solana/web3.js) mirrors server/woc_balance.ts and the
// in-flight server/solana_tx.ts.
//
// DRAFT NOTE: the SPL/token, memo, burn, and Token-2022 checks here duplicate
// server/solana_tx.ts on purpose so the draft compiles on today's main. The only
// genuinely new primitive is the native-SOL lamport delta (solana_tx.ts is
// token-only today). On merge, fold this into solana_tx.ts: add accountKeys +
// pre/post lamport balances to FinalizedTx and a `solCreditedLamports(owner)`
// helper, then delete the duplicated token logic below.
import {
  JUPITER_API,
  SOLANA_RPC_URL,
  USDC_DECIMALS,
  USDC_MINT,
  WOC_DECIMALS,
  WOC_MINT,
} from './aldrin_config';
import type { AldrinPayMethod, AldrinQuote, ParsedOnchainPayment } from './aldrin_club';

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MEMO_PROGRAM_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_PROGRAM_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
// Wrapped SOL, used as the input/output mint when routing native SOL on a DEX.
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface TokenAmount {
  amount?: string;
  decimals?: number;
}
interface TokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  programId?: string;
  uiTokenAmount?: TokenAmount;
}
interface ParsedIx {
  program?: string;
  programId?: string;
  parsed?: unknown;
}
interface RawFinalizedTx {
  err: unknown;
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  instructions: ParsedIx[];
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: unknown };
  return data?.result ?? null;
}

/** Fetch + normalize a tx at finalized commitment. null = not confirmed yet. */
async function fetchFinalizedTx(signature: string): Promise<RawFinalizedTx | null> {
  try {
    const r = await rpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    if (!r || typeof r !== 'object') return null;
    const message = r.transaction?.message;
    const top: ParsedIx[] = Array.isArray(message?.instructions) ? message.instructions : [];
    const inner: ParsedIx[] = Array.isArray(r.meta?.innerInstructions)
      ? r.meta.innerInstructions.flatMap((g: any) => (Array.isArray(g?.instructions) ? g.instructions : []))
      : [];
    const keys: string[] = Array.isArray(message?.accountKeys)
      ? message.accountKeys.map((k: any) => (typeof k === 'string' ? k : String(k?.pubkey ?? '')))
      : [];
    return {
      err: r.meta?.err ?? null,
      accountKeys: keys,
      preBalances: Array.isArray(r.meta?.preBalances) ? r.meta.preBalances : [],
      postBalances: Array.isArray(r.meta?.postBalances) ? r.meta.postBalances : [],
      preTokenBalances: Array.isArray(r.meta?.preTokenBalances) ? r.meta.preTokenBalances : [],
      postTokenBalances: Array.isArray(r.meta?.postTokenBalances) ? r.meta.postTokenBalances : [],
      instructions: [...top, ...inner],
    };
  } catch {
    return null;
  }
}

function sumTokens(rows: TokenBalance[], owner: string, mint: string): bigint {
  let total = 0n;
  for (const b of rows) {
    if (b.owner === owner && b.mint === mint) {
      const amt = b.uiTokenAmount?.amount;
      if (typeof amt === 'string' && /^[0-9]+$/.test(amt)) total += BigInt(amt);
    }
  }
  return total;
}

function tokenDelta(tx: RawFinalizedTx, owner: string, mint: string): bigint {
  return sumTokens(tx.postTokenBalances, owner, mint) - sumTokens(tx.preTokenBalances, owner, mint);
}

/** Net native-SOL change (lamports) for an address, summed over its key indices. */
function lamportDelta(tx: RawFinalizedTx, address: string): bigint {
  let delta = 0n;
  for (let i = 0; i < tx.accountKeys.length; i++) {
    if (tx.accountKeys[i] !== address) continue;
    const pre = BigInt(Math.trunc(tx.preBalances[i] ?? 0));
    const post = BigInt(Math.trunc(tx.postBalances[i] ?? 0));
    delta += post - pre;
  }
  return delta;
}

function usesToken2022(tx: RawFinalizedTx, mint: string): boolean {
  return [...tx.preTokenBalances, ...tx.postTokenBalances].some(
    (b) => b.mint === mint && b.programId === TOKEN_2022_PROGRAM,
  );
}

function hasMemo(tx: RawFinalizedTx, memo: string): boolean {
  for (const ix of tx.instructions) {
    const isMemo = ix.program === 'spl-memo' || ix.programId === MEMO_PROGRAM_V2 || ix.programId === MEMO_PROGRAM_V1;
    if (isMemo && typeof ix.parsed === 'string' && ix.parsed === memo) return true;
  }
  return false;
}

function burnedBy(tx: RawFinalizedTx, mint: string, authority: string): bigint {
  let total = 0n;
  for (const ix of tx.instructions) {
    if (ix.program !== 'spl-token') continue;
    const p = ix.parsed as { type?: string; info?: Record<string, any> } | undefined;
    if (!p || (p.type !== 'burn' && p.type !== 'burnChecked')) continue;
    const info = p.info ?? {};
    if (info.mint !== mint) continue;
    if (info.authority !== authority && info.multisigAuthority !== authority) continue;
    const raw = info.tokenAmount?.amount ?? info.amount;
    if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) total += BigInt(raw);
  }
  return total;
}

/**
 * Parse `signature` into the normalized ParsedOnchainPayment for `quote`, signed
 * by `payer`. Returns finalized:false (caller may retry) when the tx is not yet
 * confirmed or the signature is malformed.
 */
export async function parseAldrinPayment(
  signature: string,
  quote: AldrinQuote,
  payer: string,
): Promise<ParsedOnchainPayment> {
  const empty: ParsedOnchainPayment = {
    finalized: false,
    succeeded: false,
    usesToken2022: false,
    memoMatches: false,
    payerSpentBase: 0n,
    treasuryCreditedBase: 0n,
    buybackCreditedBase: 0n,
    burnedBase: 0n,
  };
  if (!BASE58.test(signature)) return empty;
  const tx = await fetchFinalizedTx(signature);
  if (!tx) return empty;

  const treasury = quote.treasury ?? '';
  const buyback = quote.buyback ?? '';
  const memoMatches = hasMemo(tx, quote.memo);
  const succeeded = tx.err === null || tx.err === undefined;

  if (quote.method === 'sol') {
    // Native SOL: payer outflow includes the network fee, which only makes the
    // underpaid check stricter (never looser); treasury/buyback credits are exact.
    const payerDelta = lamportDelta(tx, payer);
    return {
      finalized: true,
      succeeded,
      usesToken2022: false,
      memoMatches,
      payerSpentBase: payerDelta < 0n ? -payerDelta : 0n,
      treasuryCreditedBase: treasury ? maxZero(lamportDelta(tx, treasury)) : 0n,
      buybackCreditedBase: buyback ? maxZero(lamportDelta(tx, buyback)) : 0n,
      burnedBase: 0n,
    };
  }

  // usdc / woc: SPL token deltas by owner + mint.
  const mint = quote.mint ?? '';
  const payerDelta = tokenDelta(tx, payer, mint);
  return {
    finalized: true,
    succeeded,
    usesToken2022: usesToken2022(tx, mint),
    memoMatches,
    payerSpentBase: payerDelta < 0n ? -payerDelta : 0n,
    treasuryCreditedBase: treasury ? maxZero(tokenDelta(tx, treasury, mint)) : 0n,
    buybackCreditedBase: buyback ? maxZero(tokenDelta(tx, buyback, mint)) : 0n,
    burnedBase: quote.method === 'woc' ? burnedBy(tx, mint, payer) : 0n,
  };
}

function maxZero(v: bigint): bigint {
  return v > 0n ? v : 0n;
}

// ---------------------------------------------------------------------------
// FX: price of one whole asset unit in USD, via a Jupiter quote against USDC.
// USDC is 1:1. SOL/$WOC are quoted live so the membership is always ~$20 of the
// chosen asset at signing time. Returns null on any failure (the caller refuses
// the quote rather than guessing a price).
// ---------------------------------------------------------------------------
export async function assetUsdPrice(method: AldrinPayMethod): Promise<number | null> {
  if (method === 'usdc') return 1;
  if (method === 'sol') return jupiterUsdPrice(WSOL_MINT, 9);
  if (method === 'woc') return jupiterUsdPrice(WOC_MINT, WOC_DECIMALS);
  return null; // stripe is fiat; no FX
}

async function jupiterUsdPrice(mint: string, decimals: number): Promise<number | null> {
  try {
    const amount = 10 ** decimals; // one whole unit, in base units
    const url = `${JUPITER_API}/v6/quote?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { outAmount?: string };
    const out = data?.outAmount;
    if (typeof out !== 'string' || !/^[0-9]+$/.test(out)) return null;
    return Number(BigInt(out)) / 10 ** USDC_DECIMALS; // USDC out for one whole input unit
  } catch {
    return null;
  }
}
