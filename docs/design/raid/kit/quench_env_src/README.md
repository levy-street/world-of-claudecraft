# The Quench vein's painted kit: sources

The whole ice realm (the Quench, from the Ring's mouth down both landings and the Singing Ice
to the Frozen Lake) redone in the painted style the Hammer's rebuild set (design doc section
5.24), from the owner's arena concept: a dark frozen lake ringed by glacier, frozen falls and
crystal under an aurora night, four great swords of ice sunk in the lake, the Smith's carved
fire bowls the one warm thing. The realm sits darker and more saturated than the pale frost
guardian and its adds, so they stand out against it. `concept/`, `sheets/` and `paintings/`
are the ChatGPT images as WebP. The Tripo builds and the full-size images stay local
(`tmp/quench_env/`).

## The concept

`concept/qv_arena_dusk.webp` and `concept/qv_arena_aurora.webp`: two arena concepts, each its
own ChatGPT chat with the earth room's arena concept (the owner's, the ruined amphitheatre)
attached as the style. The build took the aurora night and its ring of frozen falls, and the
dusk's colossal frozen waterfall across the lake as the centrepiece.

> Generate an image: a wide 16:9 landscape concept painting of a boss arena for a stylised
> fantasy MMO, epic in scale, in exactly the hand-painted style of the attached image (the
> same thick painterly strokes, chunky faceted shapes, stylised low detail ...), but a new
> place and palette, both described below. The arena is empty: no characters, no creatures,
> no people, no text, no UI.
>
> The place: the Frozen Lake, a great round arena that is a frozen mountain lake ringed by
> colossal ice. [The lake's dark clear ice, a towering ring of glacier like a colosseum (or a
> crown) of ice: fused columns, frozen waterfalls on dark rock, teal and cyan grooves with a
> faint glow, icicles, crystal spires along the top; four enormous swords of ice sunk point
> first with horned crossguards and a glowing groove; four carved stone fire bowls; frost-
> cracked standing stones with a chevron band; nothing metal or wood.]
>
> The palette: [a cold dusk with a haloed low sun / a cold clear night with a green-teal and
> violet aurora]. Keep the lake floor darker and calmer than the ice walls around it, never
> pale white.

## Rebuild

Split each sheet into its three views (`sword`, `glacier_tall`, `glacier_wide`, `spires`,
`fall`, `plates`, `bowl`, `stone`):

```bash
node scripts/assets/smith_heart_hammer_colossi/split_views.mjs docs/design/raid/kit/quench_env_src/sheets/qv_sheet_sword.webp tmp/quench_env/sword/views
```

