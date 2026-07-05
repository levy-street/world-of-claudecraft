# PR 2 — SNS Subdomains + Tradeable Characters

> **Status:** DRAFT / implementation plan. Stacked on **PR 1** (`feat/woc-rename-vanity-names`) → #473. Flag-gated (`SNS_ENABLED`, `CHARACTER_TRADEABLE` default **off**); no behavior change on `main` by default.

## Summary
Mint **player-owned** SNS subdomains `‹name›.worldofclaudecraft.sol` **atomically with a `$WOC` burn**, and **bind character ownership to the subdomain**: transfer or sell the name on-chain and the character — *with all gear and progression* — goes with it. This is real-money-tradeable characters, native on-chain (the WoW/RuneScape account economy done legitimately).

> ⚠️ **Deliberate product decision:** this makes characters pay-to-win / RMT and raises reg risk **Low → High**, overriding the stub's "never power" constraint. That's why it's its own PR, behind flags, gated on legal review before mainnet enablement.

## A. Subdomain minting (atomic with the burn)
- **Dep:** `@bonfida/spl-name-service`. **Config:** `SNS_ENABLED` (off), `SNS_PARENT_DOMAIN=worldofclaudecraft.sol`, `EXECUTION_WALLET_SECRET` (encrypted at rest, reusing the `SecretVault` pattern from `docs/prd/eliza-agents.md`), `WOC_PRICE_SUBDOMAIN`.
- **`server/sns.ts`** (new, server-only; boundary note like `solana.ts`): `buildIssueSubdomainIxs(label, ownerPubkey)` (owner = player wallet, fee-payer = player), `partialSignWithExecutionWallet(tx)` (parent-domain authority), `subdomainAvailable(label)`, `resolveSubdomainOwner(domain)` (read-only cached RPC, mirrors `woc_balance.ts`).
- **Atomic tx:** extend PR 1's `identity.ts` quote so that when `claimSubdomain`, the subdomain-create instructions are appended to the burn tx and execution-wallet partial-signed → the player's **single signature burns `$WOC` AND mints `‹label›.worldofclaudecraft.sol` to them, or neither happens.** Player pays ~**0.00156 SOL** rent (~$0.11) + fee; **project spends 0 SOL**. Confirm independently verifies the registry-create for the expected label/owner alongside the burn.
  - Rent measured on mainnet: 96-byte subdomain registry = 0.001559 SOL rent-exempt.
  - If burn+mint exceeds the 1232-byte tx limit, fall back to two txs (verified burn → mint) and note the lost strict atomicity.
- **Label validation:** slugify name → `[a-z0-9-]{1,63}`, run `offensiveName()` on the slug (player-owned ⇒ **must** block pre-mint, since on-chain reclaim isn't possible). `sns_subdomains` table records `account_id, label, full_domain, owner_pubkey, tx_sig, character_id, status`.

## B. Character ⇆ subdomain binding + tradeability
- **Bind:** `characters.bound_domain TEXT` (nullable). A character minted-with-claim binds to its subdomain. `CHARACTER_TRADEABLE` gates *enforcement*.
- **Ownership resolution (lazy, pull-based):** at character-select/login, for a bound character resolve `resolveSubdomainOwner(domain)` → current on-chain owner; controller = the account whose verified wallet link matches it.
- **Claim/transfer:** `POST /api/characters/:id/claim` — requester proves (existing signed-challenge) their wallet owns the subdomain now ⇒ server reassigns `characters.account_id`, force-disconnects any active seller session, and runs **transfer cleanup** (cancel market listings, resolve guild membership/leadership, preserve mail/bound items). Gear/progress follow automatically (same row id + `state`).
- **Login enforcement (flag on):** entering the world with a bound character verifies the linked wallet still owns the subdomain; if not ⇒ deny + mark "transferred — claimable by new owner."
- **Policy defaults (documented, configurable):** bans follow the *account*, not the character; guild leadership on transfer auto-transfers to the highest-ranked remaining officer (or disbands if none); an online or listed character can't take a fresh bind until settled.
- **Security:** the wallet link is now high-stakes (a drained wallet = an irreversibly stolen character). Require a fresh signed-challenge per claim; rate-limit claims; document prominently.

## Client
"Claim a character you own/bought" flow; subdomain claim in the identity dialog; explicit tradeability + irreversibility disclosures.

## Tests (Vitest)
Subdomain slugify / availability / instruction-shape + execution-wallet partial-sign (mock RPC/keypair); atomic burn+mint verify; ownership resolution; claim reassigns `account_id` + cleanup; login enforcement when flag on; offensive slug blocked pre-mint.

## Prerequisites / risks
Project must control `worldofclaudecraft.sol` + fund/secure the execution wallet before `SNS_ENABLED=true`. Execution-wallet hot key = the one custodial seam (player funds stay non-custodial) — minimize scope, SecretVault/KMS. Pay-to-win/RMT + High reg risk = legal review before `CHARACTER_TRADEABLE=true`.
