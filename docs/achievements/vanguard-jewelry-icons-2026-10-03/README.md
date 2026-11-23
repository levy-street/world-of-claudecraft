# Vanguard jewelry icons: generated-art provenance

Eight shipping inventory icons for the Warfare Season 2 rings and pendants
(`SEASON2_JEWELRY_IDS` in `src/sim/content/pvp_honor_season2.ts`), one per item,
registered in `public/ui/items/mapping.json` as the generated batch
`vanguard-jewelry-icons-2026-10-03`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground) rasterized with Sharp to the
  shipping 128x128 opaque sRGB WebP by `scripts/generate_vanguard_jewelry_icons.mjs`.
  The script IS the retained source: re-running it reproduces every file byte
  for byte, so no separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item. The palette follows the
  Season 2 weapons (blackened steel, crimson enamel, burnished gold, laurel
  motif), and each role carries its own gem: Might ruby, Precision emerald,
  Focus amethyst, Mending dawn topaz.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `vanguard_band_of_focus`
- `vanguard_band_of_mending`
- `vanguard_band_of_might`
- `vanguard_band_of_precision`
- `vanguard_pendant_of_focus`
- `vanguard_pendant_of_mending`
- `vanguard_pendant_of_might`
- `vanguard_pendant_of_precision`

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
