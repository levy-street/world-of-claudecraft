# Clue Scroll icons: generated-art provenance

Two shipping inventory icons for the Clue Scroll items
(`src/sim/content/items.ts`: `clue_scroll` and `treasure_casket`; the hunts they
open live in `src/sim/content/clue_hunts.ts`), registered in
`public/ui/items/mapping.json` as the generated batch `clue-scroll-icons-2026-09-17`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground) rasterized with Sharp to the
  shipping 128x128 opaque sRGB WebP by `scripts/generate_clue_scroll_icons.mjs`.
  The script IS the retained source: re-running it reproduces every file byte
  for byte, so no separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `clue_scroll`: a weathered parchment half unrolled, a treasure cross inked on
  it, a red wax seal on a ribbon (a rare-quality soulbound scroll).
- `treasure_casket`: a squat oak casket with iron bands, its domed lid cracked
  open on a spill of gold light, coins and a gem over the rim (an epic-quality
  soulbound container).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
