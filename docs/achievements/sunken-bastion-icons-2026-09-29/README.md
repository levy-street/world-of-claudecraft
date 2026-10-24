# Sunken Bastion loot icons: generated-art provenance

Eleven shipping inventory icons for the Sunken Bastion rework's loot
(`src/sim/content/sunken_bastion_items.ts`, plus the Gaoler's Iron Key trinket in
`src/sim/content/trinkets.ts`), registered in `public/ui/items/mapping.json` as the
generated batch `sunken-bastion-icons-2026-09-29`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition (per-item
  vector art over a three-stop radial ground, a paper-grain overlay) rasterized
  with Sharp at the 512 master and downscaled to the shipping 128x128 opaque sRGB
  WebP by `scripts/generate_sunken_bastion_item_icons.mjs`. The script IS the
  retained source: re-running it reproduces every file byte for byte, so no
  separate originals or masters are kept.
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- `knight_commanders_longsword`: a verdigris-flecked longsword on the diagonal,
  gilt guard, sea-green grip, shell pommel (Olen's rare chase row).
- `gaolers_chain_girdle`: a girdle of gaol chain with a square iron buckle and a
  rusted key ring.
- `rusted_shackle_grips`: worn leather grips, one still wearing a rusted shackle
  cuff with a snapped link.
- `drowned_wardens_mantle`: a sea-green cloth mantle with a kelp hem and a pearl
  clasp.
- `gaolyard_cudgel`: an oak cudgel bound in rusted iron bands and studs.
- `drowned_commanders_breastplate`: sea-dark steel with gilt trim, a shell boss
  and a barnacle crust (heroic epic).
- `gaolyard_striders`: tall leather striders with riveted iron ankle cuffs
  (heroic epic).
- `gaolers_iron_key`: the gaol's great iron key on its ring with a cold sea-green
  glint (heroic trinket).
- `jailers_iron_gauntlets`: riveted iron mail gauntlets with rusted cuffs and a
  length of cell chain (the Gaol Turnkey miniboss, fifth pass).
- `turnkeys_keyring_belt`: a broad leather belt with a rusted buckle and the
  great ring of cell keys (the Gaol Turnkey).
- `turnkeys_lantern_cowl`: a sea-stained cloth cowl hung with a small storm
  lantern (the Gaol Turnkey).

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`): 128x128, opaque, within the byte budget, unique bytes,
one mapping owner each. Owner visual review of the compositions is pending, like
every generated batch's.
