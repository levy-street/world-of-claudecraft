# Painted ground and sky sources: prompts

Every source image in `scripts/assets/painted_ground/src/`, the two painted Eastbrook Vale
skies in `skies_in/` (`vale_painted_day.png`, `vale_painted_night.png`) and the painted cloud
sheet (`skies_in/vale_painted_clouds.png`) is project-generated
with ChatGPT image generation from a text prompt alone. No reference image was attached to any
prompt, and no third-party game imagery was used as an input. The user's style references were
described in words only.

Generated on 2026-10-29. ChatGPT returns the square sources at 1254x1254 and the sky panoramas
at 1774x887 (exactly 2:1); every later step (seam healing, de-lighting, resizing, compression)
is done by the build scripts and is recorded in their headers.

## Ground sources (`src/`)

### `grass.png`

```text
Generate an image: a square seamless tileable grass ground texture for a stylized dark-fantasy action RPG, viewed straight down (top-down orthographic, no perspective). Painted like a professional hand-painted game texture in gouache and oil: soft painterly mottled patches of mossy grass in olive green, warm yellow-green and deeper cool green, built from small confident brush dabs and short painted grass strokes pointing in random directions, with soft darker hollows and lighter sunlit tufts, a few tiny clover leaves and two or three tiny bare earth specks. Medium-scale detail evenly spread: no stripes, no rows, no diagonal banding, no repeating pattern, no single large shape. Natural and slightly muted. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No flowers, no rocks, no objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

### `dirt.png`

```text
Generate an image: a square seamless tileable dirt path ground texture for a stylized dark-fantasy action RPG, viewed straight down (top-down orthographic, no perspective). Hand-painted like a rich gouache and oil painting with soft visible brush strokes. Subject: compacted warm earth: ochre, tan and warm umber with soft painted mottling, scattered small rounded pebbles with a soft top highlight and dark contact edge placed at random, a few tiny dry grass bits and leaf specks. Calm, evenly distributed random detail: no stripes, no rows, no ruts, no tracks, no diagonal banding, no repeating pattern, no single large shape. Earthy and slightly muted. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

### `rock.png`

```text
Generate an image: a square seamless tileable rock cliff texture for a stylized dark-fantasy action RPG, front view of a rock face. Hand-painted like a rich gouache and oil painting with confident brush strokes. Subject: chunky angular stone planes and broken blocks in cool blue-grey and warm grey with painted warm highlights on top edges, dark painted cracks, and soft green moss gathering in crevices and on upper ledges. Chunky stylized shapes with chiselled painted facets, not photographic, evenly distributed: no single large shape, no straight horizontal strata, no repeating pattern. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

### `cobble.png`

```text
Generate an image: a square seamless tileable cobblestone road texture for a stylized dark-fantasy action RPG town, viewed straight down (top-down orthographic, no perspective). Hand-painted like a rich gouache and oil painting with confident visible brush strokes. Rounded, slightly irregular cobbles of varied sizes and shapes (no perfect grid, no straight rows), warm grey and sandy stone with hints of cool blue-grey, each cobble with a soft painted highlight on its upper surface and darker painted edges, deep dark earth and a little moss and tiny grass tufts in the gaps between stones, a few cracked or chipped stones. Earthy, worn, lived-in, slightly muted, imperfect and organic. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

### `leaves.png`

