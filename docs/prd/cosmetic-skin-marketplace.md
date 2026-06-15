# PRD — Cosmetic Skin Marketplace (Token-Settled, Burn-on-Trade)

| | |
|---|---|
| **Status** | Draft / Proposed |
| **Owner** | TBD (maintainer) |
| **Author** | PhilippMichaly (community proposal) |
| **Created** | 2026-06-15 |
| **Source demand** | Community tokenomics discussion (Discord). The project's `$WOC` token was publicly acknowledged by the dev; the open question raised in the community was *"how could we implement tokenomics?"*. This PRD answers that with a **cosmetic-only, burn-driven skin marketplace** — the only monetization model that does not compromise gameplay balance. |
| **Related systems** | World Market (`src/sim/sim.ts:4880-5096`), item model (`src/sim/types.ts:85-104`, `src/sim/content/items.ts`), character persistence (`server/db.ts`), HUD market window (`src/ui/hud.ts:2016-2046`), i18n (`src/ui/i18n.ts`) |
| **Companion repo** | `PhilippMichaly/woc-skin-chain` (Solana program + NFT metadata — **separate repo, not part of the game**) |

---

## 1. Summary

This PRD proposes a **cosmetic skin marketplace** for World of Claudecraft, settled in the project's Solana token (`$WOC`), with a **token burn on every transaction**. It is deliberately and exclusively **cosmetic**: skins change the *appearance* of equipment, never any stat, so the system is impossible to turn into pay-to-win and does not touch a single vanilla-WoW combat formula.

Three properties define the design:

1. **Non-custodial settlement.** The game never holds player tokens. The player signs their own Solana transaction; the authoritative server merely *observes* the confirmed on-chain transaction (via RPC) and then records ownership. The chain is authoritative for **payment and asset ownership**; the server stays authoritative for **game state**; the deterministic sim stays authoritative for **rendering**.
2. **Burn on every transaction.** A configured share of each trade is burned — on the primary mint **and** on every secondary-market resale (royalty burn). The more skins trade, the more `$WOC` is permanently removed from supply.
3. **Tradeable NFT skins.** Skins are Solana NFTs from a curated developer-authored catalog. Players can resell them to each other through the in-game marketplace; each resale burns again.

The on-chain logic (mint authority, burn, royalty, metadata) lives in a **separate repository** (`PhilippMichaly/woc-skin-chain`) so the game repo keeps its hard invariant: `src/sim/` has zero network/wallet/Three.js dependencies and stays deterministic.

> **Scope note.** This document is a *proposal* to anchor the community tokenomics discussion and give the maintainer a concrete, balance-safe design to accept, amend, or reject. It is intentionally **design-only**: it contains no on-chain code and changes no game behavior. It also does not assert that any particular token contract is the "official" one — see §16.

---

## 2. Background & motivation

### 2.1 Demand signal
The community has an acknowledged `$WOC` token and an open design question: how to give the token genuine utility without harming the game. A cosmetic marketplace is the textbook answer used by every major studio that monetizes a competitive game (see §3): it creates a token sink and a flex economy while leaving gameplay untouched.

### 2.2 Why cosmetic-only is non-negotiable here
The root `CLAUDE.md` invariant is explicit: *"Gameplay math follows real vanilla-WoW formulas … Don't invent balance numbers."* Any token-purchasable item that grants stats would (a) break that invariant and (b) make the game pay-to-win, which destroys the competitive integrity of the ranked Ashen Coliseum arena and its persistent Elo. **Cosmetics are the only monetization that respects both.**

### 2.3 Why a burn, and why on every trade
A burn turns marketplace *activity* (not just issuance) into deflation. Tying the burn to **secondary trades** — not only the first sale — means a healthy resale economy continuously tightens supply, which is the mechanism the community asked for ("burn mechanism per transaction").

---

## 3. How it works in reference games (full breakdown)

### 3.1 WoW transmogrification & the in-game shop (the cosmetic baseline)
- **Transmog** lets a player override the *appearance* of an equipped item with the appearance of any item they have collected, with **zero stat change**. This is exactly the appearance-layer model proposed in §6.
- **The shop** sells purely cosmetic mounts, pets, and (later) appearances for real money — never power. Blizzard's hard line "no power for money" is the precedent this PRD follows.

