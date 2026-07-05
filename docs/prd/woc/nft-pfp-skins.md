# PRD - NFT PFP Skins: bring your own (BAYC, CryptoPunks, ...) as a character skin

Status: **PLAN - for review (no code yet).**
Extends: [creator-skin-uploads.md](creator-skin-uploads.md) and
[creator-skins-marketplace.md](creator-skins-marketplace.md). Today a creator skin is a
procedural `design`, an operator `asset_url`, a `self_hosted` proxied URL, or a `hosted`
IPFS pin. This PRD adds a fourth source, `nft`: a player proves they own a PFP NFT and
wears it, with the look **inferred from the NFT's traits** (rendered on the existing
procedural design path) and the exact PFP image shown as the unit-frame portrait.

> `file:line` anchors below drift as the tree moves; re-verify against code, which is the
> source of truth (`docs/CLAUDE.md`).

| | |
|---|---|
| **Tier** | 1 - Acquisition / flex (free; NFT ownership is the gate) |
| **Ease** | 3/5 (net-new EVM wallet link + per-chain ownership reads) |
| **Flywheel** | 4 (blue-chip holders bring an audience; deepens wallet linking) |
| **Sustainability** | Neutral (no sink; drives wallet links + retention, not burn) |
| **Reg risk** | Medium-High (third-party IP; mitigated by a vetted allow-list) |

---

## 1. Goal and why

Let a player who owns a recognizable PFP NFT wear it as their character look. A Bored Ape
or a CryptoPunk holder links the wallet that holds it, picks the token, and the game both:

1. **infers a faithful body look from the NFT's traits** onto the procedural skin path
   (no smearing a square portrait over a humanoid UV), and
2. **shows the exact PFP image as the unit-frame portrait and floating nameplate avatar**,
   so the flex is instantly recognizable to everyone around them.

Why it matters: NFT communities are large, loud, and wallet-native. "Wear your ape in
World of ClaudeCraft" is a strong acquisition hook, it deepens the wallet-link surface the
rest of the $WOC economy already depends on, and it costs us nothing to host (the look is
either procedurally derived or a proxied image, never a new asset we author).

### Decisions locked (from review; this PRD reflects them)
- **Chains = Ethereum and Solana.** BAYC / MAYC / CryptoPunks are Ethereum; Mad Lads /
  DeGods / SMB are Solana. Ethereum is net-new (no EVM code in the tree today); Solana
  reuses the existing wallet link. Ship Ethereum first, Solana on the same generic `nft`
  source.
- **Look = trait inference (primary) + portrait fallback (always).** Traits map to the
  existing `SkinDesignSpec` and render on the procedural path. The exact PFP image is
  always proxied and shown 2D in the unit frame + nameplate. Unmapped collections get the
  portrait only.
- **Ownership = lost on sell (continuous re-verify).** Re-checked on a cadence, reusing
  the holder-tier drop-below pattern. Sell or transfer the NFT and the skin delists for
  that account; re-acquire and it restores. Only current holders wear it.
- **Free, but bounded** by a modest per-account cap and the existing IP rate limit. The
  NFT ownership is itself the gate; no $WOC purchase. ($WOC-gating premium collections is
  an open question, section 12.)

---

## 2. What an NFT becomes in-game

A PFP is a square 2D portrait. A skin here is a texture painted onto the shared humanoid
body-UV atlas (the KayKit `Rig_Medium` UV all 9 classes share). You cannot wrap a face
portrait around a body without it reading as a smear, so we never do. Instead an `nft`
skin resolves to **three** surfaces, in order of fidelity:

- **Trait-derived body look (Tier 1, ships first, zero new render code).** The NFT's
  `attributes` map to a `SkinDesignSpec` (primary / secondary / accent colour + pattern +
  finish + density + optional emissive, `src/world_api.ts:376`). A registry entry that
  carries `design` already renders procedurally via `buildSkinCanvas`
  (`src/render/characters/skin_design.ts:206`); it "takes precedence over assetUrl"
  (`src/world_api.ts:430`). So a Solid Gold ape becomes a metallic-gold body, a Zombie
  punk an emissive sickly-green one, an Alien punk a teal body, a Trippy background an
  emissive shimmer. Faithful in palette and material, free to render.
