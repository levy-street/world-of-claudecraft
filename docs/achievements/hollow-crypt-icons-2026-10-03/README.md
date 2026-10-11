# Hollow Crypt loot icons: generated-art provenance

Sixteen shipping inventory icons for the Hollow Crypt rework's loot
(`src/sim/content/hollow_crypt_items.ts`, plus the generated Heroic Cantor's Hymnal
from `src/sim/content/heroic_variants.ts`), registered in
`public/ui/items/mapping.json` as the generated batch `hollow-crypt-icons-2026-10-03`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art with a per-plate volume sheen and a soft paint-grain filter, over a
  three-stop radial ground, a paper-grain overlay) rasterized with Sharp at the 512
  master and downscaled to the shipping 128x128 opaque sRGB WebP by
  `scripts/generate_hollow_crypt_item_icons.mjs`. The script IS the retained
  source: re-running it reproduces every file byte for byte, so no separate
  originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item. The crypt's palette
  (`docs/design/dungeon-rework/hollow_crypt.md`, Palette): bone ivory, grave-earth
  umber, tallow amber for the only warm light, Gravecaller violet and soul green
  for the enemy's magic, rime white-blue for the Rimeweb's wing.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.
- Heroic weapons: `heroic_sextons_spadehaft` and `heroic_rimeweb_fang` own no
  file; like every generated Heroic weapon they resolve to their base painting
  and held model (rows in `docs/achievements/missing-painted-icons-accepted-art.json`).
  The held models reuse shipped GLBs through `ITEM_WEAPON_VARIANTS`
  (`adv_axe_2handed` for both spades, `dagger_c` for the fang).

## Items

- Sexton Marrow: `gravedirt_treads` (a pair of mail boots with folded leather
  cuffs, buckled ankle straps and iron toe caps, caked in grave dirt),
  `bellrope_girdle` (a faded violet cloth sash bound with old bell rope, a bronze
  hand-bell on one frayed tail), `sextons_spadehaft` (a long-hafted round-point
  digging spade with a dirt-crusted blade, a rope-bound haft and a D-grip).
- Rimeweb: `rimesilk_mantle` (a pale rime-silk capelet spun with web filigree, a
  chitin collar, an icicle hem and a frost-spider clasp), `bonechill_carapace_vest`
  (a mail hauberk plated in frost-widow chitin with the widow's icy hourglass and
  two jointed spider legs at the shoulders), `rimeweb_hunters_leggings` (leather
  leggings bound criss-cross with web silk, chitin knee guards),
  `rimeweb_fang` (a dagger whose blade is one curved ivory-to-ice fang, chitin-leg
  quillons, a silk-wound grip and an egg-sac pommel).
- Cantor Ilvane: `cantors_cassock` (an ankle-length black-violet cassock with bell
  sleeves, a clerical band, silver buttons and a gold choir stole worked with
  bells), `choirward_leggings` (mail leggings under a violet tabard embroidered
  with a silver bell, steel knee cops), `choristers_gloves` (a pair of dark
  leather gloves with violet cuffs stitched with notes, a silver chime on a
  ribbon), `cantors_hymnal` (a shut crimson hymnal with brass corners, a bone
  clasp, an embossed bell and two marker ribbons), `heroic_cantors_hymnal` (the
  same hymnal thrown open, its hymn rising off the pages in violet notes).
- Morthen the Gravecaller: `gravecallers_vestments` (grave-black robes with ragged
  sleeves, a spiked violet collar, a sewn bone ribcage, a skull clasp and
  soul-green light at the hem), `unquiet_stalkers_hood` (a ragged leather hood
  with a bone jaw guard, soul-green eyes in its shadow and finger-bone tokens at
  the brow).
- Heroic epics: `sextons_burial_spade` (a squared grave-steel spade blade pierced
  with a coffin cross and lit violet, a bone-wrapped haft, a bone T-grip and a
  bronze funeral bell), `rimesilk_hood` (a peaked rime-silk hood with frost web
  filigree, an ice-crystal circlet and a cold blue light in the cowl).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`, `tests/weapon_icons.test.ts`): 128x128, opaque, within
the byte budget, unique bytes, one mapping owner each. Each composition was viewed
at 256, 40 and 22 px during authoring; owner visual review is pending, like every
generated batch's.
