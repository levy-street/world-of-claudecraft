# Jewelcrafting deed source provenance

Provenance and accepted-output record for the three jewelcrafting deed crests.
All three are project-owned originals authored in-repo as hand-written SVG
compositions; no external generation service, source pack, or third-party
reference was used.

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
