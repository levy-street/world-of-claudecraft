# Runbook: Manually verify the Phase 1 creator-skin purchase + render flow on DEVNET

Operator runbook for end-to-end manual verification of the **client** purchase
path: browse the skin registry → server-issued split quote → wallet builds + signs
+ sends the 70/30 USDC split tx → server verifies the finalized tx on-chain →
grants the cosmetic → equip → renderer applies the creator skin atlas. This is the
slice that needs a **real browser + a funded wallet**, so it cannot be auto-tested
in CI.

Branch: `feature/woc-skins-marketplace`. Source of truth for everything below is the
code, not this doc — primarily `src/net/wallet.ts`, `server/marketplace.ts`,
`server/main.ts` (routes), `server/game.ts` (the `change_skin` equip gate), and
`src/render/characters/assets.ts` (creator-skin atlas loading).

> The buy-and-burn keeper (USDC → $WOC swap + SPL burn) is **explicitly out of scope
> here** — Jupiter has no devnet, so the keeper cannot run on devnet at all. See the
> "Keeper does NOT run on devnet" section at the bottom and the separate mainnet-keeper
> runbook.

---

## ⚠️ READ FIRST — the devnet USDC mint prerequisite (this WILL bite you)

The marketplace's default `USDC_MINT` is the **mainnet USDC address**
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (see `server/marketplace.ts` and
`.env.example`). **That mint does not exist on devnet.** If you run the default
config against devnet, every payment tx fails at the wallet/RPC because there is no
such mint account on that cluster.

So a devnet purchase test **requires you to create your own devnet SPL mint**, point
the **server's** `USDC_MINT` at it, and mint some "test USDC" to the buyer wallet.
You must also pre-create the recipient ATAs (creator + burn vault), because the
buyer's payment tx in `signAndSendSplitPayment` (`src/net/wallet.ts`) deliberately
**never creates the recipient ATAs** — it sends exactly two `TransferChecked` + a
memo, and the server verifier (`validateSplitPayment`) expects exactly those deltas.

Use **6 decimals** for the devnet mint so the client's hard-coded `USDC_DECIMALS = 6`
in `TransferChecked` matches and amounts line up.

---

## 0. Prerequisites

- Node >= 18 (global `fetch`; the repo uses `@solana/web3.js ^1.98.4` + `bs58 ^6.0.0`).
- Postgres running (`npm run db:up` — dev DB on `127.0.0.1:5433`; `DATABASE_URL`
  default in `.env.example`).
- The Solana CLI tools: `solana` + `spl-token`. Install via
  `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` if you don't have them.
- A browser wallet that supports the Wallet Standard + `solanaSignAndSendTransaction`
  feature (e.g. Phantom or Solflare) set to **Devnet** in its network switcher. This is
  the buyer wallet.
- A `.env` (copy from `.env.example`). Server reads `.env` (and `.env.local`) via
  `server/db.ts`.

---

## 1. Create the devnet mint, wallets, and ATAs (the prerequisite, concretely)

All commands target devnet. Set the CLI cluster once:

```sh
solana config set --url https://api.devnet.solana.com
```

### a. A keypair to act as mint authority / payer (and to fund the buyer)

```sh
# A local fee-payer + mint authority keypair for this test.
solana-keygen new --no-bip39-passphrase -o ~/woc-devnet-authority.json
solana address -k ~/woc-devnet-authority.json
solana airdrop 2 -k ~/woc-devnet-authority.json     # devnet SOL for fees/rent
```

If the airdrop faucet rate-limits you, retry, use https://faucet.solana.com, or
airdrop 1 SOL twice.

### b. Create a 6-decimal devnet SPL mint (your stand-in for USDC)

```sh
spl-token create-token --decimals 6 \
  --fee-payer ~/woc-devnet-authority.json \
  --mint-authority ~/woc-devnet-authority.json
# => "Creating token <DEVNET_USDC_MINT>"
```

Record the printed mint address as `DEVNET_USDC_MINT`. **This is what the server's
`USDC_MINT` must be set to** (step 2).

### c. Identify the three party wallets (must be distinct)

The verifier requires the buyer, creator, and burn vault to be three **distinct**
base58 addresses (`validateSplitPayment` → `owners_not_distinct` otherwise):

- **BUYER** — the browser wallet's devnet address (the one you'll link to the game
  account). Pays the fee + the full gross. This is the tx fee-payer.
