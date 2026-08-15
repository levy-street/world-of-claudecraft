# Map Marker Art Accepted Batch

Status: historical accepted-art and audit record
Batch: `woc-map-marker-art-v1`
Date: 2026-08-12
Generator: OpenAI built-in image generation

This record owns the exact lineage for the first painted micro-icon family shared by the
World of ClaudeCraft map and minimap. The current machine-readable inventory and shipping
hashes live in `public/ui/map-markers/mapping.json`.

## Audit outcome

The audit covered the marker discriminants rendered by the full map and minimap, including
gathering nodes, dungeon portals, crafting stations, quest state, player and party state,
NPCs, enemies, loot, corpses, battleground objectives, and world-detail geometry.

Painted art was admitted only where a durable content identity benefits from a stable,
recognizable silhouette. This batch therefore covers three gathering disciplines, both
dungeon directions, six authored crafting-station types, Ravenpost mailboxes, and quest
noticeboards. It does not turn every dot or state glyph into a bitmap.

Quest markers deliberately remain procedural `!` and `?` glyphs. That classic punctuation is
the information: it preserves available versus turn-in state, repeatable coloring, cooldown
alpha, outlined contrast, and reliable recognition at the smallest mobile minimap size.

Dynamic markers also remain procedural. Player and party facing, ally or guild membership,
enemy hostility and aggro, loot state, corpse state, battleground objectives, off-map
direction, and transient world geometry are live state, not fixed subject identity. Keeping
those markers geometric avoids baked-state ambiguity and lets runtime shape, color, rotation,
alpha, and animation continue to communicate changes fairly.

Dungeon exits, mailboxes, and noticeboards received distinct semantic variants before their
art was admitted, so none borrows another object's identity. Rift entrances, descents, exits,
treasure, and the paired Duskfall passage remain deferred because their current runtime
taxonomy is shared with broader object markers or absent from the marker model. Giving those
borrowed art would make the map prettier but less truthful.

## Accepted shipping inventory

Every generated source is a 1254x1254 PNG. Every committed result is a 64x64 sRGB WebP with
alpha. The entire thirteen-file shipping family is 26,912 bytes.

| Art id | Shipping file | Motif | Bytes |
| --- | --- | --- | ---: |
| `dungeon-entrance` | `public/ui/map-markers/dungeon_entrance.webp` | Sandstone arch with contained violet portal | 2,584 |
| `dungeon-exit` | `public/ui/map-markers/dungeon_exit.webp` | Warm passage arch with outward chevron | 2,164 |
| `gather-ore` | `public/ui/map-markers/gather_ore.webp` | Three-facet mineral outcrop | 1,838 |
| `gather-wood` | `public/ui/map-markers/gather_wood.webp` | Two crossed amber logs | 2,364 |
| `gather-herb` | `public/ui/map-markers/gather_herb.webp` | Three-leaf medicinal sprig | 2,120 |
| `station-forge` | `public/ui/map-markers/station_forge.webp` | Blackened-steel anvil | 1,654 |
| `station-kitchens` | `public/ui/map-markers/station_kitchens.webp` | Black-iron cooking cauldron | 2,452 |
| `station-apothecary` | `public/ui/map-markers/station_apothecary.webp` | Emerald potion bottle | 2,364 |
| `station-tannery` | `public/ui/map-markers/station_tannery.webp` | Warm-brown stretched hide | 1,880 |
| `station-loom` | `public/ui/map-markers/station_loom.webp` | Wooden loom with cobalt cloth | 1,886 |
| `station-toolworks` | `public/ui/map-markers/station_toolworks.webp` | Brass gear and steel wrench | 2,048 |
| `service-mailbox` | `public/ui/map-markers/service_mailbox.webp` | Ravenpost box with sealed envelope | 1,700 |
| `service-noticeboard` | `public/ui/map-markers/service_noticeboard.webp` | Noticeboard with pinned parchment | 1,858 |

## Runtime sizes and state ownership