```text
Generate an image: a square seamless tileable ground texture for a stylized dark-fantasy action RPG, viewed straight down (top-down orthographic, no perspective). Hand-painted like a rich gouache and oil painting with soft visible brush strokes. Subject: fallen autumn leaf litter on a forest floor: many overlapping painted leaves of mixed sizes in warm orange, rust, ochre, amber and brown, a few darker curled leaves, dark earth showing in small gaps, and a few tiny green moss specks. Evenly distributed random detail: no stripes, no rows, no diagonal banding, no repeating pattern, and no single large shape that would show when tiled. Rich but earthy, not neon. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

## Painted Eastbrook Vale skies (`skies_in/`)

### `vale_painted_day.png`

The shipped day sky (2026-10-30) is a clear painted base: open sky with low soft cloud banks along
the horizon, under the painted cloud layer that drifts over it (`vale_painted_clouds.png` below,
`src/render/sky_clouds_core.ts`). The first painted day sky (2026-10-29) carried its big clouds in
the panorama, where a 2048 texel equirect spreads a texel over two or three screen pixels and they
read blurry; it ships on as `skies_in/vale_painted_env.png`, the vale's IBL source, so the ambient
light keeps the cloud cover the layer draws (the clear base alone lights the world twice as blue).
Its prompt is recorded under `vale_painted_env.png` below.

```text
Generate an image: a seamless 360-degree equirectangular sky panorama for a fantasy video game skybox, wide 2:1 landscape format. Fully hand-painted stylized look, like a gouache and oil painting with soft visible brush strokes, painterly and illustrative, not photographic. Daytime: deep clear cerulean blue at the very top fading through soft cyan to a warm pale cream-gold haze along the horizon line, which sits exactly at the vertical middle of the image. The upper and middle sky is open clear gradient with only two or three very faint soft high wispy streaks. Low soft distant cloud banks rest along the horizon all the way around, small, soft and hazy, with warm sunlit cream tops and cool lavender-blue undersides, getting smaller and flatter toward the horizon. A gentle warm golden glow in one area of the sky near the horizon, but no sun disc. Soft and smooth everywhere, with no fine sharp detail. The bottom half of the image, below the horizon, is only a soft hazy blue-teal fog gradient: no land, no sea, no mountains, no trees, no birds, no objects. No text, no watermark. The left and right edges must continue into each other seamlessly.
```

### `vale_painted_env.png`

The first painted day sky (2026-10-29), now the vale's IBL source only.

```text
Generate an image: a seamless 360-degree equirectangular sky panorama for a fantasy video game skybox, wide 2:1 landscape format. Fully hand-painted stylized look, like a gouache and oil painting with soft visible brush strokes, painterly and illustrative, not photographic. Daytime: deep cerulean blue at the very top fading through soft cyan to a warm pale cream-gold haze along the horizon line, which sits exactly at the vertical middle of the image. Big soft billowing painted cumulus clouds near and above the horizon with warm sunlit cream tops and cool blue-violet shaded undersides, plus a few long wispy brushy cirrus streaks higher up; clouds get smaller and flatter toward the horizon. A gentle warm golden glow in one area of the sky near the horizon, but no sun disc. The bottom half of the image, below the horizon, is only a soft hazy blue-teal fog gradient: no land, no sea, no mountains, no trees, no birds, no objects. No text, no watermark. The left and right edges must continue into each other seamlessly.
```

### `vale_painted_clouds.png`

The painted cloud layer's source: four clouds on a flat green key, keyed, measured and encoded by
`scripts/assets/build_sky_clouds.mjs` (generated at 1536x1024; the first try errored and was
re-asked once).

```text
Generate an image: a sprite sheet of 4 separate hand-painted stylized clouds for a fantasy game sky, arranged in a 2 by 2 grid with generous empty space around each one, every cloud fully inside its own quarter of the image and not touching the image edges or the other clouds. Painted like a gouache and oil painting with soft confident visible brush strokes, painterly and illustrative, not photographic: big soft billowing rounded cloud shapes with warm sunlit cream-white tops, soft pale lavender and blue-grey shaded undersides, gentle painted edges. Each cloud a different shape: one tall towering cumulus, one long flat drifting cloud bank, one round puffy cloud, one wispy broken cloud. Background: one completely flat solid pure bright green (#00FF00) colour everywhere around the clouds, with no gradient, no texture, no shadows, no sky. No sun, no text, no watermark.
```

### `vale_painted_night.png`

The shipped night sky (2026-10-30) is a clear painted base: stars, the milky band and low
moonlit banks on the horizon, under the same drifting painted cloud layer the day sky carries,
graded moonlit on the night (`src/render/sky_clouds_core.ts` SKY_CLOUD_NIGHT), so the clouds
drift on unbroken from day into night. The first painted night (2026-10-29) painted its clouds
into the panorama, where they were soft and still; its prompt is kept below the new one.

```text
Generate an image: a seamless 360-degree equirectangular NIGHT sky panorama for a fantasy video game skybox, wide 2:1 landscape format. Fully hand-painted stylized look, like a gouache and oil painting with soft visible brush strokes, painterly and illustrative, not photographic. Deep indigo and navy blue at the very top fading to a muted moonlit teal-blue glow along the horizon line, which sits exactly at the vertical middle of the image. A clear open night sky: scattered soft painted stars of varied sizes (a few brighter four-point twinkles, many tiny dots) and a faint painterly band of starry haze arcing across. No big clouds in the sky at all: only low soft distant cloud banks resting along the horizon all the way around, small and hazy, with silvery moonlit tops and deep blue-violet bodies. Calm, magical, readable, not pitch black. No moon disc, no planets. The bottom half of the image, below the horizon, is only a soft dark blue haze gradient: no land, no sea, no mountains, no trees, no objects. No text, no watermark. The left and right edges must continue into each other seamlessly.
```

The first painted night (superseded):

```text
Generate an image: a seamless 360-degree equirectangular NIGHT sky panorama for a fantasy video game skybox, wide 2:1 landscape format. Fully hand-painted stylized look, like a gouache and oil painting with soft visible brush strokes, painterly and illustrative, not photographic. Deep indigo and navy blue at the very top fading to a muted moonlit teal-blue glow along the horizon line, which sits exactly at the vertical middle of the image. Scattered soft painted stars of varied sizes (a few brighter four-point twinkles, many tiny dots), a faint painterly band of starry haze arcing across, and soft drifting night clouds with silvery moonlit edges and deep blue-violet bodies near the horizon. Calm, magical, readable, not pitch black. No moon disc, no planets. The bottom half of the image, below the horizon, is only a soft dark blue haze gradient: no land, no sea, no mountains, no trees, no objects. No text, no watermark. The left and right edges must continue into each other seamlessly.
```

## Eastbrook painted props: concept images

The concept images for the Eastbrook props that replace the KayKit models at the harbour, the
churchyard and the town square were made the same way (ChatGPT image generation, text prompt
only). They are pipeline inputs, not shipped files: each one fed one Tripo image-to-3D run of
`scripts/asset_pipeline/pipeline.mjs prop`. Every prompt shares one style suffix:

```text
Hand-painted texture style like a gouache and oil painting with visible brush strokes, chunky slightly exaggerated proportions, soft imperfect organic shapes with no perfectly straight lines, painted wear and lighter edges, warm sunlit top and cooler shaded sides painted into the colours, rich earthy palette. Three-quarter front view from slightly above, the whole object visible and centred, plain light grey background, soft even lighting, no cast shadow, no ground plane, no text, no other objects.
```

Each prompt opens with `Generate an image: one single game prop concept for a stylized dark-fantasy action RPG [harbour | churchyard | town square], to be turned into a 3D model:` followed by its subject:

| Concept | Subject |
|---|---|
| barrel | a wooden cargo barrel with two dark iron hoops and a fitted lid, staves slightly bowed and weathered with a few nicks; iron painted matte with soft highlights (not chrome) |
| crate | a sturdy closed wooden cargo crate made of thick nailed planks with darker corner braces and iron nail heads, slightly warped and weathered |
| fishcrate | an open wooden crate with no lid, filled to the top with fresh silver-blue fish on a bed of straw, thick nailed planks, slightly warped and weathered |
| sack | a plump burlap grain sack, tied closed at the top with a twist of rope, slumped naturally with soft folds and a stitched patch |
| anchor | a heavy old ship anchor standing upright on its crown, thick chunky shank and curved flukes, a big ring at the top with a coil of thick hemp rope wrapped around the shank; dark iron painted matte with soft painted highlights on the edges and warm rust streaks, not chrome |
| dinghy | a small wooden rowing dinghy boat with overlapping weathered planks, chipped blue-green paint on the outside, a worn plank bench seat, two wooden oars resting inside and a coil of rope at the bow (no water) |
| ship | a two-masted fantasy merchant sailing ship at anchor, warm honey-brown wooden hull with darker plank lines, a cobalt blue and faded gold painted trim stripe, cream canvas sails patched in places and partly furled, rope rigging, a small raised stern cabin with a lantern, chunky stylized storybook proportions with a gently curved hull (side three-quarter view, no water) |
| watchtower | a small harbour watchtower about three storeys tall: a squat round base of rough grey and sandy fieldstone with mossy lower courses, a half-timbered upper storey with cream plaster and dark timber beams, a wooden lookout balcony with a rail, and a steep slate-blue conical shingled roof with a small iron lantern at the top; slightly leaning and bulging, chunky storybook fantasy proportions |
| fence | one straight section of churchyard fence about three metres long: a low mossy fieldstone kerb wall at knee height running between two short square stone pillars with rounded caps, and a row of chunky dark wrought-iron bars with simple spear tips rising from the kerb, joined by one iron rail near the top, a little ivy on one pillar (straight front view) |
| bench | a sturdy wooden town bench without a backrest, three thick slightly bowed planks on two chunky carved wooden legs with simple cross braces and a few iron nail heads, weathered and worn smooth where people sit |
