# Map Marker Art V2 Accepted Batch

Status: historical accepted-art and audit record
Batch: `woc-map-marker-art-v2`
Date: 2026-08-12
Generator: OpenAI built-in image generation

This record owns the second painted micro-icon pass shared by the World of ClaudeCraft map
and minimap. It preserves the complete v1 lineage in
`docs/achievements/map-marker-art-2026-08-12.md`, records every new accepted source and exact
prompt, and describes the responsive and state-aware runtime contract. The machine-readable
inventory and current shipping hashes live in `public/ui/map-markers/mapping.json`.

## Accepted outcome

V2 keeps the strong v1 dungeon entrance, ore, and herb paintings. It replaces ten paintings
whose subject mass, contrast, or silhouette weakened at actual marker scale, adds four painted
quest states, and introduces eleven truthful navigation and reward identities for delves, rifts,
the Duskfall world passage, and their treasure. The result is a twenty-eight-file, 62,866-byte
family of 64 by 64 sRGB WebPs with alpha.

The quest family no longer relies on canvas text. Available, turn-in ready, repeatable, and
cooldown each have a distinct painted silhouette plus punctuation. Neutral NPCs deliberately
remain a quieter procedural hollow ring so they cannot be mistaken for actionable quests.

Gathering availability remains live state. A ready node uses its full-color identity. A node on
cooldown uses a smaller grayscale identity inside a broken 300 degree neutral ring. A missing
profession tool adds a bronze padlock independently, so ready plus locked and cooldown plus
locked remain truthful combinations. No state uses opacity or hue as its only cue, and no
diagonal depletion slash remains.

## Current shipping inventory

| Art id                | Shipping file              | Lineage            | Bytes |
| --------------------- | -------------------------- | ------------------ | ----: |
| `dungeon-entrance`    | `dungeon_entrance.webp`    | Retained v1 source | 2,584 |
| `dungeon-exit`        | `dungeon_exit.webp`        | V2 redesign        | 2,372 |
| `gather-ore`          | `gather_ore.webp`          | Retained v1 source | 1,838 |
| `gather-wood`         | `gather_wood.webp`         | V2 refinement      | 2,696 |
| `gather-herb`         | `gather_herb.webp`         | Retained v1 source | 2,120 |
| `station-forge`       | `station_forge.webp`       | V2 refinement      | 1,662 |
| `station-kitchens`    | `station_kitchens.webp`    | V2 redesign        | 2,114 |
| `station-apothecary`  | `station_apothecary.webp`  | V2 refinement      | 2,008 |
| `station-tannery`     | `station_tannery.webp`     | V2 refinement      | 1,942 |
| `station-loom`        | `station_loom.webp`        | V2 redesign        | 2,556 |
| `station-toolworks`   | `station_toolworks.webp`   | V2 redesign        | 2,822 |
| `service-mailbox`     | `service_mailbox.webp`     | V2 redesign        | 1,460 |
| `service-noticeboard` | `service_noticeboard.webp` | V2 redesign        | 1,228 |
| `quest-available`     | `quest_available.webp`     | V2 addition        | 2,598 |
| `quest-ready`         | `quest_ready.webp`         | V2 addition        | 2,648 |
| `quest-repeat`        | `quest_repeat.webp`        | V2 addition        | 3,086 |
| `quest-cooldown`      | `quest_cooldown.webp`      | V2 addition        | 2,048 |
| `delve-entrance`      | `delve_entrance.webp`      | V2 addition        | 2,312 |
| `delve-passage`       | `delve_passage.webp`       | V2 addition        | 2,170 |
| `delve-surface-exit`  | `delve_surface_exit.webp`  | V2 addition        | 2,248 |
| `rift-entrance`       | `rift_entrance.webp`       | V2 addition        | 1,828 |
| `rift-descent`        | `rift_descent.webp`        | V2 addition        | 2,250 |
| `rift-beacon`         | `rift_beacon.webp`         | V2 addition        | 2,186 |
| `rift-egress`         | `rift_egress.webp`         | V2 addition        | 2,880 |
| `reward-treasure`     | `reward_treasure.webp`     | V2 addition        | 2,442 |
| `reward-locked-cache` | `reward_locked_cache.webp` | V2 addition        | 2,330 |
| `reward-reliquary`    | `reward_reliquary.webp`    | V2 addition        | 2,016 |
| `world-passage`       | `world_passage.webp`       | V2 addition        | 2,422 |

The retained v1 sources, exact prompts, ordered references, source hashes, and processing remain
unchanged in the v1 record. Their current source and shipping hashes are also repeated in
`mapping.json`, so the complete shipping inventory is auditable from one manifest without
rewriting the historical prompt record.

## Responsive runtime sizes

The 64px files are compact decode masters. One HUD-owned loader decodes each master once and
pre-rasterizes only the exact standard and compact variants used by the painters.

| Family and state   | Standard minimap / map | Compact minimap / map |
| ------------------ | ---------------------: | --------------------: |
| Gathering ready    |                18 / 20 |               24 / 28 |
| Gathering cooldown |                16 / 18 |               22 / 26 |
| Dungeon            |                18 / 20 |               24 / 30 |
| Station            |                16 / 20 |               22 / 28 |
| Civic service      |                16 / 20 |               22 / 28 |
| Quest actionable   |                20 / 24 |               26 / 32 |
| Quest cooldown     |                16 / 18 |               22 / 26 |
| Navigation         |                18 / 22 |               24 / 30 |
| Reward             |                18 / 20 |               24 / 28 |

Standard serves desktop and standard touch portrait. Compact serves touch landscape and the
explicit compact HUD, where the fixed minimap canvas is visually reduced by UI scaling. The
profile is selected once per redraw from existing HUD classes. Marker loops perform cached
`drawImage` blits without layout reads, canvas filters, text drawing, or image allocation.