The 64px files are compact decode masters. The shared loader rasterizes the exact small-size
variants once and reuses them. Each final raster is two pixels larger than its original subject
footprint so a crisp one-pixel light keyline can sit outside the master's dark contour without
shrinking or clipping the painting:

| Family | Minimap | Full map |
| --- | --- | --- |
| Gathering, ready | 12px | 18px |
| Gathering, cooldown | 10px | 14px |
| Dungeon entrance or exit | 14px | 18px |
| Crafting station | 12px | 17px |
| Civic service | 12px | 16px |

The 64px bitmap owns only subject identity, broad material color, and the closed dark contour.
The shared bounded loader adds the light terrain-separating keyline to every exact-size raster.
It also converts the two gathering cooldown sizes to grayscale while retaining internal painted
contrast. Cooldown therefore reads as temporarily unavailable through grayscale and size at full
caller alpha, without a diagonal slash. Runtime painters own ready glow, tool-lock alpha and the
ready-only lock strike, label placement, hover and hit behavior, stacking, clipping, quest state,
facing, hostility, party state, and battleground state. No lock slash, quest punctuation, hover
ring, label, or UI frame is baked into any 64px master.

## Runtime visual proof

The before captures show the first integrated marker pass before the visibility treatment:
resource paintings were smaller, lacked the light exterior keyline, and tool-locked nodes
were dominated by diagonal strikes. The after captures show the final mixed state with
ready wood and herb in color, exhausted ore in neutral grayscale, all stable identities
outlined, and the Eastbrook landmark cluster decluttered.

| View | Before visibility pass | Final treatment |
| --- | --- | --- |
| Desktop world map | [Before](../screenshots/map-markers-before-desktop.png) | [After](../screenshots/map-markers-after-desktop.png) |
| Mobile world map | [Before](../screenshots/map-markers-before-mobile.png) | [After](../screenshots/map-markers-after-mobile.png) |

The exhausted-node treatment was also captured at actual minimap scale on
[desktop](../screenshots/map-markers-minimap-cooldown-desktop.png) and the compact
[844x390 mobile landscape](../screenshots/map-markers-minimap-cooldown-mobile.png). In both
captures the ore silhouettes remain distinguishable without relying on hue or a strike.

The final minimap layering and quest-punctuation pass was verified after the cached dark
glyph outline landed. Each quest-state capture pairs a real ready `?` over grass with the
corresponding work-order `!` over a road:

| Minimap state | Desktop | 844x390 mobile landscape |
| --- | --- | --- |
| Available + ready | [Desktop](../screenshots/map-markers-minimap-quest-available-desktop.png) | [Mobile](../screenshots/map-markers-minimap-quest-available-mobile.png) |
| Repeatable + ready | [Desktop](../screenshots/map-markers-minimap-quest-repeat-desktop.png) | [Mobile](../screenshots/map-markers-minimap-quest-repeat-mobile.png) |
| Repeat cooldown + ready | [Desktop](../screenshots/map-markers-minimap-quest-cooldown-desktop.png) | [Mobile](../screenshots/map-markers-minimap-quest-cooldown-mobile.png) |

The live-marker stacking proof places the real Ironvein Foreman and its aggro square exactly
over `ore_thornpeak_t2`. The gathering painting is emitted first, so the hostile marker remains
visible above it on [desktop](../screenshots/map-markers-minimap-hostile-overlap-desktop.png)
and [mobile](../screenshots/map-markers-minimap-hostile-overlap-mobile.png). The capture harness
asserted the shared projected coordinate and marker order before taking each frame.

## Processing and review

All thirteen accepted results were generated separately in built-in mode on a flat `#FF00FF`
exterior. The generated sources were copied to the ignored staging directory
`tmp/imagegen/map-marker-family/`. The installed imagegen chroma helper sampled the border,
created a soft matte, and despilled the edge. The initial pass used transparent threshold 12
and opaque threshold 220. Dungeon entrance, apothecary, and kitchens received the reviewed
harder pass with transparent threshold 18, opaque threshold 80, and edge contraction 1.

