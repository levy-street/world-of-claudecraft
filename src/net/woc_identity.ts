// The $WOC identity payment flow: quote -> pay context -> build + sign + send
// the burn tx -> poll confirm until Solana finalization lands. String-free by
// design (progress is reported as stage tokens the UI maps to t() keys), and
// every IO primitive is injected, so a Vitest drives the whole flow with fakes.
import type { WocIdentityPayContext, WocIdentityQuote } from './online';
import { buildWocPaymentTx } from './woc_tx';

export type WocPayStage = 'quoting' | 'approve' | 'confirming' | 'finalizing';

export interface WocPayFlowDeps {
  quote(): Promise<WocIdentityQuote>;
  payContext(quoteId: string): Promise<WocIdentityPayContext>;
  /** Sign and submit the serialized tx via the wallet; resolves to the base58 signature. */
  signAndSend(transaction: Uint8Array): Promise<string>;
  confirm(
    quoteId: string,
    signature: string,
  ): Promise<{ ok: boolean; status: number; reason?: string; data: any }>;
  onStage(stage: WocPayStage, quote: WocIdentityQuote | null): void;
  sleep(ms: number): Promise<void>;
}

// The wallet returns once the tx is submitted; the server verifies at
// 'finalized' commitment, which typically lands within ~30s. 24 x 2.5s covers
// a slow cluster without hanging the UI forever.
const CONFIRM_ATTEMPTS = 24;
const CONFIRM_INTERVAL_MS = 2500;

export class WocPayError extends Error {
  constructor(
    public code: 'confirm_failed' | 'finalize_timeout',
    public serverError?: string,
  ) {
    super(serverError ?? code);
    this.name = 'WocPayError';
  }
}

/**
 * Run one full paid identity action. Resolves with the applied-action response
 * body; throws WocPayError for confirm failures (any earlier error, e.g. the
 * player rejecting the wallet prompt or a 4xx quote, propagates as-is).
 */
export async function payWocIdentityFlow(deps: WocPayFlowDeps): Promise<any> {
  deps.onStage('quoting', null);
  const quote = await deps.quote();
  const ctx = await deps.payContext(quote.quoteId);
  const tx = buildWocPaymentTx({
    payer: quote.payer,
    payerTokenAccount: ctx.payerTokenAccount,
    mint: quote.mint,
    decimals: quote.decimals,
    burnBase: BigInt(quote.burnBase),
    treasuryTokenAccount: ctx.treasuryTokenAccount,
    treasuryBase: BigInt(quote.treasuryBase),
    memo: quote.memo,
    recentBlockhash: ctx.blockhash,
  });
  deps.onStage('approve', quote);
  const signature = await deps.signAndSend(tx);
  deps.onStage('confirming', quote);
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
    const r = await deps.confirm(quote.quoteId, signature);
    if (r.ok) return r.data;
    if (r.reason !== 'not_finalized') {
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
