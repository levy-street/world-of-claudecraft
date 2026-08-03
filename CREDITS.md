# Asset Credits and Asset Licenses

**This file is the operative licence record for the project's media assets.**

The `LICENSE` file at the repository root is the MIT License, and it covers the
project's **source code**. It does not cover art, audio, fonts, or other media
assets. Every asset listed below is governed by the licence recorded against it
in these tables, and **that recorded licence controls over the project's MIT
license**.

**Media assets that are not listed here are not licensed to you by the MIT
License.** This register is still being completed, so an asset missing from it
means we have not recorded its terms yet, not that it is free to take. If you
want to use or redistribute something that is not listed, ask first
(tony@levystreet.com). Source code is the other way around: everything not
carved out here is MIT. Bundled third-party runtime dependencies carry their own
notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The **Redistribution** column tells you what you may do if you fork this
repository or redistribute a build of it:

| Value | What it means |
|---|---|
| `Yes` | Public domain or MIT-equivalent. Redistribute freely, commercially or not. |
| `Yes, attribution required` | Redistribute freely, but you must keep the credit and the licence notice. |
| `Yes, under SIL OFL 1.1` | Redistribute under the Open Font License. You may not sell the fonts on their own. |
| `With the project only` | Project-owned art you may keep and ship **as part of World of ClaudeCraft or a fork of it**, so your fork works out of the box. You may not extract these assets and redistribute, sell, or publish them on their own or as part of an asset pack. |
| `Non-commercial only, with attribution` | CC BY-NC 4.0. Share and adapt non-commercially with credit. **Commercial use requires the author's permission.** |
| **`No, permission required`** | **Do not redistribute.** Rights reserved, or licensed to Levy Street only. See below. |

## Do not redistribute these

If you fork this project, or redistribute the repository or a build of it, the
following assets are **not** yours to pass on. Remove or replace them first, or
get written permission.

- **The CraftPix class ability and curated item icons** (`public/ui/skills/<class>/*.webp`
  entries whose per-class `mapping.json` record names a CraftPix source pack and does not
  carry an overriding project-generated or owner-provided licence, plus
  `public/ui/items/*.webp` entries governed by the top-level CraftPix licence in
  `public/ui/items/mapping.json`). These were **purchased by the Levy Street account**
  (callum@levystreet.com) under a CraftPix premium royalty-free licence. That
  licence permits Levy Street to use them in this game. It does **not** permit
  you to redistribute, resell, sub-license, or otherwise pass them to a third
  party, and it does not transfer to forks. Treat CraftPix's own terms at
  https://craftpix.net/file-licenses/ as controlling, and buy your own licence
  if you want to ship these icons.
- **Commercial and prestige art owned by the project.** The Season 1 Armory
  weapon models and storefront renders, the Claudium visual asset set, the
  legacy Claudium prototype weapons, the Book of Deeds achievement icons, the
  Professions 2.0 art set, and the elite dragon rank emblem. These are commissioned
  or commercially produced art tied to the game, store, or player prestige, and
  **rights in them are reserved**. They are not covered by the MIT licence. Ask if
  you want to use them.
- **Artwork and recordings used with permission.** The Collective Reversal and
  Hourglass of Suspension mage icons, the `fireball_form` and `counterspell`
  mage artwork, and the `temporal_clock` sound effect. These are used in World
  of ClaudeCraft under a permission granted to Levy Street, which does not
  extend to third parties. **Redistribution requires permission, and must be
  arranged through Levy Street** (tony@levystreet.com).

The **@jamiecypher** sound effects are a separate case: they are CC BY-NC 4.0,
so you *may* redistribute them non-commercially with attribution, but you may
**not** use them commercially. The perpetual commercial grant covering them runs
to World of ClaudeCraft (Levy Street) only and does not transfer to forks. See
the Audio section.

The **brand marks** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) are
trademarks and are not licensed to anyone by this file. See Brand marks.

## Can I still fork and host my own world?

Yes. That is the point, and nothing above stops it.

The code is MIT, and the overwhelming majority of the world is CC0 public
domain: every KayKit, Quaternius, Kenney, ambientCG and Poly Haven pack, which
is most of the models, terrain and skies. You can do whatever you like with it.

The project's own generated props, creatures, backdrops and interface sounds are
marked `With the project only`: **keep them, ship them, run your world with
them.** They are there so a fork works out of the box. What you may not do is
lift them out and republish or sell them as standalone art.