The loader owns the light terrain-separating keyline and all systematic state rasterization.
Gathering variants cover ready, cooldown, tool-locked, and cooldown plus tool-locked. Passage
variants add a bronze seal lock. Ranked rift entrances and egresses add dark under-rings, tier
color, and one to four top notches for C through S. The S tier also adds a bottom diamond, so
rank never depends on hue alone. Reward
variants cover available, locked, active, opened, jammed, and bountiful. Opened and jammed use
grayscale identity plus a check or cross, active adds a contained ring, locked adds a padlock,
and bountiful adds corner points. These overlays are cached during load, not drawn per frame.

Painters own ready glow, labels, hover and hit state, stacking, clipping, tracking emphasis, and
dynamic markers such as players, parties, enemies, loot, corpses, battleground objectives, and
off-map direction. This separation keeps live gameplay state truthful and bounded.

## Processing and review

All new accepted sources are 1254 by 1254 PNG results generated separately against a flat
`#FF00FF` exterior. The six broad redesigns use the explicit intended key with the imagegen
chroma helper, soft matte, transparent threshold 40, opaque threshold 112, edge contraction 1,
despill, and forced overwrite. The four material refinements use border auto-keying, soft matte,
thresholds 12 and 220, despill, and forced overwrite. Quest sources use the same reviewed
chroma-removal and despill workflow. The rift, delve, reward, and Duskfall sources use the
explicit key, soft matte, thresholds 40 and 112, edge contraction 1, and despill.

Every visible subject is cropped at alpha 16, fitted into a 60 by 60 content box with Lanczos3,
centered inside a 64 by 64 transparent canvas, and encoded as WebP with quality 88, alpha quality
100, and effort 6. All accepted results retain a fully transparent two-pixel perimeter and zero
detected magenta-fringe pixels.

Ignored review artifacts under `tmp/imagegen/map-marker-v2/` compare exact 10, 12, 14, 16, 18,
20, 22, and 24 pixel draws on dark and light terrain, plus nearest-neighbor enlarged inspection
sheets and objective alpha, coverage, luma, contrast, and byte measurements. The non-quest
redesigns increased encoded size by 444 bytes while preserving the same decoded master footprint.
The four refinements increased encoded size by 46 bytes. The ten rift, delve, and reward masters
total 22,662 bytes and decode to 163,840 bytes before exact-size caching. The Duskfall master adds
2,422 shipping bytes. The generated neutral NPC candidate was reviewed but not admitted because
the quieter procedural hollow ring better preserves hierarchy.

The rift, delve, and reward subtype gate required reliable identity on both dark and light map
fields. Delve entrance, rift egress, and locked cache require at least 18px; the other seven
masters remain subtype-readable at 16px. Their standard runtime targets therefore meet or exceed
the reviewed floor. The Duskfall passage has a 60 by 50 visible alpha box, 52.83 percent opaque
coverage, a transparent perimeter, and zero detected magenta fringe pixels. Its crystal, root,
arch, and inner seam remain readable at the 18px standard navigation target.

## Accepted source ledger

The exact generated-result path, source SHA-256, prompt SHA-256, shipping SHA-256, and byte count
for every current art id are machine-readable in `public/ui/map-markers/mapping.json`. The V2
accepted generated results are:

| Art id                | Built-in generated result                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `dungeon-exit`        | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-11294a75-d897-4b77-a43a-06c1c2e8c432.png` |
| `gather-wood`         | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-b2af013f-5f4f-4f58-8e94-f972b52e28b4.png` |
| `station-forge`       | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-baa6fe33-20ba-4d04-9e29-fb42dcd21b56.png` |
| `station-kitchens`    | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-228c3899-f906-45c8-a967-1242a55f8bc9.png` |
| `station-apothecary`  | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-44db18e2-7e53-485d-9948-749a20188edd.png` |
| `station-tannery`     | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-f8562d92-f0a3-4e1e-8388-a3030b7e9d1c.png` |
| `station-loom`        | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-70b74ab3-3bc5-43ea-8955-065ef53bc522.png` |
| `station-toolworks`   | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-846df831-19c2-4275-973d-91be90735d82.png` |
| `service-mailbox`     | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-3a9f6781-50cb-46fe-9113-aacf945502c1.png` |
| `service-noticeboard` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-64b1a6cc-8be9-4f81-8cd0-312e79554ee2.png` |
| `quest-available`     | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-cd6910e3-baf1-42ef-91a9-eb318383191e.png` |
| `quest-ready`         | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-f22333b8-9ab5-4614-8453-2574622d1682.png` |
| `quest-repeat`        | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-73631cdf-7468-4379-82c6-7396353f2573.png` |
| `quest-cooldown`      | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-15fb1595-df58-465b-a8f7-acb56f45ae36.png` |
| `delve-entrance`      | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-df9682d1-275d-4caf-a96a-bda92f6e435a.png` |
| `delve-passage`       | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-85ec7217-1fa4-4380-8722-e0fae7f08839.png` |
| `delve-surface-exit`  | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-604953f0-1875-44bf-9cc3-c6db32d665e5.png` |
| `rift-entrance`       | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-b3bb698b-243d-4f26-9ba7-a524bbe318ca.png` |
| `rift-descent`        | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-e7904717-e0bd-40f1-9c24-c233cfc6ba1f.png` |
| `rift-beacon`         | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-c8e61dde-dc88-45f2-9d96-502327c1d959.png` |
| `rift-egress`         | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-1ae879ea-3ed6-449d-b7b5-e0b07bad38c0.png` |
| `reward-treasure`     | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-218d0d18-c1cc-4204-8d22-553cdf3481f2.png` |
| `reward-locked-cache` | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-9dd7ab59-c04b-45b3-835d-13e933f6045f.png` |
| `reward-reliquary`    | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-f4c3b0e2-ea5c-41a9-ac69-2c996b2e31b2.png` |
| `world-passage`       | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-eb4f38bc-ea10-48c3-9bac-c16c5774689c.png` |

No third-party image was used in the accepted V2 lineage. All reference images are existing
World of ClaudeCraft project art or earlier project-generated art whose ownership remains
separately recorded. Reference use does not transfer or reclassify authorship.

## Exact accepted prompts

The prompt hashes below are SHA-256 over the exact UTF-8 prompt text inside each code block.
To satisfy the repository punctuation rule, the ten later prompt blocks spell the original
U+2013 character as the six ASCII characters `\u2013`. Decode that escape before hashing or
replaying those prompts; no other prompt character is escaped or normalized.

### Dungeon exit

Prompt SHA-256: `1d00d48c9d44128727ca6315641f79db01bfe5e4d8d7ecb2251fb1a69ad077f1`

```text
Create a replacement raster source for the DUNGEON EXIT map marker in the first reference while keeping it unmistakably paired with the dungeon entrance in the second reference. Precise dark-fantasy MMORPG cartography icon. Preserve the squat five-block stone arch exterior, heavy near-black contour, hand-painted sandstone, warm top-left highlights, cool lower-right shadows, and centered heraldic view. Redesign only the opening: reduce the blinding center bloom, keep a warm luminous passage, and place a single very bold DARK outward/upward chevron whose width is about one third of the opening. The chevron must retain a clean negative-space boundary and remain readable at 14 pixels; the bright center must not swallow it. Three major values, no extra arrows, text, medallion, badge, scene, floor, cast shadow, UI state, or ivory runtime keyline. Fill about 86% square with at least 3% clear margin. Exterior background exactly flat solid #FF00FF without gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `tmp/imagegen/map-marker-family/dungeon_exit-source.png`
2. `tmp/imagegen/map-marker-family/dungeon-source.png`

