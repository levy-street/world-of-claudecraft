# SNS Subdomains + Tradeable Characters

> **Status:** DRAFT / implementation plan. Stacked on the $WOC paid identity
> core (`feat/woc-rename-vanity-names-v22`). Flag-gated (`WOC_SNS_ENABLED`,
> `CHARACTER_TRADEABLE`, both default **off**); no behavior change on a default
> deploy.

## Summary
Mint **player-owned** SNS subdomains `label.worldofclaudecraft.sol`
**atomically with a $WOC burn**, and **bind character ownership to the
subdomain**: transfer or sell the name on-chain and the character, with all
gear and progression, goes with it. This is real-money-tradeable characters,
native on-chain (the classic-MMO account economy done legitimately).

> **Deliberate product decision:** this makes characters pay-to-win / RMT and
> raises regulatory risk from Low to High, overriding the identity core's
> "never power" constraint. That is why it is its own PR, behind flags, gated
> on legal review before mainnet enablement.

## A. Subdomain minting (atomic with the burn)
- **No new dependencies.** Follows the identity core's pattern: hand-rolled
  legacy transaction serialization and raw Solana JSON-RPC, no
  `@solana/web3.js` and no SNS SDK in the tree. The name-account derivation
  (sha256 + program-derived-address walk, via the existing `@noble/curves`) is
  pinned in tests against the public
  `bonfida.sol -> Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb` vector.
- **Config** (`server/woc_config.ts`): `WOC_SNS_ENABLED` (off),
  `CHARACTER_TRADEABLE` (off), `SNS_PARENT_DOMAIN=worldofclaudecraft.sol`,
  `EXECUTION_WALLET_SECRET` (KMS/secret manager, never git),
  `WOC_PRICE_SUBDOMAIN` (rides `wocPriceBase`/`splitPrice` like every price).
- **`server/sns.ts`** (pure): slugify, domain-key derivation, registry parse,
  and `buildSubdomainMintTx`: one 2-signer transaction carrying burnChecked
  (+ optional treasury transferChecked) + the quote-id memo + the SNS create
  instruction, with the player as fee payer, rent payer, and subdomain OWNER,
  and the execution wallet (parent-domain owner) partial-signed server-side.
  `server/sns_chain.ts` is the IO shell (availability/owner reads, rent).
- **Atomic flow:** `POST /api/subdomain/quote` returns the partial-signed tx
  (base64); the player signs and submits through Wallet Standard
  (`signAndSendWocTransaction`); `POST /api/subdomain/confirm` independently
  verifies the finalized burn (`verifyWocPayment`: memo binding, balance
  delta, burn portion, treasury split, Token-2022 rejection) AND that the
  subdomain registry is now owned by the linked wallet, then records the
  payment (replay-guarded) and binds the character. One signature burns $WOC
  AND mints the name, or neither happens. The player pays the registry rent
  (about 0.0155 SOL for the 2000-byte SDK-default space); the project spends
  0 SOL.
- **Label validation:** slugify name to `[a-z0-9-]{1,63}`, run
  `offensiveName()` on both the display name and the slug (player-owned means
  it must be blocked pre-mint; on-chain reclaim is not possible).
  `sns_subdomains` records `account_id, character_id, label, full_domain,
  owner_pubkey, tx_sig, realm` for audit; the chain stays the source of truth.
- No reverse-lookup registry is created (cosmetic only; every ownership check
  resolves forward from the stored full domain).

## B. Character to subdomain binding + tradeability
- **Bind:** `characters.bound_domain TEXT` (nullable), set in the same DB
  transaction that records the mint. `CHARACTER_TRADEABLE` gates enforcement.
- **Ownership resolution (lazy, pull-based):** at world entry, a bound
  character resolves `resolveSubdomainOwner(domain)`; the controller is the
  account whose verified wallet link matches the current on-chain owner.
- **Claim:** `POST /api/characters/:id/claim`: the requester proves (existing
  signed-challenge wallet link) that their wallet owns the subdomain now; the
  server force-disconnects any live session, detaches the character from its
  guild (leader hand-off / disband via the normal guild-leave path), then
  reassigns `characters.account_id`. Gear and progression follow automatically
  (same row id + `state`).
- **Entry enforcement (flag on):** entering the world with a bound character
  verifies the linked wallet still owns the subdomain; if not, entry is denied
  with "transferred, claimable by the new owner".
- **Policy defaults:** bans follow the account, not the character; an online
  character cannot be claimed without being disconnected first.
- **Security:** the wallet link becomes high-stakes (a drained wallet is an
  irreversibly stolen character). Claims re-use the fresh signed-challenge
  link flow; document prominently.

## Client
- Mint UI only renders after `GET /api/subdomain/prices` succeeds (the route
  404s while the flag is off, mirroring `/api/identity/prices`).
- `src/net/woc_subdomain.ts` runs quote, sign-and-send, and the confirm poll
  (retrying `not_finalized` and `subdomain_not_minted`); the editor is
  `src/ui/mint_subdomain.ts` on the character-select row, with an explicit
  on-chain-ownership hint. Claiming is API-only for now (no client claim UI).

## Tests (Vitest)
`tests/sns.test.ts`: slugify, derivation vector, registry parse, byte-level
transaction decode + execution-signature verify, validation rejects.
`tests/character_claim.test.ts`: the controller decision (linked wallet vs
on-chain owner). `tests/woc_subdomain_flow.test.ts`: the client flow against
fakes. On-chain mint/resolve paths need a funded execution wallet + live RPC
and are exercised on devnet, not in unit tests.

## Prerequisites / risks
The project must control `worldofclaudecraft.sol` and configure (and fund with
a little SOL for fees, though the player pays rent) the execution wallet
before `WOC_SNS_ENABLED=1`. The execution-wallet hot key is the one custodial
seam (player funds stay non-custodial): minimize scope, store via KMS. The
pay-to-win / RMT posture and High regulatory risk require legal review before
`CHARACTER_TRADEABLE=1`.