- **Portrait flair (always, every collection).** The exact PFP image, proxied through our
  opaque route, shown as the player's unit-frame portrait and floating-nameplate avatar
  (2D, as the art was intended). This is the universally-recognizable part and the
  guaranteed fallback when trait inference is approximate or the collection is unmapped.
- **Literal accessory geometry (Tier 2, fast-follow, NOT in phase 1).** Hats, glasses,
  pipes, chains as actual procedural cosmetic-slot geometry on the rig. This needs new
  render slots and is explicitly deferred (section 13); Tier 1 + portrait ships the
  feature without it.

The honest limit, stated for the creator UI: Tier 1 reproduces the **palette and material
identity** of a PFP (fur / type / background / rarity finish), not its literal hat or
glasses. The portrait carries the exact likeness; the body carries the vibe. Tier 2 closes
the gap later.

---

## 3. Architecture and data flow

### 3.1 Data model (`creator_skins` additions + new tables)

`creator_skins` (extend the `source` enum and add NFT provenance):
- `source` gains `'nft'` (alongside `'design' | 'self_hosted' | 'hosted'`).
- `nft_chain TEXT` - `'ethereum' | 'solana'`.
- `nft_contract TEXT` - ERC-721 contract address (Ethereum) or collection / mint context
  (Solana). Normalized lower-case for Ethereum.
- `nft_token_id TEXT` - token id (Ethereum uint256 as a decimal string) or mint address
  (Solana). `(nft_chain, nft_contract, nft_token_id)` is **UNIQUE**: one in-game skin row
  per real NFT, no matter how many accounts have linked it over time.
- `design` (existing procedural spec column) carries the **trait-derived** `SkinDesignSpec`
  for the Tier 1 look.
- `portrait_sha256 TEXT` - content hash of the validated, proxied PFP image (cache key,
  reuses `server/skin_assets.ts`).
- The existing `review_status` / `overflow_hidden` columns from creator-skin-uploads apply
  unchanged (NFT skins from a vetted allow-list collection list `approved`; see section 6).

New `linked_evm_wallets` (per account, mirrors the Solana `wallet` table):
- `account_id`, `address` (lower-case 0x), `chain_id`, `linked_at`, with the same one-
  active-link and challenge-nonce model as the Solana link.

New `nft_grants` (the lost-on-sell ledger; an account "wears" an NFT only while a live
grant row exists):
- `account_id`, `skin_id` (FK `creator_skins.id`), `verified_at`, `revoked_at NULL`,
  `last_checked_at`. A revoked grant removes the skin from `ownedCreatorSkinIds`; a re-
  verify restores it. This is the per-account analog of `overflow_hidden`.