### Gather wood

Prompt SHA-256: `00d6baff777a679574078aa9b37e31bb943f3a716d9b48ce98819d4711a1db30`

```text
Use case: precise-object-edit
Asset type: 64px MMORPG map/minimap micro-icon source
Input images: Image 1 is the current crossed-log marker whose exact crossed composition, family scale, camera angle, and transparent-object silhouette must be preserved; Image 2 is the World of ClaudeCraft logging profession painting and controls bark/cut-wood material only.
Primary request: Refine the crossed-log marker so its four pale circular cut faces are noticeably larger and brighter, while the bark bodies become broader and simpler. Remove tiny bark scratches and tiny growth-ring detail. Keep exactly two crossed logs, a bold asymmetrical X silhouette, and strong readable separation when downsampled to 12 pixels.
Style/medium: premium hand-painted dark-fantasy MMORPG cartography icon, tactile wood, heraldic massing, crisp controlled edges, three broad value groups
Composition/framing: one centered icon, about 86% of square, optical center, generous even padding
Lighting/mood: warm top-left amber light, cool dark lower-right shadow
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background, uniform with no texture, gradient, shadow, floor, or reflection
Constraints: change only the material simplification and cut-face scale; preserve two-log X identity; thick near-black outer contour; no baked glow; no border; no text; no watermark; use no magenta in subject
```

References, in order:

1. `public/ui/map-markers/gather_wood.webp` at generation time
2. `public/ui/professions/gather_logging.webp`

### Station forge

Prompt SHA-256: `58534ce47242caecba0d5f26aeed7005f40e27a17627f586b389a127e59f1eff`

```text
Use case: precise-object-edit
Asset type: 64px MMORPG map/minimap micro-icon source
Input images: Image 1 is the current anvil marker whose exact horizontal anvil silhouette and family scale must be preserved; Image 2 is the World of ClaudeCraft smith archetype painting and controls forged-steel material and ember lighting only.
Primary request: Refine the anvil so the upper steel face becomes a broad bright silver-gray plane and a restrained molten-orange ember seam traces the underside of the horn and top plate. Lift the body midtones so the anvil remains visibly solid on dark green terrain. Remove tiny scratches and mottled microtexture.
Style/medium: premium hand-painted dark-fantasy MMORPG cartography icon, forged tactile steel, heraldic massing, crisp controlled edges, three broad value groups
Composition/framing: one centered wide anvil, about 88% width, optical center, generous even padding
Lighting/mood: warm top-left forge light, cool black-blue lower-right shadow
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background, uniform with no texture, gradient, shadow, floor, or reflection
Constraints: change only value/material clarity; preserve the horizontal horn/waist/foot silhouette; thick near-black outer contour; no hammer, no tools, no fire scene, no baked glow, no border, no text, no watermark, use no magenta in subject
```

References, in order:

1. `public/ui/map-markers/station_forge.webp` at generation time
2. `public/ui/professions/archetype_smith.webp`

### Station kitchens

Prompt SHA-256: `a17e7e31695237a3b9562bb26738279b2ed4404d47c1abb0f47f9c663db0c6eb`

