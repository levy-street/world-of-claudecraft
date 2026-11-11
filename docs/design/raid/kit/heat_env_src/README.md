# The Heat vein's painted kit: sources

The Hearth (the Heat vein, the raid's fire) redone in the painted style the Hammer's rebuild
set and the Breath and the Quench followed: a great eight-sided hall of dark columnar basalt
over a chasm, the Hearth's crystal-throated mouth in its wall, the dolmen altar-stone, the
first flame's white-gold crystal, and molten rock as an accent only (the owner's call,
2026-11-10: "a mix with molten but don't overdo it"): the wellspring's pool, the channel, the
seams in a few joints, one great fall across the chasm. `concept/`, `sheets/` and `paintings/`
are the ChatGPT images as WebP. The Tripo builds and the full-size images stay local
(`tmp/heat_env/`).

## The concept

`concept/fv_arena_dusk.webp` and `concept/fv_arena_night.webp`: two arena concepts, each its
own ChatGPT chat with the earth room's arena concept (the owner's, the ruined amphitheatre)
attached as the style. The build follows the dusk (A): its restrained molten, the smoky
white-gold sun and the one far molten fall; the night (B) lent its taller column stacks.

> Generate an image: a wide 16:9 landscape concept painting of a boss arena for a stylised
> fantasy MMO, epic in scale, in exactly the hand-painted style of the attached image (the
> same thick painterly strokes, chunky faceted shapes, stylised low detail and readable big
> value groups), but a new place and palette, both described below. The arena is empty: no
> characters, no creatures, no people, no text, no UI.
>
> The place: the Hearth, the mountain's first flame. [A great eight-sided hall of dark
> columnar basalt on the flank of a mountain over a deep chasm; a floor of hexagonal column
> heads with ash in the joints; the vast natural mouth framed by a fan of basalt columns,
> its throat crowded with prisms of glowing white-gold crystal; a dolmen altar-stone with a
> crack of white-gold fire and crystal at one end; a low mound of column stumps brimming
> with a pool of molten fire, a channel to the hall's edge spilling into the chasm; bundles
> of tall basalt columns at the corners; low walls of stacked stumps; one molten fall across
> the chasm; nothing made by hands.]
>
> The palette: mostly dark sooted basalt in cool charcoal and slate greys with warm umber
> shadows; the first flame's crystal and its light a glowing white-gold; molten rock
> red-orange but used sparingly ... never a lava lake or rivers everywhere. [A smoky dusk with
> a hazy white-gold sun / an ember night of smoke lit from below.] Keep the floor darker and
> calmer than the glowing mouth and crystal.

## The dressed pass (2026-11-10)

`concept/fv_arena_dressed.webp`: ChatGPT's paint-over of an in-game screenshot of the hall
(the first rebuild) with the dusk concept attached as the look, asked for a richer version of
the same place: the background basalt dressed with molten seams and branching cracks, thin
falls pouring down the far cliffs, small molten pools at the cliffs' feet, smoke and embers,
the floor kept dark and calm. The owner's direction from there: procedural shader veins on
the old rock were tried and rejected ("looks ass"), then Tripo models of the concept's own
cliffs, the background molten a darker orange so the guardian pops, and the whole hall "as
close as possible" to the concept. Six more sheets, each a crop of the concept's own cliff
attached with the format sheet: a tall and a broad stack of seamed basalt (`seam_tall`,
`seam_wide`, the molten in branching seams down the joints), a thin molten fall (`fall_thin`),
the concept's great fall cliff (`great_fall`), its tiered cliff wall with thin falls
(`cliff_wall`) and a low molten shore of stumps and pools (`molten_shore`). Their atlases take
the grade's `seams` and `deep` options (`heat_grade.mjs`: the thin molten kept, grown by a
texel and haloed, and the deep orange ramp `HEAT_DEEP_MOLTEN`).

## Rebuild

Split each sheet into its three views (`hearth`, `altar`, `crystal`, `boulder`, `columns`,
`cliff_tall`, `cliff_wide`, `fall`, and the dressed pass's `seam_tall`, `seam_wide`,
`fall_thin`, `great_fall`, `cliff_wall`, `molten_shore`):

```bash
node scripts/assets/smith_heart_hammer_colossi/split_views.mjs docs/design/raid/kit/heat_env_src/sheets/fv_sheet_hearth.webp tmp/heat_env/hearth/views
```

