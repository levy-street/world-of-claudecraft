# Gravewyrm Sanctum loot icons: generated-art provenance

Eleven shipping inventory icons for the Gravewyrm Sanctum rework's loot
(`src/sim/content/gravewyrm_sanctum_items.ts` and the three trinkets in
`src/sim/content/trinkets.ts`), registered in `public/ui/items/mapping.json` as
the generated batch `gravewyrm-sanctum-icons-2026-10-03`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground, a paper-grain overlay) rasterized
  with Sharp at the 512 master and downscaled to the shipping 128x128 opaque sRGB
  WebP by `scripts/generate_gravewyrm_sanctum_item_icons.mjs`. The script IS the
  retained source: re-running it reproduces every file byte for byte, so no
  separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item. The Ice Tomb's palette
  (`docs/design/dungeon-rework/gravewyrm_sanctum.md` section 8): glacier blue,
  rime white, the Smith's blue runes, the cult's goad red, black iron, soulfire
  violet-green, dark meltwater.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- Korgath the Bound: `foremans_grips` (a giant's mail work gauntlet with a broken
  shackle cuff and a blue seal rune), `serac_stride_boots` (a frost-laced leather
  boot on iron crampons beside a jag of serac ice), `seal_rune_mantle` (a deep
  blue cloth mantle stitched with the four seal-tool runes, rimed along the top).
- Grand Necromancer Velkhar: `thawbound_legguards` (mail legguards half sheathed
  in melting ice), `pyre_tenders_hood` (a soot-black leather hood with a soulfire
  ember in its shadow), `meltwater_cord` (a braided cord knotted round a bead of
  dark meltwater).
- Heroic epics: `hammer_of_the_open_lock` (the Smith's forge hammer wound with a
  broken chain, an open-lock rune on its face), `vestments_of_the_waking_rite`
  (violet rite robes under a black fur mantle, frost on one shoulder and
  ember-cracked iron on the other).
- Trinkets: `foremans_last_link` (one great chain link struck through by a goad
  brand), `phial_of_the_tithe` (a caged glass phial of swirling soulfire under a
  red tithe seal), `quenchwater_flask` (an iron flask of the Quench's black water,
  a red-hot blade tip hissing into it).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