### 3.2 CS:GO / CS2 skins (the tradeable-cosmetic-marketplace reference)
- Skins are **purely cosmetic** weapon finishes with **no gameplay effect whatsoever**, yet sustain a multi-billion-dollar secondary market.
- Every Steam Market transaction takes a **fee** (a Steam cut + a game cut). The proposed **burn + treasury split** is the direct analog, with "burn" replacing "platform fee removed from circulation."
- Lesson imported: cosmetic-only does *not* mean low-value. Rarity, scarcity, and trade depth create the value; the burn makes scarcity monotonic.

### 3.3 Fortnite / League cosmetics (catalog curation)
- Skins come from a **curated, studio-authored catalog** with controlled drop cadence and quality. No user uploads in the core economy. This is the v1 supply model (§6.2); UGC is explicitly deferred (§7).

### 3.4 On-chain cosmetic games (the settlement reference & its failure modes)
- NFT-cosmetic games demonstrate the **non-custodial pattern**: the player's wallet holds the asset; the game reads ownership from chain. Adopted here.
- They also demonstrate the **failure modes** this PRD must guard against: royalty circumvention on third-party marketplaces (Solana does **not** enforce royalties at the protocol level), mint-authority rug risk, and speculative detachment from actual gameplay. These are treated as first-class risks in §15.

### 3.5 Design synthesis
Cosmetic-only appearance layer (WoW transmog) · curated catalog (Fortnite) · tradeable NFT with a per-trade cut (CS2) · non-custodial on-chain settlement (on-chain games) · the per-trade cut implemented as **burn + disclosed treasury** rather than a private platform fee.

---

## 4. Current state in the codebase

> Verified by source exploration on 2026-06-15 against `main`. Line numbers reflect the current tree.

| Concern | Location | Notes |
|---|---|---|
| World Market (list/buy/cancel/collect/expiry) | `src/sim/sim.ts:4880-5096` | Fully working, **copper**-denominated. The structural template for the skin marketplace UI/flow. |
| `MarketListing` interface | `src/sim/sim.ts:269-278` | `{ id, sellerKey, sellerName, itemId, count, price, expiresAt, house }`. |
| Merchant cut (5%) | `src/sim/sim.ts:4973` | `MARKET_CUT = 0.05` — precedent for a per-transaction cut; the burn is the on-chain analog. |
| Market persistence | `server/db.ts:109-113` | Single `world_state` table, JSONB blob under key `'market'` — flexible, no migration friction. |
| Market UI (browse/sell/collect tabs) | `src/ui/hud.ts:2016-2046` | Plain DOM; the skin marketplace adds a parallel window, not a rewrite. |
| Item model `ItemDef` | `src/sim/types.ts:85-104` | `kind/slot/stats/quality/...`. **No appearance/transmog field exists.** |
| Item catalog | `src/sim/content/items.ts` | Data-as-code `BASE_ITEMS`. Skin catalog mirrors this pattern (§8.1). |
| Cosmetic milestones (only cosmetic system today) | `src/sim/sim.ts:239-242`, `src/sim/types.ts:670` | Lifetime-XP cosmetic badges. **No transmog/wardrobe/appearance-override system exists.** |
| Payment / crypto integration | — | **None.** No Stripe/web3/Solana/wallet code anywhere; currency is in-game copper only. |

**Two gaps must be filled by this design:** (1) there is no appearance layer at all, and (2) there is no external-settlement seam. Both are introduced *outside* `src/sim/` to preserve determinism.

---

## 5. Goals & non-goals

### Goals
- A cosmetic **appearance layer**: skins override equipment visuals, never stats.
- A **non-custodial** token-settled primary sale (mint) and secondary resale market.
- A **burn on every transaction** (mint + every resale), plus a disclosed treasury split.
- Strict architectural isolation: no chain/wallet/network code in `src/sim/`.
- A curated, developer-authored skin catalog (data-as-code).

### Non-goals
- **No stats, no power, no gameplay effect of any kind.** (Hard line.)
- **No custody** of player funds by the game or server.
- **No user-generated skins** in v1 (deferred — §7).
- **No change to the existing copper World Market.** The two markets coexist; copper buys gameplay items, `$WOC` buys cosmetics.
- **No claim of token "officialness."** Activation is explicitly gated on maintainer confirmation (§16).

