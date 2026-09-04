# Jewelcrafting deed source provenance

Provenance and accepted-output record for the three jewelcrafting deed crests.
All three shipping WebPs are project-owned originals authored in-repo from hand-written SVG
compositions; no external generation service, source pack, or third-party reference was used.
The superseded SVG masters are recoverable from the commits named below.

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
- Historical SVG source: recoverable from commit `557f2e402891f9e7e86ff24f3396f7d104f27a94`.
  The accepted WebP hash above is the authoritative shipping pin.
- Geometry review evidence: alpha bounds 11..116 on both axes, ink center
  exactly (63.5, 63.5), coverage 0.5073 against the family norm of about 0.45
  (gate band 0.35 to 0.6); the 512px source passed every converter source gate
  (transparent corners, 46px padding, 0.4993 coverage).

## Deed crests added at the phase 05 QA (2026-08-10)

The QA ruling authored the craft's remaining milestone pair, each crest an
in-repo hand-written SVG in its family style, rasterized at 512px RGBA and
ingested via `npm run assets:deeds` exactly like the rare crest above. Both historical sources carried the required title element in the
rendered bytes.

- Asset: `public/ui/deeds/prog_jewelcrafting_50.webp` (Facet and Filigree,
  the 50-skill milestone; the 50-family medallion with a faceted topaz over
  gold filigree scroll curls)
  - Accepted sha256: `5edc61e01ce5f20dbf525c1430dc1709a1bc58ff550e0f49bb0a5ca7a4f68d8a`
  - Accepted bytes: 4928 (128x128 WebP, VP8X, alpha, q82 encode)
  - Historical SVG source: recoverable from commit
    `e0c02ada0249ea56cc5f76beaa165467b56c8f1b`
- Asset: `public/ui/deeds/prog_grandmaster_jewelcrafting.webp` (Grandmaster
  Jewelcrafting, the 125-cap milestone; the grandmaster laurel wreath around
  a radiant round brilliant)
  - Accepted sha256: `f3ff906d390920499779101c7d361be8b81d07398ab9c0133778ed5daed8ee49`
  - Accepted bytes: 5126 (128x128 WebP, VP8X, alpha, q82 encode)
  - Historical SVG source: recoverable from commit
    `e0c02ada0249ea56cc5f76beaa165467b56c8f1b`
