# Deeds A generation report

Built-in imagegen mode, one separate call per asset. All generated sources used flat magenta chroma backgrounds and were processed locally.

## Processing

- Raw tool outputs: 1254 by 1254 RGB PNG.
- Chroma removal: `remove_chroma_key.py --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`.
- Purple and midnight-blue subjects produced isolated internal partial alpha with the conservative soft matte. The final matte preserves only the partial-alpha region connected to the exterior and restores enclosed medallion pixels to opaque. This keeps the outer antialiasing and prevents translucent portal, wing, and silk details.
- Normalized sources: exact 512 by 512 RGBA PNG, visible bounds fit to a maximum 416-pixel extent and centered on the canvas.
- Shipping output: exact 128 by 128 transparent WebP, quality 82, alpha quality 100, smart subsampling, effort 6. All outputs were below 15 KiB without a quality fallback.
- Retry record: no generation retries. One exploratory alternate chroma pass for `dgn_rift_s_rank` used opaque threshold 90, but it did not improve internal partial alpha and was rejected. The final source uses the standard threshold 220 plus enclosed-matte restoration described above.
- Visual review sheets: `preview/ship-128-color.png`, `preview/ship-128-gray.png`, `preview/ship-40-color-4x.png`, `preview/ship-40-gray-4x.png`, `preview/ship-24-color-6x.png`, and `preview/ship-24-gray-6x.png`.

## Result paths and references

All original tool results are under `/Users/fernando/.codex/generated_images/019fe6f8-0124-7441-889a-13c60848287d/`. Raw copies are `raw/<id>.png`, processed high-resolution sources are `normalized/<id>.png`, and shipping paths are `/Users/fernando/Documents/wocc-placeholder-art-v036/public/ui/deeds/<id>.webp`.

| ID | Original filename | Reference images |
| --- | --- | --- |
| `pvp_bg_first_capture` | `exec-6ffb7845-436c-4b63-9f45-b58d7aa92432.png` | `dgn_wildheart_basin.webp`, `pvp_vcup_first_win.webp` |
| `pvp_bg_first_win` | `exec-43d4b7f2-397b-4d59-b7b3-cc68785e3b11.png` | `dgn_wildheart_basin.webp`, `pvp_vcup_wins_25.webp` |
| `pvp_bg_wins_25` | `exec-e54c1d7e-3a94-4bb4-b852-17fd19b53cf0.png` | `dgn_wildheart_basin.webp`, `pvp_vcup_wins_25.webp` |
| `pvp_bg_captures_100` | `exec-a80ec500-d37c-4ce0-ab3c-57874e70f3a2.png` | `dgn_wildheart_basin.webp`, `pvp_vcup_wins_25.webp` |
| `chr_drakemaw_broodlord` | `exec-5633ca2c-0f09-49de-92f6-ba42aad7f1c7.png` | `chr_gleamstag.webp`, `dgn_gravewyrm_sanctum.webp` |
| `chr_maw_matriarch` | `exec-1ed102bc-7fc7-418b-82d2-a4755581d745.png` | `chr_gleamstag.webp`, `dgn_nythraxis.webp` |
| `dgn_rift` | `exec-51e34e68-a0d8-46fc-a927-4d838a7a46aa.png` | `dgn_wildheart_basin.webp`, `dgn_nythraxis_heroic.webp` |
| `dgn_rift_s_rank` | `exec-c3699833-0b27-42ee-958c-8f83173ac54d.png` | `dgn_wildheart_basin_heroic.webp`, `dgn_nythraxis_heroic.webp` |
| `prog_engineering_rare` | `exec-85c214ef-53b1-494c-bb00-b57c3bb85e4a.png` | `prog_engineering_50.webp`, `prog_grandmaster_engineering.webp` |
| `prog_alchemy_rare` | `exec-8fe1bd64-e9fb-4c9c-878d-4e71a2d92d29.png` | `prog_alchemy_50.webp`, `prog_grandmaster_alchemy.webp` |
| `prog_cooking_rare` | `exec-9ca37693-fe76-41b6-9c51-98ce366a09dc.png` | `prog_cooking_50.webp`, `prog_grandmaster_cooking.webp` |
| `prog_leatherworking_rare` | `exec-3ee8d1af-454a-4a61-8828-606b61483621.png` | `prog_leatherworking_50.webp`, `prog_grandmaster_leatherworking.webp` |
| `prog_tailoring_rare` | `exec-3fb0d9b1-0d23-4103-8bb8-13e0e7d83ed0.png` | `prog_tailoring_50.webp`, `prog_grandmaster_tailoring.webp` |
| `prog_weaponcrafting_rare` | `exec-2177be83-9fb1-4a67-ac2e-f1e27bb0e2d0.png` | `prog_weaponcrafting_50.webp`, `prog_grandmaster_weaponcrafting.webp` |
| `prog_armorcrafting_rare` | `exec-99ec7b2c-3e2c-4432-8d1b-92dfb1357627.png` | `prog_armorcrafting_50.webp`, `prog_grandmaster_armorcrafting.webp` |

