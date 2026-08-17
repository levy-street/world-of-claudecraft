# Painted weapon inventory icons, sorted indices 80-99

## Scope and execution

- Ownership was narrowed by the parent task to sorted `ITEM_WEAPON_VARIANTS` base-weapon indices 80 through 99 inclusive.
- Count: 20 unique base weapon icons.
- Generation mode: built-in `image_gen`, one call per asset.
- Generated source size: 1254 x 1254 opaque RGB PNG.
- Normalized master: 512 x 512 opaque RGB PNG in `masters-512/`.
- Shipping asset: 128 x 128 opaque RGB WebP in `public/ui/items/`, ImageMagick Lanczos resize at WebP quality 82.
- Style reference for every call: `/Users/fernando/Documents/wocc-placeholder-art-v036/tmp/imagegen/placeholder-art-completion/weapons-c/references/item-style-contact.png`.
- Image 2 for every call was the matching legacy model-family JPG under `/Users/fernando/Documents/wocc-placeholder-art-v036/public/ui/weapons/`, used only as a silhouette-family reference.

## Exact prompt for index 80

`nhalias_dirgeblade` used this exact prompt:

```text
Use case: stylized-concept
Asset type: square fantasy RPG inventory weapon icon
Input images: Image 1 is a style-only reference sheet of the game's existing painted item icons; Image 2 is a silhouette-only reference for the dagger family, not an edit target.
Primary request: Paint one unique icon for Nhalia's Dirgeblade, a rare one-handed rogue/hunter dagger claimed from the drowned-litany cultist Sister Nhalia. The weapon is a narrow, wicked dirge dagger of dark tide-worn steel with a subtle hooked profile, a drowned-silver guard, a wrapped deep teal grip, and a small violet mourning gem. Suggest sea-cult ritual craftsmanship through tasteful metal filigree only, never written glyphs.
Scene/backdrop: opaque near-black navy painted ground with a restrained cold teal-violet halo behind the weapon, no scene.
Style/medium: premium hand-painted fantasy game item illustration matching Image 1; tactile steel, leather, and jewel surfaces; strong silhouette; not a photo and not a 3D product render.
Composition/framing: exactly one complete dagger, centered on the square, diagonal lower-left to upper-right, filling about 70 percent of the tile, generous even padding, no crop, readable at 28 to 40 pixels.
Lighting/mood: crisp top-left key light, cool drowned highlights, rare-quality restrained violet accent, deep soft shadow.
Constraints: square; full opaque background; one weapon only; no frame or border; no hands; no characters; no blood; no text; no letters; no numbers; no readable runes; no symbols that resemble writing; no watermark; preserve simple uncluttered silhouette.
Avoid: black-void catalog photography, flat 3D thumbnail, excessive glow, ornate scenery, cropped tip or pommel, duplicate weapons, typography.
```

## Exact prompt template for indices 81-99

For each row below, the exact prompt was this literal template with both `${family}` occurrences and `${subject}` replaced by the row values, without any other change:

```text
Use case: stylized-concept
Asset type: square fantasy RPG inventory weapon icon
Input images: Image 1 is a style-only reference sheet of the game's existing painted item icons; Image 2 is a silhouette-only reference for the ${family} family, not an edit target.
Primary request: ${subject}
Scene/backdrop: opaque near-black navy painted ground with a restrained thematic halo behind the weapon, no scene.
Style/medium: premium hand-painted fantasy game item illustration matching Image 1; tactile materials and crisp painted bevel highlights; strong silhouette; not a photo and not a 3D product render.
Composition/framing: exactly one complete ${family}, centered on the square, diagonal lower-left to upper-right, filling about 70 percent of the tile, generous even padding, no crop, readable at 28 to 40 pixels.
Lighting/mood: crisp top-left key light, controlled thematic rim light, deep soft shadow; rarity is expressed through materials and restrained accent glow.
Constraints: square; full opaque background; one weapon only; no frame or border; no hands; no characters; no blood; no text; no letters; no numbers; no readable runes; no symbols that resemble writing; no watermark; preserve a simple uncluttered silhouette.
Avoid: black-void catalog photography, flat 3D thumbnail, excessive glow, ornate scenery, cropped tip or pommel, duplicate weapons, typography.
```