The selected alpha sources were resized with Sharp using `lanczos3`, normalized into a 60px
content box with a fully transparent 2px perimeter, then encoded as WebP with quality 88,
alpha quality 100, and effort 6. At runtime that perimeter supplies safe room for the loader's
one-pixel ivory keyline. Kitchens received a restrained luminance regrade after the
first tiny-scale review so the cauldron remains visible on dark terrain. The original round
logging stump was replaced with crossed logs after the same review found that its silhouette
collapsed into a coin below 12px. A non-shipping review sheet at
`tmp/imagegen/map-marker-family/family-preview.png` compared every icon at 64px, 24px, 18px,
16px, 14px, 12px, 10px, 8px, and 6px. Its SHA-256 was
`9b53c08e1c9ed20bf7ae1d09eaa9884ac76cf360b022fe56d7820e6091fc51f7`.

The accepted micro family superseded two discarded explorations: circular gathering medallions
at `exec-5f43bbe2-bbd9-4d73-8b3c-ad5eea22f038.png`,
`exec-2e124045-f09d-442d-8580-08e83e1c09f6.png`, and
`exec-f33ca45e-4bf9-4a88-ba30-f4230c87cbf1.png`, plus a multi-variant dungeon sheet at
`exec-74309cb9-661c-4c24-ac25-90278b9e9be2.png`. Those results were rejected because borders,
interior detail, or multiple examples collapsed at actual marker scale. They are not shipping
assets and do not own any current art id.

## Accepted source paths

| Art id | Built-in generated result |
| --- | --- |
| `dungeon-entrance` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-92fb8d44-1548-451d-85b4-3c6ee95cc307.png` |
| `dungeon-exit` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-423766b3-d2de-4568-a4ad-aea596ad78e4.png` |
| `gather-ore` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-5fcf0838-6cb0-4898-ac15-2e61529287f0.png` |
| `gather-wood` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-4ae2a36f-c195-4ded-a13f-f28bfe96da35.png` |
| `gather-herb` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-86bff4c7-4811-449c-b927-5f7c22e5aedf.png` |
| `station-forge` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png` |
| `station-kitchens` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-da787f79-0116-4e4f-8dcd-11b6b13db7f3.png` |
| `station-apothecary` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-2379e619-5b0d-43f3-9eac-e74907f2e8b4.png` |
| `station-tannery` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-c38f6981-861c-4270-86d6-331e9a54024a.png` |
| `station-loom` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-9de14a53-7fa0-4d4a-97c0-3aa8dc66c307.png` |
| `station-toolworks` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-27fc834f-9dbf-4f22-a505-8f389cd2f1c3.png` |
| `service-mailbox` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-893aa58e-1cf5-4d16-8413-0df22c90cee1.png` |
| `service-noticeboard` | `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-8ea44f73-b99d-40e7-9688-352020c7b959.png` |

No third-party image was used in the accepted lineage. Prompt references are existing
World of ClaudeCraft project art or an earlier accepted image from this same batch. Those
references remain separately owned and are not reclassified by this record.

## Exact accepted prompts

### Dungeon entrance

Mode: `precise-object-edit`

```text
Use case: precise-object-edit
Asset type: one tiny transparent cartography icon for an MMORPG world map and minimap
Input image: Image 1 is a rejected concept sheet with four versions of the same dungeon arch. Use only the large lower-right arch as the subject and style reference.
Primary request: remove the other three arches completely and produce exactly ONE centered Dungeon Entrance icon based on the lower-right arch
Scene/backdrop: replace the entire exterior with one perfectly flat solid #FF00FF chroma-key field, uniform edge to edge, with no shadow, gradient, texture, reflection, floor, or lighting variation
Subject: one squat pointed sandstone arch with five broad block masses, heavy near-black contour, and one uninterrupted deep-violet portal opening; preserve the simple bold geometry of the chosen lower-right example
Composition/framing: exactly one icon, centered, front-facing, nearly square, occupying about 88 percent of canvas width and height, minimal safe padding on every side; no second icon of any size anywhere
Style/medium: premium hand-painted classic dark-fantasy MMORPG map symbol, clean graphic massing, only two or three broad value bands, crisp closed silhouette
Constraints: ONE object only; do not show examples, variants, scale samples, thumbnails, repetitions, inset icons, or a contact sheet; no cast shadow, exterior glow, reflection, particles, runes, text, letters, numbers, watermark, logo, medallion, badge, or surrounding frame; do not use #FF00FF inside the arch
```

