# Faction ladder icons: generated-art provenance

Seventeen shipping inventory icons for the faction quartermaster stock
(`src/sim/content/faction_vendors.ts`), one per item, registered in
`public/ui/items/mapping.json` as the generated batch `faction-ladder-icons-2026-09-23`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground) rasterized with Sharp to the
  shipping 128x128 opaque sRGB WebP by `scripts/generate_faction_vendor_icons.mjs`.
  The script IS the retained source: re-running it reproduces every file byte
  for byte, so no separate originals or masters are kept. This batch extends
  the same `ITEMS_TO_GENERATE` table the `faction-vendor-icons-2026-09-16`
  batch introduced; the original 15 entries are untouched and still reproduce
  byte-identically.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `acolytes_signet`
- `champions_dawn_loop`
- `cogwork_choker`
- `cord_of_the_dawn`
- `dawnkeepers_circle`
- `dawnlit_slippers`
- `forgemasters_girdle`
- `forgemasters_sabatons`
- `forgewall_gorget`
- `formula_dawnfire_etching`
- `formula_dawns_benediction`
- `formula_piston_drive`
- `formula_riftwalkers_grace`
- `riftwalkers_cord`
- `riftwalkers_treads`
- `riftwardens_pendant`
- `tidewatchers_locket`

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`, `tests/weapon_icons.test.ts`): 128x128, opaque, within
the byte budget, unique bytes, one mapping owner each. Owner visual review of the
compositions is pending, like every generated batch's.