| Index | ID | Family | Subject | Model reference |
|---:|---|---|---|---|
| 81 | `nhalias_litany_rod` | caster rod | Paint one unique icon for Nhalia's Litany Rod, a rare one-handed caster weapon claimed through the Drowned Litany. Build it from tarnished drowned silver around a dark driftwood grip, crowned by one violet-black pearl held in a small choir-bell cage, with teal sea-glass beads and subtle flowing filigree. It should feel ceremonial, mournful, and sea-cursed without written prayers. | `wand_b.jpg` |
| 82 | `nightfangs_greatstaff` | two-handed feral greatstaff | Paint one unique icon for Nightfang's Greatstaff, an epic two-handed druid weapon dropped by Korzul the Gravewyrm. Shape a long black heartwood battle staff with a powerful crescent head made from paired gravewyrm fangs, bone bindings, and a small cold moonstone core. Use dark forest green, bone ivory, and restrained violet grave-light; it must read as a brutal feral weapon rather than a delicate wizard wand. | `adv_staff.jpg` |
| 83 | `ogre_bonecharm_staff` | two-handed caster staff | Paint one unique icon for the Ogre Bonecharm Staff, a rare caster staff earned from the ogre warlands. Use a thick, gnarled ochre-brown shaft wrapped in coarse hide, crowned by a broad fork of weathered ogre bone with several chunky tooth charms and one warm amber crystal bound at the center. It should look primitive, heavy, and shamanic, with pale bone and rare-quality blue-gold sparks. | `adv_staff.jpg` |
| 84 | `palecoil_rod` | one-handed caster rod | Paint one unique icon for the Palecoil Rod, an uncommon caster quest reward from a moonlit tide temple. Make a slender pale ivory-and-silver rod whose head coils like a smooth sea serpent around one opalescent pearl, with a sea-green wrapped grip and small tideglass inlays. Keep it elegant but modest, with soft aqua light appropriate to uncommon gear. | `adv_wand.jpg` |
| 85 | `pitlords_cleaver` | one-handed cleaver axe | Paint one unique icon for the Pit Lord's Cleaver, a level-20 rare axe dropped by Azgorath, Lord of the Pit in the Rift. Forge a brutally broad, horn-backed cleaver head from soot-black demon iron with chipped edges, dark brass collars, and sparse ember-orange heat glowing through a few deep cracks. Wrap the short handle in charred red leather; make it massive and infernal but clearly one-handed. | `adv_axe_1handed.jpg` |
| 86 | `redbrook_blade` | one-handed militia sword | Paint one unique icon for the Redbrook Militia Blade, an uncommon early-game one-handed sword awarded by the Redbrook militia. Use honest polished steel with a practical straight blade, simple iron crossguard, red-brown leather grip, and a small worn red cloth knot at the pommel. It should feel reliable, locally forged, and modest, with only a restrained warm highlight and no magic. | `sword_d.jpg` |
| 87 | `riptide_dirk` | one-handed dagger | Paint one unique icon for the Riptide Dirk, a rare rogue and hunter quest weapon from the drowned coast. Give it a swift recurved blue-steel blade shaped like a breaking wave, a compact silver tide guard, deep blue cord grip, and a small aqua sea-glass pommel. Use crisp cyan edge light and a restrained spray-like halo, but keep the silhouette clean and lethal. | `dagger_c.jpg` |
| 88 | `rusty_dagger` | one-handed starter dagger | Paint one unique icon for the Rusty Dagger, a common starter weapon. Show a short plain iron dagger with heavy mottled rust, a chipped but intact point, a tiny utilitarian crossguard, cracked brown leather wrapping, and a dull iron pommel. No magic, no jewel, no ornament; humble, battered, and still usable. | `dagger_a.jpg` |
| 89 | `rusty_hatchet` | one-handed starter hatchet | Paint one unique icon for the Rusty Hatchet, a common starter weapon. Show a small practical iron hatchet with a broad simple edge, mottled orange-brown rust, nicks from hard use, a rough ashwood handle, and one plain dark leather binding. No magic, no jewel, no ornament; humble, battered, and clearly lighter than a war axe. | `axe_a.jpg` |
| 90 | `scepter_of_the_deathless_court` | one-handed royal scepter | Paint one unique icon for the Scepter of the Deathless Court, an epic level-20 raid caster weapon. Build a regal blackened-silver scepter with a skeletal crown-shaped head cradling one luminous amethyst, polished bone inlays, and restrained antique-gold edges. The grip is wrapped in midnight velvet and the halo is cold violet grave-light; make it noble, ominous, and unmistakably epic without any written glyphs. | `adv_wand.jpg` |
| 91 | `skullsplitter_dirk` | one-handed heavy dirk | Paint one unique icon for the Skullsplitter Dirk, a rare rogue and hunter dagger looted from Brutok in the ogre warlands. Give it a thick forward-weighted dark-steel blade with a chisel-like reinforced spine, a compact guard shaped from weathered bone, ochre hide wrapping, and one small blue stone set in the pommel. It should feel brutal and practical, made to punch through bone, not like an elegant assassin's knife. | `adv_dagger.jpg` |
| 92 | `sloomtooth_tidefang` | one-handed fang dagger | Paint one unique icon for Sloomtooth's Tidefang, a rare rogue and hunter dagger taken from the drowned-coast creature Sloomtooth. Fashion the blade from one long curved sea-beast fang capped in tarnished bronze, with a hooked tideguard, kelp-green leather grip, barnacle texture, and a tiny teal pearl. Use cool sea-blue edge light; the silhouette must clearly differ from a forged steel dirk. | `adv_dagger.jpg` |
| 93 | `staff_of_drowned_prayers` | two-handed caster staff | Paint one unique icon for the Staff of Drowned Prayers, an uncommon caster staff from the drowned coast. Use a salt-bleached driftwood shaft, a simple forked crown holding a dim sea-blue prayer pearl, tarnished copper wire, a few smooth tide beads, and one tiny broken bell. It should feel waterlogged, mournful, and modest rather than ornate; no paper, no writing, and only a soft aqua halo. | `staff_b.jpg` |
| 94 | `staff_of_the_gravewyrm` | two-handed necrotic staff | Paint one unique icon for the Staff of the Gravewyrm, an epic caster staff dropped by Korzul the Gravewyrm. Build its long shaft from dark petrified heartwood sheathed in articulated gravewyrm vertebrae, ending in a dramatic horned dragon-skull crown around one deep emerald soulstone. Add small ember-orange fissures against cold grave-green light to echo Korzul's Grave Inferno, while keeping the complete staff silhouette strong and centered. | `adv_druid_staff.jpg` |
| 95 | `staff_of_velkhar` | two-handed necromancer staff | Paint one unique icon for the Staff of Velkhar, a rare caster staff tied to Grand Necromancer Velkhar in the gravewyrm crypt. Use a straight blackwood shaft with restrained aged-silver fittings, a high angular crown resembling folded raven wings around one smoky violet crystal, and a small polished bone pommel. It should feel scholarly, severe, and necromantic rather than monstrous, with cold purple light and no skull cliché. | `staff_d.jpg` |
| 96 | `stormcallers_focus` | one-handed storm focus | Paint one unique icon for the Stormcaller's Focus, an epic level-20 raid caster weapon for paladins and shamans. Shape a compact one-handed silver-and-dark-bronze storm focus with a forked lightning crown holding one brilliant blue-white storm crystal, a cobalt leather grip, and small hammered cloud-scroll curves that are decorative shapes rather than writing. Make it powerful and epic with restrained electric arcs and a crisp cyan halo. | `wand_b.jpg` |
| 97 | `thorium_warblade` | one-handed crafted warblade | Paint one unique icon for the Osmium Warblade, a rare crafted one-handed sword from advanced weaponcrafting. Forge a clean, dense pale-gray osmium blade with a broad reinforced spine, precise angular bevels, a dark steel upswept guard, charcoal leather grip, and one small cobalt maker-stone in the pommel. It should feel exceptionally balanced and master-crafted, with cool blue forge highlights but no magical flames. | `adv_sword_1handed.jpg` |
| 98 | `tideglass_dirk` | one-handed glass dagger | Paint one unique icon for the Tideglass Dirk, an uncommon rogue and hunter quest reward from a moonlit tide temple. Use a single translucent aqua-blue tideglass blade with a crisp triangular profile and subtle wave-like internal striations, set into a simple pale-silver guard and dark teal wrapped grip. Keep the magic modest, the edges legible, and the glass clearly distinct from steel. | `dagger_b.jpg` |
| 99 | `tidereaver_gaff` | two-handed hooked gaff spear | Paint one unique icon for the Tidereaver Gaff, a rare two-handed polearm taken from Sloomtooth on the drowned coast. Use a long dark driftwood haft reinforced with tarnished bronze bands, ending in a large practical sea-steel gaff hook with a rear spike, barnacle wear, sea-green cord, and one small aqua tideglass cabochon. It must read immediately as a fisherman's hooked gaff turned heroic weapon, not as a trident or scythe. | `spear_a.jpg` |

