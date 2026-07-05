// Shared, asset-agnostic on-chain transaction verification — the canonical
// primitive every $WOC/USDC commerce path reuses (rename burns here, and the
// USDC-split marketplace in the skins/character marketplaces). We read finalized
// transactions over **raw Solana JSON-RPC** (no @solana/web3.js in the server
// bundle, mirroring server/woc_balance.ts) and expose small, composable checks:
// token-balance deltas, burn amounts, memo presence, and a Token-2022 guard.
//
// Why balance-delta and not just instruction parsing: a payer's net token
// decrease across the accounts a tx touches is a robust proof of spend that a
// crafted client tx cannot fake (a self-transfer nets zero; only a burn or a
// transfer *out* moves the needle). We still parse burn instructions for exact
// sink accounting/transparency.
import { SOLANA_RPC_URL } from './woc_config';

// Legacy SPL Token program. We pin to this and reject Token-2022 ($WOC and USDC
// are both legacy-program mints; a Token-2022 look-alike with transfer hooks /
// fees must never be accepted as payment).
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
// SPL Memo (v2 and legacy v1). jsonParsed labels both `program: 'spl-memo'`.
const MEMO_PROGRAM_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_PROGRAM_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';

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
export interface FinalizedTx {
  signature: string;
  err: unknown;
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  instructions: ParsedIx[];
  // Native-SOL accounting. accountKeys is index-aligned with preBalances /
  // postBalances (lamports). In jsonParsed encoding `message.accountKeys`
  // already includes lookup-table-loaded addresses, so these three stay aligned.
  accountKeys: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  feeLamports: bigint;
}

// Parse a JSON number/string lamport value to bigint, tolerating either shape.
function toLamports(v: unknown): bigint {
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.round(v));
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  return 0n;
}

/**
 * Fetch a transaction at **finalized** commitment and normalize it. Returns null
 * if not found, not yet finalized, or malformed — callers treat null as "not
 * confirmed yet, retry" (never as success).
 */
export async function getFinalizedTx(signature: string): Promise<FinalizedTx | null> {
  try {
    const res = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: any };
    const r = data?.result;
    if (!r || typeof r !== 'object') return null;
    const message = r.transaction?.message;
    const top: ParsedIx[] = Array.isArray(message?.instructions) ? message.instructions : [];
    // Include inner instructions: SPL burns are frequently CPI'd from a
    // higher-level program, so they live under meta.innerInstructions.
    const inner: ParsedIx[] = Array.isArray(r.meta?.innerInstructions)
      ? r.meta.innerInstructions.flatMap((g: any) =>
          Array.isArray(g?.instructions) ? g.instructions : [],
        )
      : [];
    // jsonParsed accountKeys is an array of { pubkey, signer, writable, source };
    // it includes lookup-table-loaded addresses and is index-aligned with the
    // pre/post balance arrays. Defensively fall back to a raw string array.
    const rawKeys: any[] = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
    const accountKeys: string[] = rawKeys.map((k) =>
      typeof k === 'string' ? k : String(k?.pubkey ?? ''),
    );
    const preBalances: bigint[] = Array.isArray(r.meta?.preBalances)
      ? r.meta.preBalances.map(toLamports)
      : [];
    const postBalances: bigint[] = Array.isArray(r.meta?.postBalances)
      ? r.meta.postBalances.map(toLamports)
      : [];
    return {
      signature,
      err: r.meta?.err ?? null,
      preTokenBalances: Array.isArray(r.meta?.preTokenBalances) ? r.meta.preTokenBalances : [],
      postTokenBalances: Array.isArray(r.meta?.postTokenBalances) ? r.meta.postTokenBalances : [],
      instructions: [...top, ...inner],
      accountKeys,
      preBalances,
      postBalances,
      feeLamports: toLamports(r.meta?.fee),
    };
  } catch {
    return null;
  }
}