```text
Create a replacement raster source for the KITCHENS crafting-station map marker in the first reference. Precise icon redesign for a dark-fantasy MMORPG cartography UI. Preserve the cauldron concept but make it read instantly at 12 pixels: a broad squat iron cooking pot, two oversized side handles that strengthen the silhouette, a large bright warm amber stew ellipse occupying the top third, and one simple ladle notch rising behind it. Lift the iron body to a readable charcoal-bronze midtone and use a restrained orange ember accent beneath; remove mottled microtexture and tiny ingredients. Match the tactile painted materials, heavy near-black contour, warm top-left light, cool lower-right shadow, and bold values of the references. Three major value groups. No medallion, badge, scene, floor, cast shadow, text, UI state, or ivory runtime keyline. Centered object fills about 86% of square with at least 3% clear margin. Exterior background perfectly flat solid #FF00FF, no gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `tmp/imagegen/map-marker-family/station_kitchens-source.png`
2. `tmp/imagegen/map-marker-family/station_forge-source.png`
3. `public/ui/professions/prof_cooking.webp`
4. `public/ui/items/goldleaf_game_stew.webp`

### Station apothecary

Prompt SHA-256: `c6dcaaccb5b6460e1b2ee8e3e485b90fcf9564b03cd6acc94ac8b4600c2b588f`

```text
Use case: precise-object-edit
Asset type: 64px MMORPG map/minimap micro-icon source
Input images: Image 1 is the current potion-bottle marker whose exact bottle silhouette and family scale must be preserved; Image 2 is the World of ClaudeCraft apothecary archetype painting and controls emerald glass and leaf material only.
Primary request: Refine the potion bottle for tiny-scale recognition. Brighten and widen the bottle neck and pale glass rim, enlarge the single solid three-leaf emblem so it occupies the central third, simplify the green liquid to two broad value planes, and remove tiny specular dots or mottled detail.
Style/medium: premium hand-painted dark-fantasy MMORPG cartography icon, tactile emerald glass, heraldic massing, crisp controlled edges, three broad value groups
Composition/framing: one centered squat necked bottle, about 84% of square height, optical center, generous even padding
Lighting/mood: warm pale top-left glass rim, cool forest-green lower-right shadow
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background, uniform with no texture, gradient, shadow, floor, or reflection
Constraints: preserve bottle identity and cork; exactly one large leaf emblem; thick near-black outer contour; no surrounding herbs, no baked glow, no border, no text, no watermark, use no magenta in subject
```

References, in order:

1. `public/ui/map-markers/station_apothecary.webp` at generation time
2. `public/ui/professions/archetype_apothecary.webp`

### Station tannery

Prompt SHA-256: `b9b961983cefa3ed5a3a8afd7d97de105c67745b0ed59b6c126cef4fccd228cf`

```text
Use case: precise-object-edit
Asset type: 64px MMORPG map/minimap micro-icon source
Input images: Image 1 is the current stretched-hide marker whose organic hide silhouette and family scale must be preserved; Image 2 is the World of ClaudeCraft leatherworking profession painting and controls warm leather material only.
Primary request: Refine the hide so there is no pale diagonal slash or stripe anywhere. Replace it with one broad warm copper center plane and subtle irregular leather wear that follows the hide shape. Lift the center value while keeping a deep umber perimeter, so it remains a leather hide rather than a disabled-state symbol at 12 pixels.
Style/medium: premium hand-painted dark-fantasy MMORPG cartography icon, tactile worn leather, heraldic massing, crisp controlled edges, three broad value groups
Composition/framing: one centered stretched animal hide, about 86% of square, optical center, generous even padding
Lighting/mood: warm top-left copper light, cool dark-brown lower-right shadow
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background, uniform with no texture, gradient, shadow, floor, or reflection
Constraints: remove only the diagonal state-like highlight and improve value clarity; preserve the irregular four-lobed hide silhouette; thick near-black outer contour; no knife, no tools, no holes, no baked glow, no border, no text, no watermark, use no magenta in subject
```

References, in order:

1. `public/ui/map-markers/station_tannery.webp` at generation time
2. `public/ui/professions/prof_leatherworking.webp`

### Station loom

Prompt SHA-256: `1238dc287b0c05067e37b4f106dcae20d36c6a7e08318274c3ad38ccc51cca7b`

```text
Create a replacement raster source for the LOOM crafting-station map marker in the first reference. This is precise icon redesign for a dark-fantasy MMORPG cartography UI, not a scene. Keep the tactile hand-painted material rendering, heavy near-black outer contour, warm top-left light, cool lower-right shadow, and heraldic simplicity demonstrated by the references. Redesign the object as a squat, broad A-frame wooden loom with a large unmistakable indigo cloth roll and one oversized golden-brown shuttle projecting beyond the frame. The loom must read from its OUTER SILHOUETTE and remain nameable when reduced to 12 pixels. Use only three major value groups, broad shapes, minimal texture, no fine threads, no window-like rectangle, no medallion, no badge, no cast shadow, no floor, no lettering, no UI state, no ivory outer keyline. Center one object, front three-quarter or near-front orthographic icon view, apparent mass filling about 86% of the square with at least 3% clear margin. Background outside the black contour must be perfectly flat solid #FF00FF with no gradient, texture, shadow, or magenta reflected on the object.
```

References, in order:

1. `tmp/imagegen/map-marker-family/station_loom-source.png`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`
3. `public/ui/professions/prof_tailoring.webp`
4. `public/ui/items/homespun_cloth.webp`

### Station toolworks

Prompt SHA-256: `b89c843fb0179d44e0717cb9c556aa8a8bcf9c56589773fc0bb9922b9252266f`

```text
Create a replacement raster source for the TOOLWORKS crafting-station map marker in the first reference. Precise icon redesign for a dark-fantasy MMORPG cartography UI. Match the tactile hand-painted metal, heavy near-black contour, warm top-left highlights, cool lower-right shadows, and bold simplified value grouping of the references. Replace the narrow vertical wrench composition with a BROAD six-tooth brass gear as the dominant outer silhouette and a short stout steel wrench crossing it diagonally from lower-left to upper-right. Both gear and wrench must remain obvious at 12 pixels; make teeth large, wrench jaws open and broad, and avoid tiny holes or screws. Three major value groups, no plastic gloss, no vector-flat look, no medallion, badge, cast shadow, floor, text, UI state, or ivory outer keyline. Centered heraldic object, fills about 86% of square, at least 3% clear perimeter. Background outside the black contour exactly flat solid #FF00FF, no gradient/texture/shadow or magenta spill.
```

References, in order:

1. `tmp/imagegen/map-marker-family/station_toolworks-source.png`
2. `tmp/imagegen/map-marker-family/station_forge-source.png`
3. `public/ui/professions/prof_engineering.webp`

### Service mailbox

Prompt SHA-256: `797d19d7c090d9cfeb89fe3638619247bd1c357880b066e972430561b1a451c9`

