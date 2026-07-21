# Claudium visual asset set

Generated via the Higgsfield MCP connector (Recraft V4.1 for stills, Seedance 2.0
for motion), then composited and web-optimized locally. Identity is pinned in
[CLAUDIUM_VISUAL_ID.md](CLAUDIUM_VISUAL_ID.md): a platinum coin with a hexagonal
bezel and a blue-essence-to-cyan arcane gem core, distinct from the gold $WOC token.

Credit spend: 336 Higgsfield credits total (877.16 to 541.16). All assets are the
project's preferred formats: WebP for transparent art, mp4 + webm + poster for
motion, PNG only where a scannable QR must stay crisp.

Every animation ships as `.webm` (VP9, primary), `.mp4` (H.264, faststart
fallback), and `_poster.jpg` (first-frame placeholder). Wire with
`<video autoplay muted loop playsinline poster="..._poster.jpg">` and two
`<source>` tags. Respect `prefers-reduced-motion`: fall back to the poster.

## 1. Icons  (`icons/`)

Transparent WebP. Ladder sizes 512/256/128/64; the unsuffixed file is the 1024
master. `claudium_coin_master.png` is a PNG convenience copy of the coin.

| File (base) | Use in UI | Format / sizes |
|---|---|---|
| `claudium_coin` | The Claudium mark. Balance readout, any "Claudium" amount, currency chip. | WebP 1024/512/256/128/64 (+ PNG master) |
| `icon_wallet` | Balance / wallet entry point. | WebP 1024/512/256/128/64 |
| `icon_buy` | "Buy Claudium" action (coin + plus badge). | WebP 1024/512/256/128/64 |
| `icon_history` | Transaction history tab (coin in a circular arrow). | WebP 1024/512/256/128/64 |
| `icon_giftcard` | Gift-card buy/redeem entry. | WebP 1024/512/256/128/64 |
| `icon_store` | Cosmetic store / spend entry (market awning). | WebP 1024/512/256/128/64 |
| `stack_single` | Value tier: small amount. Composited from the real coin. | WebP 1024/512/256/128 |
| `stack_small` | Value tier: medium amount (3 coins). | WebP 1024/512/256/128 |
| `stack_large` | Value tier: large amount (coin pile). | WebP 1024/512/256/128 |
| `../claudium_coin_hero_3q` | Hero / marketing 3-4 angle of the coin. | WebP 1400w |

Light + dark: the icons are transparent, so they sit on either theme. No baked
background variant is needed; place them on the theme surface token directly.

## 2. Animations  (`animations/`)

960x960 source, shipped at 512x512, silent, 5s.

| File (base) | Moment | Loop? |
|---|---|---|
| `claudium_coin_idle` | Balance display idle: slow shimmer spin. | Loop (start=end frame) |
| `claudium_credit_earn` | "You received Claudium": coins fly in and stack with a sparkle. | One-shot |
| `claudium_spend` | Cosmetic purchase debit: coin dissolves into sparks. | One-shot |
| `claudium_purchase_success` | Buy complete: celebratory light burst. | One-shot |
| `claudium_pending` | On-chain confirmation wait: calm orbiting-particle ring. | Loop (start=end frame) |

## 3. Gift-card faces  (`giftcard/card-designs/`)

Two layers per occasion:
- `face_<occasion>_art.webp` (1600w): the blank themed art (border, motif, coin
  emblem, empty center panel). Feed this to the service render pipeline as the
  background; it composites the live denomination/message/QR server-side.
- `card_<occasion>.png` (1280w): a fully composited PREVIEW showing the real slots
  (denomination in Claudium + USD, recipient, message, and a genuinely scannable
  QR produced by the service `qr.ts` encoder). PNG to keep the QR crisp.

Occasions: `birthday`, `holiday`, `congrats`, `thankyou`, `generic`. Every
`card_*.png` QR was decode-verified with jsQR back to its exact redeem URL.

## 4. Gift send / receive / redeem flow  (`giftcard/send|transit|receive|redeem/`)

1:1 (core) and 4:3 (occasion variants), silent, 5s, webm + mp4 + poster.

| File | Beat | Notes |
|---|---|---|
| `send/gift_envelope_sealed.webp` | The sealed gift object (still). | Start frame for the flow. |
| `send/gift_send` | Envelope glows, whooshes into an arcane portal. | One-shot. |
| `transit/gift_transit` | Envelope drifts through the cosmos. | Loop; use for "arrives on <date>" scheduled state. |
| `receive/gift_receive` | Envelope settles, seal brightens, flap lifts. | One-shot; build anticipation. |
| `redeem/gift_redeem` | Envelope bursts open, coins pour out. | One-shot. The emotional peak. |
| `redeem/gift_redeem_birthday` | Redeem burst, birthday themed (balloons/confetti). | One-shot. |
| `redeem/gift_redeem_holiday` | Redeem burst, holiday themed (snow/mint). | One-shot. |
| `redeem/gift_redeem_generic` | Redeem burst, arcane themed (runes). | One-shot. |

Wiring: `send` on the gifter's confirm; `transit` for the in-transit/scheduled
state; `receive` then `redeem` (or a `redeem_<occasion>` variant) on the
recipient's open. The scheduled-delivery date overlay and the actual credit are
service-side; these are the visual layer only.

## Final vs. human-polish

Final and ready to wire:
- Coin, all five action icons, the three denomination tiers, the size ladders.
- All five UI animations.
- All five card faces (art + composited preview) with verified-scannable QR.
- The full send/transit/receive/redeem flow and the three occasion redeem variants.

Would benefit from a human/artist pass (not blocking):
- `icon_history` and `icon_store` coins carry a slightly simpler sigil than the
  master coin's crescent-and-gem; a pass could unify the face exactly.
- The denomination `stack_large` is coins composited flat, not a true isometric
  heap; an artist could rebuild it as a 3D pile.
- Loop seams on `coin_idle` / `pending` / `transit` are close but not frame-perfect
  (Seedance start=end frame); a short crossfade in-engine tightens them.
- Poster frames are the video's first frame; for the one-shot flow videos a
  mid-burst poster reads better as a static.
- Card face text is composited here for preview only; production text/QR should be
  laid by the service render pipeline (real recipient, message, live code) so it is
  always current and localized.

## Reviewer must check
- These are art assets only; no money, code, or QR payload is trusted from the
  client. The scannable QR on the preview cards uses sample codes; production QRs
  come from the service.
- Formats/paths assume Vite static serving from `public/` (see `public/CLAUDE.md`);
  `icons/`, `animations/`, `giftcard/` are referenced by raw logical path, not the
  media manifest, matching how `ui/` assets are served.