Build each with Tripo (the key from the repo-root `.env`; a rerun resumes the task recorded in
its `job.json` and never pays twice; the face limit is the table's):

```bash
node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/heat_env/hearth 4000
```

Then grade and size the sources, build the kit in Blender and ship it:

```bash
node scripts/assets/smith_heart_heat_env_kit/prepare_sources.mjs docs/design/raid/kit/heat_env_src/paintings tmp/heat_env tmp/heat_env/kit
"<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_heat_env_kit.py -- --src tmp/heat_env/kit --out tmp/heat_env/smith_heart_heat_env_kit_components.glb
node scripts/assets/smith_heart_heat_env_kit/build.mjs
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_heat_env_kit.glb
node scripts/build_media_manifest.mjs generate
```

`prepare_sources.mjs` grades each Tripo atlas by what a texel is
(`scripts/assets/smith_heart_heat_env_kit/heat_grade.mjs`): the rock onto a sooted basalt ramp
by value, stretched about its own middle (the builds came back dark and narrow, a warm
brown-violet, with the sheets' orange rim light baked onto every rock edge, which read as fire
everywhere), the first flame's crystal kept and nudged toward white-gold, the molten kept as
built. ChatGPT painted the stone a dusky violet-brown, so `gradePainting` takes the floor, the
cliff and the masonry toward charcoal. The sky's last columns are folded over its first so its
wrap is continuous.

| Model | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|
| The Hearth's mouth | `sheets/fv_sheet_hearth.webp` | `34be7472-988e-4320-bc89-310c7a9abfb2` | 4000 | 110 |
| The dolmen altar-stone | `sheets/fv_sheet_altar.webp` | `ad2d1b4f-f373-448c-9be7-1bb982579127` | 3000 | 110 |
| A cluster of the first flame's crystal | `sheets/fv_sheet_crystal.webp` | `59f29ace-966e-4767-903d-d5a6a2b17082` | 3000 | 110 |
| A basalt boulder split by a molten seam | `sheets/fv_sheet_boulder.webp` | `13458840-ff28-4a5e-af81-a336ae6d1919` | 2500 | 110 |
| A bundle of basalt columns | `sheets/fv_sheet_columns.webp` | `8390d54c-809d-4878-8f86-a99434fd823d` | 3000 | 110 |
| A tall cliff stack of columnar basalt | `sheets/fv_sheet_cliff_tall.webp` | `0cbccc68-8a2f-4a03-b9d0-c13ca0763be7` | 3000 | 110 |
| A broad bluff of columnar basalt | `sheets/fv_sheet_cliff_wide.webp` | `d1ddbbb5-b0b4-420d-99d0-78bda1bf31bf` | 3000 | 110 |
| A cliff with one molten fall | `sheets/fv_sheet_fall.webp` | `5887cbb5-3bfe-4829-b638-8762e249cf19` | 3000 | 110 |
| A tall stack of seamed basalt | `sheets/fv_sheet_seam_tall.webp` | `17c494ed-687a-4c40-83c1-cc9d392f158d` | 3000 | 110 |
| A broad bluff of seamed basalt | `sheets/fv_sheet_seam_wide.webp` | `be5f184e-3127-4b0a-b560-7d2c73299d5a` | 3000 | 110 |
| A thin molten fall | `sheets/fv_sheet_fall_thin.webp` | `ed40c75b-40ba-4587-9052-db0791bca708` | 3000 | 110 |
| The concept's great fall cliff | `sheets/fv_sheet_great_fall.webp` | `79df1383-a46f-4556-b597-cdf3ae91cb3a` | 3000 | 110 |
| The concept's tiered cliff wall | `sheets/fv_sheet_cliff_wall.webp` | `eb526187-2bee-42e2-a565-b59bc970adda` | 3000 | 110 |
| A molten shore of stumps and pools | `sheets/fv_sheet_molten_shore.webp` | `7c2fbe43-fbf2-460a-9d29-21d2d2bc68a2` | 3000 | 110 |

1,540 credits in all (880 for the first eight, 660 for the dressed pass's six), every model on
its first build.

## The prompts

Each was its own ChatGPT chat. A sheet attached the Breath's `bv_sheet_spire.webp` (the format)
and the dusk concept (the look):

> Generate an image: a three-view orthographic turnaround sheet of ONE game environment asset.
> Copy the FORMAT of the first attached image (three views of one asset side by side on a flat
> dark navy background) and the LOOK of the second attached image, the fire arena painting (its
> hand-painted style, thick painterly strokes, chunky faceted shapes, stylised low detail and
> its palette). Show the FRONT view, the LEFT side view and the BACK view, side by side from
> left to right, at one scale on one ground line, on a flat dark navy background with clear
> wide gaps between the views, no floor shadow, no labels, no text, orthographic with no
> perspective. The asset is one solid piece with no floating parts and no thin loose pieces.
> Do not draw a scene: only the three views of the asset.
>
> The palette is the fire arena's: dark sooted basalt in cool charcoal and slate greys with
> warm umber shadows and faint soot, glowing white-gold crystal, and red-orange molten rock
> used sparingly in thin seams only. No metal, no wood, nothing made by hands.
>
> The asset: SUBJECT

- **Hearth**: "the HEARTH MOUTH, a great natural cave mouth set in a thick wall of dark
  basalt: a tall pointed arch framed by a fan of thick six-sided basalt columns radiating
  round it like a sunburst, soot climbing the rock above it; its throat filled with great
  faceted prisms of glowing white-gold crystal ... a large faceted crystal heart glowing deep
  at the back. Seen from the side and the back it is a thick rough solid mass of stacked
  basalt columns."
- **Altar**: "a DOLMEN ALTAR-STONE: three pairs of thick six-sided basalt columns standing on a
  low bed of short column stumps, carrying one great long thick capstone slab of basalt; a
  single jagged crack of glowing white-gold fire runs along the top of the capstone and down
  over its edges; a cluster of chunky white-gold crystal prisms breaks out of one end."
- **Crystal**: "a CLUSTER of the first flame's CRYSTAL: five to seven long thick faceted
  six-sided prisms of glowing white-gold crystal of different heights, the tallest in the
  middle, growing up and slightly outward from a low bed of short dark basalt column stumps,
  each prism warm amber at its root and bright white-gold at its tip."
- **Boulder**: "a long low BOULDER of dark basalt, faceted and chunky, split open along its
  length by one jagged glowing seam of red-orange molten fire that brightens to white-gold deep
  inside, a few short white-gold crystal prisms grown inside the split, soot on its back."
- **Columns**: "a tall BUNDLE of thick fused six-sided basalt columns of different heights
  standing tight together like one natural pillar, their flat heads stepped down from a tall
  middle column, about three times as tall as it is wide, one thin glowing seam of white-gold
  fire in a joint, a few short white-gold crystal prisms breaking out of one side."
- **Cliff tall**: "a TALL CLIFF STACK of dark columnar basalt, a mountain crag nearly twice as
  tall as it is wide and almost as deep as it is wide ... soot streaks, grey ash on the ledges,
  only two or three thin glowing red-orange molten seams in deep joints near its foot."
- **Cliff wide**: "a BROAD low BLUFF of dark columnar basalt, about twice as wide as it is tall
  ... a level broken top, soot streaks down its front, grey ash on its ledges, one thin
  glowing red-orange molten seam in a deep joint."
- **Fall** (its palette without the "sparingly"): "a MOLTEN FALL: a tall narrow cliff of dark
  columnar basalt, about three times as tall as it is wide, with a notch at its top where a
  single stream of glowing red-orange molten rock pours over and falls straight down its front
  face as one thick ribbon, bright white-gold at its core and crusting dark red at its edges,
  spreading into a small glowing molten pool at the cliff's foot."

**Paintings.** Each attached the Breath's painting of the same kind of surface (`bv_slab` for
the floor, `bv_cliff`, `bv_block`, `bv_sky`) for the format and the dusk concept for the
palette: "a perfectly seamless tileable square game texture, seen straight from above (or
front-on) with no perspective, flat even lighting, no objects, no text, in exactly the
hand-painted style of the first attached texture ... in the palette of the second attached
painting", then:

- **`fv_floor`**: "the flat hexagonal heads of basalt columns seen from directly above ... each
  head worn to a low smooth dome ... narrow deep dark joints with pale grey ash packed into
  some stretches. No glow, no fire." Its first take read as rounded pebbles; one correction
  asked for every head clearly six-sided with straight edges and crisp corners, an irregular
  honeycomb.
- **`fv_cliff`**: "a cliff face of dark columnar basalt seen front-on: tall vertical six-sided
  columns standing side by side with crisp vertical edges and flat faces, broken here and there
  by short stepped ledges, soot streaks running down, a little pale grey ash on the ledges."
- **`fv_block`**: "a low wall of stacked dark basalt seen front-on: short broken lengths of
  six-sided basalt columns laid on their sides in uneven rows ... dark joints with pale grey ash
  in them, soot."
- **`fv_sky`**: "a wide 2:1 panorama of a sky, seamless from its left edge to its right edge
  ... a smoky dusk over a fiery chasm: a deep warm slate and dusky violet sky overhead, great
  slow billows of grey-brown smoke drifting across its lower half, their undersides lit warm
  gold and soft orange from below, a faint hazy white-gold glow along the lower edge. No
  ground, no mountains, no sun, no moon, no text." (The dome draws the sun itself.)

Every sheet and painting but the floor came back on the first attempt.