Reference, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-74309cb9-661c-4c24-ac25-90278b9e9be2.png`

### Gather ore

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Dungeon Entrance map marker and controls the bold near-black contour, broad value bands, clean hand-painted finish, subject fill, and flat chroma exterior. Image 2 is the existing World of ClaudeCraft Mining profession painting and supplies only ore/mining subject identity.
Primary request: create exactly ONE original Ore Node marker: a compact three-facet mineral outcrop, clearly a harvestable ore deposit with no tool
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, with no shadow, gradient, texture, reflection, floor, or lighting variation
Subject: one squat angular cluster with three large rock facets; dark iron stone, one copper-orange mineral seam, and one cool teal crystal face; silhouette like a low crown, unmistakable as ore at 8px, 10px, 12px, and 16px
Style/medium: preserve Image 1's premium classic dark-fantasy MMORPG cartography language: heavy crisp near-black contour, only two or three broad value bands per facet, restrained hand-painted material, no small details
Composition/framing: exactly one centered front-facing cutout, nearly square, subject fills 88 to 92 percent of canvas, minimal safe padding; no medallion, no surrounding frame
Lighting/mood: warm top-left highlight, cool deep lower-right shadow
Constraints: ONE object only; closed exterior silhouette; no cast shadow, contact shadow, exterior glow, reflection, particles, tiny chips, pickaxe, hammer, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle, square frame; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-92fb8d44-1548-451d-85b4-3c6ee95cc307.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/gather_mining.webp`

### Gather wood

Mode: `precise-object-edit`

```text
Use case: precise-object-edit
Asset type: one tiny transparent cartography icon for an MMORPG world map and minimap
Input image: Image 1 is the approved Logging Node marker and controls exact warm amber and dark-bark palette, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior
Primary request: replace the round stump with exactly ONE more readable Logging Node marker built from two short stout cut logs crossed into a broad X silhouette
Subject: two chunky amber log sections crossing diagonally, each with one pale circular cut end and one dark bark band; the crossing creates four bold outward ends and must read as timber rather than a coin at 8px, 10px, 12px, and 16px; no axe or other tool
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, with no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted wood and bark
Composition/framing: exactly one centered combined cutout, near-square X silhouette, subject fills 88 to 92 percent of canvas, minimal safe padding, no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE combined emblem only; exactly two crossed logs; four large cut ends; no stump, rings beyond one broad circle per end, branches, leaves, axe, saw, chips, sawdust, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

Reference, in order:

1. `/Users/fernando/Documents/wocc-icon-art-v037/tmp/imagegen/map-marker-family/gather_wood-source.png`

### Station forge

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Dungeon Entrance map marker and controls bold near-black contour, broad value bands, clean hand-painted finish, subject fill, and flat chroma exterior. Image 2 is the existing Smith archetype painting and supplies forge subject/material identity only.
Primary request: create exactly ONE Forge station marker: one compact blackened-steel anvil with a broad top and stout base, a small contained orange ember glow along its upper edge
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, simplified hand-painted forged metal
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed silhouette; no hammer, sword, tongs, sparks, particles, fire plume, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-92fb8d44-1548-451d-85b4-3c6ee95cc307.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/archetype_smith.webp`

