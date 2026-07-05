# PRD — Creator Skin Uploads: self-hosted + IPFS-hosted, $WOC-gated

Status: **PLAN — for review (no code yet).**
Extends: [creator-skins-marketplace.md](creator-skins-marketplace.md). Today a creator
skin is either a **procedural design** (the in-browser designer) or an operator-seeded
`asset_url`. This PRD adds two creator-supplied **image** sourcing modes and a
$WOC-holdings gate on the hosted one.

---

## 1. Goal & why

Let creators bring their own skin art (authored against our body-UV template), two ways:

- **(B) Self-hosted — free.** The creator gives a URL to a file they host elsewhere.
  We **proxy** it so the origin link is never exposed to buyers. No $WOC required.
- **(C) Hosted — $WOC-gated.** The creator **uploads** the file; we **pin it to IPFS
  via Pinata** and keep it pinned *persistently*. How many hosted skins a creator may
  keep is gated by the **tier of $WOC they hold** — affordable to enter, scaled to
  reward whales. Pinning is an ongoing cost, so "hold to host" funds it and ties skin
  capacity to $WOC demand (reinforcing the flywheel).

Mode (A), the procedural designer, ships already and is unchanged.

### Decisions locked (this PRD reflects them)
- **Hosted storage = Pinata IPFS.** Not Postgres/volume/S3.
- **Tier curve = entry-friendly, but the first hosted slot starts at ≥100 $WOC.**
- **Drop-below-tier = hide overflow, restore on top-up** (continuous enforcement; never delete).
- **Moderation = review queue, with an earned "trusted creator" badge** (faster to earn
  at higher tiers) that lets a creator upload **instant-live**, skipping review.

---

## 2. What an uploaded/self-hosted file must conform to

Both image modes feed the same renderer path as the existing numeric/URL skins, so a
creator-supplied file MUST be:

- **PNG**, RGBA (JPEG loses alpha).
- **1024×1024** (preferred) or 512×512 (accepted; soft). Exact-dimension allow-list,
  same shape as the player-card validator.
- Authored for the **glTF body-UV atlas** (`flipY=false`, sRGB) — one continuous atlas
  covering the whole humanoid (the KayKit `Rig_Medium` UV all 9 classes share). We ship a
  downloadable **UV template + guide** so art lands on the right body regions.
- Within a decoded-byte ceiling (decompression-bomb guard) + a wire size cap (≈4–8 MB),
  reusing `parsePngInfo` / `readBinaryBody` from `server/player_card.ts`.

Server-side validation rejects anything that fails these before it is pinned/proxied.

---

## 3. Architecture & data flow

### 3.1 Data model (`creator_skins` additions + new tables)

`creator_skins` (extend):
- `source TEXT NOT NULL DEFAULT 'design'` — `'design' | 'self_hosted' | 'hosted'`.
- `origin_url TEXT` — self-hosted only; the creator's external URL. **Server-only; never
  serialized into the public registry.**
- `ipfs_cid TEXT` — hosted only; the Pinata pin CID.
- `sha256 TEXT` — content hash of the validated atlas (dedupe + integrity; column already exists).
- `review_status TEXT NOT NULL DEFAULT 'pending'` — `'pending' | 'approved' | 'rejected'`
  (distinct from the existing sale `status`; a skin is sellable only when
  `review_status='approved'` AND `status='live'`).
- `overflow_hidden BOOLEAN NOT NULL DEFAULT false` — set when a tier-drop pushes this
  hosted skin past quota (auto-restored on top-up). Hidden ⇒ not in registry, not buyable,
  not equippable by new buyers.

New `creator_trust` (per account):
- `account_id PK`, `approved_count INT`, `strikes INT`, `trusted BOOLEAN`,
  `first_listing_at TIMESTAMPTZ`, `updated_at`. Drives the instant-live badge (§6).

The **public registry payload is unchanged in shape**: every non-procedural skin exposes
an **opaque** `assetUrl = /api/skins/<id>/atlas.png`. Origin URL, CID, and storage mode
never leave the server.

### 3.2 Mode B — self-hosted (free, proxied)

```
creator: POST /api/skins  { source:'self_hosted', originUrl, name, price, targetClass }
  → server fetches originUrl (server-side, timeout+size guard) → parsePngInfo validates
  → store origin_url + sha256, source='self_hosted', review_status='pending'
buyer/renderer: GET /api/skins/<id>/atlas.png
  → server streams the validated, cached bytes; origin_url NEVER sent to client
```

- **Anti-hotlink / origin privacy:** the origin URL stays server-side; clients only ever
  see `/api/skins/<id>/atlas.png`.
- **Honest limitation (documented for the creator):** this hides the *source link* and
  blocks hotlinking, but the **texture pixels are inherently downloadable** — every client
  must fetch the atlas to render the avatar. You cannot DRM a rendered texture. We can
  re-encode + strip metadata + short-cache; we cannot make the art un-copyable.
