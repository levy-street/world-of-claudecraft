# woc_auction_escrow

A non-custodial English-auction escrow for one SPL token (the in-game $WOC mint on
mainnet; a fresh test mint on devnet). One program-owned vault backs each auction, so
deposited bids live in a PDA that only a program-signed CPI can move. No server hot key
can ever divert bidder money. The vault ATA authority IS the auction state PDA, exactly
like the match and season vaults in the existing `woc_escrow` program.

Devnet program id: `GzkjHHkkJqZf5Qa3YZaJo1iHcKkxi4zUT5sV3zpVeyqZ`

## Why this program exists

A bid escrows the bidder's money and must be refunded the instant a higher bid lands.
For self-custodied $WOC, where the server holds no keys, that refund cannot be
server-mediated. It has to be enforced on chain. `place_bid` is the primitive that does
it: it pulls the new bid into the vault AND refunds the prior high bidder their exact
prior bid in one atomic instruction. There is no window in which the vault holds two
bids or in which a refund can be mis-routed.

## Instructions

1. `open_auction(auction_id, seller, min_bid, rake_bps, buyout, settler, ends_at)`
   Creates the Auction PDA (`seeds = [b"auction", auction_id.le_bytes()]`) and its
   program-owned vault ATA. No token moves (the seller stakes nothing). `seller` is
   stored explicitly so a game server can open on a seller's behalf; the seller only
   ever receives proceeds, validated at settle. `rake_bps` is capped by the
   `MAX_RAKE_BPS` program constant. `ends_at` must sit in `[now + MIN_DURATION_SECS,
   now + MAX_DURATION_SECS]`.

2. `place_bid(auction_id, amount)` The core new primitive, fully atomic:
   - Requires the auction Open and live (`now < ends_at`), the bidder is not the seller
     and not already the high bidder, and `amount` meets the minimum acceptable
     (`min_bid` for the first bid, else `high_bid + max(1, high_bid * MIN_RAISE_BPS /
     10_000)`).
   - Transfers `amount` from the bidder into the vault (bidder-signed).
   - If a prior high bidder exists, refunds them their exact prior bid via a
     program-signed CPI (authority = the auction PDA), only to an account whose `owner`
     is the on-chain-recorded prior high bidder and whose `mint` matches. After the swap
     the vault holds exactly the new high bid.
   - Records `high_bidder`/`high_bid`, emits `BidPlaced { refunded_prior }`.

3. `settle_auction(auction_id)` Settler-signed (`has_one = settler`). Allowed at
   `ends_at`, or immediately once a bid meets `buyout`. With bids: burn the capped rake
   from the vault and pay the seller the rest (both program-signed), then close the
   vault. With no bids: close the vault back to the opener. Emits `AuctionSettled`.

4. `cancel_auction(auction_id)` Settler-signed. Refunds the standing high bidder (if
   any), closes the vault, marks Cancelled. The bidder is always made whole. This is the
   settler's escape hatch for a griefed or errored auction.

5. `reclaim_expired(auction_id)` Permissionless liveness valve. Only callable once
   `now >= ends_at + RECLAIM_GRACE_SECS` (the settler had its window first). Runs the
   same deterministic settle economics, so a down settler key can never strand funds.

## Non-custodial guarantees

- Funds leave the vault only via a program-signed CPI: an outbid refund (to the recorded
  prior bidder), a settle payout (to the recorded seller minus a burned rake), a cancel
  refund (to the recorded high bidder), or a reclaim.
- The settler (the realm key) can never route funds anywhere except the
  on-chain-recorded parties. It has no authority to name a destination.
- The rake is a constant-capped program constant (`MAX_RAKE_BPS = 1000`, 10%), never an
  instruction argument, and it is burned from the vault, not skimmed to a treasury.
- All money math is checked (`checked_add`/`checked_mul`/`checked_div`), mapping overflow
  to an `Overflow` error, on top of the release profile's `overflow-checks = true`.

## Build, deploy, prove

```
cd solana
anchor build                                  # compiles programs/woc_auction_escrow -> target/deploy/woc_auction_escrow.so
solana config set --keypair <deployer> --url devnet
anchor deploy --provider.cluster devnet       # capture the program id
```

Devnet proof (all instruction types on live devnet, Finalized commitment):

```
WOC_DEVNET_TEST=1 npx ts-mocha -p ./tsconfig.json -t 1000000 \
  tests/woc_auction_escrow.devnet_alltypes.test.ts
```

The test creates a fresh SPL mint, funds a seller and three bidders, then drives:
auction 1 (open, a three-rung outbid ladder each asserting the prior bidder's balance is
restored on chain and the vault holds exactly the new high bid, settle-on-buyout with the
seller paid `high_bid - rake` and the rake burned from supply); auction 2 (open, one bid,
cancel refunds the bidder); auction 3 (open, one bid, the `reclaim_expired` guard is
rejected before the grace window, `NotEnded`). Every signature is confirmed by HTTP
polling `getSignatureStatuses` to Finalized (never a websocket `confirmTransaction`) and
written to `devnet-proof.json` with explorer URLs. The captured run is in that file.

## IDL generation caveat (host toolchain, not the program)

`anchor build` compiles and deploys the program `.so` cleanly. Its separate IDL-generation
step fails on this host because `anchor-syn 0.30.1` calls `proc_macro2::Span::source_file()`,
which the pinned `proc-macro2 1.0.106` no longer exposes (a known Anchor 0.30.1 vs newer
proc-macro2 incompatibility). This is independent of program correctness. To keep the proof
toolchain-independent, the devnet test builds every instruction manually (raw web3.js with
hand-encoded Anchor discriminators) rather than through a generated IDL client. To regenerate
the IDL, pin a toolchain from the Anchor 0.30.1 era (a `proc-macro2` that still exposes
`source_file()`); the on-chain program is unaffected.