### Station kitchens

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Forge marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior. Image 2 is the existing Cooking profession painting and supplies kitchen warmth and material identity only.
Primary request: replace the anvil with exactly ONE Kitchens station marker: one squat black iron cooking cauldron with two short side handles and one broad warm-orange stew surface visible at the top
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted iron and warm food
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed silhouette; no flame, smoke, steam, ladle, spoon, ingredients, plates, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/prof_cooking.webp`

### Station apothecary

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Forge marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior. Image 2 is the existing Apothecary archetype painting and supplies herbal medicine subject/material identity only.
Primary request: replace the anvil with exactly ONE Apothecary station marker: one squat emerald potion bottle with a broad cork and one simple pale leaf stamped as a bold solid shape on its front
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted glass and cork
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed silhouette; leaf is one broad emblem with no fine veins; no bowl, mortar, pestle, loose herbs, smoke, bubbles, particles, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection outside the bottle; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/archetype_apothecary.webp`

### Station tannery

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Forge marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior. Image 2 is the existing Leatherworking profession painting and supplies tannery subject/material identity only.
Primary request: replace the anvil with exactly ONE Tannery station marker: one compact warm-brown stretched hide silhouette, broad shoulders tapering to a lower point, with a single dark edge band and one simple diagonal pale cut mark
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted leather
Composition/framing: exactly one centered front-facing cutout, near-square hide silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed silhouette; no knife, needle, rack, ropes, fur strands, animal face, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/prof_leatherworking.webp`

### Station loom

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Forge marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior. Image 2 is the existing Tailoring profession painting and supplies loom/textile subject and palette identity only.
Primary request: replace the anvil with exactly ONE Loom station marker: one compact upright wooden weaving frame with a broad cobalt cloth panel stretched through its center and two thick pale-gold vertical threads
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted wood and cloth
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed outer silhouette; no needle, scissors, loose thread, spool, tiny crosshatch, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/prof_tailoring.webp`

### Station toolworks

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent crafting-station cartography icon for an MMORPG world map and minimap
Input image roles: Image 1 is the approved Forge marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior. Image 2 is the existing Engineering profession painting and supplies toolworks subject and palette identity only.
Primary request: replace the anvil with exactly ONE Toolworks station marker: one compact brass gear with only six broad teeth and one stout dark-steel wrench laid vertically through its center
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted brass and steel
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, readable at 10px, 12px, 16px, and 18px; no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE combined emblem only; crisp closed outer silhouette; exactly one gear and one wrench; no small cogs, chains, wires, sparks, screws, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

References, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-a5775fb1-5424-4a89-a8c6-f75becdd5445.png`
2. `/Users/fernando/Documents/wocc-icon-art-v037/public/ui/professions/prof_engineering.webp`

### Gather herb

Mode: `precise-object-edit`

```text
Use case: precise-object-edit
Asset type: one tiny transparent cartography icon for an MMORPG world map and minimap
Input image: Image 1 is the approved Ore Node marker and controls the exact subject scale, heavy near-black contour, broad value bands, hand-painted finish, lighting, padding, and flat chroma exterior
Primary request: replace only the ore cluster with exactly ONE compact Herb Node marker
Subject: one symmetrical three-leaf medicinal sprig, three broad emerald leaf masses joined at one short stem, with one small pale-gold bud at the center; unmistakably harvestable herbalism at 8px, 10px, 12px, and 16px
Scene/backdrop: preserve a perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, with no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: preserve Image 1's premium classic dark-fantasy MMORPG cartography language, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted material
Composition/framing: exactly one centered cutout, near-square three-lobed silhouette, subject fills 88 to 92 percent of canvas, minimal safe padding; no medallion or surrounding frame
Lighting/mood: warm top-left highlight, deep cool lower-right shadow
Constraints: ONE object only; crisp closed exterior silhouette; only three leaves; no fine veins, loose leaves, roots, soil, pot, sickle, text, letters, numbers, pseudo-writing, runes, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, particles, or reflection; do not use #FF00FF inside the subject
```

Reference, in order:

1. `/Users/fernando/.codex/generated_images/019ff60d-9cde-7fc3-9e2d-12d897a00dde/exec-5fcf0838-6cb0-4898-ac15-2e61529287f0.png`

### Dungeon exit

Mode: `precise-object-edit`

```text
Use case: precise-object-edit
Asset type: one tiny transparent cartography icon for an MMORPG world map and minimap
Input image: Image 1 is the approved Dungeon Entrance marker and controls exact scale, heavy near-black contour, broad value bands, hand-painted finish, padding, and flat chroma exterior
Primary request: transform the entrance into exactly ONE Dungeon Exit marker while preserving the same squat five-block sandstone arch
Subject: one front-facing sandstone arch whose opening is a broad warm ivory-gold passage with one simple dark outward-pointing chevron cut into the center; unmistakably an exit at 10px, 12px, and 16px, visibly distinct from the entrance's violet interior
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted stone and light
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, subject fills 88 to 92 percent of canvas, minimal safe padding, no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed outer silhouette; one broad chevron only; no text, letters, numbers, pseudo-writing, runes, particles, rays, smoke, characters, weapons, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