## Built-in generation result paths

All generated files below share `/Users/fernando/.codex/generated_images/019fe70b-72e4-7813-a65a-71516a0e59a8/` as their directory.

| ID | Generated result filename |
|---|---|
| `nhalias_dirgeblade` | `exec-a7caa409-5dd1-43ce-8290-b1e739e7ab54.png` |
| `nhalias_litany_rod` | `exec-e001c21b-009a-4520-969f-db1ea66aa8b3.png` |
| `nightfangs_greatstaff` | `exec-821aca6a-c774-448d-95c3-0e6336697c4b.png` |
| `ogre_bonecharm_staff` | `exec-76bda1ef-56b7-402c-9ff3-c229eb300124.png` |
| `palecoil_rod` | `exec-143f045e-1438-43a9-8850-a13484323afa.png` |
| `pitlords_cleaver` | `exec-bed16be4-df93-4456-8c4b-6a14d0b09257.png` |
| `redbrook_blade` | `exec-49c56125-3d84-4952-b3c9-09f622519354.png` |
| `riptide_dirk` | `exec-81f56e45-8f62-47f4-ad83-4d6893c5aa7e.png` |
| `rusty_dagger` | `exec-c9b38098-dcd0-414d-91bf-0c3fa163cffb.png` |
| `rusty_hatchet` | `exec-2f5640bc-bfa0-44ec-937c-dec27e3a6451.png` |
| `scepter_of_the_deathless_court` | `exec-4c24db48-e8ac-4e2a-9912-aff11d1c20ba.png` |
| `skullsplitter_dirk` | `exec-926a0bed-313c-4216-9d72-544e21e1fe24.png` |
| `sloomtooth_tidefang` | `exec-7604d091-8ecd-474c-b7fa-9688addef306.png` |
| `staff_of_drowned_prayers` | `exec-c6d541f6-3e8f-48f0-a8bc-d5a475eda2b6.png` |
| `staff_of_the_gravewyrm` | `exec-a2ed304e-ce5b-4c96-91a5-33ac9c3d85e8.png` |
| `staff_of_velkhar` | `exec-3b0c2d3a-a797-4b2f-9183-30603b4d3671.png` |
| `stormcallers_focus` | `exec-317536d3-6921-4713-b2db-9738c418f2d1.png` |
| `thorium_warblade` | `exec-2b9b49cc-df1c-42f7-8bd4-99bc4ed64752.png` |
| `tideglass_dirk` | `exec-23dca9e1-ccdf-4e95-894b-3f14496fc378.png` |
| `tidereaver_gaff` | `exec-be606b60-1122-4bc1-96cf-e8233f5c3625.png` |

