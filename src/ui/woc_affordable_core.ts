// Whether a $WOC price is one the connected wallet can actually pay.
//
// One definition for every surface that asks (the trade window's offer, the
// Exchange's bid and its buy-now), because the interesting part is not the
// comparison but what happens when a side is UNKNOWN, and three copies of that
// judgement would drift apart the first time one of them was edited.
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

/**
 * True only when the price is KNOWN to exceed the balance.
 *
 * Fails OPEN on missing information, deliberately, and in the opposite
 * direction to the server. A null balance means "not loaded" (the read is
 * async, and it goes missing for reasons that say nothing about what the player
 * holds: still loading, an RPC blip, a wallet connected but not yet linked),
 * and a null price means the quote has not come back. Treating either as a
 * shortfall would refuse a player who can pay, on no evidence, every time a read
 * was slow.
 *
 * The server re-checks at payment time and fails CLOSED there, which is the
 * right split: the client's job is to stop the obviously doomed action before
 * anyone commits to it, not to be the authority on anyone's balance.
 *
 * Compare TOKENS to tokens. Every caller has a USD figure to hand and it is the
 * wrong operand: fee legs come out of the quoted amount rather than being added
 * on top, so the quote is what leaves the wallet, and cents against a token
 * balance is two different units.
 */
export function overWalletBalance(
  priceTokens: number | null,
  walletTokens: number | null,
): boolean {
  return priceTokens !== null && walletTokens !== null && priceTokens > walletTokens;
}
