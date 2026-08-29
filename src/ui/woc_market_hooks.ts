import type { WocMarketClient } from '../net/woc_market_sdk';

/** Online-only glue main.ts wires (the ClaudiumHooks pattern): the typed SDK,
 *  the session identity, and the wallet signers. Absent hooks = the Exchange
 *  window is never openable (the platform gate). Built by
 *  src/game/woc_market_wiring.ts; consumed by the window and the trade arm. */
export interface WocMarketHooks {
  client: WocMarketClient;
  characterId(): number;
  walletLinked(): boolean;
  /** Sign and broadcast a service-built transaction (the payload is always a
   *  server-authorized quote, never client-assembled). `reference` is the
   *  quote's server reference: the desktop arm resolves the registered quote
   *  by it in the external browser; browser web signs the bytes in-renderer
   *  (src/net/wallet.ts). Resolves the signature; throws an Error whose
   *  message is already player-facing. */
  signAndSendTransactionBase64(
    transactionBase64: string,
    reference: string | null,
  ): Promise<string>;
  /** Sign the SERVER-BUILT step-up challenge message (B6/R1) with the linked
   *  wallet (no transaction, no funds). Same contract as the transaction
   *  signer; `stepUpNonce` is the challenge nonce the desktop arm resolves
   *  the server-stored message by. The asymmetry with `reference` above is
   *  deliberate: a challenge always carries its nonce, while a quote view's
   *  reference is nullable, so each parameter mirrors its source's truth. */
  signMessageBase58(message: string, stepUpNonce: string): Promise<string>;
}
