# Implementation Plan and Research - NFT PFP Skins

Status: **PLAN - for review (no code yet).**
Companion to the product spec [nft-pfp-skins.md](nft-pfp-skins.md). That doc is the "what and
why"; this is the "how", grounded in a verified read of the codebase and current external facts.
Where the two differ, this plan supersedes the PRD (it post-dates the deep research). All codebase
anchors below were re-verified against the tree; external facts were verified against primary
sources (EIPs, Etherscan, project sites) and are current as of 2026-06.

---

## 1. Goal (clarified)

A player proves, by signing a challenge with the wallet that holds it, that they own a specific PFP
NFT, and then wears it. "Wears it" means two surfaces:

1. **Body look, inferred from the NFT's traits**, rendered on the existing procedural skin path (no
   smearing a square portrait over a humanoid UV).
2. **The exact PFP image** shown 2D as the player's HUD unit-frame portrait and floating-nameplate
   avatar, so the flex is instantly legible to everyone nearby.

Locked from prior review: chains are **Ethereum and Solana**; the look is **trait inference plus a
portrait fallback**; ownership is **lost on sell (continuous re-verify)**; the feature is **free**
(the NFT is the gate), bounded by an anti-spam cap.

Success = a BAYC/Punk/MadLad/DeGod holder links a wallet, picks a token, sees a faithful body look
plus their exact PFP on their frame and nameplate, keeps it while they hold the NFT, and loses it
within one sweep of selling it. No gameplay stat ever changes. The sim core never interprets the
cosmetic id. tsc + Vitest + build + `tests/architecture.test.ts` + the S3 i18n guard stay green.

---

## 2. Constraints, dependencies, and edge cases

### 2.1 Hard constraints (from the repo, non-negotiable)
- **Cosmetic-only.** `recalcPlayerStats` never reads skin fields; `Entity.cosmeticSkinId`
  (`src/sim/types.ts:1286`) is opaque to `src/sim/`. An NFT skin sets appearance only.
- **`src/sim/` purity and determinism.** No DOM/Three/`net` imports; no `Math.random`/`Date.now`.
  The trait-to-design mapper, if placed in `src/sim/content/`, must be pure and seed any variation
  on the token id, not RNG. Guarded by `tests/architecture.test.ts`.
- **Server is authoritative and SQL is confined.** Ownership is decided server-side; raw SQL only in
  `server/db.ts` / `*_db.ts`. New logic modules (`nft_ownership.ts`, `wallet_link_evm.ts`) carry no
  SQL and follow the pure/IO split (`wallet_link.ts` pure vs `wallet.ts` shell is the model).
- **Wire lockstep.** Adding `portraitUrl` to the registry entry must land in the server serializer
  (`server/marketplace.ts`), the seam (`src/world_api.ts`), and the client (`src/net/online.ts`) in
  one change.
- **i18n.** Every new player-visible string (the picker UI, error toasts) is a `t()` key in `en`;
  server-emitted text is English at source with a matcher entry. No em/en dashes or emojis anywhere.
- **Keep deps tiny.** Justify every package.

### 2.2 New dependencies
| Dependency | For | Notes |
|---|---|---|
| `@noble/curves` v2 + `@noble/hashes` v2 | Server EVM signature recovery (secp256k1, keccak256) | Same `@noble` family as the ed25519 already used by `wallet_link.ts`. Zero-dep. **v2 API breakers:** subpath imports need the `.js` extension; hash inputs are `Uint8Array`-only; `prehash` default flipped to `true`. Use `keccak_256` from `@noble/hashes/sha3.js`, `secp256k1.Signature.fromCompact(rs).addRecoveryBit(v-27).recoverPublicKey(hash)`. |
| `ETH_RPC_URL` (config, not a package) | `eth_call` for `ownerOf` / `punkIndexToAddress` / `tokenURI` / `getCode` / EIP-1271 | Alchemy/Infura/own node. Mainnet. Behind a generic `ethRpc()` wrapper mirroring `solanaRpc()` (`server/solana_rpc.ts:24`). |
| `HELIUS_API_KEY` or any DAS provider (config) | Solana **compressed** NFT ownership + metadata (Mad Lads) | **Deferred to Phase 7** (D2). The DAS path is built behind this env flag but dark at launch; standard Solana NFTs (DeGods) reuse `SOLANA_RPC_URL`. No paid dependency at launch. |
| Client EVM connection | Browser wallet link (personal_sign) | Two options (open decision D4): raw EIP-1193 `window.ethereum` + EIP-6963 discovery (zero dep, desktop-first) vs `viem`/`wagmi` + WalletConnect (mobile + broad, adds deps). Recommend raw first. |