---

## 6. Functional requirements

### 6.1 Appearance layer
- **FR-1.1** A character has an optional cosmetic **skin override** per equipment slot. Render uses the skin's visual when set; otherwise the equipped item's visual. Combat/stats read **only** the equipped item — never the skin.
- **FR-1.2** A skin can be applied only if the player **owns** it (server-verified, §6.3) and it is **slot-compatible** with the targeted equipment slot. Ownership is held at the **wallet** level (the NFT lives in the linked wallet), while *application* is per **character** — so all characters on an account that share a linked wallet draw from the same owned-skin pool.
- **FR-1.3** Applying/removing a skin is free, instant, reversible, and account-local — it is a pure presentation toggle, persisted in `CharacterState`.

### 6.2 Catalog
- **FR-2.1** Skins are defined as data-as-code in `src/sim/content/skins.ts` (curated, dev-authored). Each entry declares `id`, display name, target slot(s), rarity, and visual parameters — no balance fields.
- **FR-2.2** Adding a skin is a content-only change (new catalog entry + on-chain metadata in the companion repo). No engine change.

### 6.3 Ownership & settlement
- **FR-3.1** Ownership of a skin NFT is authoritative **on-chain**. The server maintains a **mirror ledger** in Postgres for fast reads and snapshot inclusion, reconciled from chain (§8.2).
- **FR-3.2** **Primary sale (mint):** the player signs a transaction that pays `$WOC`, splits it into burn + treasury, and mints the skin NFT to the player's wallet. The server grants the catalog unlock only after observing the confirmed transaction via RPC.
- **FR-3.3** **Secondary sale (resale):** a player lists an owned skin NFT for a `$WOC` price in the in-game marketplace. Because a buyer cannot move the seller's NFT with a single unilateral signature on Solana, listing requires one of two **atomic-swap mechanisms** (chosen in §16): (a) **escrow** — at list time the seller signs a transaction depositing the NFT into a program-owned escrow account, and on purchase the buyer's transaction atomically pays `$WOC`, applies the split, and releases the escrowed NFT; or (b) **delegate approval** — the seller grants the marketplace program a transfer delegate on the NFT, and the buyer's purchase transaction performs the delegated transfer plus split in one instruction. Either way the swap (NFT out, `$WOC` split: **burn + treasury + seller-proceeds**) settles in a single confirmed transaction. The server updates the mirror ledger only after that confirmation; a cancelled listing must revoke the escrow/delegate.
- **FR-3.4** The server **never** initiates a transfer or holds tokens. All value movement is a player-signed, on-chain transaction; the server is a read-only observer + ledger mirror.

### 6.4 Wallet
- **FR-4.1** A client wallet-connect flow (Solana wallet adapter) lives in a new client module (`src/net/` or `src/game/`), **never** in `src/sim/`. A character may be linked to one wallet address; linking is opt-in and required only to mint/trade/own skins.

---

## 7. Deferred scope (future PRDs)

The v1 scope is fixed by §5 (Goals) and §13 (Phases 1–5). The following are explicitly **out of v1**, to be handled by later PRDs:
- **User-generated skins (UGC):** requires moderation, asset-pipeline hardening, IP handling, and render-perf guarantees.
- **Reward-pool split** (a third split bucket feeding arena/creator rewards); v1 is burn + treasury only.
- **Cross-character / account-wide skin libraries** beyond the shared-wallet pool of FR-1.2.

---

## 8. Data model & schema changes

### 8.1 Catalog (game repo, deterministic, no chain deps)
```ts
// src/sim/content/skins.ts  — data-as-code, mirrors items.ts
export interface SkinDef {
  id: string;                 // stable catalog id, e.g. 'ember_warblade'
  name: string;
  slot: EquipSlot;            // which equipment slot this re-skins
  rarity: 'common'|'uncommon'|'rare'|'epic'|'legendary';
  visual: SkinVisual;         // procedural geometry/texture/VFX params (render-side resolves)
  // NO stats, NO weapon damage, NO gameplay fields — by invariant.
}
```
```ts
// src/sim/types.ts — CharacterState gains a presentation-only field
interface CharacterState {
  // ...existing...
  skinOverrides?: Partial<Record<EquipSlot, string>>; // slot -> SkinDef.id (owned + applied)
}
```

