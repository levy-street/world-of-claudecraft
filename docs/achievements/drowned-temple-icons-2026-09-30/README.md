# Drowned Temple loot icons: generated-art provenance

Eleven shipping inventory icons for the Drowned Temple rework's loot
(`src/sim/content/drowned_temple_items.ts`), registered in
`public/ui/items/mapping.json` as the generated batch
`drowned-temple-icons-2026-09-30`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground, a paper-grain overlay) rasterized
  with Sharp at the 512 master and downscaled to the shipping 128x128 opaque sRGB
  WebP by `scripts/generate_drowned_temple_item_icons.mjs`. The script IS the
  retained source: re-running it reproduces every file byte for byte, so no
  separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `conchplate_girdle`: a mail girdle of overlapping conch plates with a gold
  spiral buckle (Choirmother Selthe).
- `pale_chorus_leggings`: pale leather leggings stitched with moonlit hymn lines.
- `refrain_silk_gloves`: a pair of pale silk gloves, a gold note on each cuff.
- `chorus_conch`: a nacre conch with gold light in its mouth (Selthe's rare
  chase row).
- `heroic_chorus_conch`: the conch's Heroic clone, the same shell under a deeper
  moonlit ground with the light spilling over.
- `tideglass_pauldrons`: a mail pauldron capped with tideglass shards (the
  Tideglass Colossus).
- `moonburn_treads`: leather treads branded with a cold silver crescent.
- `prism_etched_cowl`: a cloth cowl with a violet prism on its brow.
- `tideglass_shiv`: a slim tideglass dagger with a pearl pommel (the Colossus's
  rare chase row).
- `pale_chorus_vestment`: a moonsilk vestment with a gold stole (heroic epic).
- `tideglass_warmaul`: a pearl-stone maul crowned with a tideglass prism
  (heroic epic).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