```text
Create a replacement raster source for the MAILBOX civic-service map marker in the first reference. Precise dark-fantasy MMORPG cartography icon, not a miniature building or scene. Keep the tactile hand-painted wood/metal, heavy near-black contour, warm top-left highlight, cool lower-right shadow, and bold heraldic simplification of the references. Completely remove the gabled roof/birdhouse silhouette. Design a tall narrow courier postbox with a shallow rounded iron lid, a broad front mail slot, one short sturdy post, and one oversized pale parchment envelope visibly emerging from the slot. The envelope flap must be a simple strong interior mark and the narrow postbox outline must read at 12 pixels. Use three major value groups, minimal texture, no words, letters, tiny hardware, medallion, badge, floor, cast shadow, UI state, or ivory runtime keyline. Center one object filling about 84% of the square with at least 3% clear margin. Exterior background perfectly flat #FF00FF with no gradient, texture, shadow, or magenta reflection.
```

References, in order:

1. `tmp/imagegen/map-marker-family/service_mailbox-source.png`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`

### Service noticeboard

Prompt SHA-256: `00f1de599b83d90672de2560e22df6d951691bd2e578c7e6fc3319b5509f386d`

```text
Create a replacement raster source for the NOTICEBOARD civic-service map marker in the first reference, designed as the wide semantic counterpart to a tall mailbox. Precise dark-fantasy MMORPG cartography icon, not a scene. Keep tactile hand-painted wood and parchment, heavy near-black contour, warm top-left highlight, cool lower-right shadow, and bold heraldic simplification. Remove the gabled house roof. Make a clearly WIDE landscape wooden board with a shallow flat cap, two widely separated short posts, one oversized pale parchment sheet covering most of the center, and two large brass pins. No readable writing; the parchment itself is the identity. Outer silhouette and wide proportions must be unmistakable at 12 pixels and not resemble a mailbox or house. Three major value groups, minimal texture, no medallion/badge/floor/cast shadow/UI state/ivory runtime keyline. Center and fill about 86% of square with at least 3% clear margin. Exterior background exactly flat solid #FF00FF without gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `tmp/imagegen/map-marker-family/service_noticeboard-source.png`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`

### Quest available

Prompt SHA-256: `13be45d900554ddbc69c2b796b6b3856e25650f339f2b16dc90f40cac6761190`

```text
Create ONE premium AVAILABLE QUEST map-marker icon for a dark-fantasy MMORPG map and minimap. This is a tiny heraldic cartography symbol, not a scene and not a UI panel. Build a broad gold parchment-scroll silhouette with two very short rolled ends and a large solid dark exclamation mark centered on it; add a small ruby wax seal as a simple lower-right protrusion. The exclamation mark must be a custom painted mark with an oversized stem and dot, occupying most of the scroll and still unmistakable at 12 pixels. The outer silhouette must differ from a repeatable quest emblem. Match the references' tactile hand-painted parchment/metal, near-black contour, warm top-left highlight, cool lower-right shadow, and only three major value groups. No readable writing, quill, book, medallion, circle/square frame, glow, cast shadow, floor, characters, logo, or watermark. One centered object filling about 86% of square with at least 3% margin. Exterior background perfectly flat solid #FF00FF with no gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `public/ui/chrome/questlog.webp`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`
3. `public/ui/professions/masterwork_seal.webp`

### Quest ready

Prompt SHA-256: `c54c0ba4b5418edb56121ca4f516ec73ceec614a7c97f7dede3930c12a252108`

```text
Create ONE premium QUEST TURN-IN READY map-marker icon for a dark-fantasy MMORPG map and minimap. Tiny heraldic cartography symbol, not a scene or UI panel. Use a broad pale-gold parchment scroll or compact quest parchment silhouette and a very large solid dark question mark centered on it. Add a small bright emerald seal/check-shaped tab at the bottom so the completed/ready state has a second non-color silhouette cue, while the question mark remains the primary classic semantic. Custom painted punctuation with oversized strokes, readable at 12 pixels. Tactile hand-painted parchment, heavy near-black outer contour, warm top-left light, cool lower-right shadow, three broad value groups. No writing, quill, book, medallion, circle/square frame, glow, cast shadow, floor, characters, logo, watermark. Centered, fills about 86%, at least 3% margin. Exterior exactly flat solid #FF00FF with no gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `public/ui/chrome/questlog.webp`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`

### Quest repeat

Prompt SHA-256: `9bd035ac0df627d527a20cca726f2eb0a08df6c661ff151b9626bac163cce41c`

```text
Create ONE premium REPEATABLE QUEST map-marker icon for a dark-fantasy MMORPG map and minimap. Tiny heraldic cartography symbol, not a scene. Use a royal-blue circular-arrow ribbon forming an OPEN broken ring around a small gold parchment center, with a large solid pale-gold exclamation mark centered. The circular arrow/ribbon must create an unmistakable repeat-loop outer silhouette, clearly different from the plain available parchment, and survive at 12 pixels; use one broad arrowhead and one deliberate gap, no tiny arrows. Tactile hand-painted cloth/parchment/metal, heavy near-black contour, warm top-left highlight, cool lower-right shadow, three major value groups. No readable writing, book, medallion frame, glow, cast shadow, floor, characters, logo, watermark. Center one combined emblem filling about 86% with at least 3% margin. Exterior background exactly flat solid #FF00FF, no gradient/texture/shadow or magenta spill.
```

References, in order:

1. `public/ui/chrome/questlog.webp`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`
3. `public/ui/professions/masterwork_seal.webp`

### Quest cooldown

Prompt SHA-256: `8b19021513acc81e5926c31b8fe78a0b642011cfb042112826441e4cbeacfdd5`

```text
Create ONE premium QUEST COOLDOWN map-marker icon for a dark-fantasy MMORPG map and minimap. Tiny heraldic cartography symbol, not a scene. Make a compact neutral-gray rolled parchment silhouette with a large dark exclamation mark, but give it a bold missing/broken lower-right corner and one simple dark clock wedge or hourglass notch integrated into that corner. Cooldown must be distinguishable from repeatable and available by silhouette and neutral value, never opacity alone, and readable at 12 pixels. Tactile hand-painted parchment/stone, heavy near-black contour, cool muted lighting with one pale edge, only three value groups. No blue repeat ribbon, readable writing, book, circular frame, glow, cast shadow, floor, characters, logo, watermark. Centered combined object filling about 82%, at least 4% margin. Exterior exactly flat solid #FF00FF with no gradient, texture, shadow, or magenta spill.
```

References, in order:

1. `public/ui/chrome/questlog.webp`
2. `tmp/imagegen/map-marker-family/gather_ore-source.png`
3. `public/ui/skills/mage/temporal_hourglass.webp`

## Rift, delve, and reward reference sets

The ten rift, delve, and reward prompts below used three exact ordered reference sets:

- Set A: `public/ui/map-markers/dungeon_entrance.webp`,
  `tmp/imagegen/map-marker-v2/quest_available.webp`, and
  `tmp/imagegen/map-marker-v2/gather_wood_v2.webp`.
- Set B: `public/ui/map-markers/dungeon_entrance.webp`,
  `tmp/imagegen/map-marker-v2/quest_available.webp`, and
  `tmp/imagegen/map-marker-v2-rift/rift_egress-source.png`.
- Set C: `public/ui/map-markers/dungeon_entrance.webp`,
  `tmp/imagegen/map-marker-v2/quest_available.webp`, and
  `tmp/imagegen/map-marker-v2/station_forge_v2.webp`.

### Delve entrance

Prompt SHA-256: `2c54f2f13cbd394e85bbf6a25dbe471c0f8c2e2dc46eb2af9ccfbd97ee3c3fd7`
References: set A

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a DELVE ENTRANCE icon: a squat ancient stone mine arch with three clearly descending steps disappearing into a dark opening, one compact warm amber lantern glow, and a tiny cool teal mineral accent
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; near-square bold silhouette; subject fills about 78% of the canvas; generous even padding; large readable masses; visually balanced at tiny scale
Lighting/mood: warm amber edge light against charcoal stone; adventurous and inviting but subterranean
Color palette: charcoal slate, aged bronze-gold, warm amber, tiny muted teal accent
Materials/textures: broad stone blocks and a single metallic rim; no tiny masonry lines
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp outer contour; no #ff00ff anywhere in the symbol; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: perspective scene, realistic cave painting, thin strokes, microdetail, loose particles, smoke, chains, characters, multiple objects, cropped edges
```

### Delve passage

Prompt SHA-256: `d1ca22bd7a03e7c887d546c163c44deaae04c61ed9b1dea460e3e1de1ee5dcce`
References: set B

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 is an accepted current map-marker rendering reference; Image 3 is the accepted blue-cyan rift-family palette reference
Primary request: recreate the DELVE TOMB PASSAGE concept as a low ancient crypt doorway shaped by two heavy stone jambs and a broad sarcophagus-like lintel, with two clearly descending slabs leading into a black opening and one simple centered ivory funerary rune; retain the compact wide-arch silhouette
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; compact wide-arch silhouette distinct from the taller delve entrance; subject fills about 76% of the canvas; generous even padding; large readable masses
Lighting/mood: solemn cool moonlit stone with one restrained cobalt-blue inner glimmer
Color palette: cold charcoal slate, weathered ivory, cobalt blue, minimal aged-gold edge accents; absolutely no purple, violet, magenta, pink, or red anywhere in the symbol
Materials/textures: broad tomb stone planes; no tiny carvings or masonry lines
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp dark outer contour; do not use any color close to #ff00ff inside the symbol; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: skull pile, character, thin strokes, microdetail, loose particles, smoke, chains, multiple objects, perspective scene, cropped edges
```

### Delve surface exit

Prompt SHA-256: `262613dee0cd37179e6279506d7c3a03c2c7d8fcba1b439593328589e2bd3bba`
References: set A

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a DELVE SURFACE EXIT icon: a compact stone arch containing three broad upward steps that rise toward a single pale warm daylight opening, with a simple upward-pointing wedge of light formed by the negative space
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; strong arch silhouette with the bright opening and upward stair direction readable at a glance; subject fills about 76% of the canvas; generous even padding; large readable masses
Lighting/mood: hopeful daylight breaking through a dark subterranean threshold
Color palette: charcoal slate, aged bronze-gold edges, pale ivory daylight, tiny desaturated moss-green accent
Materials/textures: broad stone blocks and one luminous opening; no tiny masonry lines
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp dark outer contour; no #ff00ff anywhere in the symbol; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: separate floating arrow, perspective landscape, realistic cave scene, thin strokes, microdetail, sun rays outside the silhouette, loose particles, smoke, characters, multiple objects, cropped edges
```

### Rift entrance