export function txSucceeded(tx: FinalizedTx): boolean {
  return tx.err === null || tx.err === undefined;
}

/** True if the mint is held under the Token-2022 program in this tx (reject). */
export function usesToken2022(tx: FinalizedTx, mint: string): boolean {
  return [...tx.preTokenBalances, ...tx.postTokenBalances].some(
    (b) => b.mint === mint && b.programId === TOKEN_2022_PROGRAM,
  );
}

function sumBalances(rows: TokenBalance[], owner: string, mint: string): bigint {
  let total = 0n;
  for (const b of rows) {
    if (b.owner === owner && b.mint === mint) {
      const amt = b.uiTokenAmount?.amount;
      if (typeof amt === 'string' && /^[0-9]+$/.test(amt)) total += BigInt(amt);
    }
  }
  return total;
}

/**
 * Net change in `owner`'s `mint` balance (base units) across the accounts this
 * tx touched. Negative = the owner spent (burned or transferred out).
 */
export function ownerTokenDeltaBase(tx: FinalizedTx, owner: string, mint: string): bigint {
  return (
    sumBalances(tx.postTokenBalances, owner, mint) - sumBalances(tx.preTokenBalances, owner, mint)
  );
}

/** Amount `owner` was credited in `mint` (base units); 0 if they didn't gain. */
export function ownerCreditedBase(tx: FinalizedTx, owner: string, mint: string): bigint {
  const d = ownerTokenDeltaBase(tx, owner, mint);
  return d > 0n ? d : 0n;
}

/** Amount `owner` spent in `mint` (base units, positive); 0 if they didn't spend. */
export function ownerSpentBase(tx: FinalizedTx, owner: string, mint: string): bigint {
  const d = ownerTokenDeltaBase(tx, owner, mint);
  return d < 0n ? -d : 0n;
}

/** Total `mint` burned by `authority` via spl-token burn/burnChecked (base units). */
export function burnedBase(tx: FinalizedTx, mint: string, authority: string): bigint {
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

/** Whether a memo instruction with exactly `memo` is present. */
export function hasMemo(tx: FinalizedTx, memo: string): boolean {
  for (const ix of tx.instructions) {
    const isMemo =
      ix.program === 'spl-memo' ||
      ix.programId === MEMO_PROGRAM_V2 ||
      ix.programId === MEMO_PROGRAM_V1;
    if (!isMemo) continue;
    // jsonParsed renders the memo program's data as the raw string in `parsed`.
    if (typeof ix.parsed === 'string' && ix.parsed === memo) return true;
  }
  return false;
}

/**
 * Net change in `owner`'s **native SOL** balance (lamports) across this tx,
 * summed over every account index whose key is `owner`. Negative = the owner
 * paid out. This is the lamport analogue of ownerTokenDeltaBase: a self-transfer
 * nets ~zero (minus fees), so only real SOL moving in/out moves the needle — a
 * crafted tx cannot fake a treasury credit it never funded.
 */
export function lamportsDeltaFor(tx: FinalizedTx, owner: string): bigint {
  let delta = 0n;
  const n = Math.min(tx.accountKeys.length, tx.preBalances.length, tx.postBalances.length);
  for (let i = 0; i < n; i++) {
    if (tx.accountKeys[i] === owner) delta += tx.postBalances[i] - tx.preBalances[i];
  }
  return delta;
}

/** Lamports `owner` was credited (net positive delta); 0 if they didn't gain. */
export function lamportsCreditedTo(tx: FinalizedTx, owner: string): bigint {
  const d = lamportsDeltaFor(tx, owner);
  return d > 0n ? d : 0n;
}

/** Lamports `owner` spent (net negative delta, positive); 0 if they didn't spend. */
export function lamportsSpentBy(tx: FinalizedTx, owner: string): bigint {
  const d = lamportsDeltaFor(tx, owner);
  return d < 0n ? -d : 0n;
}