Reference, in order:

1. `/Users/fernando/Documents/wocc-icon-art-v037/tmp/imagegen/map-marker-family/dungeon-source.png`

### Service mailbox

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent civic-service cartography icon for an MMORPG world map and minimap
Input image: Image 1 is the approved Dungeon Entrance marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior
Primary request: create exactly ONE Ravenpost Mailbox marker
Subject: one compact dark-oak postbox on a short stout post, front-facing, with one broad pale-gold sealed envelope emblem centered on the box; silhouette has a small peaked lid and strong square body, unmistakably mail at 10px, 12px, and 16px
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted oak, iron, and parchment
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed silhouette; one envelope emblem only; no raven, bird, loose letters, parcel, text, letters, numbers, pseudo-writing, runes, characters, particles, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

Reference, in order:

1. `/Users/fernando/Documents/wocc-icon-art-v037/tmp/imagegen/map-marker-family/dungeon-source.png`

### Service noticeboard

Mode: `stylized-concept`

```text
Use case: stylized-concept
Asset type: one tiny transparent civic-service cartography icon for an MMORPG world map and minimap
Input image: Image 1 is the approved Dungeon Entrance marker and controls exact subject scale, heavy near-black contour, broad value bands, clean hand-painted finish, lighting, padding, and flat chroma exterior
Primary request: create exactly ONE Quest Noticeboard marker
Subject: one compact dark-oak noticeboard on two short stout posts with a broad peaked cap, front-facing; one single pale parchment sheet centered on the board and pinned by two large round brass tacks; unmistakably a quest board at 10px, 12px, and 16px
Scene/backdrop: perfectly flat solid #FF00FF chroma-key exterior, uniform edge to edge, no shadow, gradient, texture, reflection, floor, or lighting variation
Style/medium: premium classic dark-fantasy MMORPG cartography symbol, heavy crisp near-black contour, only two or three broad value bands, clean simplified hand-painted oak, parchment, and brass
Composition/framing: exactly one centered front-facing cutout, near-square silhouette, fills 88 to 92 percent of canvas, minimal safe padding, no medallion or surrounding frame
Lighting: warm top-left rim, deep cool lower-right shadow
Constraints: ONE object only; crisp closed outer silhouette; exactly one blank parchment and two tacks; no readable writing, no text, letters, numbers, pseudo-writing, runes, exclamation mark, question mark, extra notices, quill, characters, particles, watermark, logo, variants, thumbnails, repetitions, collage, UI screenshot, badge, circle frame, square frame, cast shadow, contact shadow, exterior glow, or reflection; do not use #FF00FF inside the subject
```

Reference, in order:

1. `/Users/fernando/Documents/wocc-icon-art-v037/tmp/imagegen/map-marker-family/dungeon-source.png`
