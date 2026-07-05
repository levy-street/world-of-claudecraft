// The $WOC subdomain mint flow: quote (a server-built, execution-wallet
// partial-signed burn + SNS create tx) -> sign + submit through the wallet ->
// poll confirm until both the burn finalizes and the subdomain reads back as
// player-owned. Sibling of src/net/woc_identity.ts and string-free the same
// way (progress is reported as stage tokens the UI maps to t() keys); every
// IO primitive is injected, so a Vitest drives the whole flow with fakes.
import type { WocSubdomainQuote } from './online';
import { WocPayError, type WocPayStage } from './woc_identity';

export interface WocMintFlowDeps {
  quote(): Promise<WocSubdomainQuote>;
  /** Sign and submit the serialized tx via the wallet; resolves to the base58 signature. */
  signAndSend(transaction: Uint8Array): Promise<string>;
  confirm(
    quoteId: string,
    signature: string,
  ): Promise<{ ok: boolean; status: number; reason?: string; data: any }>;
  onStage(stage: WocPayStage, quote: WocSubdomainQuote | null): void;
  sleep(ms: number): Promise<void>;
}

// Same budget as the identity flow: the server verifies at 'finalized'
// commitment (~30s typical); 24 x 2.5s covers a slow cluster without hanging
// the UI forever.
const CONFIRM_ATTEMPTS = 24;
const CONFIRM_INTERVAL_MS = 2500;

// Confirm reasons that mean "finalization has not landed yet, ask again":
// the burn itself ('not_finalized') or the RPC still not showing the freshly
// created registry account ('subdomain_not_minted'). Anything else (underpaid,
// owner mismatch, expired quote) is a hard failure.
const RETRYABLE_REASONS = new Set(['not_finalized', 'subdomain_not_minted']);

/** Decode the server's base64 transaction into the bytes the wallet signs. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Run one full paid subdomain mint. Resolves with the confirm response body
 * ({ characterId, fullDomain, owner }); throws WocPayError for confirm
 * failures (any earlier error, e.g. the player rejecting the wallet prompt or
 * a 4xx quote, propagates as-is).
 */
export async function payWocSubdomainMintFlow(deps: WocMintFlowDeps): Promise<any> {
  deps.onStage('quoting', null);
  const quote = await deps.quote();
  const tx = base64ToBytes(quote.txBase64);
  deps.onStage('approve', quote);
  const signature = await deps.signAndSend(tx);
  deps.onStage('confirming', quote);
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
    const r = await deps.confirm(quote.quoteId, signature);
    if (r.ok) return r.data;
    if (!RETRYABLE_REASONS.has(r.reason ?? '')) {
      throw new WocPayError(
        'confirm_failed',
        typeof r.data?.error === 'string' ? r.data.error : undefined,
      );
    }
    deps.onStage('finalizing', quote);
    await deps.sleep(CONFIRM_INTERVAL_MS);
  }
  throw new WocPayError('finalize_timeout');
}