### 8.2 Server mirror ledger (Postgres)
```sql
-- ownership mirror; chain is source of truth, this is a reconciled cache
CREATE TABLE IF NOT EXISTS skin_ownership (
  mint_address   TEXT PRIMARY KEY,   -- Solana NFT mint (the asset id on-chain)
  skin_id        TEXT NOT NULL,      -- maps to SkinDef.id
  owner_wallet   TEXT NOT NULL,      -- current on-chain owner
  character_id   BIGINT,             -- linked character, if any (type TBD — must match the existing characters PK; assumed BIGINT, verify against server/db.ts)
  last_tx_sig    TEXT NOT NULL,      -- last confirmed settlement signature
  reconciled_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skin_ownership_owner ON skin_ownership (owner_wallet);

-- wallet link (opt-in)
CREATE TABLE IF NOT EXISTS wallet_links (
  character_id BIGINT PRIMARY KEY,
  wallet       TEXT NOT NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 8.3 On-chain (companion repo `PhilippMichaly/woc-skin-chain`)
- Solana program (Anchor) for: mint-from-catalog, transfer-with-split, burn accounting.
- NFT metadata via the Metaplex Token Metadata standard, one collection for WoC skins.
- A **burn address** and a **disclosed treasury address**; split percentages are program parameters (values = open question, §16).
- **Not part of this PR.** Referenced only.

---

## 9. API / command surface

All new endpoints are server-side (authoritative). None live in the sim.

- `POST /api/wallet/link` `{characterId, wallet, signature}` → verifies a wallet-ownership signature, writes `wallet_links`.
- `GET  /api/skins/catalog` → static catalog (mirrors `src/sim/content/skins.ts`) + on-chain price hints.
- `GET  /api/skins/owned?character=<id>` → mirror-ledger rows for the linked wallet.
- `POST /api/skins/mint/verify` `{txSig}` → server confirms the on-chain mint via RPC, updates `skin_ownership`. **Idempotent on `txSig`.**
- `POST /api/skins/market/list` `{mintAddress, priceWoc}` / `DELETE …/list/{id}` → in-game resale listing metadata (the *listing* is off-chain; the *settlement* is on-chain).
- `POST /api/skins/market/buy/verify` `{txSig}` → server confirms the on-chain transfer+split, reassigns ownership in the mirror.
- **WS:** applying/removing a skin is a `{t:'cmd',cmd:'applySkin',slot,skinId}` validated against owned+slot-compatible, then reflected in interest-scoped snapshots so nearby players see it. Only the `skinId` (a short catalog key) travels on the wire; the receiving client resolves the visual locally from the data-as-code catalog (`src/sim/content/skins.ts`), so per-entity snapshot cost is one extra string and rendering stays deterministic.

---

## 10. UI / UX specification

- **Wardrobe window** (new): grid of owned skins, apply/remove per slot, live preview. Plain DOM, mirrors the existing market window structure (`src/ui/hud.ts:2016-2046`).
- **Skin marketplace window** (new): browse/list/buy tabs, `$WOC`-priced, parallel to the copper World Market — not a modification of it.
- **Wallet-connect affordance**: a clearly optional entry point; the entire game is fully playable without ever connecting a wallet.
- **i18n:** every new string is added to `en` first in `src/ui/i18n.ts`, then to every locale (type-enforced — a missing key fails `tsc`). No hardcoded strings.
- **Transparency UI:** each purchase screen shows the explicit split (burn %, treasury %, seller proceeds %) before the player signs.

---

## 11. Performance & security requirements

- **On-chain verification is the trust boundary.** The server grants ownership **only** after a transaction reaches a safe confirmation level; it must handle RPC reorgs by re-checking finalized status before committing the mirror row (no premature grant).
- **Idempotency:** all `…/verify` endpoints key on the transaction signature; replay yields no double-grant.
- **No hot path impact:** wallet/chain calls are off the 20 Hz tick. The sim only ever sees a resolved `skinOverrides` map; it performs no I/O.
- **No custody / no signing on the server:** the server holds no keys and never constructs value-moving transactions on a user's behalf.
- **Rate limiting** on verify endpoints (RPC cost + abuse).

---

## 12. Tokenomics & economic design

- **Per-transaction split** on both mint and every resale: `burn% + treasury% + sellerProceeds%` (mint has no seller; its non-burn remainder goes to treasury). **Exact percentages are deliberately left open for the maintainer** (§16) — this PRD fixes the *mechanism*, not the *numbers*.
- **Deflation is activity-driven:** supply tightens with trade volume, not just issuance, satisfying the "burn per transaction" intent.
- **Treasury is disclosed and on-chain-auditable** — it funds development/servers; it is not a hidden fee.
- **No token rewards / no earning loop in v1** — this avoids "play-to-earn" dynamics and the regulatory and bot-farming problems they bring. `$WOC` enters the game only as a *sink* for cosmetics.

### 12.1 Price denomination & oracle (handling token volatility)
A burn is deflationary, so `$WOC` tends to appreciate and is volatile regardless. Pricing skins in **raw token units** would make nominal prices swing wildly and force constant manual repricing. The design separates the two markets:

- **Primary sale (catalog) — stable-unit denomination.** The maintainer sets each skin price in a **stable reference unit** (e.g. a USD-equivalent), and the purchase transaction converts it to the `$WOC` amount due **at buy time via an on-chain price oracle** (e.g. Pyth on Solana). The *nominal* token amount floats; the *real* price stays stable, with no manual repricing as the token moves.
- **Burn stays a percentage, never a flat amount** (already specified above). Because the split is proportional, it auto-scales with price and never blocks small or large trades — no separate stabilization needed.
- **Secondary sale (player resale) — free float, made legible.** Sellers price freely (price discovery is desirable here, à la CS2). The elegance is in **UX, not a price peg**: the marketplace always shows the **live fiat-equivalent** (via the same oracle) next to the token price, so a volatile token number is instantly understandable. Optionally, sellers may also **list in the stable unit** (resolved to `$WOC` at buy time) so their listing doesn't drift against token moves.

This keeps catalog prices stable, lets the secondary market discover price naturally, and never breaks the burn math. The oracle dependency is a real trust/availability surface — see the oracle risk in §15 and the open question in §16.

---

## 13. Phasing

> **This PRD is a design proposal, not an implementation spec.** It is deliberately at proposal altitude: it fixes direction, guarantees, and architecture, but does not pin every interface down to code. Several details are intentionally underspecified here because they depend on open maintainer decisions (§16) — notably the `SkinVisual` field shape and render hook-up (`src/render/characters/visual.ts`), the full API request/response schemas (§9), the on-chain program's account/instruction layout (companion repo), and the oracle/price config (§12.1). **Each phase below should get its own short implementation spec** (exact interfaces, file-level hook points, test list) **before coding** — matching the repo's PRD → plan → code workflow. Phase 1 (appearance layer, no chain dependency) is the most self-contained and the natural first such spec.

| Phase | Scope | Est. effort |
|---|---|---|
| **0** | This PRD + maintainer alignment on token officialness and split numbers | XS |
| **1** | Appearance layer (catalog + `skinOverrides` + render + wardrobe UI) — **fully functional with no chain at all** (skins grantable via dev command for testing) | M |
| **2** | Companion repo: Solana program (mint/burn/split) + Metaplex metadata + devnet deployment | L |
| **3** | Server verification + mirror ledger + wallet link | M |
| **4** | In-game marketplace (primary mint + secondary resale, `$WOC`-priced) | M |
| **5** | Hardening: reorg handling, rate limits, transparency UI, audit | M |

Phase 1 is valuable **on its own** (a transmog system) and ships with zero crypto dependency — a natural first PR if the maintainer wants to decouple cosmetics from the token.

---

## 14. Testing strategy

- **Sim/unit (Vitest, `tests/`):** appearance override never alters combat (a skin and a no-skin character with identical gear produce identical damage rolls under the same seed); slot-compatibility validation; persistence round-trip of `skinOverrides`.
- **Server:** `…/verify` idempotency (replayed `txSig` = single grant); mirror reconciliation; reorg simulation (unconfirmed → no grant).
- **On-chain (companion repo):** program tests for split arithmetic (burn+treasury+proceeds = total), mint authority, transfer atomicity — Anchor test suite on devnet.
- **E2E:** wallet link → mint (devnet) → apply skin → second player sees it in snapshot → resale → burn observed on devnet.
- **Determinism guard:** a test asserting `src/sim/` imports nothing from `net/render/ui/game` and no wallet/web3 module.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Royalty/burn circumvention** on third-party Solana marketplaces (Solana does not enforce royalties at protocol level) | Burn is enforced by the *program* on the in-game marketplace path; document that off-platform trades may bypass it; optionally use a transfer-hook / pNFT-style enforced-royalty standard. Treat as a known limitation, not a silent one. |
| **Mint-authority rug / trust** | Mint authority and split parameters held by a maintainer-controlled, disclosed authority (ideally multisig); document upgrade authority; consider renouncing mint after catalog freeze. |
| **Pay-to-win drift** | Hard invariant: `SkinDef` has no stat fields; a Vitest enforces appearance ≠ balance. Code review gate on any skin touching gameplay. |
| **Custody / regulatory exposure** | Non-custodial by construction; the game never holds funds or signs for users. No earning loop (sink-only) reduces securities-style concerns. Not legal advice — flagged for maintainer. |
| **Wallet phishing / fake "connect" prompts** | Official wallet-connect only via the in-client adapter; never ask for seed phrases/private keys; UI warns. |
| **RPC reorg double-grant** | Grant only on finalized confirmation; idempotent on `txSig`; reconciler re-checks. |
| **Token authenticity ("official" token impersonation)** | **Activation gated on maintainer confirmation of the canonical mint address (§16).** This PRD ships no live token binding. |
| **Price-oracle staleness / manipulation** (oracle used for stable-unit pricing, §12.1) | Reject stale prices in the settlement transaction (max-age check → revert); apply sanity bounds; on thin liquidity prefer a TWAP/confidence-interval-aware feed; define a fallback when the feed is unavailable (block purchase, never guess a price). |

---

## 16. Open questions (for the maintainer / community)

1. **Token officialness:** what is the canonical `$WOC` mint address, and does the maintainer endorse binding cosmetics to it? *Nothing here goes live until this is answered.*
2. **Split numbers:** what are `burn%` / `treasury%` / `sellerProceeds%` on mint and on resale?
3. **Treasury address & governance:** single key or multisig? What does the treasury fund, publicly?
4. **Decouple or bundle:** ship Phase 1 (transmog, no crypto) first as an independent feature, then layer the token economy? (Recommended.)
5. **Royalty enforcement standard:** plain NFT + best-effort, or a transfer-hook/pNFT enforced-royalty model?
6. **Secondary-market swap model (FR-3.3):** **escrow** (seller deposits the NFT into a program account at list time) or **delegate approval** (seller grants the marketplace program a transfer delegate)? This decides the on-chain marketplace design and the cancel/revoke flow.
7. **Price denomination & oracle (§12.1):** which stable reference unit (USD-equivalent? a basket?) and which oracle (Pyth?) for converting catalog prices to `$WOC` at buy time? What is the staleness/fallback policy?
8. **Catalog ownership:** who authors/approves skin art and cadence?

---

## 17. Acceptance criteria

- [ ] Maintainer has confirmed (or amended) the cosmetic-only, non-custodial, burn-on-every-trade direction.
- [ ] `src/sim/` remains free of any network/wallet/web3/Three.js import (enforced by test).
- [ ] A skin changes only appearance — a Vitest proves identical combat output with vs. without a skin under the same seed.
- [ ] Primary mint and secondary resale each burn the configured share on a player-signed, on-chain transaction; the server never holds tokens.
- [ ] Ownership is authoritative on-chain and mirrored idempotently server-side; reorgs cannot produce a double-grant.
- [ ] No change to the existing copper World Market.
- [ ] All new UI strings routed through `src/ui/i18n.ts` (every locale).
- [ ] Open questions in §16 resolved or explicitly tracked before any mainnet binding.