Build each with Tripo (the key from the repo-root `.env`; a rerun resumes the task recorded in
its `job.json` and never pays twice; the face limit is the table's):

```bash
node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/quench_env/sword 4000
```

Then grade and size the sources, build the kit in Blender and ship it:

```bash
node scripts/assets/smith_heart_quench_env_kit/prepare_sources.mjs docs/design/raid/kit/quench_env_src/paintings tmp/quench_env tmp/quench_env/kit
"<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_quench_env_kit.py -- --src tmp/quench_env/kit --out tmp/quench_env/smith_heart_quench_env_kit_components.glb
node scripts/assets/smith_heart_quench_env_kit/build.mjs
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_quench_env_kit.glb
node scripts/build_media_manifest.mjs generate
```

`prepare_sources.mjs` grades each Tripo atlas by what a texel is
(`scripts/assets/smith_heart_quench_env_kit/quench_grade.mjs`): the rock onto a deep slate ramp
(the builds came back a washed lavender), the ice a little richer, the snow cooled, the fire
bowls' coals left warm; the pieces of ice (the sword, the plates, the spires) take only a
little of it, since the rock's ramp would turn their pale facets to slate. ChatGPT painted the
stone a saturated cobalt, which the night's blue light doubled into one blue: the rime, the
cliff and the masonry are taken toward the slate (`gradePainting`), the lake keeps its teal. The
sky's last columns are folded over its first so its wrap is continuous.

| Model | Node | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|---|
| The fight's great sword of ice | `Env_IceSword` | `sheets/qv_sheet_sword.webp` | `ea227113-09d0-49a9-8384-9de547efd20a` | 4000 | 110 |
| A tall glacier cliff stack | `Env_GlacierTall` | `sheets/qv_sheet_glacier_tall.webp` | `b2e27259-b214-4efa-b280-548d73ef6444` | 3000 | 110 |
| A broad glacier bluff | `Env_GlacierWide` | `sheets/qv_sheet_glacier_wide.webp` | `d821c876-a364-4345-a51c-5ff14f718a43` | 3000 | 110 |
| A cluster of ice crystal spires | `Env_IceSpires`, `Env_IceCluster` | `sheets/qv_sheet_spires.webp` | `c47ce959-9e79-4260-b740-4a10793ac580` | 3000 | 110 |
| A frozen waterfall | `Env_FrozenFall` | `sheets/qv_sheet_fall.webp` | `b5e61591-45a2-4437-bc61-d49ef84cae84` | 3000 | 110 |
| A heap of broken lake ice | `Env_IcePlates` | `sheets/qv_sheet_plates.webp` | `4b8070c4-0769-4124-a3d6-38d23f128464` | 2500 | 110 |
| The Smith's carved fire bowl | `Env_FireBowl` | `sheets/qv_sheet_bowl.webp` | `dcdb4109-3bfd-40a5-97c3-096a902ef98f` | 2500 | 110 |
| A chevron standing stone | `Env_ChevronStone` | `sheets/qv_sheet_stone.webp` | `c4fe13a6-0bdd-464b-8d4b-896a69abb80c` | 2500 | 110 |

880 credits in all, every model on its first build. Blender builds the rest as low-poly
pieces on the paintings: the low walls over the void, the vents, the swords' collars of heaved
plates and their fuller strips (laid on the blade's own faces, found by casting rays at it).

## The prompts

Each was its own ChatGPT chat. A sheet attached the Breath's `bv_sheet_spire.webp` (the format)
and the aurora concept (the look):

> Generate an image: a three-view orthographic turnaround sheet of ONE game environment asset.
> Copy the FORMAT of the first attached image (three views of one asset side by side on a flat
> dark navy background) and the LOOK of the second attached image, the ice arena painting (its
> hand-painted style, thick painterly strokes, chunky faceted shapes, stylised low detail and
> its palette). Show the FRONT view, the LEFT side view and the BACK view, side by side from
> left to right, at one scale on one ground line, on a flat dark navy background with clear
> wide gaps between the views, no floor shadow, no labels, no text, orthographic with no
> perspective. The asset is one solid piece with no floating parts and no thin loose pieces.
> Do not draw a scene: only the three views of the asset.
>
> The palette is the ice arena's: dark slate-blue granite with snow on its ledges, ice in
> saturated deep teal, cyan and blue with crisp pale highlights and a faint cold glow inside
> its grooves, glowing cyan crystal. Nothing warm, no metal, no wood.
>
> The asset: SUBJECT

- **Sword**: "ONE enormous greatsword made entirely of ice, standing upright with its point
  down ... a broad flat faceted blade, deep blue in its thick heart and milky pale at its
  chipped keen edges, a glowing cyan groove running down the middle of the blade on both faces,
  a crossguard of two swept horns of ice curving upward, a grip wrapped in frost, a faceted
  crystal pommel at the top." Its first sheet's side view was too thin to split; one correction
  asked for a chunkier sword with a thick diamond-shaped cross-section.
- **Glacier tall**: "a TALL glacier cliff stack ... dark slate-blue rock almost buried under
  ice, fused columns of ice bulging in freeze rings pouring down its faces as frozen
  waterfalls ... heavy icicle beards under every ledge, snow on its ledges, a few glowing cyan
  ice crystal shards jutting from its top."
- **Glacier wide**: "a BROAD low glacier bluff ... thick beds of dark slate-blue rock capped by
  a thick sheet of glacier ice that spills over its front edge in frozen curtains and icicles."
- **Spires**: "a cluster of giant ICE CRYSTAL spires ... five to seven long faceted six-sided
  crystals of clear cyan-blue ice of different heights growing up and slightly outward from one
  rough base of dark slate rock with snow on it, glowing faintly from inside."
- **Fall**: "a FROZEN WATERFALL ... a thick column of fused ice pouring over a notch of dark
  slate rock at its top, frozen mid-fall, bulging in freeze rings ... an icicle beard down each
  side, a frozen splash of ice and snow spreading at its foot."
- **Plates**: "a HEAP of broken old lake ice ... thick slabs of teal-blue ice shoved up and
  upended, flat plates lying low at the front and jagged plates standing tilted in a crest
  behind, chipped milky edges, snow in their hollows, icicles under their brows."
- **Bowl** (its palette dark slate with glowing orange coals the only warm colour): "a carved
  stone FIRE BOWL ... a wide round bowl of dark slate-blue stone with a thick rolled rim and a
  deep carved chevron band running round it, on a short fluted pedestal standing on a square
  stepped plinth, the bowl filled with a bed of glowing orange coals (no flame above them)."
- **Stone**: "a single standing STONE ... a squared, slightly tapering monolith of dark
  slate-blue stone with a deep carved chevron band across its middle, frost cracks with glowing
  cyan ice grown into them, snow on its head and shoulders, standing on a low rough stone base."

**Paintings.** Each attached the Breath's painting of the same kind of surface (`bv_slab` for
the floors and the snow, `bv_cliff`, `bv_block`, `bv_sky`) for the format and the aurora
concept for the palette: "a perfectly seamless tileable square game texture, seen straight
from above (or front-on) with no perspective, flat even lighting, no objects, no text, in
exactly the hand-painted style of the first attached texture ... in the palette of the second
attached painting", then:

- **`qv_lake`**: "thick clear lake ice seen from directly above, dark deep teal and
  blue-green, crossed by a web of long pale straight-run cracks, a few small clusters of frozen
  bubbles, faint patches of frost film and soft streaks of polish ... it stays dark."
- **`qv_rime`**: "the frost-bound rock shore round a frozen lake. Large flat irregular
  flagstones of dark slate-blue granite in mixed sizes ... parted by narrow joints packed with
  white rime and snow."
- **`qv_cliff`**: "frozen dark slate-blue granite. Angular planes and blocky ledges glazed with
  thin sheets of teal ice, small icicles under the ledges, snow on every ledge."
- **`qv_block`**: "large irregular cut blocks of dark slate-blue granite in uneven courses,
  rime and frost in the joints and along the edges."
- **`qv_snow`**: "deep soft snow. Gentle wind-carved drifts and ripples of snow in broad soft
  shapes, pale blue-white on the lit sides and soft blue-violet in the hollows."
- **`qv_sky`**: "a wide 2:1 panorama of a sky, seamless from its left edge to its right edge
  ... a clear cold night over a frozen lake. A deep navy and indigo sky full of small painterly
  stars, a great flowing ribbon of green-teal and violet aurora across its upper half, a faint
  pale blue-grey haze filling the lower third. No ground, no mountains, no moon, no text." (The
  dome draws the moon itself, where the night's key light comes from.)

Every painting and every sheet but the sword came back on the first attempt.