## Master and shipping hashes

| ID | 512 master SHA-256 | Master bytes | Shipping SHA-256 | Shipping bytes |
|---|---|---:|---|---:|
| `nhalias_dirgeblade` | `da006860813fa2387c1f4acb2720a3815d4963ea1263df7455c96d7969fd70e2` | 277767 | `c11a35fdda0b563aec3e52f9be932c0fc45e421852cf734ebf8b65fe08c6e0cc` | 1364 |
| `nhalias_litany_rod` | `b088fc2e8e0fd1cb17fc51da693159c289d40304abc61cdab227bc2ccd15afff` | 272464 | `a970b641b3e21bb6fe857e22a6d01a4c9bcdfb1ea721f11194783b4489733d47` | 1638 |
| `nightfangs_greatstaff` | `a9634272c7f15b0c4b7ccc61c35fc11bd87544c824a06dcd639b8059bb9feba1` | 269051 | `53d5c42581265b53eb464d4b40febc8b98261ca31d085d383729a4e09c61525b` | 1640 |
| `ogre_bonecharm_staff` | `5a530be58323cbef3dc89fd8e7201d23e2fd9aa9949ff159c397d57b677f0ac9` | 292308 | `68bb9877529e86c7bf369e699639c7688d36b293d3888d28e3fdff217d43fb3f` | 2038 |
| `palecoil_rod` | `ce7c8b374edb6c7ef7e838c67914a5c1b2aa99768612d6071af9101719aefb3a` | 254327 | `e892f27f1039ba0a00ff6ab8afa789e7faa19ae9dc30fa8ad213154ff0407505` | 1416 |
| `pitlords_cleaver` | `9369544bf485195dd4435727907d12d2c0075f4cac8f0c75e04eb8fc89fde59d` | 308999 | `91eb763568e8a8bfd04338014bed733ea7397179d7ff884e8cefd9c4e8ef2f2c` | 1952 |
| `redbrook_blade` | `404181d15dc8d55803ee34059f0c88fc3cadef471c133d241af696b5c3f5a45f` | 253994 | `99a1792f98311e7a2379c8feddd95e1a6db388b999388aca95941499992d0638` | 1374 |
| `riptide_dirk` | `b0a2a4a5ec9b994b347325dd29a8e6323c829a64f9f3e927f4f35bf5aadf2b28` | 303170 | `a779d5a7c4fad86bbdc34a78189e6209921214f1fabf2ff0cbeb8aef1bc989c2` | 1764 |
| `rusty_dagger` | `a3298e702c8eb450a18756a2ae1a06809cdf3670143965cb0e75ff35e013ed85` | 260701 | `336a4912cf943b0e0771234a900ceda64bbc6bd407dad42b801b551b6cff19d8` | 1302 |
| `rusty_hatchet` | `8e1767acd1c8144bb919e02318263028588df182bf17d1e4b7f6cfbe9f225ce0` | 302072 | `bc5bea1893a853baaeb2cc7f2e3a042d3eb7ee8050794bebaca366cd354e2a3e` | 1512 |
| `scepter_of_the_deathless_court` | `53f0f043fe9c8380da7ce961765ffd54d800ef98502634fb7efa70f8036c7514` | 318769 | `4a60f65998b63def4cf358b5b1c41caa33d8eb2290834150e2cc15a8491e00fa` | 1896 |
| `skullsplitter_dirk` | `f7576f86f7bf515aa5ddd0844c434bbe2cdba1adddb350d6225ad88ee77f972e` | 283026 | `821d83d475f9b0dbc38103c6ef5c3cd57b4b0da23df6a536f80440a683f437a6` | 1708 |
| `sloomtooth_tidefang` | `1f5eea5a5d2e20f3d6d40ecc594725a18cc4940c5f4846a3d347b12f2109aab0` | 287700 | `78a4a8e8e73bec4f3f301f8996248b89f9daae00190735def5c94954a3014d3c` | 1758 |
| `staff_of_drowned_prayers` | `751a21222990aa25ea400029052e24260d2ccd13c83a1421d2c8073cb83dbbaa` | 256309 | `cd11f806e95e4bda499592fbbd077a68814fd680ee6d196c5c40eb8874dd7f8e` | 1226 |
| `staff_of_the_gravewyrm` | `e0c29e74f11c596e3397dca0486f18091b3f56af53a427a8ba20e5d3e79f3a53` | 279733 | `cb67dc16deece88da7257239d353a13f1563c20ad28d0692b4d2b47195dc2768` | 1716 |
| `staff_of_velkhar` | `d9786885a5ca45e78150447147b1a565bfb9040b9be912f2fe90123c722e0bb0` | 256824 | `bc3c2f81af75c73135c6ef09376293f53d3a54ec4a18ed0a1aebee64751ece61` | 1200 |
| `stormcallers_focus` | `e6f626f7a7ac75d326c7587c0fc0c3b97c9a5774a01f92191dae78cd81783dce` | 303615 | `3ec152777c8ca72e1142096e512211064c2bdbd77a4511f66c2428b53431602e` | 2766 |
| `thorium_warblade` | `61239d9b69a9aa34b92b64f4f131f84f98241c6fb440fed79c326db51be8935f` | 274443 | `93d59c4942099622ccee55b3b622eebcfb6a473d955e336410bda33fe3fcab99` | 1608 |
| `tideglass_dirk` | `100ca7fc6c89ef6cf86067e68a615e208b8a07b30bb33f95e20ab43a92e68a61` | 262458 | `ffea9f9406d1b0dcba05056e474d809b5aff1a3dc7bb6cf0c30762e975971262` | 1544 |
| `tidereaver_gaff` | `68f581fefc41feb63570a1be97637b86d300518198e09b07868e4c87672f4c39` | 272511 | `9903ceaf1e3224b86040c84667abe3beb5f7aaf486e0a1e5513aacb5ef2687fa` | 1294 |

## QA

- 20 of 20 normalized masters are exactly 512 x 512, opaque sRGB.
- 20 of 20 shipping files are exactly 128 x 128, opaque sRGB WebP.
- Largest shipping file: 2766 bytes, below the 15360-byte contract.
- Exact duplicate shipping hashes: 0.
- Visual inspection completed for every generated source at native scale and for the full batch at 128, 40, and 28 pixels, plus 40-pixel grayscale.
- All subjects are complete, centered, uncropped, and readable at game size.
- No generated asset contains text, letters, numbers, readable runes, hands, characters, borders, or watermarks.
- Rarity progression remains legible: common starter tools are plain and worn, uncommon items are restrained, rares receive thematic materials, and epics receive controlled jewel/light accents.

Preview sheets:

- `previews/all-128-color.png`
- `previews/all-40-color-4x.png`
- `previews/all-28-color-5x.png`
- `previews/all-40-gray-4x.png`