Prompt SHA-256: `47aac082d4aefbd06b45aa6e8a78c6fdbaf712f4d642c07b5966309f40e36bda`
References: set B

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 is an accepted current map-marker rendering reference; Image 3 is the accepted blue-cyan rift-family palette reference
Primary request: recreate the RIFT ENTRANCE concept as one upright jagged dimensional tear with a deep black almond-shaped core, a thick faceted royal-blue-and-electric-cyan energy rim, and two small anchored stone shards at its base; retain the bold asymmetric vertical tear silhouette
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing vertical symbol; bold asymmetric tear silhouette distinct from any stone doorway; subject fills about 74% of the canvas; generous even padding; large readable masses
Lighting/mood: dangerous arcane energy, luminous but controlled
Color palette: black void, navy indigo, royal blue, electric cyan, small white highlight; absolutely no purple, violet, magenta, pink, or red anywhere in the symbol
Materials/textures: broad faceted energy bands and two solid stone anchors; no wispy transparency
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; do not use any color close to #ff00ff inside the symbol; all glow stays inside the silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: purple energy, smoke, wispy aura, loose sparks, starfield, landscape, characters, multiple portals, thin strokes, microdetail, cropped edges
```

### Rift descent

Prompt SHA-256: `61241a4f0ecd25e6dfe72c3752eb7d3a1ec48f9aa9d2ba775c32145416fc0142`
References: set B

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 is an accepted current map-marker rendering reference; Image 3 is the accepted blue-cyan rift-family palette reference
Primary request: recreate the RIFT DESCENT concept as one inverted faceted dimensional vortex shaped like a broad downward-pointing teardrop, with a deep black central funnel and one thick pale-cyan downward chevron integrated inside the core; retain the unmistakable downward silhouette
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing vertical symbol; unmistakable downward silhouette distinct from the upright rift entrance; subject fills about 72% of the canvas; generous even padding; large readable masses
Lighting/mood: deepening dangerous arcane energy
Color palette: black void, navy indigo, royal blue, electric cyan, pale-cyan central chevron; absolutely no purple, violet, magenta, pink, or red anywhere in the symbol
Materials/textures: broad faceted energy plates; no wispy transparency
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; do not use any color close to #ff00ff inside the symbol; all glow stays inside the silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: purple energy, separate floating arrow, smoke, wispy aura, loose sparks, starfield, landscape, characters, multiple portals, thin strokes, microdetail, cropped edges
```

### Rift beacon

Prompt SHA-256: `15af14d97277ff789f4dbb310e0317920ec5337e64a325800c4d376340a5afe0`
References: set B

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap objective icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 is an accepted current map-marker rendering reference; Image 3 is the accepted blue-cyan rift-family palette reference
Primary request: recreate the RIFT BEACON concept as one squat faceted arcane obelisk on a broad dark-stone base, with a single large vertical cyan crystal slit and one simple royal-blue crown flame fully contained inside the slit; retain the sturdy triangular obelisk silhouette
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; sturdy triangular obelisk silhouette; subject fills about 72% of the canvas; generous even padding; large readable masses
Lighting/mood: powerful objective landmark, magical and authoritative
Color palette: charcoal stone, aged bronze rim, navy and royal blue, electric cyan, small ivory highlight; absolutely no purple, violet, magenta, pink, or red anywhere in the symbol
Materials/textures: broad faceted crystal and solid stone planes; no tiny runes
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; do not use any color close to #ff00ff inside the symbol; all glow stays inside the silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: purple flame, tower scene, thin antenna, smoke, wispy aura, loose sparks, starfield, characters, multiple objects, thin strokes, microdetail, cropped edges
```

### Rift egress

Prompt SHA-256: `d1cef47c9431085cfc1740f28e16377da383072e7ed32c38cdb0271e363ffba7`
References: set A

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap navigation icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a RIFT EGRESS icon: one thick broken circular portal ring with a bright ivory-cyan center and a single broad wedge-shaped opening at the upper right that clearly implies movement outward, supported by a small dark-stone base
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; bold near-circular ring silhouette with the outward opening readable at a glance; subject fills about 72% of the canvas; generous even padding; large readable masses
Lighting/mood: safe dimensional escape, luminous and decisive
Color palette: deep indigo outer ring, electric azure, pale cyan, ivory center, minimal aged-gold stone edge
Materials/textures: broad faceted energy bands and one solid base; no wispy transparency
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; no #ff00ff anywhere in the symbol; all glow stays inside the silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: separate floating arrow, smoke, wispy aura, loose sparks, starfield, landscape, characters, multiple portals, thin strokes, microdetail, cropped edges
```

### Reward treasure

Prompt SHA-256: `88f972df1bdb1d5384fb0784ab710603af91b5d9f38284f1953bf4604a8501e6`
References: set C

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap reward icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a TREASURE CACHE icon: one compact open adventurer's coffer with a broad raised lid, thick dark iron bands, and one large contained wedge of warm golden light inside; the open silhouette must read instantly without loose coins
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing three-quarter symbol; squat wide open-chest silhouette; subject fills about 74% of the canvas; generous even padding; large readable masses
Lighting/mood: rewarding, warm, valuable, immediately lootable
Color palette: dark walnut brown, near-black iron, aged bronze-gold, warm amber and pale-gold interior
Materials/textures: broad wood planks and thick metal bands; no tiny rivets or coin detail
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; no #ff00ff anywhere in the symbol; all glow stays inside the chest silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: loose coin pile, gems outside the chest, key, lock, mimic teeth, smoke, spark particles, characters, multiple chests, thin strokes, microdetail, cropped edges
```

### Reward locked cache

Prompt SHA-256: `c901f44ac29f956bdfba242fbdf079f7be55d8c3e0f494beb7a060acd617eb08`
References: set C

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap reward icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a LOCKED CACHE icon: one compact fully closed ironbound coffer with a single oversized bronze padlock integrated into the center front, a muted cool-gray lid, and no visible treasure or glow
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing symbol; squat closed-chest silhouette; padlock occupies a bold readable central mass; subject fills about 72% of the canvas; generous even padding
Lighting/mood: valuable but unavailable, subdued and unmistakably locked
Color palette: charcoal iron, desaturated dark walnut, aged bronze lock, small cold-silver edge highlight
Materials/textures: broad wood and metal planes; no tiny rivets or engraving
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; no #ff00ff anywhere in the symbol; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: open lid, visible treasure, bright magical glow, key, chain pile, mimic teeth, smoke, spark particles, characters, multiple chests, thin strokes, microdetail, cropped edges
```

### Reward reliquary

Prompt SHA-256: `582ab91ce6cd49ce8acbdde4d35ca2b989a6bb3a4c513c5b082df72feb653d99`
References: set C