## Shipping validation

Every output is 128 by 128 WebP with an alpha channel and fully transparent corners. Source coverage is measured at alpha 8 on the 512-pixel PNG. Shipping coverage is measured at alpha 8 on the 128-pixel WebP.

| ID | Bytes | SHA-256 | Source coverage | Source padding L/T/R/B | Shipping coverage | Shipping padding L/T/R/B |
| --- | ---: | --- | ---: | --- | ---: | --- |
| `pvp_bg_first_capture` | 4908 | `20acfae447687abac5dec2164607feb84de6f5b58703bbdc1ab62ab31af98dd9` | 0.4207 | 54/48/54/48 | 0.4290 | 13/12/13/12 |
| `pvp_bg_first_win` | 4504 | `5574a47a9111cce9d5ab3ec65400f5420766d45fda9d3aad0a88ecf41fb141c3` | 0.4088 | 49/48/49/48 | 0.4175 | 12/12/12/12 |
| `pvp_bg_wins_25` | 4818 | `c25de03319438b3cdc7276ea46d9b92ccbe184fd4ff0d42c4b20f36f903ea335` | 0.4053 | 52/48/52/48 | 0.4127 | 13/12/13/12 |
| `pvp_bg_captures_100` | 5136 | `1750927f7e0aadd6563d999e52a3b7a566819b504fac397ae0b46ceb73dc9443` | 0.4240 | 51/48/51/48 | 0.4326 | 12/11/12/12 |
| `chr_drakemaw_broodlord` | 4908 | `6abe3f06924651f4e2a384d7041cb51374926a431f72c96f9f1f0a54bdde41d4` | 0.4014 | 54/48/55/48 | 0.4095 | 13/12/13/12 |
| `chr_maw_matriarch` | 4612 | `d6a6e08b24a3f4dd1f2ccf3c416e14bf04da4fd1400cc6c745366d099356e44c` | 0.4096 | 57/48/58/48 | 0.4177 | 14/12/14/12 |
| `dgn_rift` | 4832 | `556576dd8adb6d925d40a97bd0b4fca3cf16c22623532fb6d377a3d90efaa9be` | 0.4324 | 52/48/53/48 | 0.4402 | 13/12/13/12 |
| `dgn_rift_s_rank` | 5510 | `e165f1c8111ff9d7388613d4ee9c3855072aeac84803f1b0f0623f9c7b51a88b` | 0.4021 | 60/48/61/48 | 0.4100 | 15/12/15/12 |
| `prog_engineering_rare` | 5420 | `3dcb72be4f790fad01a74fb47bc68e42dc74af250f4632a526f0486cc6f1c43c` | 0.4431 | 51/48/51/48 | 0.4514 | 12/12/12/12 |
| `prog_alchemy_rare` | 4760 | `0659c89f67c2cdf3d284819a27df3b63560c5fd5d9fbe8b70133172e2f2bf206` | 0.4423 | 53/48/53/48 | 0.4504 | 13/12/13/12 |
| `prog_cooking_rare` | 5166 | `f73e805af5d2ba9bbe647506d6ea76047dc1328d3e667596af26bafdaf3afa15` | 0.4495 | 50/48/51/48 | 0.4580 | 12/12/12/12 |
| `prog_leatherworking_rare` | 4934 | `f146664c58200e650ee2133ab3107fe0a2cdb1a5fc996d91869d6e048d330ef8` | 0.4332 | 50/48/51/48 | 0.4415 | 12/12/12/12 |
| `prog_tailoring_rare` | 4794 | `e8380bb9000be25d8337136f7bbe29cb55bd875cc1f69b40e47e91c7bec35fc4` | 0.4328 | 50/48/51/48 | 0.4413 | 12/12/12/12 |
| `prog_weaponcrafting_rare` | 5212 | `d35ff61718d711c69c64fae67df9a26c18b6b9a6921a4e9ff91fc3d6c93a71d8` | 0.4691 | 51/48/51/48 | 0.4774 | 12/12/12/12 |
| `prog_armorcrafting_rare` | 5016 | `c9c93ab7acc9052db60a7efc3d253f9b540c5a25ae07cea687002efa81fd42cd` | 0.4389 | 48/48/48/49 | 0.4473 | 12/12/12/12 |

