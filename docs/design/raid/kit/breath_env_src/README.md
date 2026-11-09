# The Breath vein's painted kit: sources

The Breath redone in the painted style the Hammer vein's rebuild set (design doc section
5.23), its element kept: storm granite carved by the gale, sky-blue crystal, pale lichen,
a storm sky. `paintings/` and `sheets/` are the ChatGPT images as WebP. The Tripo builds
and the full-size images stay local (`tmp/breath_env/`).

## Rebuild

Split each sheet into its three views (`spire`, `bluff`, `arch`, `stone`):

```bash
node scripts/assets/smith_heart_hammer_colossi/split_views.mjs docs/design/raid/kit/breath_env_src/sheets/bv_sheet_spire.webp tmp/breath_env/spire/views
```

Build each with Tripo (the key from the repo-root `.env`; a rerun resumes the task recorded in
its `job.json` and never pays twice; the face limit is the table's):

```bash
node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/breath_env/spire 3000
```

Then grade and size the sources, build the kit in Blender and ship it:

```bash
node scripts/assets/smith_heart_breath_env_kit/prepare_sources.mjs docs/design/raid/kit/breath_env_src/paintings tmp/breath_env tmp/breath_env/kit
"<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_breath_env_kit.py -- --src tmp/breath_env/kit --out tmp/breath_env/smith_heart_breath_env_kit_components.glb
node scripts/assets/smith_heart_breath_env_kit/build.mjs
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_breath_env_kit.glb
node scripts/build_media_manifest.mjs generate
```

`prepare_sources.mjs` puts each Tripo atlas's stone on the storm ramp by value (deep slate-violet
shade, blue-grey body, a dull silver where the wind scours it; the builds came back a washed
lavender, and a paler top read as the Quench's ice), sparing the lichen and the crystal, and folds
the sky's last columns over its first so its wrap is continuous.

| Model | Node | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|---|
| A tall wind-carved spire stack | `Env_StormSpire` | `sheets/bv_sheet_spire.webp` | `c76db8e7-a0ee-4ae2-b826-071fb51ebaef` | 3000 | 110 |
| A broad bluff of slanting beds | `Env_StormBluff` | `sheets/bv_sheet_bluff.webp` | `c17a9424-98ee-411e-bd65-e3688c1e882e` | 2500 | 110 |
| A stepped crag with a wind arch | `Env_StormArch` | `sheets/bv_sheet_arch.webp` | `f9d30be4-6125-4a11-bba3-42bf3202d861` | 3000 | 110 |
| A standing stone crowned with crystal | `Env_StormStone` | `sheets/bv_sheet_stone.webp` | `07f1774d-7582-4d7d-95dc-439d61e3d451` | 2500 | 110 |

## The prompts

Each was its own ChatGPT chat, with an image from the Hammer's rebuild attached as the style
(`../hammer_env_src/`).

**Sheets.** `hv_sheet_cliff_tall.webp` attached for the format and the painted style:

> Generate an image: a three-view orthographic turnaround sheet of ONE game environment asset,
> in exactly the format and hand-painted style of the attached image (the same chunky faceted
> stone, thick painterly strokes, stylised low detail), but with a new palette and a new shape,
> both described below. Show the FRONT view, the LEFT side view and the BACK view, side by side
> from left to right, at one scale on one ground line, on a flat dark navy background with clear
> wide gaps between the views, no floor shadow, no labels, no text, orthographic with no
> perspective. The asset is one solid piece with no floating parts and no thin pieces.
>
> The palette is a storm-swept mountain summit: cool pale blue-grey granite with soft lavender in
> the shadows, pale silver-white light on the wind-scoured top planes, deeper slate blue in the
> creases, pale sea-green lichen (not olive moss) on a few ledges, and a few small clusters of
> glowing sky-blue crystal. No warm orange, no sand colour, no olive green.
>
> The asset: SUBJECT

- **Spire**: "a TALL wind-carved granite spire stack, about one and a half times taller than
  wide: stacked leaning blocks and blades all tilting the same way as if pushed by a constant
  gale, smooth scooped hollows worn into the windward faces, two round wind holes bored clean
  through its upper half, crisp sharp edges on the downwind side, a few thin glowing sky-blue
  crystal veins in its cracks, pale lichen on its ledges."
- **Bluff**: "a BROAD low bluff of storm granite, about twice as wide as tall: thick tilted beds
  of rock all slanting the same way, their faces scoured smooth and scalloped by the wind,
  overhanging lips on the downwind side, pale lichen along the top, a cluster of glowing sky-blue
  crystal in one crack."
- **Arch**: "a stepped storm-granite outcrop about as wide as it is tall, with a natural
  wind-carved ARCH through its lower middle that the background shows through, smooth scooped
  hollows, a few rounded boulders fused to its foot, pale lichen on its ledges, a cluster of
  glowing sky-blue crystal on one side."
- **Stone**: "a single tall standing STONE shaped by the wind: a slender twisted granite monolith
  about four times taller than it is wide, tapering to its crown, scalloped hollows on one face,
  one round hole bored clean through near the top, a simple carved chevron band round its lower
  body, crowned with a cluster of glowing sky-blue crystal, standing on a low rough stone base."

Every sheet came back on the first attempt and split into its three views.

**Paintings.** Each attached the Hammer's painting of the same surface (`hv_paving`, `hv_cliff`,
`hv_block`, `hv_sky`):

- **`bv_slab`** (the floors): "a perfectly seamless tileable square game texture, seen straight
  from above with no perspective, flat even lighting, no objects, no text, in exactly the
  hand-painted style of the attached texture ... but a different surface and palette: the
  storm-scoured stone floor of a mountain summit. Large flat irregular slabs of pale cool
  blue-grey granite in mixed sizes, fitted together like natural flagstones and parted by narrow
  dark blue-grey cracks; faint parallel wind-polished streaks across the slabs, all running the
  same diagonal direction; a few small shallow scooped hollows; a little pale sea-green lichen in
  some of the cracks. Soft lavender in the shadows, pale silver on the lit slabs. No warm orange,
  no sand colour, no olive green. It must tile seamlessly on all four edges."
- **`bv_cliff`** (the mountain's paint and the stacks' strokes): the same opening, then "a cliff
  face seen front-on ... storm granite on a windswept mountain. Angular planes and blocky ledges
  all slanting the same way, scoured smooth by the wind, cool blue-grey stone with soft lavender
  shadows and pale silver lit planes, a few small patches of pale sea-green lichen on the ledges."
- **`bv_block`** (the low walls and the shelters): the same opening, then "a dry-laid stone wall
  seen front-on ... Large irregular cut blocks in uneven courses with rounded, wind-worn edges,
  cool pale blue-grey stone with soft lavender-grey shadows in the joints and pale silver on the
  lit faces." ChatGPT returned two; this is the rounder, wind-worn one. Its courses do not line up
  top to bottom, so the Blender build keeps every face inside one repeat up its height.
- **`bv_sky`**: "a wide 2:1 panorama of a sky, seamless from its left edge to its right edge, in
  exactly the painted style of the attached sky ... a storm over a high mountain summit. A high
  deck of painterly storm cloud streaming in one direction, cool slate blue and blue-violet, with
  one bright rift where pale silver light breaks through; a soft pale blue-grey haze filling the
  lower third. No ground, no mountains, no birds, no lightning, no text." (The dome's own
  lightning walks it.)