- **CREATOR** — the payout wallet you'll put in the seeded skin row's `creatorWallet`.
  Can be any other devnet keypair you control. Receives 70%.
- **BURN VAULT** — a devnet pubkey you control; set `MARKETPLACE_BURN_VAULT` to it
  (step 2). Receives 30%. (On devnet the keeper never spends it, so it just needs a
  USDC ATA to receive into; you do **not** need its secret for this test.)

You can mint two more keypairs for CREATOR and BURN_VAULT, or reuse existing devnet
addresses you own:

```sh
solana-keygen new --no-bip39-passphrase -o ~/woc-devnet-creator.json
solana-keygen new --no-bip39-passphrase -o ~/woc-devnet-burnvault.json
solana address -k ~/woc-devnet-creator.json     # => CREATOR
solana address -k ~/woc-devnet-burnvault.json   # => BURN_VAULT
```

### d. Pre-create all three USDC ATAs (recipients MUST already exist)

The buyer's tx does not create recipient ATAs (`src/net/wallet.ts` comment: "The
buyer tx never creates these … an onboarding precondition"). Create the buyer,
creator, and burn-vault ATAs for `DEVNET_USDC_MINT` up front. The ATA derivation the
client uses (legacy Token program; `findProgramAddressSync([owner, TOKEN_PROGRAM,
mint], ATA_PROGRAM)`) is exactly what `spl-token create-account --owner` produces:

```sh
# Buyer ATA (use the browser wallet's address):
spl-token create-account <DEVNET_USDC_MINT> \
  --owner <BUYER> --fee-payer ~/woc-devnet-authority.json

# Creator ATA:
spl-token create-account <DEVNET_USDC_MINT> \
  --owner <CREATOR> --fee-payer ~/woc-devnet-authority.json

# Burn-vault ATA:
spl-token create-account <DEVNET_USDC_MINT> \
  --owner <BURN_VAULT> --fee-payer ~/woc-devnet-authority.json
```

### e. Mint test USDC to the buyer

Mint comfortably more than the skin price. For a 1.50 "USDC" skin (price_usdc =
`1500000` base units), mint e.g. 100:

```sh
spl-token mint <DEVNET_USDC_MINT> 100 \
  --mint-authority ~/woc-devnet-authority.json \
  --fee-payer ~/woc-devnet-authority.json \
  --recipient-owner <BUYER>
# verify:
spl-token balance <DEVNET_USDC_MINT> --owner <BUYER>
```

> Make sure the **browser wallet itself also holds a little devnet SOL** — it is the
> fee-payer for the purchase tx (`feePayer: buyerPk` in `signAndSendSplitPayment`).
> `solana airdrop 1 <BUYER>`.

---

## 2. Configure the server + client env for devnet

In `.env` (server-side, no `VITE_` prefix is read by the server):

```ini
# Point the SERVER's USDC mint at your devnet mint (NOT the mainnet default).
USDC_MINT=<DEVNET_USDC_MINT>

# Enable the marketplace by setting the burn vault to your devnet vault pubkey.
# marketplaceEnabled() is false until this is a valid Solana address — quote/buy
# would return 503 "marketplace unavailable" otherwise.
MARKETPLACE_BURN_VAULT=<BURN_VAULT>

# Server-side RPC used by verification (fetchFinalizedTransaction / parseSplitPayment
# in server/solana_rpc.ts read SOLANA_RPC_URL). Point at devnet so the verifier can
# see the buyer's devnet tx.
SOLANA_RPC_URL=https://api.devnet.solana.com

# Do NOT set MARKETPLACE_BURN_VAULT_SECRET for this test — that would try to boot the
# buy-and-burn keeper, which is mainnet-only (see bottom). Leaving it unset keeps the
# keeper a no-op (keeperConfigured() is false) while purchases still work.
```

In the **client/Vite** env (these are the browser payment knobs — `VITE_`-prefixed,
read by `src/net/wallet.ts`):

```ini
VITE_MARKETPLACE_RPC_URL=https://api.devnet.solana.com
VITE_MARKETPLACE_CHAIN=solana:devnet
```

Notes:
- `VITE_MARKETPLACE_RPC_URL` defaults to `https://api.devnet.solana.com` and
  `VITE_MARKETPLACE_CHAIN` to `solana:devnet` already, so for a devnet test you can
  leave them unset — but set them explicitly to be unambiguous. **RPC and CHAIN must
  be the same cluster** (devnet here): a blockhash from one cluster is invalid on
  another ("blockhash not found").