No server-side image-processing dependency: the PFP portrait is proxied and cached as-is (bounded,
content-sniffed, SVG rejected) and downscaled on the client (the unit frame already blits via
`ctx.drawImage`; the nameplate uses CSS `background-size`). `sharp` is optional later hardening
(re-encode to strip payloads), not baseline.

### 2.3 Edge cases (designed-for, not deferred)
- **Smart-contract wallets (EIP-1271).** A Gnosis Safe / vault holder has no private key; `ecrecover`
  on its signature blob returns garbage, never the Safe address. Verification MUST branch on
  `eth_getCode`: empty code => `ecrecover` (EOA); has code => `eth_call isValidSignature(hash,sig)`
  and accept iff it returns the magic `0x1626ba7e`. (ERC-6492 covers not-yet-deployed wallets;
  out of scope for phase 1, noted.)
- **Wrapped vs native CryptoPunks.** Check both the original `CryptoPunksMarket`
  (`0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB`, `punkIndexToAddress` selector `0x58178168`,
  returns zero-address on unowned) and Wrapped Punks
  (`0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6`, ERC-721 `ownerOf`). Either match = owns the punk.
- **Compressed NFTs (Mad Lads).** No token/mint/metadata account; SPL reads find nothing. Must use
  DAS `getAsset(assetId)` -> `ownership.owner` and `content.metadata.attributes`. DeGods are
  standard (mint -> `getTokenLargestAccounts` -> token account -> owner). pNFTs are frozen but
  token-account reads still work.
- **`ownerOf` revert vs zero-address.** ERC-721 `ownerOf` reverts on a nonexistent/unowned token;
  `punkIndexToAddress` returns zero-address. Treat both as "not owned", do not crash.
- **Sold mid-session.** The re-verify sweep removes the skin from `ownedCreatorSkinIds` AND, because
  the equip gate only re-checks on `change_skin` (`server/game.ts:1532`), actively force-clears the
  live equipped `cosmeticSkinId` if it is the revoked skin. Net-new "revoke and unequip" path.
- **Borrowed / flash-loaned ownership.** A one-block holder passes a point-in-time read. The sweep
  bounds the exploit to "wears it only while actually holding"; an optional min-hold-time is open
  decision D5.
- **Same NFT, two accounts.** `UNIQUE(chain, contract, token_id)` gives one skin row; the prior
  holder's grant revokes on the next sweep. A transient double-display window (<= one sweep) is
  acceptable; documented, not silently ignored.
- **Mutable / dead metadata, reveals.** Derive the design spec and cache the portrait at claim time
  (content-hashed). A later metadata 404 does not break a granted skin; a periodic re-derive picks
  up legitimate reveals.
- **URI schemes.** `tokenURI`/Metaplex `uri` may be `ipfs://`, `ar://`, `https://`, or
  `data:application/json;base64,...`. Resolve via gateway or decode inline. **Reject SVG portraits**
  (SVG can carry script); sniff magic bytes and allow PNG/JPEG/WebP/GIF (static frame of animated).
- **Address casing.** Store EVM addresses lower-cased; compare case-insensitively; render EIP-55
  checksummed.
- **RPC flakiness.** Fail-closed: last-known on a transient error, deny on an unknown first read;
  never grant on an unknown owner. Short TTL cache smooths load.