All source bounds centers are within 0.5 pixel of the 255.5 target. All shipping bounds centers are within 0.5 pixel of the 63.5 target.

## Exact prompt construction

The exact prompts are recorded below. Where a prompt names a shared suffix, the tool received the listed prefix, one newline, then the suffix verbatim.

### Shared suffix `PVP_SHARED`

```text
Style/medium: richly hand-painted fantasy game icon, classic MMORPG achievement art, compact storytelling, polished painterly bevels, crisp focal silhouette, no photorealism and no flat vector look
Composition/framing: one perfectly centered circular medallion, complete and fully visible, filling about 78 percent of the square; blackened bronze and steel body; antique-gold double rim; exactly four small symmetrical kite-shaped points at north, east, south, and west; generous even exterior padding; no crop
Lighting/mood: top-left warm rim light on aged metal, cool slate shadows, hard-earned battlefield triumph
Constraints: exterior background must be one perfectly uniform #FF00FF with no shadows, gradients, texture, reflections, floor plane, halo, or lighting variation; do not use magenta anywhere inside the medallion; preserve a hard clean silhouette for chroma removal; exactly four cardinal kite points and no additional spikes; all ornament stays within the medallion silhouette
Avoid: text, letters, numerals, runes that resemble letters, ribbons, title plates, extra badges, watermarks, logos, cast shadow, contact shadow, reflection, transparent-looking materials, cropped frame, off-center subject, modern graphic design, flat glyphs
```

### Shared suffix `CHRONICLE_RIFT_SHARED`

```text
Style/medium: richly hand-painted fantasy game icon, classic dark-fantasy MMORPG achievement art, compact storytelling, polished painterly bevels, crisp focal silhouette, no photorealism and no flat vector look
Composition/framing: one perfectly centered circular medallion, complete and fully visible, filling about 78 percent of the square; blackened bronze and steel body; antique-gold double rim; exactly four small symmetrical kite-shaped points at north, east, south, and west; centered large subject; generous even exterior padding; no crop
Lighting/mood: strong top-left focal light, deep jewel-toned shadows, storied and prestigious
Constraints: exterior background must be one perfectly uniform #FF00FF with no shadows, gradients, texture, reflections, floor plane, halo, or lighting variation; do not use magenta anywhere inside the medallion; preserve a hard clean silhouette for chroma removal; exactly four cardinal kite points and no additional spikes; all ornament stays within the medallion silhouette
Avoid: text, letters, numerals, readable runes, ribbons, title plates, extra badges, watermarks, logos, cast shadow, contact shadow, reflection outside, transparent-looking frame materials, cropped frame, off-center subject, modern graphic design, flat glyphs
```

### Shared suffix `PROFESSION_SHARED`

