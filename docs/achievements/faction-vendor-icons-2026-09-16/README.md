# Faction vendor icons: generated-art provenance

Fifteen shipping inventory icons for the faction quartermaster stock
(`src/sim/content/faction_vendors.ts`), one per item, registered in
`public/ui/items/mapping.json` as the generated batch `faction-vendor-icons-2026-09-16`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground) rasterized with Sharp to the
  shipping 128x128 opaque sRGB WebP by `scripts/generate_faction_vendor_icons.mjs`.
  The script IS the retained source: re-running it reproduces every file byte
  for byte, so no separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `artificers_welding_cowl`
- `automaton_cog_ring`
- `champion_dawn_medallion`
- `champion_forged_loop`
- `champion_rift_band`
- `clockwork_tinkers_pack`
- `dawnkeeper_consecrated_mace`
- `forgemaster_crag_cleaver`
- `order_prayer_beads`
- `rift_surveyors_satchel`
- `rift_watchers_band`
- `riftwalkers_tunic`
- `riftwarden_voidblade`
- `templar_dawn_shield`
- `vestments_of_the_acolyte`

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`, `tests/weapon_icons.test.ts`): 128x128, opaque, within
the byte budget, unique bytes, one mapping owner each. Owner visual review of the
compositions is pending, like every generated batch's.