- **Re-validation:** a self-hosted origin can change or 404 later. We cache the validated
  bytes on first serve (keyed by sha256) and periodically re-validate; a now-invalid origin
  flips the skin to `rejected` + delists, and notifies the creator.
- **Anti-spam:** self-hosted is free but still bounded by a modest per-account cap + the
  existing IP rate limit (so "free" can't mean "infinite listings").

### 3.3 Mode C — hosted (Pinata IPFS, $WOC-gated)

```
creator: POST /api/skins/upload  (multipart/binary PNG)  [auth + wallet + quota checked FIRST]
  → readBinaryBody + parsePngInfo (PNG, 1024², decoded-byte ceiling, sha256)
  → Pinata pinFileToIPFS(bytes)  → CID
  → store ipfs_cid + sha256, source='hosted', review_status='pending'
buyer/renderer: GET /api/skins/<id>/atlas.png
  → server resolves CID → streams via our Pinata gateway (proxied, so delist = 404 from us)
```

- **Pinata integration:** a small `server/pinata.ts` (HTTP, `PINATA_JWT` env, dedicated
  gateway host env). `pinFileToIPFS` on upload; `unpin(cid)` when a hosted skin is removed
  (and not referenced by another row) to stop paying to pin it.
- **Why IPFS is fine here:** the CID is content-addressed/public, but a cosmetic texture
  isn't a secret. We still serve through our opaque route so *sale/equip* state (delist,
  overflow-hide, review) is enforced server-side; IPFS permanence of the bytes is acceptable.
- **Persistence = the product:** we keep the file pinned as long as the creator holds the
  tier. Drop below quota ⇒ overflow-hide (and optionally unpin the hidden overflow to stop
  cost; re-pin on restore). This is the "persistent uploads by tier" the feature sells.

### 3.4 $WOC quota gate (net-new, small; reuses existing balance machinery)

In the upload/listing handler, before accepting a **hosted** skin:
```
wallet = walletForAccount(accountId)                 // existing
{ tier } = await holderInfoForPubkey(wallet.pubkey)  // existing, server-authoritative, cached
quota = HOSTED_SLOT_QUOTA[tier]                       // NEW table (§5)
if (countHostedByAccount(accountId) >= quota) → 402/400 'hosted_quota_exceeded' {tier, quota, held}
```
Self-hosted and procedural designs are **not** gated by this (free). Balance read is the
existing 2-min-cached mainnet RPC; never silently grant on an RPC failure (fail-closed:
treat unknown balance as the last-known, else tier 0).

---

## 4. APIs (additions)

| Method · Route | Purpose |
|---|---|
| `POST /api/skins` (extend) | Accept `source:'self_hosted'` + `originUrl` (proxy-validate). Existing `design` path unchanged. |
| `POST /api/skins/upload` (new) | Binary PNG upload → validate → Pinata pin → row. Quota-gated. |
| `GET /api/skins/<id>/atlas.png` (new) | Opaque atlas serve for self_hosted (proxy origin) + hosted (proxy gateway). Enforces review/delist/overflow. |
| `GET /api/skins/quota` (new) | The viewer's tier, hosted quota, used, and remaining (for the designer UI). |
| `POST /admin/api/skins/:id/review` (new) | Operator approve/reject (admin-gated), with reason. |

Registry (`GET /api/skins/registry`) shape unchanged — only `review_status='approved' AND
status='live' AND NOT overflow_hidden` rows appear.

---

## 5. $WOC hosted-slot schedule (entry-friendly; first slot at ≥100)

Mapped onto the existing 18-rung ladder (`src/sim/holder_tier.ts`). Below 100 $WOC ⇒ **0
hosted slots** (creators can still use the free designer + self-hosted). Numbers tunable in
one server constant `HOSTED_SLOT_QUOTA`:

| Tier (key · ≥$WOC) | Hosted slots |
|---|---|
| < coppercrest (<100) | 0 |
| coppercrest (100) | **2** |
| silverbound (1,000) | 5 |
| gilded (10,000) | 12 |
| vaultwarden (100,000) | 30 |
| whale (1,000,000) | 80 |
| leviathan (10,000,000 · 1% supply) | 200 |
| tidelord (20,000,000 · 2%) and above | 400 |

Entry-friendly above the floor (100 → 2, 1k → 5, 10k → 12), strong whale payoff (1% → 200).
Self-hosted free (anti-spam cap only). *These exact numbers are the first thing to tune in review.*

---

## 6. Moderation: review queue + earned trusted-creator badge

- **Default:** a creator-supplied image (self_hosted or hosted) lists as
  `review_status='pending'` — not for sale until an operator approves it
  (`POST /admin/api/skins/:id/review`). Procedural designs keep their current policy.