- **Mainnet vs devnet.** ETH and Solana NFT ownership reads are **mainnet**; the marketplace USDC
  payment cluster is devnet. Intentional, documented (mirrors the existing $WOC-mainnet vs
  USDC-devnet split).
- **Replay / nonce / expiry / rate limit** on the EVM link: mirror the Solana guards exactly
  (single-use nonce PK, 10-min TTL, account-scoped consume, 10/min per IP and account).

---

## 3. Existing patterns, APIs, and libraries (verified)

### 3.1 Codebase seams to reuse or mirror (re-verified file:line)
| Seam | Location | Reuse |
|---|---|---|
| Pure Solana link (challenge + ed25519) | `server/wallet_link.ts` (`buildLinkMessage:43`, `verifySolanaSignature:30`) | **Mirror** as `server/wallet_link_evm.ts` (EIP-4361 message + secp256k1 EOA recovery). |
| Link IO shell + routes | `server/wallet.ts` (`handleWalletChallenge:31`, `handleWalletLink:54`, `handleWalletGet:96`, `handleWalletUnlink:106`); routes `server/main.ts:1273-1291` | **Mirror** as `server/wallet_evm.ts` + 4 routes under `/api/wallet/evm/*`. The EIP-1271 contract-wallet branch lives here (it needs `eth_call`), not in the pure module. |
| Wallet link DDL | `server/db.ts:368-388` (`wallet_links`, `wallet_link_challenges`) | **Mirror** as `evm_wallet_links` (+ `chain_id`), `evm_wallet_link_challenges`. |
| Account wallet resolve | `walletForAccount` (used `server/game.ts:620`, `server/main.ts` marketplace routes) | Add `evmWalletForAccount(accountId)`. |
| $WOC balance reader (cached, fail-closed) | `server/woc_balance.ts` (`CACHE_TTL_MS=2min:32`, `getTokenAccountsByOwner`, LRU 1024, 8s timeout) | **Mirror** as `server/nft_ownership.ts` (per `(chain,contract,token)` cache, fail-closed). |
| Generic Solana RPC wrapper | `server/solana_rpc.ts:24` `solanaRpc<T>(method,params,timeout)` | **Mirror** as `ethRpc()`; reuse `solanaRpc` for SPL NFT reads. |
| Holder-tier refresh sweep | `server/game.ts` (`HOLDER_TIER_REFRESH_MS=60s:112`, `refreshAllHolderTiers:643`, `refreshHolderTier:618` -> `enforceHostedQuota`) | **Mirror** as the lost-on-sell sweep (`NFT_VERIFY_REFRESH_MS`, `refreshAllNftGrants`, overlap guard). |
| SSRF-safe fetch + atlas LRU | `server/skin_assets.ts` (`assertSafePublicUrl:85`, `fetchRemoteImage:98`, `loadAtlasBytes:139`, `MAX_CACHED_ATLASES=64`) | **Reuse** the SSRF guard + cache for the portrait proxy (with a portrait-specific validator, not the 1024² body-atlas one). |
| Atlas serve route | `server/main.ts:1341` `GET /api/skins/<id>/atlas.png` | **Add** sibling `GET /api/skins/<id>/portrait.png` (sniff, size cap, reject SVG, same-origin, `Cache-Control: public, max-age=300`). |
| `creator_skins` table + row | `server/db.ts:421-455`; `CreatorSkinRow` `:2147`; `mapCreatorSkin:2181` | **Extend** `source` to include `'nft'`; add `nft_chain`/`nft_contract`/`nft_token_id`/`portrait_sha256`. |
| Listing create pattern | `createListing` / `createSelfHostedListing` / `imageRow` (`server/marketplace.ts:234/351/329`) | **Mirror** as `claimNftSkin(...)`. |
| Grant (RMW append) | `redeemPurchase` (`server/db.ts:2425`, row-lock append to `ownedCreatorSkinIds:2445`); live `applyCreatorSkinGrant` (`server/game.ts:739`) | **Reuse** the append; add `grantCreatorSkin(accountId,skinId)` (no payment) + `revokeCreatorSkin` (remove + unequip). |
| Ownership store + normalize | `AccountCosmetics.ownedCreatorSkinIds`, `normalizeAccountCosmetics` (`src/world_api.ts:326-356`) | Unchanged; NFT skin ids live in the same array. |
| Equip gate (source-agnostic) | `server/game.ts:1532` (`change_skin`, bounded id, `ownedCreatorSkinIds.includes`) | **Unchanged.** Revoke relies on it dropping an un-owned id, plus the active unequip. |
| Registry serialize + filter | `registrySkins` (`server/marketplace.ts:194`), `listLiveCreatorSkins` (`server/db.ts:2205`, filters `status='live' AND review_status='approved' AND NOT overflow_hidden`); client `creatorSkins()` (`src/net/online.ts:494`) | **Extend** the serializer + `RegistrySkin`/`CreatorSkinRegistryEntry` with `portraitUrl`. |
| Body render: design vs assetUrl | `registerCreatorSkins`/`ensureCreatorSkin`/`creatorSkinTexture` (`src/render/characters/assets.ts:404-474`), `designSkinTexture`, `visual.setCreatorSkin` | **Unchanged** for the body. NFT body = trait-derived `design`, renders via the existing procedural path with zero new render code. |
| Procedural design spec | `SkinDesignSpec` (`src/world_api.ts:376`), `normalizeDesignSpec:393`, `buildSkinCanvas` (`src/render/characters/skin_design.ts:206`) | **Target** of the trait mapper. Vocabulary: `primary`/`secondary`/`accent` hex, `pattern` (9), `finish` (matte/satin/metallic), `density`, `emissive`. |
| Unit-frame portrait | `UnitPortraitPainter.drawClass`/`drawHeadshot` (`src/ui/unit_portrait_painter.ts:82/62`), `imgCache:28` | **Inject** a portrait branch: if the entity's cosmetic has a `portraitUrl`, `drawHeadshot(canvas, portraitUrl)` (the async decode + 2D blit already exists). |
| Nameplate DOM + update | build `src/render/renderer.ts:2998-3054`; `updateNameplates:4428`; skin-swap read `:3723` | **Add** a `.np-avatar` div + CSS `background-image` from `portraitUrl` (net-new; no avatar slot today). |