The only assets you need to actually remove or replace are the ones marked
`No, permission required` above, plus the CC BY-NC audio if your fork is
commercial. Anything not listed in this register at all is unrecorded rather
than free, so ask before you rely on it.

## Models, textures, icons, and art

| Assets | Author | Source | License | Redistribution |
|---|---|---|---|---|
| Character models + animations (knight, mage, rogue, barbarian, hooded rogue), weapons/shields | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 | Yes |
| Skeleton character models + animations, bone weapons | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | CC0 1.0 | Yes |
| Dungeon modular kit (walls, floors, pillars, torches, banners, chests, furniture; also the Drakelands castle structure set) | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 1.0 | Yes |
| Graveyard/crypt props, dead trees, lanterns | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | CC0 1.0 | Yes |
| Extra character animation library (Rig_Medium) | Kay Lousberg (KayKit) | https://kaylousberg.itch.io/kaykit-character-animations | CC0 1.0 | Yes |
| Animated creatures (wolf, bull, fox, stag, alpaca, spider, frog, goblin, orc, yeti, giant, demon, ghost, goleling, glub, tribal, velociraptor, dragon) | Quaternius | https://poly.pizza/u/Quaternius · https://quaternius.com | CC0 1.0 | Yes |
| Stylized Nature MegaKit (trees, rocks, bushes, mushrooms, grass) | Quaternius | https://quaternius.itch.io/stylized-nature-megakit | CC0 1.0 | Yes |
| Medieval Village Pack (houses, inn, blacksmith, well, market, cart) | Quaternius | https://quaternius.com/packs/medievalvillage.html | CC0 1.0 | Yes |
| Fantasy Props MegaKit (barrels, crates, lanterns, furniture, smithy) | Quaternius | https://quaternius.itch.io/fantasy-props-megakit | CC0 1.0 | Yes |
| Nature Kit (modular cliffs), Graveyard Kit, Pirate Kit (docks/boats), Fantasy Town Kit, Castle Kit, Particle Pack (VFX sprites) | Kenney | https://kenney.nl | CC0 1.0 | Yes |
| Pirate Kit (palm trees, docks, ship, chests, cannon, anchor, beach rocks, beach house) | Quaternius | https://quaternius.com/packs/piratekit.html | CC0 1.0 | Yes |
| LowPoly Animated Fish (dolphin, shark, manta ray, whale, clownfish, blue tang, puffer, swordfish, anglerfish, koi) | Quaternius | https://poly.pizza/u/Quaternius | CC0 1.0 | Yes |
| Modular Dungeons Pack (stone walls, arches, pillar, floor tile, wall banner, trap door, horse statue, cobweb, coin piles) | Quaternius | https://poly.pizza/u/Quaternius | CC0 1.0 | Yes |
| Medieval Village MegaKit (wagon, crate, fences, vines, arch, exterior stairs) | Quaternius | https://quaternius.com/packs/medievalvillagemegakit.html | CC0 1.0 | Yes |
| Survival Kit (tents, bedrolls, campfires, signpost, sand rocks) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | Yes |
| Watercraft Kit (sail boats, fishing boat, rowboat, buoys) | Kenney | https://kenney.nl/assets/watercraft-kit | CC0 1.0 | Yes |
| Modular Dungeon Kit (corridor and room tiles, stairs, gates) | Kenney | https://kenney.nl/assets/modular-dungeon-kit | CC0 1.0 | Yes |
| Mini Dungeon (trap, wood structure, supports, column, banner) | Kenney | https://kenney.nl/assets/mini-dungeon | CC0 1.0 | Yes |
| Medieval Hexagon Pack (hex buildings, hex tiles, walls, bridge) | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | CC0 1.0 | Yes |
| Canyon Terrain Asset (cacti, desert tree, canyon rock formations, boulders, mesas) | loafbrr | https://loafbrr.itch.io/canyon-terrain-asset | CC0 1.0 | Yes |
| Mines and Cave Modular Set (mine carts, rails, ladder, cave rocks, entrances, supports, platforms) | loafbrr | https://loafbrr.itch.io/mines-and-cave-set | CC0 1.0 | Yes |
| Terrain PBR textures (Grass001, Ground023, Rock026, Rock051, Rock060, Ground071, Ground080, PavingStones046, Snow010A) | ambientCG | https://ambientcg.com | CC0 1.0 | Yes |
| Terrain PBR textures, biome set (Ground054, Ground095A, Ground093A, Rock029, Lava004, Gravel024, Rock035) | ambientCG | https://ambientcg.com | CC0 1.0 | Yes |
| Surface-detail PBR textures for the triplanar material families (Bark012, Bricks076A/B, Fabric030, Metal013 incl. Metalness, Plaster007; Color/NormalGL/AmbientOcclusion/Roughness/Displacement under `public/textures/structures/`) | ambientCG | https://ambientcg.com | CC0 1.0 | Yes |
| Canopy clump-detail textures (Moss002; NormalGL/AmbientOcclusion under `public/textures/foliage/`) | ambientCG | https://ambientcg.com | CC0 1.0 | Yes |
| Worn-metal surface-detail PBR texture (RustCoarse01, from rust_coarse_01; NormalGL/AmbientOcclusion/Roughness/Displacement under `public/textures/structures/`) | Poly Haven | https://polyhaven.com/a/rust_coarse_01 | CC0 1.0 | Yes |
| Medieval wood surface-detail PBR texture (MedievalWood, from medieval_wood; Color/NormalGL/AmbientOcclusion/Roughness/Displacement under `public/textures/structures/`) | Poly Haven | https://polyhaven.com/a/medieval_wood | CC0 1.0 | Yes |
| HDRI environment maps (kloofendal_48d_partly_cloudy_puresky, belfast_open_field, kiara_1_dawn, dikhololo_night) | Poly Haven | https://polyhaven.com | CC0 1.0 | Yes |
| Vale Cup practice-pitch skybox (env/space_galaxy.jpg, the 360 degree Milky Way panorama) | ESO / S. Brunier | https://www.eso.org/public/images/eso0932a/ | CC BY 4.0 | Yes, attribution required |
| Water normal maps (waternormals.jpg, Water_1/2_M_Normal.jpg) | three.js authors | https://github.com/mrdoob/three.js (r165, examples/textures) | MIT | Yes, attribution required |
| Basis Universal KTX2 transcoder (`public/basis/basis_transcoder.js`/`.wasm`, copied from three r165 `examples/jsm/libs/basis/`) | Binomial LLC | https://github.com/BinomialLLC/basis_universal | Apache-2.0 | Yes, attribution required |
| Biome backdrop panoramas (vale_backdrop.webp, marsh_backdrop.webp, peaks_backdrop.webp and 4K variants) | World of ClaudeCraft | Project-generated procedural painterly sky panorama art | Project asset | With the project only |
| Elite dragon rank emblem (`public/ui/ranks/elite-dragon-frame.webp`) | World of ClaudeCraft | Project-generated with OpenAI image generation and optimized locally | Project asset, rights reserved | **No, permission required** |
| Eastbrook Vale rebuild master concept, nine turnaround sheets, full-color surface-atlas source, and comparison evidence (`docs/screenshots/eastbrook-vale-rebuild/concepts/`, `turnarounds/`, and `materials/`) | World of ClaudeCraft | Original project art generated with OpenAI image generation using only World of ClaudeCraft captures and project-generated style/scale anchors; the full-color atlas source and any comparison containing it are provenance evidence, not the redistributable shipping texture; prompts and provenance are committed under `docs/design/eastbrook-vale-rebuild/` | Project asset, rights reserved | **No, permission required** |
| Eastbrook finishing-pass master concept and Ravenpost mailbox / noticeboard turnaround sheets (`docs/screenshots/eastbrook-vale-rebuild/polish/concepts/` and `polish/turnarounds/`) | World of ClaudeCraft | Original project art generated with OpenAI image generation using only accepted World of ClaudeCraft concepts, turnarounds, and in-game captures; no proprietary-game screenshots or third-party art entered the lineage; exact prompts, hashes, and provenance are committed under `docs/design/eastbrook-vale-rebuild/` | Project asset, rights reserved | **No, permission required** |
| Eastbrook shared surface atlas (`public/textures/eastbrook_surface_atlas.webp`; accepted source and comparison under `docs/screenshots/eastbrook-vale-rebuild/materials/`) | World of ClaudeCraft | Original project art generated with OpenAI image generation from first-party World of ClaudeCraft references, then deterministically converted to a high-key grayscale detail multiplier via `scripts/assets/eastbrook_town`; exact prompt and provenance are committed under `docs/design/eastbrook-vale-rebuild/` | Project asset | With the project only |
| Meshy creature models (tolling_bell, spider_egg_sac from the Drowned Litany, yumi_cat from Protect Yumi, in `public/models/creatures/`) | World of ClaudeCraft | Project-generated via Meshy AI (text-to-3D; the humanoids and yumi_cat rigged and animated), owned under the Meshy paid-plan license | Project asset | With the project only |
| Legacy Claudium prototype weapon models and source images (emberfang, Red Skull, and Purple sets, in `public/models/weapons/` and `public/ui/weapons/`) | World of ClaudeCraft | Project-generated and normalized through the PR 1405 asset pipeline | Project asset, rights reserved | **No, permission required** |
| Bag icons (`public/ui/items/{backpack,linen_pouch,travelers_knapsack,wolfhide_satchel,gravewoven_bag,mistcallers_duffel}.webp`, encoded to 128px WebP via `scripts/convert_item_icons_webp.mjs`) | World of ClaudeCraft | Project art created for this game; provenance per icon in `public/ui/items/mapping.json` | Project asset | With the project only |
| Curated item icons (`public/ui/items/*.webp`, limited to ordinary `entries` governed by the top-level licence in `public/ui/items/mapping.json`; excludes entries with an overriding licence and every ID in `generatedBatches`) | CraftPix | https://craftpix.net; exact source-pack mapping per icon in `public/ui/items/mapping.json` | CraftPix premium (royalty-free commercial), purchased by Levy Street account (callum@levystreet.com) | **No, permission required** |
| Professions 2.0 art set (`public/ui/professions/*.webp`, the `woc_professions_art` material icons recorded in `public/ui/items/mapping.json`, and the inline maker's-mark glyph in `src/ui/ui_icons.ts`) | World of ClaudeCraft | Maintainer-commissioned original art created for this game and normalized through the profession/item pipelines; provenance per raster in the corresponding mapping file | Project asset, rights reserved | **No, permission required** |
| Generated item icon rebrand (`public/ui/items/*.webp`, exact IDs under `generatedBatches` in `public/ui/items/mapping.json`, including `silkspun_satchel` and `last_keep_signet`) | World of ClaudeCraft | Project-generated with OpenAI built-in image generation, reviewed and optimized locally; licensed CraftPix Premium references retain their third-party lineage in the mapping, and the release v0.34.0 additions are prompt-and-hash pinned in `docs/achievements/release-v034-additional-art.json` | Project asset, rights reserved | **No, permission required** |
| Class ability icons (`public/ui/skills/<class>/*.webp`, excluding entries with an explicit project-generated or owner-provided licence in the per-class mapping; re-encoded from the source-pack PNGs to WebP via `scripts/convert_skill_icons_webp.mjs`; all 9 classes: paladin, hunter, priest, warlock, rogue, warrior, mage, druid, shaman; source packs paladin/archer/priest/warlock/thief/warrior/berserker/demon/druid/pyromancer/cryomancer/aeromancer/lightning-mage/earth-magician/100-rpg-skill-icons/100-skill-icons-pack-for-rpg + per-ability fill sets) | CraftPix | https://craftpix.net | CraftPix premium (royalty-free commercial), purchased by Levy Street account (callum@levystreet.com) | **No, permission required** |
| Generated class ability additions (`public/ui/skills/<class>/*.webp`, exact `woc_openai_missing_painted_icons_2026_08_01` and `woc_openai_release_v034_audit_2026_08_02` entries in each class's `mapping.json`) | World of ClaudeCraft | Project-generated with OpenAI built-in image generation from the exact repository references recorded per ability; reviewed, normalized, and optimized locally; prompt, reference-role, source-hash, and shipping-hash records in `docs/achievements/missing-painted-icons-accepted-art.json` and `docs/achievements/release-v034-additional-art.json` | Project asset, rights reserved | **No, permission required** |
| Collective Reversal and Hourglass of Suspension ability icons (`public/ui/skills/mage/collective_reversal.webp`, `public/ui/skills/mage/temporal_hourglass.webp`) | World of ClaudeCraft project owner | Owner-provided original artwork | Used with permission (Levy Street) | **No, permission required** |
| Season 1 Armory weapon models, source images, generated store thumbnails, and promotional card (Guildmark, Emberwrought, Hoarfrost, and Fallen Star collections, in `public/models/weapons/`, `public/ui/weapons/`, and `public/ui/store/`) | World of ClaudeCraft | Project-generated via `scripts/asset_pipeline` (Tripo AI 3D); storefront renders composited locally, with the text-free promo background derived through OpenAI image editing | Project asset, rights reserved | **No, permission required** |
| Tripo3d vegetation prop models (`public/models/props/reeds.glb`) | World of ClaudeCraft | Project-generated via Tripo3d (text-to-3D), owned under the Tripo3d paid-plan license | Project asset, rights reserved | **No, permission required** |
| Claudium visual asset set (`public/claudium/`: coin, UI icons, and denomination stacks; excludes the two payment-rail brand icons noted under Brand marks) | World of ClaudeCraft | Project-generated via the Higgsfield MCP connector (Recraft V4.1 stills), composited and web-optimized locally; owned under the Higgsfield paid-plan license | Project asset, rights reserved | **No, permission required** |
| Sampled interface and event sound effects (`public/audio/sfx/ui_*.mp3`, except `ui_level_up.mp3` and `ui_achievement.mp3`, credited under Audio below) | World of ClaudeCraft | Project-generated deterministic FFmpeg synthesis via `scripts/gen_ui_sfx.mjs` | Project asset | With the project only |
| Book of Deeds achievement icons (`public/ui/deeds/*.webp`, excluding the fourteen generated additions listed next; downscaled from reviewed 512px sources to 128px WebP via `scripts/convert_deed_icons_webp.mjs`) | World of ClaudeCraft | Maintainer-commissioned bespoke art, owned by the project | Project asset, rights reserved | **No, permission required** |
| Generated Book of Deeds additions (`chr_peaks_gatherer`, `chr_marsh_rares_ii`, `chr_peaks_rares_ii`, `chr_gleamstag`, `chr_hollow_rares`, `dgn_wildheart_basin`, `dgn_wildheart_basin_heroic`, `pvp_card_duel_first_win`, `chr_willowfen_gatherer`, `chr_willowfen_first_cast`, `chr_galecrest_gatherer`, `chr_galecrest_first_cast`, `chr_farshore_gatherer`, and `chr_farshore_first_cast` under `public/ui/deeds/`) | World of ClaudeCraft | Project-generated with OpenAI built-in image generation from the exact project-owned, project-generated, commissioned, and licensed CraftPix Premium repository references recorded for each crest; the earlier five used the licensed `grubjaw_tusk` and `old_cragmaws_pelt` references and retain their lineage record in `docs/achievements/professions-tuning-art-provenance.md`, the wave three are prompt-and-hash pinned in `docs/achievements/missing-painted-icons-accepted-art.json`, and the six phase 20 crests are prompt-and-hash pinned in `docs/achievements/release-v034-additional-art.json`; all were reviewed, keyed, centered, and optimized locally | Project asset, rights reserved | **No, permission required** |
| HUD chrome launcher icons (`public/ui/chrome/*.webp`, one per primary destination in the side rail and mobile bar, keyed to alpha and normalized to 128px WebP via `scripts/convert_chrome_icons_webp.mjs`) | World of ClaudeCraft | Project-generated with Google Gemini image generation to one authored art direction, keyed and optimized locally; provenance per icon in `public/ui/chrome/mapping.json` | Project asset, rights reserved | **No, permission required** |
| World-map continent overview plate (`public/map_art/world_overview.webp`, the painted backdrop of the interactive world map's continent level) | World of ClaudeCraft | Project-generated with Google Gemini image generation (terrain-only top-down key art, no baked text), cropped to the continent's land bounds so the plate rect equals the world bounds, and optimized to WebP locally | Project asset, rights reserved | **No, permission required** |
| Guide webfonts (`public/fonts/*.woff2`: Cinzel by Natanael Gama; Alegreya and Alegreya Sans by Juan Pablo del Peral, Huerta Tipografica; woff2 subsets latin/latin-ext/cyrillic/vietnamese as served by Google Fonts, self-hosted for the /wiki guide) | Natanael Gama; Huerta Tipografica | https://fonts.google.com/specimen/Cinzel , https://fonts.google.com/specimen/Alegreya , https://fonts.google.com/specimen/Alegreya+Sans | SIL OFL 1.1 | Yes, under SIL OFL 1.1 |
| Owner-provided Mage artwork (`fireball_form.webp`, `counterspell.webp`) | Levy Street account | Owner-provided artwork | Used with permission (Levy Street) | **No, permission required** |
| Temporal clock sound effect (`public/audio/sfx/temporal_clock.mp3`) | World of ClaudeCraft | User-provided source recording | Used with permission (Levy Street) | **No, permission required** |
| Remastered streamed soundtrack (`public/audio/music/*.mp3`: town, overworld, dungeon, and battle themes) | World of ClaudeCraft | Existing themes were rendered from the project's procedural score (`scripts/render_music.mjs`) and remastered; the new-world remasters are owner-provided Suno Studio exports | Project asset | With the project only |

| Rideable mount models (valorsteed, grag_bear, stalkglider_snail, aether_hover_cycle, shadowjump_toad, stormfeather_griffin, in `public/models/mounts/`) | World of ClaudeCraft | Project-generated via the Tripo API asset pipeline (scripts/asset_pipeline; the quadrupeds auto-rigged, gait clips baked locally via scripts/bake_mount_gaits.mjs), owned under the Tripo paid-plan license | Project asset | With the project only |
| Terrorspark Groundshaker rideable mount model and item icon (`public/models/mounts/terrorspark_groundshaker.glb`, `public/ui/items/reins_terrorspark_groundshaker.webp`) | World of ClaudeCraft | Original project art procedurally reconstructed from a user-supplied concept without redistributing source pixels; deterministic source, design boundary, and provenance are committed under `scripts/assets/terrorspark_groundshaker/` and `docs/design/terrorspark-groundshaker/` | Project asset, rights reserved | **No, permission required** |
| Rift dimensional gate model (`public/models/props/rift_portal.glb`) | World of ClaudeCraft | Project-generated via Meshy AI (text-to-3D), owned under the Meshy paid-plan license | Project asset | With the project only |
| Rift arcane flame + rune monolith props (`public/models/props/rift_flame.glb`, `rift_rune.glb`) | World of ClaudeCraft | Project-generated via Tripo AI (text-to-3D), owned under the Tripo paid-plan license | Project asset | With the project only |
| Realm sky HDRIs (hollow_dusk, ember_storm, frost_twilight, amber_sunset, fen_day, nightbloom_dream, wraithwood_gloom; 2k and 1k) | World of ClaudeCraft | Project-generated equirect sky panoramas, converted to RGBE with HDR sun re-injection | Project asset | With the project only |
| Zone map overlays (`public/map_art/*.png`) | World of ClaudeCraft | Project-generated painterly map overlay art derived from local zone reference plates | Project asset | With the project only |
| Infernal Citadel props (`public/models/props/infernal_brazier.glb`, `infernal_altar.glb`, `demon_idol.glb`, `hell_forge.glb`, `hanging_cage.glb`, `bone_pile.glb`, `obsidian_fang.glb`, `infernal_statue.glb`, `slag_cauldron.glb`, `bone_throne.glb`) | World of ClaudeCraft | Project-generated via `scripts/asset_pipeline` (Tripo AI text-to-3D), owned under the Tripo paid-plan license | Project asset | With the project only |
| Generated class skin-suit set "Prismatic Vanguard" (suit_prismatic, all classes, `public/textures/skins/<class>/alt_suit_prismatic.png`) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (procedural gradient-map atlas) | Project asset | With the project only |
| Generated class skin-suit set "Liquid Chrome" (suit_chrome, all classes, `public/textures/skins/<class>/alt_suit_chrome.png`) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (procedural gradient-map atlas) | Project asset | With the project only |
## Brand marks

The four streamer-platform marks inlined as SVG paths in `src/ui/ui_icons.ts`
(Twitch, X, Kick, YouTube) are the trademarks of their respective platforms,
reproduced monochrome and unmodified in shape solely to identify a link that
points at that platform. They are not project assets, and no endorsement or
affiliation is implied. The Discord (Clyde) mark in the same file is used the
same way.

The Solana and USDC logos shipped as `public/claudium/icons/solana-icon.webp`
and `public/claudium/icons/usdc-icon.webp` are trademarks of their respective
owners, reproduced unmodified solely to identify the corresponding payment
rail in the Claudium buy window (`src/ui/claudium_window.ts`). They are not
project assets, and no endorsement or affiliation is implied.

None of these marks are licensed to you by this file or by the project's MIT
license. Trademark law, not copyright licensing, governs their use. The same
applies to the "World of ClaudeCraft" and "Levy Street" names, logos, and
branding.

## Audio

All sampled sound effects credited to @jamiecypher below (`public/audio/sfx/`)
are original recordings and sound design, reworked using original sounds and
licensed source material from EastWest Composer Cloud, Epic Stock Media, and
Freesound.org (CC0). @jamiecypher retains copyright and publishes this work
under CC BY-NC 4.0 (Creative Commons Attribution-NonCommercial 4.0
International): free to use and share non-commercially with attribution.
@jamiecypher separately grants World of ClaudeCraft (Levy Street) a
perpetual, royalty-free license to use these assets commercially, including
in official releases and the Claudium store.

**That commercial grant is to Levy Street and does not transfer with a fork.**
If you redistribute these sounds you must credit @jamiecypher and keep the use
non-commercial. For commercial use, arrange your own licence with the author.

| Assets | Author | Source | License | Redistribution |
|---|---|---|---|---|
| Remaining generated world, interface, event, and ambience sound effects not attributed below (`public/audio/sfx/*.mp3`, excluding `quest_*.mp3` and `mount_*.mp3`) | World of ClaudeCraft | Project-generated with the ElevenLabs Sound Effects API from `scripts/sfx/sfx_prompts.mjs` or deterministic FFmpeg synthesis via `scripts/gen_ui_sfx.mjs` | Project asset | With the project only |
| Valorsteed gallop layer (`mount_run_valorsteed.mp3`) | D4XX, adapted by congusbongus | [Horse gallop on different surfaces](https://opengameart.org/content/horse-gallop-on-different-surfaces), individual `ground.mp3` source identified as CC0 in the included credits | CC0 1.0 | Yes |
| Mount footfall layers (`mount_run_grag_bear.mp3`, `mount_run_shadowjump_toad.mp3`, `mount_run_stormfeather_griffin.mp3`, `mount_run_thunderstrut_gobbler.mp3`) | Fantozzi, extracted by qubodup | [Fantozzi's Footsteps](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone) | CC0 1.0 | Yes |
| Stalk-Glider slime layer (`mount_run_stalkglider_snail.mp3`) | RandomUser | [Slime ultimate the best](https://opengameart.org/content/slime-ultimate-the-best) | CC0 1.0 | Yes |
| Shadow-Jump Toad slime layer (`mount_run_shadowjump_toad.mp3`) | KobatoGames | [Slime jump effect](https://opengameart.org/content/slime-jump-effect) | CC0 1.0 | Yes |
| Hover-Cycle movement layer (`mount_run_aether_hover_cycle.mp3`) | Umplix | [Hovermobile SFX](https://opengameart.org/content/hovermobile-sfx) | CC0 1.0 | Yes |
| Stormfeather and Grand Gobbler wing layers (`mount_run_stormfeather_griffin.mp3`, `mount_run_thunderstrut_gobbler.mp3`) | AntumDeluge, derived from dave.des | [Large Wings Flap](https://opengameart.org/content/large-wings-flap) | CC0 1.0 | Yes |
| Terrorspark Groundshaker movement layer (`mount_run_terrorspark_groundshaker.mp3`) | World of ClaudeCraft | Original deterministic FFmpeg synthesis via `scripts/gen_terrorspark_groundshaker_sfx.mjs` | Project asset | With the project only |
| Quest event sounds (`quest_accept`, `quest_ready`, `quest_complete`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Lockpick minigame sounds (`lockpick_*`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Wand auto-attack sounds (`wand_*`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Level-up and Book of Deeds achievement chimes (`ui_level_up`, `ui_achievement`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Magic-school impact and casting-support one-shots (`impact_*`, `heal_impact`, `buff_apply`, `debuff_apply`, `spell_nova`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Magic-school projectile launches (`proj_*`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Melee, footstep, movement, combat-reaction, and player-state sounds (`melee_*`, `foot_*`, `move_*`, `combat_*`, `player_death*`, `player_hurt*`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |
| Creature vocalizations, every mob family (`mob_*`) | @jamiecypher | Original work | CC BY-NC 4.0 (+ perpetual commercial grant to World of ClaudeCraft) | Non-commercial only, with attribution |

## Generated prop and creature models

| Assets | Author | Source | License | Redistribution |
|---|---|---|---|---|
| Generated prop model (marsh_plank_bridge) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_shrine_fragment) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_corpse_candle) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_bell_gallows) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_sluice_post) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_dead_tree) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_reed_cluster) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (yumi_brazier_stand) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (yumi_torch_handle) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (dungeon_door_arch) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (crypt_ritual_circle) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_module_exit) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_surface_exit) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_rite_shrine_bell) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_rite_shrine_candle) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_rite_shrine_reed) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_rite_shrine_skull) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (delve_pressure_plate) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (marsh_root_wall) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated creature model + animations (training_dummy) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated prop model (engineering_workbench) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (alchemy_cauldron) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (cooking_spit) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (leatherworking_rack) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (tailoring_loom) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (inscription_lectern) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (enchanting_altar) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (jewelcrafting_bench) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Great Maze prop models (`public/models/props/maze_hedge_wall.glb`, `maze_hedge_arch.glb`, `leafy_fox_statue.glb`) | World of ClaudeCraft | Maintainer-authored generated models, optimized via `scripts/assets/specs/evergarden_maze.json` | Project asset | With the project only |
| Evergarden flower bed models (`public/models/props/flower_bed_square_a.glb`, `flower_bed_square_b.glb`, `flower_bed_round.glb`) | World of ClaudeCraft | Maintainer-authored generated models, optimized via `scripts/assets/specs/evergarden_beds.json` | Project asset | With the project only |
| Galecrest monument models (`public/models/props/ship_monument.glb`, `golden_horse_statue.glb`) | World of ClaudeCraft | Maintainer-authored generated models, optimized via `scripts/assets/specs/gale_statues.json` | Project asset | With the project only |
| Generated prop model (mining_ore_cart) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (herbalism_drying_rack) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (banker_chest) | World of ClaudeCraft | Project-generated via the img2threejs workflow and `scripts/assets/banker_chest` from a user-provided concept reference; reference not redistributed | Project asset | With the project only |
| Generated landmark model (eastbrook_grand_armoury) | World of ClaudeCraft | Original procedural Three.js model produced via the img2threejs workflow and `scripts/assets/eastbrook_grand_armoury`, inspired by a user-provided scene reference; reference not redistributed | Project asset | With the project only |
| Generated Eastbrook town kit (`eastbrook_bank`, `eastbrook_smithy`, `eastbrook_inn`, `eastbrook_chapel`, `eastbrook_weaving_workshop`, `eastbrook_toolworks`, `eastbrook_civic_well_beacon`, `eastbrook_market_stall`, `eastbrook_wall_wing`) | World of ClaudeCraft | Original deterministic procedural Three.js models produced via the img2threejs workflow and `scripts/assets/eastbrook_town` from the project-generated Eastbrook turnaround sheets | Project asset | With the project only |
| Generated Eastbrook Ravenpost mailbox (`mailbox_pillar`) | World of ClaudeCraft | Original deterministic procedural Three.js model produced via the img2threejs workflow and `scripts/assets/eastbrook_mailbox` from the project-generated finishing-pass turnaround; replaces the historical Tripo mailbox while preserving its stable runtime path and gameplay contract | Project asset | With the project only |
| Generated Eastbrook public noticeboard (`eastbrook_noticeboard`) | World of ClaudeCraft | Original deterministic procedural Three.js model produced via the img2threejs workflow and `scripts/assets/eastbrook_noticeboard` from the project-generated finishing-pass turnaround; blank notice shapes contain no readable or proprietary text | Project asset | With the project only |

| Generated prop model (wildheart_jaguar_gate) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_ritual_pyramid) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_canopy_platform) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_rope_bridge) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_beast_den) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_mask_totem) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated creature model + animations (wildheart_ravager) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated creature model + animations (wildheart_hexcaller) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated creature model + animations (wildheart_beastmaster) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated creature model + animations (wildheart_high_priest) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated prop model (wildheart_limestone_cliff) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated creature model + animations (wildheart_stalker) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D, auto-rig + preset retargets) | Project asset | With the project only |
| Generated prop model (wildheart_giant_fern) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_ancestor_ruin) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
| Generated prop model (wildheart_jungle_canopy_tree) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |
Assets were optimized for shipping (animation clip pruning, meshopt compression,
texture resizing) via `scripts/assets/build_assets.mjs`; raw packs are not
committed.

License texts: https://creativecommons.org/publicdomain/zero/1.0/ (CC0 1.0) ,
https://creativecommons.org/licenses/by/4.0/ (CC BY 4.0) ,
https://creativecommons.org/licenses/by-nc/4.0/ (CC BY-NC 4.0) ,
https://openfontlicense.org/ (SIL OFL 1.1) ,
https://github.com/mrdoob/three.js/blob/r165/LICENSE (three.js MIT) , and
https://craftpix.net/file-licenses/ (CraftPix).

The KayKit packs ship their own CC0 readme, kept at
`third_party/licenses/kaykit-cc0.txt`. It is an asset pack notice, not a project
licence; the only licence file at the repository root is `LICENSE`, which is the
MIT License covering the source code.

If you are unsure whether you may use an asset, or you want permission for
something this file marks as restricted, ask first: tony@levystreet.com.
