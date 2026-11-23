# Wildheart Basin loot icons: generated-art provenance

Eleven shipping inventory icons for the Wildheart Basin rework's loot
(`src/sim/content/wildheart_items.ts` and the two trinkets in
`src/sim/content/trinkets.ts`), registered in `public/ui/items/mapping.json` as
the generated batch `wildheart-basin-icons-2026-10-02`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground, a paper-grain overlay) rasterized
  with Sharp at the 512 master and downscaled to the shipping 128x128 opaque sRGB
  WebP by `scripts/generate_wildheart_basin_item_icons.mjs`. The script IS the
  retained source: re-running it reproduces every file byte for byte, so no
  separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item. The basin's palette
  (`docs/design/dungeon-rework/wildheart_basin.md` section 7): jade canopy, moss,
  wet basalt, sunbone ochre, troll war red, waterfall white-cyan, the
  Gorgebloom's pollen yellow and Zulgar's jade spirit flame.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.
- The Heroic Falls-Blessed Staff is a generated heroic weapon variant: it aliases
  its base staff's art like every heroic weapon, so it has no file of its own.

## Items

- The Fanglord Beastmaster: `beastpit_warbelt` (a mail war belt hung with fangs, a
  red-lacquered jaguar-skull buckle), `jaguar_hide_jerkin` (a rosetted jaguar-hide
  jerkin laced with jade cord), `hexbone_handwraps` (cloth wraps bound with carved
  hex-bones, a jade hex between the knuckles).
- The Gorgebloom: `rootbound_sabatons` (a mail sabaton gripped by living roots),
  `pollen_dusted_leggings` (leather leggings in drifting pollen), `bloomsilk_cowl`
  (a petal-hemmed bloomsilk cowl with a pollen-gold clasp), `falls_blessed_staff`
  (a river-wood staff crowned by a falls-worn basalt stone spilling white water;
  the rare chase row).
- Heroic epics: `fanglords_hide_mantle` (a jaguar-hide pauldron with a snarling
  jaguar head and war-red feathers), `thornroot_greathelm` (the Thorncrowned
  Greathelm: a closed mail helm ringed with thorned roots and one pollen bloom).
- Trinkets: `fanglords_whistle` (a carved fang whistle on a red cord, a jade spirit
  jaguar rising from its call), `gorgebloom_seedpod` (a split blood-red seedpod
  with a glowing pollen seed inside).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