### 3.2 External APIs / selectors / addresses (verified, hardcode these)
- ERC-721 `ownerOf(uint256)` selector **`0x6352211e`**; `tokenURI(uint256)` **`0xc87b56dd`**.
- CryptoPunks `punkIndexToAddress(uint256)` **`0x58178168`**; native `0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB`; Wrapped `0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6`.
- BAYC `0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D` (standard ERC-721).
- EIP-1271 `isValidSignature(bytes32,bytes)` magic return **`0x1626ba7e`**.
- EIP-4361 (SIWE) message: exact line order and blank lines are load-bearing; reconstruct
  server-side before recovery. EIP-191 `personal_sign` preimage:
  `"\x19Ethereum Signed Message:\n" + byteLen(msg) + msg`, then keccak256, then ecrecover.
- Metadata `attributes: [{trait_type, value}]` (OpenSea standard, same shape on Solana via DAS
  `content.metadata.attributes`).
- BAYC trait categories: Background, Clothes, Earring, Eyes, **Fur**, Hat, Mouth (Fur is the
  rarity-decisive one: Solid Gold, Trippy, DMT, Robot, Zombie, Cheetah).
- CryptoPunks: **Type** (Male/Female/Zombie 88/Ape 24/Alien 9) plus 0-7 accessories from 87
  (Mohawk, Pipe, 3D Glasses, Cap, Earring, ...).
- Solana ownership: standard = `getTokenLargestAccounts(mint)` -> token account -> `getAccountInfo`
  owner; compressed = DAS `getAsset`. Optional EVM indexers behind the interface: Alchemy
  `getOwnersForNFT` / `isHolderOfContract`, Moralis `getWalletNFTs`.