The **public registry payload shape is unchanged** (`CreatorSkinRegistryEntry`,
`src/world_api.ts:421`): an NFT skin exposes its trait-derived `design` and an opaque
`assetUrl`/portrait route. Chain, contract, token id, and the owner's wallet **never** leave
the server in the world-public registry (the entry "deliberately carries no ownership or
creator wallet", `src/world_api.ts:419`).

### 3.2 EVM wallet linking (net-new, mirrors the Solana pure/IO split)

`server/wallet_link.ts` today is the pure, IO-free Solana challenge / ed25519 verify
(`verifySolanaSignature`, `:30`; `buildLinkMessage`, `:43`). Add a sibling
`server/wallet_link_evm.ts` that is the same shape for Ethereum:
- a **Sign-In-With-Ethereum (EIP-4361)** style challenge message bound to a server nonce +
  account + expiry,
- **secp256k1 / EIP-191 `personal_sign` recovery**: recover the signer address from the
  signature and assert it equals the claimed `0x` address (case-insensitive checksum-safe),
- pure and unit-testable without a DB, exactly like `wallet_link.ts`.

The DB + HTTP shell lives in `server/wallet.ts` alongside the Solana shell. One new
dependency for secp256k1 recovery (prefer `@noble/curves/secp256k1` + `@noble/hashes`,
already in the same `@noble` family as the ed25519 we use; no heavy web3 SDK). This is the
single largest net-new piece.

### 3.3 Ownership verification (per-chain read path)

A new `server/nft_ownership.ts`, the analog of `server/woc_balance.ts` (the cached, fail-
closed Solana RPC reader). It answers one question per chain: **does address A own token T
of contract C right now?**
- **Ethereum:** `ownerOf(tokenId) == address` for standard ERC-721; a small special case
  for CryptoPunks (a pre-721 contract: `punkIndexToAddress(index) == address`). Read via a
  configured Ethereum RPC (env `ETH_RPC_URL`), or an indexer (Alchemy / Moralis) behind the
  same interface if we prefer hosted reads. Pure `eth_call` keeps the dependency surface at
  zero.
- **Solana:** the largest token-account holder of the mint == an ATA owned by `address`,
  with the mint's collection / verified-creator checked against the allow-list. Reuses the
  existing Solana RPC wiring (`server/woc_balance.ts` patterns; `SOLANA_RPC_URL`).
- **Caching + fail-closed:** cache per `(chain, contract, tokenId)` for a short TTL (the
  woc_balance 2-min cache is the model). On an RPC failure, treat ownership as **last
  known**, never silently grant; an unknown first-time read fails the grant rather than
  guessing.

### 3.4 Grant, then continuous re-verify (lost on sell)

```
link:   POST /api/wallet/evm/challenge -> message ; POST /api/wallet/evm/link {address,sig}
claim:  POST /api/skins/nft/claim {chain, contract, tokenId}
          [auth + linked wallet for that chain checked FIRST]
          -> nft_ownership.owns(addr, contract, tokenId)            (server-authoritative)
          -> resolve metadata (tokenURI / Metaplex) -> attributes
          -> traitProfile(contract).toDesignSpec(attributes)        (section 5)
          -> proxy + validate PFP image (skin_assets) -> portrait_sha256
          -> upsert creator_skins row (source='nft', UNIQUE on chain+contract+token)
          -> insert/restore nft_grants row -> append skin id to ownedCreatorSkinIds
equip:  existing server-authoritative gate (ownership allow-list, bounded id)
verify: a periodic sweep + the existing per-player holder-tier refresh re-run
          nft_ownership.owns(...) for live grants; a now-false owner revokes the grant
          (skin leaves ownedCreatorSkinIds, delists), a restored owner re-grants.
```

Equip is unchanged: the `change_skin` creator branch resolves a requested id to `null`
unless the account **actually owns** it (bounded id, ownership allow-list, the equip gate
from creator-skins-marketplace FR-6, `server/game.ts`). A revoked NFT grant therefore drops
the skin the same way an unowned id is dropped; no special equip logic.

### 3.5 Why this is cheap

The opaque `cosmeticSkinId` carrier, the procedural `design` render path, the
`/api/skins/<id>/atlas.png` style proxy + atlas cache (`server/skin_assets.ts`), the
ownership-gated equip, and the holder-tier drop-below refresh **all already exist**. The
genuinely new code is: EVM wallet linking (3.2), per-chain ownership reads (3.3), the
trait-to-`SkinDesignSpec` mapper (section 5), and the `nft_grants` lost-on-sell ledger.
Nothing in `src/sim/` changes (the sim never interprets `cosmeticSkinId`); the renderer is
untouched on the Tier 1 path.

---

## 4. APIs (additions)

| Method - Route | Purpose |
|---|---|
| `POST /api/wallet/evm/challenge` (new) | Issue an EIP-4361 challenge bound to a nonce + account. |
| `POST /api/wallet/evm/link` (new) | Verify `personal_sign`, link the `0x` address (one active per account). |
| `POST /api/skins/nft/claim` (new) | Prove ownership of `{chain, contract, tokenId}`, derive look, grant. |
| `GET /api/skins/nft/eligible` (new) | List PFPs in the viewer's linked wallets that belong to a supported collection (for the picker UI). Owner-scoped, never public. |
| `DELETE /api/skins/nft/:id` (new) | Player un-claims (removes their grant; row persists for re-claim). |
| `GET /api/skins/<id>/portrait.png` (new) | Opaque portrait serve (proxied, cached) for the unit frame + nameplate. Enforces revoke / overflow. |
| `POST /admin/api/skins/collections` (new) | Operator manages the supported-collection allow-list + its trait profile id. |

Registry (`GET /api/skins/registry`) shape unchanged; only live, non-revoked, approved NFT
skins appear, and only with `design` + opaque portrait (never chain / contract / token /
owner).

---

## 5. Trait inference: profiles + generic mapper

A **trait profile** is a per-collection adapter, pure and unit-tested, that turns an
NFT's `attributes: [{trait_type, value}]` into a `SkinDesignSpec`. It is data-as-code, the
same spirit as `src/sim/content/` records, living host-agnostic so the server derives the
spec once at claim time and stores it in `design`.

```
interface TraitProfile {
  id: string;                                   // 'bayc' | 'cryptopunks' | 'madlads' | ...
  toDesignSpec(attrs: NftAttribute[]): SkinDesignSpec;
}
```

- **Hand-authored profiles** for the marquee collections give high fidelity. Examples:
  - **BAYC** `Fur` -> primary colour + finish (Solid Gold -> gold `#caa84b` + `metallic`;
    Robot -> steel + `metallic`; Zombie -> sickly green + emissive; DMT / Trippy -> high-
    density pattern + emissive). `Background` -> accent. `Clothes` -> pattern hint.
  - **CryptoPunks** `Type` -> base palette (Human / Ape / Zombie green + emissive / Alien
    teal). Accessory traits (Mohawk, Cap, ...) bias pattern + accent in Tier 1 and become
    real geometry in Tier 2.
  - **Solana** Mad Lads / DeGods / SMB: their own profiles keyed on their trait schemas.
- **Generic mapper** for any allow-listed collection without a hand profile: key on the
  widely-followed OpenSea conventions (`Background`, `Fur` / `Skin` / `Body`, `Eyes`,
  `Clothes`, `Mouth`, `Hat` / `Headwear`) and a deterministic colour hash of the token id
  for anything unmatched, so it is stable and never random.
- **No profile + not on the allow-list** -> **portrait-only**: no `design`, the PFP image
  carries the whole look. Always available, always recognizable.

Determinism: `toDesignSpec` is pure and seeded only by the NFT's own data, so the same
token always yields the same look, and any client / the server agree.

---

## 6. Supported-collection allow-list (this is also the IP control)

NFT skins are enabled **only** for collections on an operator allow-list. This single
mechanism does three jobs at once:
- **IP / legal control (section 7):** we only enable collections whose holder licence we
  have vetted. BAYC and CryptoPunks (both under Yuga) grant broad commercial / display
  rights to holders; many collections do not. The allow-list is where that vetting lands.
- **Quality control:** the allow-list entry names the trait profile, so an enabled
  collection renders well (hand profile) or acceptably (generic mapper), never garbage.
- **Anti-spam / anti-abuse:** arbitrary contracts cannot be claimed; only vetted ones.

A claim for an off-list collection is rejected with a clear reason. Operators add a
collection (+ its trait profile id, + a per-collection note on the licence basis) via the
admin route. Trusted, well-licensed collections list `approved` automatically; the review
queue from creator-skin-uploads still backstops anything flagged.

---

## 7. Edge cases and risks (designed-for, not deferred)

- **Third-party IP (the headline risk).** Using a collection's art, even by its holder,
  can infringe unless that collection grants holders display / commercial rights. Mitigation
  is layered: (a) the section 6 allow-list enables only vetted collections; (b) usage is
  holder-only and personal-cosmetic (the player wears their own asset, we host no art beyond
  a proxied portrait they already own the right to display); (c) a fast takedown path
  (remove a collection from the allow-list -> all its skins delist immediately, the same
  delist mechanic as overflow-hide); (d) we never sell NFT skins (free), so there is no
  "we monetized your IP" exposure. Counsel signs off the initial allow-list.
- **Sold / transferred mid-life (lost on sell).** The continuous re-verify sweep (3.4) is
  the core mechanic: a live grant whose owner no longer holds the token is revoked, the
  skin leaves `ownedCreatorSkinIds`, and the equip gate drops it on the next change. Restore
  on re-acquire. Existing snapshot of who-owns-what is never trusted past its TTL.
- **Borrowed / flash-loaned / rented ownership.** A wallet that holds the NFT for one block
  passes a point-in-time `ownerOf`. The continuous sweep limits the exploit to "wears it
  only while actually holding it"; combined with lost-on-sell this is acceptable for a free
  cosmetic. A min-hold-time before grant is an optional hardening (open question).
- **Shared / delegated wallets and delegate.xyz.** A common pattern is holding NFTs in a
  cold wallet and proving with a hot wallet. Phase 1 verifies the linking wallet is the
  direct owner; delegate.cash / delegate.xyz support is a tracked follow-up so cold-wallet
  holders are not locked out.
- **Mutable / dead metadata.** `tokenURI` can point at a 404 or change. We derive the
  `design` spec and cache the validated portrait at claim time (content-hashed, like
  self-hosted), so a later metadata outage does not break a granted skin; a periodic
  re-derive picks up legitimate metadata reveals.
- **Malicious portrait images.** The proxied PFP runs the **same** validator as
  self-hosted (`validateSkinPng` / `parsePngInfo`, decoded-byte ceiling, dimension /
  size caps, `server/skin_assets.ts:27`) and the **same SSRF guard** for any non-IPFS
  origin (`assertSafePublicUrl`, `:85`). IPFS / Arweave gateways are fetched via the
  trusted bounded path.
- **Wrong-chain / spoofed contract.** `(chain, contract, tokenId)` is normalized and the
  contract must be on the allow-list; a contract that merely re-implements a famous name
  is not on the list and is rejected.
- **RPC flakiness / cost.** Fail-closed (last-known, else deny), short TTL cache, and an
  indexer behind the `nft_ownership` interface if direct `eth_call` volume gets expensive.
- **Mainnet vs devnet.** Ethereum ownership reads are **mainnet** (that is where the NFTs
  live), independent of the marketplace's devnet USDC payment cluster. Document the split,
  exactly as the $WOC mainnet-balance vs devnet-payment split is documented today.
- **CORS / WebGL taint.** The portrait is always served same-origin via our route, so no
  cross-origin texture taint (same property as the existing atlas proxy).

---

## 8. Security properties

- **Server-authoritative ownership at every step:** link (signature recovery), claim
  (live on-chain read), and continuous re-verify. The client never asserts ownership.
- **Lost-on-sell by construction:** a grant is a revocable ledger row gated by a fresh
  on-chain read, not a permanent purchase.
- **One NFT, one skin row** (`UNIQUE(chain, contract, tokenId)`): two accounts cannot both
  hold a live grant for the same token (the prior holder's grant revokes when they no longer
  own it).
- **Cosmetic-only / no pay-to-win** (inherited, non-negotiable): an `nft` skin sets the
  `design` and portrait only; `recalcPlayerStats` never reads skin fields, `src/sim/` never
  interprets `cosmeticSkinId`.
- **No new funds path:** NFT skins are free; nothing signs a transfer. EVM linking only ever
  verifies a signature, never moves an asset.
- **IP takedown is one operator action** (delist a collection) with immediate effect.

---

## 9. Dependencies and config

- **EVM signature recovery:** `@noble/curves/secp256k1` + `@noble/hashes/keccak` (same
  `@noble` family as the ed25519 already in use). No web3 SDK.
- **Ethereum reads:** `ETH_RPC_URL` (pure `eth_call`), optionally an indexer key
  (`NFT_INDEXER_API`) behind the `nft_ownership` interface. Mainnet.
- **Solana reads:** reuse `SOLANA_RPC_URL` + the `woc_balance` patterns.
- **Reuses:** `wallet_link.ts` (pure split to mirror), `woc_balance.ts` (cached fail-closed
  reader pattern + the holder-tier refresh sweep), `skin_assets.ts` (validator + SSRF +
  atlas cache for the portrait), `world_api.ts` `SkinDesignSpec` / `normalizeDesignSpec` /
  `CreatorSkinRegistryEntry`, the procedural `buildSkinCanvas` render path, the
  server-authoritative equip gate.
- Document all new env in `.env.example`. No secret in code.

---

## 10. Rollout phases

1. **EVM wallet link** - `wallet_link_evm.ts` (pure, unit-tested) + the
   challenge / link routes + `linked_evm_wallets`. No skins yet.
2. **Ownership reads** - `server/nft_ownership.ts` (Ethereum ERC-721 + CryptoPunks special
   case; Solana mint owner), cached + fail-closed, behind the allow-list.
3. **Trait inference** - `SkinDesignSpec` mapper: generic mapper + the first hand profiles
   (BAYC, CryptoPunks), pure + unit-tested against real sample metadata.
4. **Claim + grant + portrait** - `POST /api/skins/nft/claim`, the `nft_grants` ledger,
   the proxied + validated portrait serve, registry exposure.
5. **Continuous re-verify** - wire the sweep into the holder-tier refresh + a periodic job;
   tests for revoke-on-sell and restore-on-reacquire determinism.
6. **Picker UI** - "Wear an NFT" tab in the Create / appearance panel: connect EVM /
   Solana wallet, `GET /api/skins/nft/eligible` grid of owned PFPs, live preview of the
   trait-derived look + portrait, claim button, lost-on-sell explainer.
7. **Solana collections + more profiles** - Mad Lads / DeGods / SMB profiles; expand the
   allow-list.

Each phase ships green (tsc + suite + builds) with tests, behind the existing online
gating. Tier 2 literal-accessory geometry (section 13) is a separate later program.

---

## 11. Acceptance criteria

- A linked EVM wallet that proves a `personal_sign` over the issued challenge links; a
  wrong / replayed / expired signature is rejected.
- A claim for an owned, allow-listed token grants the skin; an off-list collection, a
  not-owned token, or a wrong-chain claim is rejected with a distinct reason.
- The trait mapper is deterministic: the same token always yields the same `SkinDesignSpec`;
  hand-profiled collections (BAYC, Punks) produce the intended palette / material; an
  allow-listed but un-profiled collection renders via the generic mapper; an off-profile
  collection renders portrait-only.
- The exact PFP shows as the unit-frame portrait + nameplate; the body shows the trait-
  derived look; stats are unchanged by any of it.
- Selling / transferring the NFT revokes the grant on the next sweep (skin leaves
  `ownedCreatorSkinIds`, equip drops it); re-acquiring restores it. `UNIQUE(chain, contract,
  tokenId)` means two live grants for one token never coexist.
- Removing a collection from the allow-list delists every skin from it immediately.
- An RPC failure never grants on an unknown balance / owner (fail-closed); a malformed or
  oversized portrait is rejected by the existing validator before serve.

---

## 12. Open questions / assumptions to confirm in review

- **$WOC interplay:** keep NFT skins fully free, or gate premium collections / Tier 2
  accessory geometry behind a $WOC holder tier (reusing `holder_tier.ts`)? Assumed free.
- **Min-hold-time before grant** to blunt borrow / flash-loan flexing: none, or e.g. 24h
  continuous ownership? Assumed none for a free cosmetic.
- **Delegated ownership (delegate.xyz / delegate.cash):** phase 1 direct-owner only;
  confirm it is an acceptable phase-1 limitation with delegation as a fast follow.
- **Per-account NFT-skin cap** (anti-spam): assume the existing
  `MAX_LISTINGS_PER_ACCOUNT` (24) unless we want higher.
- **Initial allow-list:** which collections at launch (BAYC + MAYC + CryptoPunks +
  Mad Lads + DeGods + SMB?), pending counsel sign-off on each collection's holder licence.
- **Indexer vs raw RPC** for Ethereum ownership at scale: start with `eth_call`, add an
  indexer behind the interface only if volume / cost demands.

---

## 13. Out of scope

- **Tier 2 literal-accessory geometry** (hats / glasses / pipes as real procedural cosmetic
  slots on the rig). It needs new render slots and is a separate later program; phase 1 is
  trait-derived body look + portrait.
- Buying / selling / transferring NFT skins (they are not ours to sell; ownership lives
  on-chain), refunds, multi-token pricing, and any gameplay-stat effect.
- Minting new NFTs from in-game looks (a possible future, not this PRD).
- delegate.xyz / cold-wallet delegation (tracked follow-up, section 12).

---

Plan authored with Claude Code; no implementation yet, awaiting review.
