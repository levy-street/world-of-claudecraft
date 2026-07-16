// Non-custodial $WOC trade-leg verification. The server holds NO keys and signs
// NOTHING: the paying player sends the on-chain SPL transfer from their own wallet
// (via a Solana Pay transfer request), and this module only READS the chain over
// HTTP JSON-RPC to confirm the payment landed before the escrowed goods release.
//
// House rules honored here:
//  - HTTP polling only, never websockets.
//  - Raw fetch to the RPC endpoint, exactly like server/woc_balance.ts (the RPC
//    URL, and any key embedded in it, never ships to the client).
//  - ALL amount math is BigInt on base units; no float ever touches a token
//    amount. UI-unit decimal strings convert to base units with the mint decimals.
//  - No new npm dependency: base58 encode reuses the in-repo `bs58` (the same
//    module server/wallet_link.ts already decodes with).

import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';

// The $WOC mint default matches server/woc_balance.ts so solanaPayUri renders the
// canonical token when the caller does not pass an explicit mint.
const DEFAULT_WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

// Per-RPC request timeout (distinct from the settlement wall-clock timeout the
// orchestrator enforces). Mirrors woc_balance.ts's 8s read budget.
const RPC_TIMEOUT_MS = 8000;

export interface WocTradeConfig {
  rpcUrl: string;
  mint: string;
  timeoutMs: number;
  pollMs: number;
  minConfirm: 'finalized';
}

export interface VerifyWocInput {
  reference: string;
  payerPubkey: string;
  recipientPubkey: string;
  amountUi: string;
}

export type VerifyWocResult = 'pending' | { signature: string } | { error: string };

export type FetchImpl = typeof fetch;

// 32 random bytes, base58-encoded: a single-use Solana Pay `reference` public key.
// It is pure entropy (no keypair, no custody), used only to find the payment tx
// via getSignaturesForAddress.
export function makeReference(): string {
  return bs58.encode(randomBytes(32));
}

// The standard Solana Pay SPL transfer request. `amountUi` passes through as-is
// (it is already a canonical decimal string); the label is URL-encoded; the memo
// is a constant tag. Param order is fixed so the string is deterministic (tested).
export function solanaPayUri(
  recipientPubkey: string,
  amountUi: string,
  reference: string,
  label: string,
  mint: string = DEFAULT_WOC_MINT,
): string {
  return (
    `solana:${recipientPubkey}` +
    `?amount=${amountUi}` +
    `&spl-token=${mint}` +
    `&reference=${reference}` +
    `&label=${encodeURIComponent(label)}` +
    `&memo=woc-trade`
  );
}

// Convert a UI-unit decimal string to integer base units with `decimals` places,
// in BigInt. Returns null when the string is malformed or carries more fractional
// digits than the mint supports (which would silently lose precision). No float.
export function uiToBaseUnits(amountUi: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  if (!/^\d+(?:\.\d+)?$/.test(amountUi)) return null;
  const [wholeRaw, fracRaw = ''] = amountUi.split('.');
  if (fracRaw.length > decimals) return null;
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0');
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + BigInt(frac === '' ? '0' : frac);
}

interface RpcSignatureInfo {
  signature: string;
  err: unknown;
}

interface RpcTokenBalance {
  owner?: unknown;
  mint?: unknown;
  uiTokenAmount?: { amount?: unknown; decimals?: unknown };
}

interface RpcTransaction {
  meta?: {
    err?: unknown;
    preTokenBalances?: RpcTokenBalance[];
    postTokenBalances?: RpcTokenBalance[];
  } | null;
}