### 3.3 IP / legal (the headline risk, verified)
- **BAYC:** Yuga grants the holder an unlimited, worldwide commercial **license** to that ape's art
  (no revenue cap). It is a license, not a copyright transfer, and excludes trademark.
- **CryptoPunks:** restrictive under Larva Labs pre-2022; Yuga granted holders full commercial
  rights to their punk's art on 2022-08-15. Era matters.
- **Landscape:** most PFP collections do NOT grant broad third-party display rights by default.
  Three buckets: generous license (BAYC, Punks/Meebits post-Yuga), CC0 / public domain (Nouns,
  CrypToadz, mfers - safe regardless of holder), and restrictive/capped (legacy "NFT License").
- **Posture:** a **per-collection allow-list** is the correct control. Enable a collection only
  after vetting its holder license; store the license basis per row. Display of the holder's owned
  art as their cosmetic is a narrow, defensible use; gate on verified ownership and avoid the
  project's trademarks/logos in our own branding.

---

## 4. Architecture and data flow

### 4.1 Modules (new) and where they sit
```
server/
  wallet_link_evm.ts   PURE: EIP-4361 message build, 0x address + EIP-55 validate,
                       secp256k1/keccak EOA signature recovery. Unit-tested, no DB/IO.
  wallet_evm.ts        IO SHELL: challenge/link/get/unlink handlers; the EIP-1271 contract-wallet
                       branch (eth_getCode -> eth_call isValidSignature). Mirrors wallet.ts.
  eth_rpc.ts           ethRpc<T>(method, params): generic mainnet JSON-RPC, fail-closed, 8s.
  nft_ownership.ts     LOGIC: owns(chain, contract, tokenId, address) + metadataAttributes(...).
                       ETH path (ownerOf / punks / wrapped, EIP-1271 not needed for reads) and
                       Solana path (SPL largest-account owner; DAS getAsset for cNFT). Cached,
                       fail-closed, behind the allow-list. No SQL.
  nft_collections.ts   The allow-list (chain, contract, profile id, license basis, enabled) +
                       admin management. The IP + quality + anti-spam control.
  (db.ts)              + evm_wallet_links, evm_wallet_link_challenges, nft_grants tables;
                       creator_skins source='nft' + nft_* columns; grant/revoke queries.
src/sim/content/
  nft_trait_profiles.ts  PURE host-agnostic: TraitProfile.toDesignSpec(attrs) -> SkinDesignSpec.
                         Hand profiles (bayc, cryptopunks) + generic mapper + deterministic
                         token-id color hash. Unit-tested against real metadata fixtures.
src/net/
  wallet_evm.ts        Client EVM connect + personal_sign (raw EIP-1193 / EIP-6963).
  online.ts            + nft claim/eligible calls; + portraitUrl on the registry entry.
src/ui/
  unit_portrait_painter.ts  + portrait branch (drawHeadshot from portraitUrl).
src/render/
  renderer.ts          + .np-avatar nameplate slot painted from portraitUrl.
```
Architecture rule check: the new `server/` modules import only `src/sim/` types, `src/world_api.ts`,
and `node:*`. `nft_trait_profiles.ts` in `src/sim/content/` is pure (no DOM/RNG; varies on token id),
so `tests/architecture.test.ts` stays green.

