// STUB (RFC) — client-side on-chain paid flow (Solana).
// quote -> sign transfer (agent wallet -> recipient, memo=quoteId) -> sendAndConfirm('finalized')
//       -> verify-payment -> entitlement. Amounts/recipient/cluster are configurable.
// The server verifies finalized commitment + exact recipient/amount + memo==quoteId (replay guard).
// TODO(eliza): import { Connection, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js'.

export interface Quote {
  quoteId: string;
  lamports: number;
  recipient: string; // base58 treasury address
  memo: string; // == quoteId, embedded in the tx to bind it to this grant
}

export interface Entitlement {
  kind: 'agent_player' | 'familiar';
  entitled: boolean;
  expiresAt: number | null;
}

export interface WocRestClient {
  post(path: string, body: unknown): Promise<unknown>;
}

export async function payAndVerify(
  _client: WocRestClient,
  _kind: Entitlement['kind'],
): Promise<Entitlement> {
  // const quote = await client.post('/api/agent/quote', { kind }) as Quote;
  // enforce the non-LLM spend policy here (see WocPaymentService.SpendPolicy)
  // build Transaction: SystemProgram.transfer({ fromPubkey, toPubkey: recipient, lamports }) + memoIx(quote.memo)
  // const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'finalized' });
  // const ent = await client.post('/api/agent/verify-payment', { quoteId: quote.quoteId, signature: sig, address });
  // if (!ent.entitled) throw new PaymentError('verification failed');
  // return ent;
  throw new Error('TODO(eliza): payAndVerify');
}