- `VITE_SOLANA_RPC_URL` (the mainnet $WOC-balance RPC) is intentionally **not** a
  fallback for the payment RPC, so it cannot silently mix clusters.

---

## 3. Seed a live creator-skin row

The registry (`GET /api/skins/registry`) returns only rows with `status = 'live'`
(`listLiveCreatorSkins` → `WHERE status = 'live'`). Seed one row. Columns
(`creator_skins`, see `server/db.ts` `CreatorSkinRow` / `upsertCreatorSkin`):

| Column | Value for this test | Notes |
|---|---|---|
| `id` | e.g. `devnet-test-skin` | opaque id; becomes `Entity.cosmeticSkinId` |
| `creator_wallet` | `<CREATOR>` | **must be valid base58** or quote throws `invalid payout wallet` |
| `name` | e.g. `Devnet Test Skin` | shown in the marketplace UI |
| `asset_url` | a reachable atlas URL | the texture `ensureCreatorSkin` will fetch |
| `price_usdc` | `1500000` | **base units**, 6dp → 1.50 USDC; must be `> 0` |
| `status` | `'live'` | required for it to appear in the registry |
| `skin_catalog` | `'class'` | `'class'` or `'mech'` |
| `fallback_skin` | `0` | numeric skin used when the atlas can't load / before equip |
| `target_class` | `NULL` (or a class) | nullable |
| `emissive_url` | `NULL` | optional glow atlas |
| `description` | `''` | optional |

Pick an `asset_url` the browser can actually fetch (CORS-readable image). For a
local test, drop a body atlas PNG under `public/` (e.g.
`public/skins/devnet-test.png`) and use `/skins/devnet-test.png` — the game server
serves `dist/`, so for a quick path either `npm run build` first or use the Vite dev
origin / an external CDN URL. The point is `ensureCreatorSkin` must be able to
`loadTexture(assetUrl)` it.

Seed it directly via SQL (single global DB — `creator_skins` is not realm-scoped):

```sh
psql "postgres://eastbrook:change-me@127.0.0.1:5433/eastbrook" <<'SQL'
INSERT INTO creator_skins
  (id, creator_account_id, creator_wallet, name, description,
   skin_catalog, fallback_skin, target_class, asset_url, emissive_url,
   price_usdc, status)
VALUES
  ('devnet-test-skin', NULL, '<CREATOR>', 'Devnet Test Skin', '',
   'class', 0, NULL, '/skins/devnet-test.png', NULL,
   1500000, 'live')
ON CONFLICT (id) DO UPDATE SET
  creator_wallet = EXCLUDED.creator_wallet,
  asset_url = EXCLUDED.asset_url,
  price_usdc = EXCLUDED.price_usdc,
  status = EXCLUDED.status;
SQL
```

(Adjust the connection string to your `DATABASE_URL`. There is also a programmatic
`upsertCreatorSkin(row)` in `server/db.ts` if you prefer a small script.)

Sanity check the registry once the server is up:

```sh
curl -s http://localhost:8787/api/skins/registry | jq
# expect: { "skins": [ { "id":"devnet-test-skin", "name":"Devnet Test Skin",
#                        "priceUsdc":"1500000", ... } ] }
```

Note the registry response **excludes** `creator_wallet`, `status`, and price
internals by design (`RegistrySkin` in `server/marketplace.ts`).

---

## 4. Run server + client, create a character, link the buyer wallet

```sh
npm run server   # authoritative server on :8787 (serves dist/ + the API)
npm run dev      # Vite client on :5173, proxies /api, /admin/api, /ws -> :8787
```

On boot, confirm the server log does **not** say `buy-and-burn keeper enabled`
(it should not, because `MARKETPLACE_BURN_VAULT_SECRET` is unset — keeper off).
The HTTP "listening on http://localhost:8787" line should print normally.