### 4.2 Data model (DDL deltas)
```sql
-- creator_skins (extend)
ALTER TABLE creator_skins ADD COLUMN IF NOT EXISTS nft_chain TEXT;        -- 'ethereum' | 'solana'
ALTER TABLE creator_skins ADD COLUMN IF NOT EXISTS nft_contract TEXT;     -- lower-cased ERC-721 / collection
ALTER TABLE creator_skins ADD COLUMN IF NOT EXISTS nft_token_id TEXT;     -- decimal uint256 / mint / assetId
ALTER TABLE creator_skins ADD COLUMN IF NOT EXISTS portrait_sha256 TEXT;  -- cached portrait content hash
CREATE UNIQUE INDEX IF NOT EXISTS creator_skins_nft
  ON creator_skins(nft_chain, nft_contract, nft_token_id) WHERE source = 'nft';
-- source already TEXT DEFAULT 'design'; app-validate the new 'nft' value. design_spec holds the
-- trait-derived SkinDesignSpec. assetUrl is unused for nft (body = design); portraitUrl is derived.

-- evm wallet link (mirror wallet_links / wallet_link_challenges)
CREATE TABLE IF NOT EXISTS evm_wallet_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,           -- lower-cased 0x
  chain_id INT NOT NULL DEFAULT 1,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evm_wallet_link_challenges (
  nonce TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  message TEXT NOT NULL,                  -- the exact SIWE string the wallet must sign
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evm_wallet_link_challenges_account ON evm_wallet_link_challenges(account_id);

-- lost-on-sell ledger (which owned skins are NFT-gated + need re-verification)
CREATE TABLE IF NOT EXISTS nft_grants (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  skin_id TEXT NOT NULL REFERENCES creator_skins(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, skin_id)
);
CREATE INDEX IF NOT EXISTS nft_grants_live ON nft_grants(account_id) WHERE revoked_at IS NULL;

-- allow-list (IP + quality + anti-spam)
CREATE TABLE IF NOT EXISTS nft_collections (
  chain TEXT NOT NULL,
  contract TEXT NOT NULL,                 -- lower-cased; for Solana, collection key / verified creator
  profile_id TEXT NOT NULL,               -- trait profile ('bayc'|'cryptopunks'|'generic'|...)
  license_basis TEXT NOT NULL,            -- vetted note: 'yuga-holder-license' | 'cc0' | ...
  enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (chain, contract)
);
```

### 4.3 Link flow (EVM)
```
POST /api/wallet/evm/challenge {address}      [bearer, rate-limited]
  -> validate 0x address; build SIWE message (nonce, account, issuedAt, expiry); store challenge (10m)
  -> { nonce, message }
client: personal_sign(message) via window.ethereum
POST /api/wallet/evm/link {address, signature, nonce}   [bearer, rate-limited]
  -> consume challenge (single-use, account-scoped, unexpired)
  -> eth_getCode(address): empty => ecrecover EOA (wallet_link_evm.recover) == address ?
                           non-empty => eth_call isValidSignature(keccak(siwe), sig) == 0x1626ba7e ?
  -> link (one active EVM wallet per account; UNIQUE address) -> { address, linked:true }
```

### 4.4 Claim -> derive -> grant flow
```
GET /api/skins/nft/eligible        [bearer; owner-scoped, never public]
  -> for each linked wallet (evm + solana), list tokens in allow-listed collections (indexer or
     a small enumerated set) for the picker grid.
POST /api/skins/nft/claim {chain, contract, tokenId}   [bearer, linked wallet for chain, rate-limited]
  -> collection on allow-list? else reject 'collection_not_supported'
  -> nft_ownership.owns(chain, contract, tokenId, linkedAddress)? else reject 'not_owner' (fail-closed)
  -> nft_ownership.metadataAttributes(...) -> attrs
  -> traitProfile(profileId).toDesignSpec(attrs) -> SkinDesignSpec        (pure)
  -> proxy + sniff + cache the PFP image (image field) -> portrait_sha256  (SSRF-safe / gateway)
  -> upsert creator_skins (id = cs_nft_<chain>_<short(contract)>_<token>, source='nft',
       design_spec = spec, review_status from collection policy, status='live')
  -> grantCreatorSkin(accountId, skinId): RMW append to ownedCreatorSkinIds (db.ts:2445 pattern)
       + insert nft_grants(account_id, skin_id)
  -> game.applyCreatorSkinGrant(accountId, skinId)   (live, equip without reconnect)
  -> invalidatePublicRead('registry')
equip: unchanged server-authoritative gate (server/game.ts:1532)
render: body via design (assets.ts existing path); portrait via portraitUrl in frame + nameplate
```

