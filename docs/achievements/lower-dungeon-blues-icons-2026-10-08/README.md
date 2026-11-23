# Lower-dungeon normal blues: generated-art provenance

Fifty-five shipping inventory icons for the normal rare groups of the three lower
dungeons (`src/sim/content/hollow_crypt_items.ts`, `sunken_bastion_items.ts` and
`drowned_temple_items.ts`), plus the generated Heroic clone of every new armour
piece (`src/sim/content/heroic_variants.ts`), registered in
`public/ui/items/mapping.json` as the generated batch
`lower-dungeon-blues-icons-2026-10-08`.

## What happened

- Generator: no image model. Each icon is an authored SVG composition rasterized
  with Sharp at the 512 master and downscaled to the shipping 128x128 opaque sRGB
  WebP by its dungeon's generator: `CRYPT_BLUES` in
  `scripts/generate_hollow_crypt_item_icons.mjs` (per-plate volume sheen and the
  soft paint-grain filter of that batch), `BASTION_BLUES` in
  `scripts/generate_sunken_bastion_item_icons.mjs` and `TEMPLE_BLUES` in
  `scripts/generate_drowned_temple_item_icons.mjs`. Each script renders only the
  ids passed to it (`node scripts/generate_<dungeon>_item_icons.mjs <id ...>`),
  and re-running it reproduces every file byte for byte, so no separate originals
  or masters are kept.
- Heroic armour clones: each `heroic_<id>` is its base composition under a deeper
  ground, with a halo of its boss's light behind it (tallow, frost, violet or soul
  light in the Crypt, sea light in the Bastion, moon or sea light in the Temple)
  and extra glints: the `heroic_chorus_conch` recipe (`heroicClone` in each
  generator).
- Heroic weapons: `heroic_gravecallers_rod`, `heroic_turnkeys_shank`,
  `heroic_fogbinders_rod`, `heroic_merecleaver` and `heroic_moonwrack_stave` own
  no file; like every generated Heroic weapon they resolve to their base painting
  and held model (rows in `docs/achievements/missing-painted-icons-accepted-art.json`).
  The held models reuse shipped GLBs through `ITEM_WEAPON_VARIANTS` (`wand_a`,
  `dagger_c`, `wand_b`, `adv_axe_2handed`, `adv_staff`).
- Style contract: woc-item-icon-v1 (`docs/design/item-icon-art-style.md`): opaque
  dark vignette, warm top-left key light, cool bottom-right shadow, centered
  silhouette with safe padding, distinct art per item, each dungeon in its own
  batch palette.
- Owner/license: World of ClaudeCraft, project-generated art, project asset,
  rights reserved. No prior icon is replaced and there is no supersession.

## Items

- Sexton Marrow (gloves): `spadeworn_gauntlets` (a pair of mail gauntlets over a
  dirt-crusted spade haft, palms worn bright, iron knuckle plates),
  `gravedirt_grips` (dark leather grips, fingertips cut away, knuckles caked in
  grave earth, bone wrist toggles), `bellrope_mitts` (faded violet fingerless
  mitts wound with bell rope, a bronze bell on one tail).
- The Lady of the Bonechill (helm): `rimewreath_coif` (a mail coif crowned with a
  bridal wreath of ice crystals), `rime_laced_hood` (a peaked leather hood laced
  shut with frost-white cord), `lamenting_veil` (a silver circlet over a bowed
  head, a rime-silk veil beaded with frozen tears).
- Cantor Ilvane (shoulders): `choirward_pauldrons` (a pair of mail pauldrons with
  silver-edged lames over a violet tabard and its silver bell),
  `choristers_spaulders` (rounded leather spaulders stitched with notes, a chime),
  `cantors_stole` (a violet choir stole with gold-worked bells and fringed ends).
- Morthen the Gravecaller (chest, rod): `knellbound_hauberk` (grave-dark mail
  with a bronze knell bell chained to the breast), `candlewatch_jerkin` (a
  leather jerkin with a bandolier of three lit tallow candles),
  `robe_of_the_unquiet_rite` (a violet-black rite robe with the Rite Ring and
  its four candle flames on the breast), `gravecallers_rod` (a black-iron rod
  with a bone grip and a finger-bone cage holding a soul-green flame).
- The Gaol Turnkey (waist, shank): `portcullis_girdle` (a mail girdle with a
  portcullis buckle), `cellwatch_belt` (a warder's belt with a spyhole buckle
  and tally sticks), `lanternwick_sash` (a sea-green sash with a lit gaol
  lantern at the knot), `turnkeys_shank` (an iron bar ground to a point, a rag
  grip and a key-ring pommel).
- Gaoler Ossick (chest): `gaolyard_jerkin` (a sea-stained leather jerkin closed
  with shackle rings, a broken chain at the shoulder), `brinewarden_robe` (a
  sea-green warden's robe with a gold key on the breast and kelp at the hem).
- Vael the Fogbinder: `fogbinders_rod` (a copper-bound driftwood rod with a
  sea-glass orb wreathed in fog).
- Choirmother Selthe (feet): `conchplate_sabatons` (mail sabatons with conch-plate
  toes and gold spiral bosses), `pale_chorus_slippers` (moon-silk slippers with
  hymn stitching and pearl toes).
- The Tideglass Colossus (gloves): `tideglass_gauntlets` (steel gauntlets with
  tideglass knuckle shards), `moonburn_grips` (russet grips with a burned moon
  crescent), `prism_etched_handwraps` (violet silk handwraps etched with a
  spectrum, a prism at each wrist).
- The Mere Hydra (helm, axe): `mere_crested_helm` (a steel helm with three hydra
  fins), `mereskin_hood` (a scaled hood of hydra skin with a finned ridge),
  `merewater_cowl` (a rippled sea-green cowl with a pearl and falling drops),
  `merecleaver` (a two-handed axe with a fin-shaped, three-toothed blade).
- Ysolei: `moonwrack_stave` (a pale driftwood stave crowned with a nacre crescent
  cradling a pearl).
- The 25 Heroic armour clones: `heroic_` plus each armour id above.

## Review

Machine-checked by the shipping catalog audit (`tests/item_art_consistency.test.ts`,
`tests/item_icons.test.ts`, `tests/weapon_icons.test.ts`): 128x128, opaque, within
the byte budget, unique bytes, one mapping owner each. Each composition was viewed
on a 200 px contact sheet during authoring; owner visual review is pending, like
every generated batch's.