async function rpc<T>(
  cfg: WocTradeConfig,
  method: string,
  params: unknown[],
  fetchImpl: FetchImpl,
): Promise<T | null> {
  try {
    const res = await fetchImpl(cfg.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: T };
    return data?.result ?? null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// Per-owner net WOC base-unit delta across the tx (post minus pre), plus the mint
// decimals observed. Returns null when the tx moved no WOC of this mint at all.
function wocDeltas(
  tx: RpcTransaction,
  mint: string,
): { deltas: Map<string, bigint>; decimals: number } | null {
  const meta = tx.meta;
  if (!meta) return null;
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
  const deltas = new Map<string, bigint>();
  let decimals: number | null = null;
  let sawMint = false;
  const apply = (entries: RpcTokenBalance[], sign: bigint): void => {
    for (const entry of entries) {
      if (entry.mint !== mint) continue;
      sawMint = true;
      const owner = typeof entry.owner === 'string' ? entry.owner : null;
      const amt = asRecord(entry.uiTokenAmount);
      const rawAmount = amt?.amount;
      const dec = amt?.decimals;
      if (typeof dec === 'number' && Number.isInteger(dec)) decimals = dec;
      if (owner === null || typeof rawAmount !== 'string' || !/^\d+$/.test(rawAmount)) continue;
      deltas.set(owner, (deltas.get(owner) ?? 0n) + sign * BigInt(rawAmount));
    }
  };
  apply(post, 1n);
  apply(pre, -1n);
  if (!sawMint || decimals === null) return null;
  return { deltas, decimals };
}

// Validate one candidate transaction against the pledge: it must have succeeded
// (meta.err === null), moved this mint, credited the recipient at least the
// pledged base-unit amount, and debited the payer at least that amount. Robust
// across transfer / transferChecked because it reads pre/post token-balance
// deltas rather than decoding a specific instruction variant.
function txSatisfiesPledge(tx: RpcTransaction, mint: string, input: VerifyWocInput): boolean {
  if (!tx.meta || tx.meta.err !== null) return false;
  const woc = wocDeltas(tx, mint);
  if (!woc) return false;
  const amountBase = uiToBaseUnits(input.amountUi, woc.decimals);
  if (amountBase === null) return false;
  const recipientDelta = woc.deltas.get(input.recipientPubkey) ?? 0n;
  const payerDelta = woc.deltas.get(input.payerPubkey) ?? 0n;
  return recipientDelta >= amountBase && payerDelta <= -amountBase;
}

/**
 * Poll the chain for the $WOC payment carrying `reference`:
 *   'pending'        no successful signature references the key yet (keep polling).
 *   { signature }    a successful tx matched and satisfied the pledge (release).
 *   { error }        a tx referenced the key but FAILED validation (wrong mint /
 *                    amount / parties). The settlement does NOT consume this: the
 *                    caller keeps polling until timeout, since a stray tx on the
 *                    reference must not sink a still-payable trade.
 * Read-only: getSignaturesForAddress then getTransaction, finalized commitment,
 * HTTP only. Any RPC/parse failure reads as 'pending' (retry next poll).
 */
export async function verifyWocPayment(
  cfg: WocTradeConfig,
  input: VerifyWocInput,
  fetchImpl: FetchImpl = fetch,
): Promise<VerifyWocResult> {
  const sigs = await rpc<RpcSignatureInfo[]>(
    cfg,
    'getSignaturesForAddress',
    [input.reference, { limit: 10, commitment: cfg.minConfirm }],
    fetchImpl,
  );
  if (!Array.isArray(sigs) || sigs.length === 0) return 'pending';
  // Newest first (RPC order). Consider every SUCCESSFUL signature; the first that
  // satisfies the pledge wins. A matched-but-invalid tx is remembered so the
  // caller learns "wrong tx on the reference" without consuming the settlement.
  let sawInvalid = false;
  for (const info of sigs) {
    if (typeof info?.signature !== 'string' || info.err !== null) continue;
    const tx = await rpc<RpcTransaction>(
      cfg,
      'getTransaction',
      [
        info.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: cfg.minConfirm },
      ],
      fetchImpl,
    );
    if (!tx) continue;
    if (txSatisfiesPledge(tx, cfg.mint, input)) return { signature: info.signature };
    sawInvalid = true;
  }
  return sawInvalid ? { error: 'no matching transfer on reference' } : 'pending';
}
