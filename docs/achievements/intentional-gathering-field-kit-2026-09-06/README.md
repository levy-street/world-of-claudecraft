# Field Kit icon: accepted-art provenance

One new painted inventory icon, `field_kit`, for the reusable Field Kit item
(`public/ui/items/field_kit.webp`). Full pin record: `accepted-art.json` in this
directory; the same batch is registered in `public/ui/items/mapping.json` under
`intentional-gathering-field-kit-2026-09-06`.

## What happened

- Generator: OpenAI built-in image generation, one text-prompt call, no retries.
- The exact prompt is retained verbatim in `accepted-art.json` (`prompt`). Three
  existing house-style icons (`arcanite_mining_pick`, `linen_pouch`,
  `eastbrook_buckler`) were viewed by the reviewing parent and described in that
  prompt text as style anchors; none were passed as image-generation inputs.
- Pipeline: generated original (1254x1254 PNG) retained byte for byte, resized to
  a 512x512 master (Sharp, Lanczos3, sRGB), then converted to the shipping 128x128
  opaque sRGB WebP via `npm run assets:items`.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Review

The parent visually inspected the original, the 512px master, and 128px, 40px,
28px, 22px, 28px-grayscale, and 64px-circle crops, and accepted the art (cohesive
leather tool roll, readable knife/scraper/tongs silhouette, safe padding, opaque
dark ground, no text or frame). The contact sheet used for that review
(`review/size-review.png`) lives only under the local, gitignored
`tmp/imagegen/intentional-gathering-field-kit-2026-09-06/` tree and is not part of
this commit; the retained original and master PNGs are in that same tree
(`originals/field_kit.png`, `masters/field_kit.png`) and can regenerate a fresh
review sheet if needed.

## What is still outstanding

- The canonical `assets:items` converter run already passed (128x128, opaque,
  sRGB, exact accepted hash and byte count pinned in `accepted-art.json`).
- The batch `icon_asset_audit` passed: one asset, zero issues, zero duplicates
  and zero perceptual candidates. Parent command: `node scripts/icon_asset_audit.mjs
  docs/achievements/intentional-gathering-field-kit-2026-09-06/accepted-art.json
  tmp/imagegen/intentional-gathering-field-kit-2026-09-06/audit`.
- The catalog-wide item audit and in-game runtime screenshots remain pending.
- Art existence alone is not runtime completion: the Field Kit's gameplay
  definition (a reusable item, buy 20c / sell 4c, opens the shared harvest
  preference picker on use) is owned by the separate PR3 implementation work,
  not by this art record.