```text
Style/medium: richly hand-painted fantasy game icon, classic dark-fantasy MMORPG achievement art, compact storytelling, polished painterly bevels, crisp focal silhouette, no photorealism and no flat vector look
Composition/framing: one perfectly centered circular medallion, complete and fully visible, filling about 78 percent of the square; blackened bronze and steel body; antique-gold double rim; exactly four small symmetrical kite-shaped points at north, east, south, and west; centered large subject; generous even exterior padding; no crop
Lighting/mood: top-left workshop light, deep jewel-tone shadows, rare-craft prestige
Materials/textures: hammered blackened metal, aged gilding, painterly dark enamel, richly tactile craft materials
Constraints: exterior background must be one perfectly uniform #FF00FF with no shadows, gradients, texture, reflections, floor plane, halo, or lighting variation; do not use magenta anywhere inside the medallion; preserve a hard clean silhouette for chroma removal; exactly four cardinal kite points and no additional spikes; all ornament, sparks, steam, and glow stay within the medallion silhouette
Avoid: text, letters, numerals, readable runes, ribbons, title plates, extra badges, watermarks, logos, cast shadow, contact shadow, reflection outside, cropped frame, off-center subject, modern graphic design, flat glyphs
```

### `pvp_bg_first_capture`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted classic dark-fantasy MMORPG deed medallion for "Banner in Hand" (asset id pvp_bg_first_capture).
Input images: Image 1 is the exact World of ClaudeCraft deed frame, finish, brushwork, and small-size readability reference. Image 2 is a PvP palette and motif reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a strong mud-streaked iron gauntlet seizing a torn Thornhollow battleground banner at the cloth's gathered base; the banner folds upward behind the fist; thorny green vines and a subtle battlefield haze stay entirely inside the enamel inset
Style/medium: richly hand-painted fantasy game icon, classic MMORPG achievement art, compact storytelling, polished painterly bevels, crisp focal silhouette, no photorealism and no flat vector look
Composition/framing: one perfectly centered circular medallion, complete and fully visible, filling about 78 percent of the square; blackened bronze and steel body; antique-gold double rim; exactly four small symmetrical kite-shaped points at north, east, south, and west; dark forest-green enamel inset; fist and seized banner centered and large; generous even exterior padding; no crop
Lighting/mood: top-left warm rim light on aged metal, cool slate shadows, determined battlefield triumph
Color palette: thorn-hollow greens, weathered iron, muted umber mud, restrained antique gold, cold slate
Materials/textures: hammered blackened metal, worn gilding, torn woven banner cloth, scuffed iron gauntlet, painterly enamel
Constraints: exterior background must be one perfectly uniform #FF00FF with no shadows, gradients, texture, reflections, floor plane, halo, or lighting variation; do not use magenta anywhere inside the medallion; preserve a hard clean silhouette for chroma removal; exactly four cardinal kite points and no additional spikes; all ornament stays within the medallion silhouette
Avoid: text, letters, numerals, runes that resemble letters, ribbons, title plates, extra badges, watermarks, logos, cast shadow, contact shadow, reflection, transparent-looking materials, cropped frame, off-center subject, modern graphic design, flat glyphs
```

### `pvp_bg_first_win` prefix plus `PVP_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted classic dark-fantasy MMORPG deed medallion for "The Hollow Holds" (asset id pvp_bg_first_win).
Input images: Image 1 is the exact World of ClaudeCraft deed frame, finish, brushwork, and small-size readability reference. Image 2 is a PvP palette and motif reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one battered Thornhollow victory standard planted upright on a dark hollow field after battle, its thorn-green cloth catching a single dusk-gold beam; low broken palisades and slate hills remain subdued entirely inside the inset; the central banner must read as victorious without any writing or glyph
Color palette: deep thorn green, dusk gold, charcoal slate, weathered iron, restrained antique gold
Materials/textures: hammered blackened metal, worn gilding, heavy torn banner cloth, muddy field, painterly enamel
```

### `pvp_bg_wins_25` prefix plus `PVP_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted classic dark-fantasy MMORPG deed medallion for "Warden of the Hollow" (asset id pvp_bg_wins_25).
Input images: Image 1 is the exact World of ClaudeCraft deed frame, finish, brushwork, and small-size readability reference. Image 2 is a PvP palette and motif reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a stern closed warden helm mounted before a tall thorn-green banner staff, with a crescent fan of many small hammered victory studs and worn tally cuts worked into the staff as physical campaign marks; the helm and banner form one bold centered silhouette; communicate a seasoned battleground title visually, never with printed numbers
Color palette: forest green, dark steel, weathered leather, muted gold, cold slate
Materials/textures: hammered blackened metal, aged gilt, scratched steel helm, woven field banner, rough carved staff, painterly enamel
```

### `pvp_bg_captures_100` prefix plus `PVP_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted classic dark-fantasy MMORPG deed medallion for "A Hundred Banners" (asset id pvp_bg_captures_100).
Input images: Image 1 is the exact World of ClaudeCraft deed frame, finish, brushwork, and small-size readability reference. Image 2 is a PvP palette and motif reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one large heroic captured battle banner rising in the center, backed by a dense ceremonial fan of many small folded field pennants and spear shafts, suggesting a lifetime hoard of captured standards; keep the central banner dominant and the small flags simplified enough to read at icon size; communicate the vast tier visually without any printed number
Color palette: deep green and muted crimson pennants, blackened iron, burnished gold, cold slate shadows
Materials/textures: hammered blackened metal, antique gilding, layered worn cloth, dark wood shafts, painterly enamel
```

### `chr_drakemaw_broodlord` prefix plus `CHRONICLE_RIFT_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Clutch Breaker" (asset id chr_drakemaw_broodlord).
Input images: Image 1 is the exact World of ClaudeCraft chronicle deed frame, finish, brushwork, and small-size readability reference. Image 2 is a draconic mood reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one large pale dragon egg cracked wide in a blackened scorched nest, glowing ember light visible through the shell fracture; a broken curved broodlord horn lies diagonally across the egg and nest; keep egg, crack, horn, and ember as one bold readable central emblem
Color palette: ember orange, charred umber, bone ivory, cold slate, restrained antique gold
Materials/textures: cracked eggshell, burned woven nest, rough broken horn, hammered blackened metal, worn gilding, dark enamel
```

### `chr_maw_matriarch` prefix plus `CHRONICLE_RIFT_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "The Sky Goes Quiet" (asset id chr_maw_matriarch).
Input images: Image 1 is the exact World of ClaudeCraft chronicle deed frame, finish, brushwork, and small-size readability reference. Image 2 is a high-drama boss mood reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a vast dark dragon wing folding protectively and finally still over the curved rim of a volcanic crater roost; one tiny pale ash fleck descends through the open cold dusk sky; silhouette the broad wing strongly against the crater glow so it remains unmistakable when tiny; no dragon head and no living creature
Color palette: cold indigo dusk, charcoal wing membrane, ash gray, faint ember-red crater rim, restrained antique gold
Materials/textures: leathery folded wing membrane, jagged volcanic stone, ash haze inside the inset, hammered blackened metal, worn gilding
```

### `dgn_rift` prefix plus `CHRONICLE_RIFT_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Riftwalker" (asset id dgn_rift).
Input images: Image 1 is the exact World of ClaudeCraft dungeon deed frame, finish, brushwork, and small-size readability reference. Image 2 is a heroic dungeon lighting reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a torn vertical violet void portal held open by two broken halves of an ancient stone keystone, with one sturdy traveler's leather boot decisively stepping across the glowing threshold toward the viewer; the boot and split keystone dominate, the portal remains a bright narrow tear rather than a second circular frame
Color palette: deep violet, midnight blue, cold stone, weathered brown leather, restrained gold-white portal light
Materials/textures: cracked rune-free keystone stone, worn travel boot leather, painterly void energy, hammered blackened metal, antique gilding
```

### `dgn_rift_s_rank` prefix plus `CHRONICLE_RIFT_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Rift Sovereign" (asset id dgn_rift_s_rank).
Input images: Image 1 is the exact World of ClaudeCraft heroic dungeon deed frame, finish, brushwork, and small-size readability reference. Image 2 is a prestigious boss-deed lighting reference only. Do not copy either subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a majestic torn violet void portal held by an ornate split keystone, crowned at its apex by a small battered sovereign crown and anchored by a glowing faceted golden seal at the threshold; make this an unmistakably exalted evolution of Riftwalker through richer violet-gold energy and regal ornament, never through a letter or rank glyph
Color palette: royal violet, midnight indigo, old stone, radiant gold, restrained ivory highlights
Materials/textures: cracked ornate keystone, battered crown gold, faceted sovereign seal, painterly void energy, blackened metal frame, rich worn gilding
```

### `prog_engineering_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Precision Engineering" (asset id prog_engineering_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft engineering deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: two interlocking finely machined brass gears cradling one calibrated faceted sapphire-blue crystal, with a delicate brass divider caliper embracing the crystal and a single rare blue spark at the top; no dial faces and no marks resembling text
Color palette: aged brass, rare sapphire blue, blackened steel, soft cyan spark, restrained antique gold
```

### `prog_alchemy_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "A Rare Vintage" (asset id prog_alchemy_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft alchemy deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one elegant round-bellied rare potion vial sealed with deep red wax and a short wrapped cork, containing a luminous two-tone elixir divided in flowing sapphire-blue and warm amber layers; a subtle alchemist's lab glow behind it entirely within the dark inset; vial remains bold and mostly opaque-edged
Color palette: sapphire blue, warm amber, burgundy wax, smoke-gray glass highlights, restrained antique gold
```

### `prog_cooking_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "A Dish to Remember" (asset id prog_cooking_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft cooking deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a heroic plated feast centered on a dark ceramic platter: a glazed roast portion, golden root vegetables, bright green herb garnish, and one controlled curl of warm steam; present it like a master chef's memorable finished dish, simplified and bold for tiny size
Color palette: warm roast umber, hearth orange, golden vegetables, fresh herb green, dark ceramic, restrained antique gold
```

### `prog_leatherworking_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Fine Tanning" (asset id prog_leatherworking_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft leatherworking deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one beautifully finished deep-brown rare hide panel rolled slightly at its upper corner, edged with precise pale-gold saddle stitching and stamped with a simple embossed circular sunburst maker's brand, with a small curved leatherworking awl laid diagonally across the lower edge; no letters
Color palette: rich chestnut, oxblood shadow, pale-gold thread, blackened steel awl, restrained antique gold
```

### `prog_tailoring_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "A Master's Stitch" (asset id prog_tailoring_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft tailoring deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a sumptuous folded bolt of rare midnight-blue silk with a sweeping violet highlight, pierced diagonally by one elegant oversized gold sewing needle trailing a single controlled loop of luminous gold thread; the silk sheen, needle, and thread form one bold readable centered emblem
Color palette: midnight blue, royal violet, warm gold thread, cool pearl highlight, restrained antique gold
```

### `prog_weaponcrafting_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Tempered to a Shine" (asset id prog_weaponcrafting_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft weaponcrafting deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: one newly forged rare blue-steel sword blade laid diagonally across a compact black anvil, its polished edge catching a brilliant white gleam; a small quench trough below sends one curl of steam upward while forge-orange embers glow behind, all contained in the inset; no hands
Color palette: rare blue steel, forge orange, coal black, steam gray, restrained antique gold
```

### `prog_armorcrafting_rare` prefix plus `PROFESSION_SHARED`

```text
Use case: stylized-concept
Asset type: transparent game achievement deed icon master, designed to downscale cleanly to 128x128 and remain readable at 24 to 40 pixels
Primary request: Create a fresh, premium hand-painted deed medallion for "Plated to Perfection" (asset id prog_armorcrafting_rare).
Input images: Image 1 and Image 2 are the exact World of ClaudeCraft armorcrafting deed family references for frame, finish, palette, brushwork, and small-size readability. Create a distinct new subject.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior surrounding the medallion for local background removal
Subject: a masterfully finished rare plate cuirass displayed front-facing as a proud compact crest, with polished beveled pauldrons, cool blue-steel inlays, and a small simple hammer-strike maker mark shaped like a round dent at the breastbone; no letters; make the armor silhouette broad and immediately readable
Color palette: polished silver steel, rare sapphire-blue inlay, charcoal shadow, warm forge glint, restrained antique gold
```