### 4.5 Lost-on-sell sweep
```
setInterval(NFT_VERIFY_REFRESH_MS ~ 5min) -> refreshAllNftGrants()   (overlap-guarded, mirror :643)
  for each online account with live nft_grants:
    for each grant: nft_ownership.owns(...) ?
      still owns -> touch last_checked_at
      no longer owns (definite, not RPC-unknown) ->
        revokeCreatorSkin(accountId, skinId):
          remove skinId from ownedCreatorSkinIds (RMW) ; set nft_grants.revoked_at
          updateLiveAccountCosmetics ; if entity.cosmeticSkinId == skinId -> setPlayerSkin(clear overlay)
        invalidatePublicRead('registry')
  also: re-acquired (revoked grant, now owns again) -> restore (re-grant)
on login: verify live grants once before trusting them past TTL.
collection disabled in allow-list -> all its skins delist immediately (registry filter + sweep revoke).
```

---

## 5. Unknowns and risks

| # | Risk / unknown | Severity | Mitigation / plan |
|---|---|---|---|
| R1 | **IP/legal per collection.** Rights vary by collection and era; using art outside the license infringes. | High | Per-collection allow-list with counsel-vetted `license_basis`; ownership-gated, holder-only, no resale, instant delist. Launch only BAYC + Punks/Meebits (post-2022) + CC0 (Nouns/CrypToadz/mfers). |
| R2 | **cNFT dependency.** Mad Lads need a DAS provider (Helius) + key + cost. | Med | Build the Solana reader with an SPL path and a DAS path behind one interface; gate cNFT collections on the DAS env. Open decision D2: include now or defer. |
| R3 | **Smart-wallet holders (EIP-1271).** Plain ecrecover locks out Safe/vault holders (the whales). | Med | Bytecode-branch verification at link (4.3). ERC-6492 counterfactual wallets deferred, noted. |
| R4 | **Trait->3-color spec is lossy.** Captures palette/material, not literal hats/glasses. | Med | Honest UI copy; the portrait carries exact likeness; Tier 2 accessory geometry is a separate later program (out of scope here). |
| R5 | **ETH RPC cost/latency at scale.** Per-claim and per-sweep `eth_call`s. | Med | Cache (TTL), batch, and allow an indexer (Alchemy/Moralis) behind the `nft_ownership` interface. Sweep only online players; longer NFT TTL than balances. |
| R6 | **Portrait image abuse.** Arbitrary proxied image. | Low-Med | Allow-list collections only (canonical, immutable art for BAYC/Punks); sniff magic bytes; reject SVG; size cap; same-origin serve; optional re-encode (sharp) later. |
| R7 | **Transient double-display** of one NFT across two accounts between sweeps. | Low | Bounded by sweep cadence; `UNIQUE` row; documented. Tighten cadence if needed. |
| R8 | **Borrow/flash-loan flex.** | Low | Sweep limits to actual-hold window; optional min-hold-time (D5). |
| R9 | **Mobile EVM wallet connect** without a heavy lib. | Med | D4: raw EIP-1193/6963 (desktop-first) vs viem/wagmi + WalletConnect (mobile). Recommend raw first, revisit for mobile. |
| R10 | **Wire-shape drift** from adding `portraitUrl`. | Low | Land server serializer + `world_api.ts` + client in one change; covered by a test. |

---

## 6. Phased implementation plan

Each phase ships green (tsc + targeted Vitest + `npm run build` + `tests/architecture.test.ts` + the
S3 i18n guard) and is independently reviewable. Test-first per the `extract-and-test` skill.

- **Phase 0 - schema + allow-list + types.** `creator_skins` `source='nft'` + `nft_*` columns +
  unique index; `evm_wallet_links` / `evm_wallet_link_challenges` / `nft_grants` / `nft_collections`
  tables; `CreatorSkinRow` + `source` union extension; `nft_collections.ts` config + admin route.
  No behavior. Tests: schema migration, row mapping.