- **Trusted-creator badge (skips review → instant-live):** earned, and earned *faster at
  higher tiers*. A creator becomes `trusted` when **all** hold:
  - `approved_count ≥ T(tier)` where the bar shrinks with tier — e.g. coppercrest 5 ·
    silverbound 3 · gilded 2 · vaultwarden 1 · whale+ 0 (a whale is trusted on their first
    clean listing);
  - account age ≥ N days (e.g. 14) — relaxed/zero at whale+;
  - `strikes = 0` in the trailing 30 days (a removed/ToS-violating skin is a strike).
- **Revocation:** a strike clears `trusted` and the bar must be re-earned. Trusted creators'
  uploads go live instantly but remain subject to post-hoc takedown (admin `remove` + strike).
- This both lowers ops load over time and gives a real, $WOC-influenced status perk — bigger
  holders get the "no-friction publishing" badge sooner.

Exact thresholds (T(tier), age, strike window) live in one server constant for tuning.

---

## 7. Edge cases & risks (designed-for, not deferred)

- **Tier drop mid-life (hide overflow, restore on top-up):** the existing per-player
  holder-tier refresh already reads balance; extend it (plus a periodic sweep) to recompute
  each creator's hosted quota and set `overflow_hidden` on the **newest-over-quota** hosted
  skins (deterministic order = newest first), clearing it when they top back up. Hidden ⇒
  out of registry + un-buyable; existing owners keep what they already bought. Optionally
  unpin hidden overflow to stop pinning cost; re-pin on restore (CID is stable by content).
- **Pinata availability / cost:** gateway latency or an outage shouldn't break rendering —
  cache served bytes server-side (sha256 key) so a hot skin survives a gateway blip. Pinning
  failures fail the upload cleanly (no half-created row). Cost is bounded by the WOC quota.
- **Malicious uploads:** decompression bombs (decoded-byte ceiling), wrong dimensions/MIME,
  oversize body — all rejected pre-pin. Offensive/infringing art — the review queue (§6).
- **Balance RPC flakiness:** fail-closed (last-known balance, else tier 0); never grant a
  slot on an unknown balance. 2-min cache already smooths RPC load.
- **CORS:** atlas always served same-origin via our route → no cross-origin WebGL taint.
- **Mainnet vs devnet mints:** the $WOC balance reads the **mainnet** `WOC_MINT`; the
  marketplace's USDC payment mint is separate (devnet today). Intentional — document it.
- **Registry growth / pagination:** image skins will grow the catalog; Browse needs
  pagination/sort (already a tracked TODO) before this scales publicly.

---

## 8. Dependencies & config

- **Pinata:** `PINATA_JWT` (server secret, never client), `PINATA_GATEWAY` host. New
  `server/pinata.ts` (HTTP via `fetch`; no heavy SDK needed). Externalized via env; no
  secret in code. Document in `.env.example`.
- Reuses: `woc_balance.ts`, `holder_tier.ts`, `wallet*`, `player_card.ts` upload/validation
  primitives, the static/serve + cache helpers, the marketplace listing + payout flow.
- No new client deps; the renderer's `assetUrl` path is unchanged (opaque URL).

---

## 9. Rollout phases

1. **Schema + quota gate** — `source`/`review_status`/`overflow_hidden`/`creator_trust`;
   `HOSTED_SLOT_QUOTA`; `/api/skins/quota`; server-authoritative gate. (No new art path yet.)
2. **Self-hosted (B)** — `POST /api/skins {self_hosted}` + the `/atlas.png` proxy +
   validation + re-validation sweep.
3. **Hosted (C)** — `server/pinata.ts` + `POST /api/skins/upload` + CID serve + unpin on remove.
4. **Moderation + trust** — review queue, admin approve/reject, `creator_trust` accrual +
   instant-live badge.
5. **Designer UI** — add "Upload / Self-host" tabs to the Create panel: drop-zone + UV-template
   download, quota meter ("Hosted 2/5 · hold ≥1,000 $WOC for more"), review-status chips,
   trusted badge.
6. **Drop-below enforcement** — wire the overflow-hide/restore into the holder-tier refresh +
   a periodic sweep; tests for the newest-first determinism.

Each phase ships green (tsc + suite + builds) with tests, behind the existing online gating.

---

## 10. Open questions / assumptions to confirm in review

- **Self-hosted cap:** what's the free per-account self-hosted limit (anti-spam)? Assume the
  current `MAX_LISTINGS_PER_ACCOUNT` (24) as a starting ceiling unless you want higher/lower.
- **Pinata plan & unpin policy:** confirm we may unpin overflow-hidden skins to save cost
  (re-pin on restore), or keep everything pinned regardless.
- **Trust thresholds:** confirm/tune the `T(tier)` bars + account-age + strike window in §6.
- **Self-hosted review:** does self-hosted (free) go through the same review queue as hosted,
  or is review hosted-only? (Assumed: both, since both are arbitrary images.)
- **Quota counts which rows:** confirm the WOC quota counts **hosted** skins only (self-hosted
  + procedural excluded), and counts `approved`+`pending` (so pending uploads hold a slot).

---

🤖 Plan authored with Claude Code — no implementation yet; awaiting review.