1. Open the client (the Vite dev origin, typically http://localhost:5173).
2. Register / log in, create or pick a character, enter the world (online mode — the
   marketplace hooks are attached only when `online` is set; see `src/main.ts`).
3. Link the **buyer** wallet to this account using the existing wallet-link flow
   (`POST /api/wallet/link/challenge` → wallet signs the challenge message →
   `POST /api/wallet/link`). The linked wallet must be the same devnet address that
   holds the test USDC (it is the payer; the buy route looks it up via
   `walletForAccount` and the verifier checks the tx fee-payer == that pubkey →
   `wrong_payer` otherwise). Confirm with `GET /api/wallet` (returns `{ wallet: { pubkey, ... } }`).

> Make sure the browser wallet's network is set to **Devnet**, matching
> `VITE_MARKETPLACE_CHAIN=solana:devnet`. `signAndSendSplitPayment` picks the account
> chain matching `MARKET_CHAIN`, falling back to any Solana chain; a wallet stuck on
> mainnet-beta will broadcast to the wrong cluster.

---

## 5. Buy the skin in the browser

Open the marketplace UI (the HUD marketplace entry — `hud.attachMarketplace(...)` in
`src/main.ts`) and buy `Devnet Test Skin`. Under the hood (`purchase` hook in
`src/main.ts`):

1. `api.quoteSkin(skin.id)` → `POST /api/marketplace/skins/devnet-test-skin/quote`.
   Server (`server/main.ts`) checks `marketplaceEnabled()`, the skin is `live`, and
   the account has a linked wallet, then `quotePurchase` returns the split legs:
   `{ quoteId, mint, memo (== quoteId), creator:{owner,amount}, burn:{owner,amount}, gross, expiresAt }`.
   With price `1500000`: creator = `1050000` (70%), burn = `450000` (30%, takes the
   remainder incl. rounding dust).
2. `wallet.signAndSendSplitPayment(quote)` (`src/net/wallet.ts`) builds **one atomic
   tx** with exactly: `TransferChecked` buyer→creator ATA (1050000), `TransferChecked`
   buyer→burn ATA (450000), and a **memo instruction carrying the quoteId**. The
   connected wallet signs + sends via `SolanaSignAndSendTransaction`. The client then
   **waits for `finalized`** (the commitment the server verifies against) before
   returning the signature.
3. `api.buySkin(quote.quoteId, signature)` → `POST /api/marketplace/buy`. Server
   `verifyPurchase` fetches the finalized tx, `parseSplitPayment` computes per-owner
   USDC deltas, `validateSplitPayment` hard-equality-checks them against the quote,
   then `redeemPurchase` atomically consumes the signature (replay guard), records the
   sale, and grants the skin. Response: `{ ok: true, skinId }`.
4. `online.changeSkin(skin.fallbackSkin, skin.skinCatalog, skin.id)` immediately
   equips it (sends a `change_skin` cmd with `csk = skin.id`).

Approve the transaction in the wallet popup when prompted. Finalization adds a short
wait (devnet finality is a few seconds) before the buy call returns — expected.

---

## 6. VERIFY

### a. The on-chain split is correct

Take the signature (from the wallet history or the browser network tab on
`/api/marketplace/buy`) and open:

```
https://explorer.solana.com/tx/<sig>?cluster=devnet
```

Confirm in the token-balance changes:
- **buyer**: −1500000 base units of `DEVNET_USDC_MINT` (−1.50), and is the fee payer.
- **creator** (`<CREATOR>`): +1050000 (+1.05, the 70%).
- **burn vault** (`<BURN_VAULT>`): +450000 (+0.45, the 30%).
- No third party receives the mint; exactly the two transfers + the memo instruction
  (the memo equals the `quoteId`).

### b. The skin is granted and equippable

- The buy response was `{ ok: true, skinId: "devnet-test-skin" }`.
- The account's `ownedCreatorSkinIds` now contains `devnet-test-skin`
  (`game.applyCreatorSkinGrant` on the server; rides into the session cosmetics).
- The equip gate holds: the `change_skin` handler in `server/game.ts` only accepts
  `csk` when `session.accountCosmetics.ownedCreatorSkinIds.includes(requested)` — so
  equipping an **owned** id sets `cosmeticSkinId`, while a forged/unowned id is
  dropped to `null` (built-in numeric skin only). Verify that you cannot equip a
  random unowned id, and that the granted one sticks. The id is mirrored on the wire
  as `csk` and back into `Entity.cosmeticSkinId` (`src/net/online.ts`).

### c. The renderer applies the creator-skin atlas

- After equip, the avatar should show the creator atlas. The render path
  (`src/render/characters/assets.ts`): the registry was registered at boot
  (`registerCreatorSkins` via `api.creatorSkins()` in `src/main.ts`); when the
  renderer sees the entity's `cosmeticSkinId`, it calls `ensureCreatorSkin(id)` to
  load `assetUrl` (sRGB, `flipY=false`), then `creatorSkinTexture(id)` returns the
  texture and `applyMaterials` swaps the body atlas onto the body meshes.
- If `assetUrl` 404s or fails to decode, the avatar falls back to the numeric
  `fallbackSkin` (0) — visible as the default body, no error crash. That's the
  "miss" path; fix the `asset_url` to see the actual override.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Quote/buy returns 503 **"marketplace unavailable"** | `MARKETPLACE_BURN_VAULT` unset or not a valid base58 Solana address → `marketplaceEnabled()` is false | Set `MARKETPLACE_BURN_VAULT=<BURN_VAULT>` (step 2) and restart the server |
| Quote 500 / **"invalid payout wallet"** (`creator skin <id> has an invalid payout wallet`) | the seeded `creator_wallet` isn't valid base58 | Reseed with a real base58 `<CREATOR>` address |
| Buy returns **`token_2022`** | the tx touched the mint under the Token-2022 program; the verifier accepts only the legacy SPL Token program | Use a mint created with the standard `spl-token create-token` (legacy program), as above |
| Buy returns **`wrong_payer`** | the tx fee-payer ≠ the account's linked wallet | Link the **same** devnet wallet that signs/pays; check `GET /api/wallet` |
| Buy returns **`creator_amount` / `burn_amount` / `buyer_amount` / `extra_recipient`** | on-chain deltas don't hard-match the quote (wrong mint, wrong amount, wrong/extra recipient, decimals mismatch) | Ensure the devnet mint is **6 decimals**, server `USDC_MINT` == that mint, and you didn't hand-modify the tx |
| Buy returns **`tx_not_finalized`** | server queried before finality, or it's reading a different cluster | Confirm server `SOLANA_RPC_URL=https://api.devnet.solana.com` (verifier reads it); the client already waits for `finalized`, so a mismatch is usually wrong server RPC |
| Wallet error **"blockhash not found"** / tx never lands | RPC vs CHAIN cluster mismatch | `VITE_MARKETPLACE_RPC_URL` and `VITE_MARKETPLACE_CHAIN` must be the **same** cluster (both devnet); wallet network must also be Devnet |
| Tx fails / wallet sim error about a missing account (**ATA-not-found**) | a recipient ATA (creator or burn vault) doesn't exist — the buyer tx doesn't create them | Pre-create all three ATAs for the mint (step 1d) |
| Mint/balance ops fail with "mint not found" on devnet | you're using the default mainnet `USDC_MINT` on devnet | Create a devnet mint and set server `USDC_MINT` to it (the core prerequisite) |
| Avatar shows the default body, not the atlas | `asset_url` unreachable / CORS-blocked / not yet loaded → `creatorSkinTexture` miss → `fallbackSkin` | Use a fetchable, CORS-readable `asset_url`; check the browser network tab for the atlas request |
| `change_skin` silently does nothing for the new id | id not in `ownedCreatorSkinIds`, or longer than `MAX_COSMETIC_SKIN_ID_LEN` | Confirm the grant succeeded (`/api/marketplace/buy` returned ok); keep the skin `id` short |

---

## The buy-and-burn keeper does NOT run on devnet

Do not expect any USDC → $WOC swap or $WOC burn during this test. The keeper
(`server/burn_keeper.ts`) swaps on **Jupiter, which is mainnet-only**, and burns the
**mainnet $WOC mint** (`3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth`). On devnet
there's no Jupiter route and no $WOC mint, so the swap/burn path cannot execute.

Two consequences for this runbook:
- The 30% burn share simply **accrues** in the devnet burn-vault ATA (you'll see the
  +0.45 land in step 6a) and stays there. That's correct Phase-1 behavior: the server
  accepts purchases and the burn cut accumulates; draining is a separate, mainnet-only
  concern.
- Keep `MARKETPLACE_BURN_VAULT_SECRET` **unset** so `keeperConfigured()` is false and
  `buildBurnKeeper()` returns null — the server log will not print
  `buy-and-burn keeper enabled`, and no `burn keeper cycle failed:` errors will appear.

The keeper (swap + burn + the public `/api/marketplace/burn-ledger`) is verified
separately on a funded **mainnet** deployment — see the mainnet-keeper runbook.