```text
Use case: stylized-concept
Asset type: tiny MMORPG map and minimap high-value reward icon master, designed to downsample cleanly to 16\u201332 pixels
Input images: Image 1 is the established dungeon-entrance map-marker style reference; Image 2 and Image 3 are accepted current map-marker family references for rendering, contour, and palette only
Primary request: create a RELIQUARY icon: one upright chapel-shaped sacred reliquary with a thick aged-gold frame, two broad ivory door panels, and one large centered teal soul-gem set into its heart
Style/medium: premium hand-painted high-fantasy MMORPG UI icon; simplified sculpted forms; restrained WoW/Diablo/RuneScape-inspired readability without copying any franchise asset
Composition/framing: exactly one centered front-facing vertical symbol; tall shrine silhouette clearly distinct from a treasure chest; subject fills about 72% of the canvas; generous even padding; large readable masses
Lighting/mood: ancient, sacred, prestigious, rare
Color palette: aged gold, warm ivory, charcoal recesses, saturated teal gem, tiny pale-cyan highlight
Materials/textures: broad metal and ivory planes; one faceted gemstone; no filigree or tiny inscriptions
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for local background removal
Constraints: background must be exactly one uniform #ff00ff with no shadows, gradients, texture, reflections, floor plane, vignette, glow spill, or lighting variation; hard clean separation from background; crisp near-black outer contour; no #ff00ff anywhere in the symbol; all glow stays inside the silhouette; no cast shadow; no contact shadow; no reflection; no text; no letters; no numbers; no watermark; no UI tile, badge, circle, square, or background frame
Avoid: treasure chest shape, cross symbol, religious real-world emblem, open doors, wings, crown, floating halo, smoke, spark particles, characters, multiple objects, thin strokes, microdetail, cropped edges
```

### World passage

Prompt SHA-256: `70d863ec13c182941d26507a8d881598262d007fa5a6ee1b92e60601dd172344`

```text
Use case: precise-object-design from canonical game references.
Asset type: one 64px MMORPG map/minimap micro-icon source for the DUSKFALL PASSAGE, a two-sided ancient realm passage connecting the crystal cave gate and root-covered hollow gate shown in Images 3 and 4. Images 1 and 2 define the existing World of ClaudeCraft map-marker family scale, bold silhouette, near-black contour, warm top-left/cool lower-right lighting, and three-value hand-painted dark-fantasy material treatment.
Primary request: Create one broad, squat, unmistakable passage emblem: a heavy asymmetrical stone-and-root arch with a clean dark opening; one large faceted pale-cyan crystal embedded on the left shoulder; one thick old tree root wrapping the right shoulder; and a single bold pale-cyan S-shaped seam of otherworldly light inside the opening to suggest a passage between two realms. The crystal, root, arch, and opening must remain readable at 14 pixels. Use the canonical gate references for identity, but simplify aggressively to heraldic micro-icon shapes.
Style/medium: premium hand-painted dark-fantasy MMORPG cartography icon, tactile stone/root/crystal, crisp controlled edges, three broad value groups, thick near-black outer contour, no fine runes or moss speckles.
Composition/framing: one centered icon, fills about 86% of the square, optical center, at least 4% clear perimeter, broad rather than tall.
Lighting/mood: restrained warm stone highlight from top left, cool black-green root shadow at lower right, pale cyan crystal and seam; no baked glow outside the silhouette.
Scene/backdrop: perfectly flat solid #FF00FF chroma-key background, uniform with no gradient, texture, cast shadow, floor, reflection, or magenta spill.
Constraints: no purple or magenta in the subject; no text, letters, arrows, badge, medallion, UI frame, characters, landscape, logo, watermark, or ivory runtime keyline. Do not reproduce either full 3D gate literally; combine their strongest identities into one small navigation symbol.
```

References, in order:

1. `public/ui/map-markers/dungeon_entrance.webp`
2. `public/ui/map-markers/rift_entrance.webp`
3. `tmp/imagegen/map-marker-v2-duskfall/hollow_gate_crystal.png`
4. `tmp/imagegen/map-marker-v2-duskfall/hollow_gate_tree.png`

## Rejected concepts

The first tomb and rift color pass used magenta-adjacent violet. Explicit `#FF00FF` matte
removal visibly desaturated or removed those facets, so the sources were rejected before
normalization and replaced with cobalt, royal-blue, and cyan iterations.

| Rejected source                                       | Built-in result                                                                                                              | Source SHA-256                                                     | Reason                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `delve_tomb_passage-source-rejected-key-conflict.png` | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-88666f29-ef51-4d40-a146-1990de1e91b4.png` | `a2573a3893e720ed458da92e6e2aac019d1d7d5d999271db04c0c693b2d7c1ee` | Muted-violet interior produced excessive partial-alpha pixels. |
| `rift_entrance-source-rejected-key-conflict.png`      | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-e44501e4-72d0-477b-a830-8f193a7f16aa.png` | `45fecf8dd5a4de7640343aa78623737cb7fda9d1aca7ee7dec930e929305ae7c` | Violet energy rim became gray or transparent under despill.    |
| `rift_descent-source-rejected-key-conflict.png`       | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-458e9f8d-baf3-421a-8083-2d4f386c6806.png` | `8d82552facdacc113a2a7e32e5f6b2e6aaffbb11da1a9a393cee2875d44948d6` | Violet outer plates conflicted with the chroma key.            |
| `rift_beacon-source-rejected-key-conflict.png`        | `/Users/fernando/.codex/generated_images/019ff8aa-5688-7033-b4e7-6c2f7999b9fd/exec-6394da74-f33f-4a07-afa0-01340c73860e.png` | `4c473c4de10494d42107712c67b2245aafea5b6bc498bab459d0346ab92827a4` | Violet flame and gem were visibly desaturated by despill.      |
