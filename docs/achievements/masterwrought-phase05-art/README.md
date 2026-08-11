# Masterwrought Phase 05 art provenance (2026-08-10)

Provenance and accepted-output record for the ten original art assets the
jewelcrafting base catalog shipped: nine item icons and one deed crest. All ten
are project-owned originals authored in-repo (hand-written SVG compositions,
rasterized and encoded through the owning converter pipelines); no external
generation service, source pack, or third-party reference was used.

## Deed crest

- Asset: `public/ui/deeds/prog_jewelcrafting_rare.webp` (the Polished to
  Brilliance crest, the jewelcrafting rare-tier milestone)
- Accepted sha256: `057a867ec786493771e9bdd9a1100f38694bb6c7aeffca4de78fb9fd6896f5dd`
- Accepted bytes: 4942 (128x128 WebP, VP8X, alpha, q82 encode)
- Authoring method: hand-written SVG composition in the `prog_*_rare` family
  style (dark medallion, ornate gold rim with four cardinal spikes and diagonal
  studs, deep blue field, a gold jeweler's ring with a faceted sapphire, ruby
  cabochon, sparkles), rasterized at 512px RGBA and ingested via
  `npm run assets:deeds` (`scripts/convert_deed_icons_webp.mjs`).
- Committed source: `prog_jewelcrafting_rare.source.svg` in this directory,
  sha256 `51dfd91d207fce32376d282d63b227a779fccff44906496a001daf336a3f88ad`. The
  committed copy adds one metadata title element over the exact bytes that
  rendered the crest (the biome a11y lint requires an SVG title; the authoring
  bytes hashed `67875b8d101afd5af416889bb1da68de3ce8c172cf0ea3598db42abc7a5d9182`);
  the accepted WebP hash above is the authoritative pin.
- Geometry review evidence: alpha bounds 11..116 on both axes, ink center
  exactly (63.5, 63.5), coverage 0.5073 against the family norm of about 0.45
  (gate band 0.35 to 0.6); the 512px source passed every converter source gate
  (transparent corners, 46px padding, 0.4993 coverage).

## Deed crests added at the phase 05 QA (2026-08-10)

The QA ruling authored the craft's remaining milestone pair, each crest an
in-repo hand-written SVG in its family style, rasterized at 512px RGBA and
ingested via `npm run assets:deeds` exactly like the rare crest above. Both
committed sources carry the biome-required title element in the rendered
bytes (no post-render amendment this time).

- Asset: `public/ui/deeds/prog_jewelcrafting_50.webp` (Facet and Filigree,
  the 50-skill milestone; the 50-family medallion with a faceted topaz over
  gold filigree scroll curls)
  - Accepted sha256: `5edc61e01ce5f20dbf525c1430dc1709a1bc58ff550e0f49bb0a5ca7a4f68d8a`
  - Accepted bytes: 4928 (128x128 WebP, VP8X, alpha, q82 encode)
  - Committed source: `prog_jewelcrafting_50.source.svg`, sha256
    `dd77c9d923cbd1bb632630df625aa9d54d974474f3f055ab611f3eead231a0e1`
- Asset: `public/ui/deeds/prog_grandmaster_jewelcrafting.webp` (Grandmaster
  Jewelcrafting, the 125-cap milestone; the grandmaster laurel wreath around
  a radiant round brilliant)
  - Accepted sha256: `f3ff906d390920499779101c7d361be8b81d07398ab9c0133778ed5daed8ee49`
  - Accepted bytes: 5126 (128x128 WebP, VP8X, alpha, q82 encode)
  - Committed source: `prog_grandmaster_jewelcrafting.source.svg`, sha256
    `f7a37f152020188bf6f8e820060a18a8a7cae35e265fa127f6dee2faa459a505`

## Item icons

Nine placeholder originals in the `woc-item-icon-v1` house style (one hero
object on the opaque dark house ground; copper warm brown-orange for the 0
rung, iron cool grey for the 25 rung, osmium silver-blue with a faint arcane
accent for the 50 rung), each a distinct hand-written SVG rasterized at 128px
and encoded via `npm run assets:items` (`scripts/convert_item_icons_webp.mjs`).
Provenance rows live in `public/ui/items/mapping.json` (`woc_original_svg`,
placeholder license pending commissioned painted icons); audit admission lives
in `docs/achievements/item-art-consistency-2026-08-09/` (counts 825 to 834 art
files, 840 to 849 live items, per-id verdict rows and evidence digests). The
authoring SVGs were not retained (the Phase 04 materials precedent); the
accepted hashes below pin the shipped bytes.

| id | accepted sha256 | bytes |
|---|---|---|
| hammered_copper_band | `a037f3b2fc314d297f8a86c8413a9dbc47f6c70b93cea1da852494a147f64345` | 1160 |
| polished_copper_loop | `a2ba91dfc2c30174d6bf3881981e8d7f0657f952fb42b4d64bb7546af8715f86` | 1416 |
| coiled_copper_torc | `5057ddcc7fddbab22cfa8231d6bf794fead4c87215ee35087bd5da754c1b4b3c` | 1794 |
| riveted_iron_signet | `af45deeb5f1042af0b6058cf0b2159c40f6d0bfc9f48e0cefb94b8ddba5b170d` | 1016 |
| etched_iron_loop | `c71b532223437480dfecd369bf068304ecdc79513f0325370a8047cef04b5ea4` | 1184 |
| iron_link_choker | `8c432282220638b9bfda665f2ea0200041a7473276b33efea2bba5c7b7860000` | 1152 |
| weighted_thorium_band | `5b27e92689d01b63cf90d9c0fa6aff522ec2a82335f23d7e766e7debb425f3cf` | 1192 |
| gleaming_thorium_loop | `3000ddb19343d9530f8d6b6cc8b41715b11c416f575f540472f6e8f8e19fe776` | 1226 |
| burnished_thorium_amulet | `84e828b6eb1563e5a1c4951cdab1f7acfd8470c6dfdef0811dfce4930c0ce9ca` | 1152 |

The three thorium ids display the Osmium register (Weighted Osmium Band,
Gleaming Osmium Loop, Burnished Osmium Amulet); ids are frozen and keep
thorium, matching `thorium_ore` whose display is Osmium Ore.
