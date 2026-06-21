// Low-level Solana JSON-RPC for the server, plus the pure parser that turns a
// confirmed transaction into the USDC ownership deltas the marketplace verifies
// a split payment against.
//
// As with woc_balance.ts we hit the JSON-RPC directly (raw fetch — no
// @solana/web3.js in the server bundle) and read SOLANA_RPC_URL from the server
// environment. The PARSING is a pure function (parseSplitPayment) so it is fully
// unit-testable against fixture getTransaction responses, with the network call
// (fetchFinalizedTransaction) kept thin and separate.

// The single server-side Solana RPC. Every server read (purchase-payment verify
// AND the buy-and-burn keeper's reads/broadcast) resolves against this one URL,
// so they can never diverge onto different clusters. Must point at the cluster
// payments + swaps actually settle on (mainnet in production).
export const SOLANA_RPC_URL = (process.env.SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();

// The two SPL token programs. We accept ONLY the legacy program; a Token-2022
// account can carry transfer hooks / fees that make "amount sent" != "amount
// received", so a USDC look-alike under Token-2022 is rejected outright.
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MEMO_PROGRAMS = new Set(['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);

export async function solanaRpc<T>(method: string, params: unknown[], timeoutMs = 8000): Promise<T | null> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: T; error?: unknown };
  if (data.error || data.result === undefined || data.result === null) return null;
  return data.result;
}

// The shape of the fields we read out of a `getTransaction` jsonParsed response.
// Deliberately narrow — only what the parser touches.
export interface RawConfirmedTransaction {
  meta: {
    err: unknown;
    preTokenBalances?: RawTokenBalance[];
    postTokenBalances?: RawTokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string } | string>;
      instructions: Array<{ program?: string; programId?: string; parsed?: unknown }>;
    };
  };
}

interface RawTokenBalance {
  owner?: string;
  mint?: string;
  programId?: string;
  uiTokenAmount?: { amount?: string };
}

// A confirmed transaction reduced to what a split-payment check needs: did it
// succeed, who paid the fee, what memo did it carry, did it touch the USDC mint
// under Token-2022, and the NET USDC base-unit change per owner.
export interface ParsedSplitPayment {
  succeeded: boolean;
  feePayer: string | null;
  memo: string | null;
  usesToken2022ForMint: boolean;
  // owner pubkey -> net USDC change in base units (post - pre). Positive = received.
  tokenDeltas: Map<string, bigint>;
}

function pubkeyOf(key: { pubkey: string } | string): string {
  return typeof key === 'string' ? key : key.pubkey;
}

/**
 * Reduce a confirmed jsonParsed transaction to its USDC ownership deltas + memo
 * + fee payer. PURE — no I/O. `usdcMint` is the mint we measure deltas for;
 * balances on any other mint are ignored. An owner's delta sums all of their
 * USDC token accounts touched by the tx (post − pre), so a freshly-created ATA
 * (absent from preTokenBalances) is treated as starting at zero.
 */
export function parseSplitPayment(tx: RawConfirmedTransaction, usdcMint: string): ParsedSplitPayment {
  const message = tx.transaction.message;
  const feePayer = message.accountKeys.length > 0 ? pubkeyOf(message.accountKeys[0]) : null;

  let memo: string | null = null;
  for (const ix of message.instructions) {
    const isMemo = ix.program === 'spl-memo' || (ix.programId !== undefined && MEMO_PROGRAMS.has(ix.programId));
    if (isMemo && typeof ix.parsed === 'string') {
      memo = ix.parsed;
      break;
    }
  }

  const pre = new Map<string, bigint>();
  const post = new Map<string, bigint>();
  let usesToken2022ForMint = false;
  const accumulate = (into: Map<string, bigint>, rows: RawTokenBalance[] | undefined): void => {
    if (!rows) return;
    for (const row of rows) {
      if (row.mint !== usdcMint || typeof row.owner !== 'string' || typeof row.uiTokenAmount?.amount !== 'string') continue;
      if (row.programId === SPL_TOKEN_2022_PROGRAM) usesToken2022ForMint = true;
      into.set(row.owner, (into.get(row.owner) ?? 0n) + BigInt(row.uiTokenAmount.amount));
    }
  };
  accumulate(pre, tx.meta?.preTokenBalances);
  accumulate(post, tx.meta?.postTokenBalances);

  const tokenDeltas = new Map<string, bigint>();
  for (const owner of new Set([...pre.keys(), ...post.keys()])) {
    const delta = (post.get(owner) ?? 0n) - (pre.get(owner) ?? 0n);
    if (delta !== 0n) tokenDeltas.set(owner, delta);
  }

  return {
    succeeded: tx.meta != null && tx.meta.err == null,
    feePayer,
    memo,
    usesToken2022ForMint,
    tokenDeltas,
  };
}

/**
 * Fetch a transaction at `finalized` commitment. Returns null if the signature
 * is unknown or not yet finalized (so callers treat "not final" as "not yet
 * verifiable" rather than valid). jsonParsed gives us pre/postTokenBalances with
 * owner+mint+programId, which is what the parser reads.
 */
export async function fetchFinalizedTransaction(signature: string): Promise<RawConfirmedTransaction | null> {
  return solanaRpc<RawConfirmedTransaction>('getTransaction', [
    signature,
    { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ]);
}