- **Phase 1 - EVM wallet link.** `wallet_link_evm.ts` (pure: SIWE build + EOA recovery, unit-tested
  with known vectors) + `wallet_evm.ts` (shell + EIP-1271 branch) + `eth_rpc.ts` + 4 routes + DB
  funcs + client connect/sign. Tests: EOA recover, 1271 contract path (faked eth_call), nonce/expiry/
  replay/rate-limit, one-active-wallet.
- **Phase 2 - ownership reads.** `nft_ownership.ts`: ETH `ownerOf` + punks native/wrapped +
  revert/zero handling; Solana SPL largest-account owner; DAS `getAsset` path (behind DAS env);
  cached + fail-closed; allow-list gated. Tests: each path with faked RPC, fail-closed on error.
- **Phase 3 - trait inference.** `nft_trait_profiles.ts`: generic mapper + bayc + cryptopunks
  profiles -> `SkinDesignSpec`. Pure + deterministic. Tests against real metadata fixtures (golden
  design specs), determinism (same token => same spec), normalize round-trip.
- **Phase 4 - claim + grant + portrait + registry.** `claimNftSkin` + `grantCreatorSkin`; portrait
  proxy/sniff/cache + `GET /api/skins/<id>/portrait.png`; `portraitUrl` added to serializer +
  `world_api.ts` + client (wire lockstep). Body renders via existing design path. Tests: claim
  happy/again-idempotent/off-list/not-owner, portrait sniff + SVG reject, registry exposes
  portraitUrl not chain/contract/token.
- **Phase 5 - lost-on-sell.** `revokeCreatorSkin` (remove + active unequip) + the sweep
  (`refreshAllNftGrants`, overlap guard) + login re-verify + restore-on-reacquire + collection-disable
  delist. Tests: revoke removes + unequips, restore re-grants, RPC-unknown does not revoke,
  disable delists.
- **Phase 6 - UI.** "Wear an NFT" tab: connect EVM/Solana, `eligible` grid, live preview of
  trait-derived body + portrait, claim, lost-on-sell explainer; portrait in unit frame
  (`drawHeadshot`) + nameplate (`.np-avatar`). All strings `t()` keys. Tests/E2E as the UI allows.
- **Phase 7 - expand + harden.** cNFT collections (Mad Lads via DAS), more profiles (DeGods/SMB),
  EIP-1271/6492 hardening, delegate.xyz cold-wallet follow-up, indexer behind the interface, optional
  `sharp` portrait re-encode.

---

## 7. Decisions (locked in review)

| # | Decision | Ruling |
|---|---|---|
| D1 | Free vs $WOC-gated. | **LOCKED: Free.** The NFT is the gate; bounded by an anti-spam cap. Revisit $WOC-gating only if Tier 2 accessory geometry ships. |
| D2 | Compressed-NFT (Mad Lads / Helius DAS) at launch or deferred. | **LOCKED: Build the two-path interface now; launch Ethereum + standard-Solana (DeGods); defer Mad Lads + the Helius DAS dependency to Phase 7.** No new paid dependency at launch. The DAS path exists behind an env flag, dark until Phase 7. |
| D3 | EIP-1271 smart-wallet support at launch. | **LOCKED: Yes.** The `eth_getCode` + `isValidSignature` (`0x1626ba7e`) branch is in Phase 1, so Safe/vault holders can link from day one. ERC-6492 (counterfactual wallets) stays deferred. |
| D4 | Client EVM connection library. | **LOCKED: Raw EIP-1193 + EIP-6963 discovery, zero new client dependency.** Desktop-first (MetaMask/Rabby/Coinbase extension). Revisit viem/wagmi + WalletConnect only when mobile EVM becomes a priority. |
| D5 | Min-hold-time before grant (anti borrow/flash-loan). | **None** for a free cosmetic; the sweep bounds the exploit. Add later only if abused. |
| D6 | Initial allow-list + counsel sign-off. | BAYC, MAYC, CryptoPunks, Meebits (post-2022 Yuga license), plus CC0 (Nouns/CrypToadz/mfers). Counsel signs each `license_basis` before `enabled=true`. |

---

Plan and research by Claude Code; no implementation yet, awaiting review.
