# Generating leaf source art for the Deepglass tree atlas

What `compose_leaf_atlas.py` needs, and the prompts that produce it.

## Settings (Magnific → Image Generator)

| Setting | Value | Why |
| --- | --- | --- |
| Model | GPT Image 2.5 |, |
| Mode | **Flare** | Sunburst preserves faces/logos/products across edits; there is nothing to preserve here and Flare is faster. |
| Transparent background | **ON** | The alpha IS the asset. |
| Aspect | **1:1** | Not 16:9, a sprig is roughly square and 16:9 wastes most of the canvas. |
| Size | 1K is plenty | Each finished atlas cell is 512px, and a sprig is scaled well below that. |
| Count | 4 per prompt | Variation is the point; I use several per cell. |

## Hard requirements

These are what make a generated leaf usable rather than something I have to fight:

1. **Stalk at the BOTTOM, tip at the TOP, vertical.** The composer rotates each
   leaf about its own length axis. If the source is diagonal, every placement
   inherits that lean and the whole cell tilts.
2. **Flat-on.** No perspective, no foreshortening, no three-quarter view.
3. **Even ambient light, no cast shadow, no ground plane, no contact shadow.**
   The engine lights these. A baked shadow fights it from every angle the card
   is not facing.
4. **No frame, vignette, border, text, watermark, or drop shadow.**
5. **Clean alpha**, no white or grey halo. Check by dropping the PNG on a dark
   background; a fringe there will show as a light rim on every leaf in game.
6. **One subject, centred, filling most of the canvas.**

## Prompts

### 0a. Feathery painted spray, closest to the homemade look, higher craft

The painted atlas read well because of two things the generated fronds keep
losing: **hair-thin tapering tips** (the wispy edge is what makes a spray look
soft rather than cut out) and **internal value range** (near-black in the
shaded interior lifting to a pale sage on the lit tips). Generations that come
back as one flat dark mass have neither, and no amount of arranging fixes it , 
they stack into a black blob, which is what the current tree is doing.

So ask for the brushwork explicitly, and ask for the value range explicitly:

> Hand-painted stylised conifer foliage spray, World of Warcraft art style,
> visible painterly brush strokes, fine soft needles tapering to hair-thin
> wispy tips, feathery and airy with delicate open edges, drooping and curving
> downward, strong internal value range from near-black deep in the shaded
> interior to pale sage green on the lit outer tips, soft feathered silhouette
> not a solid mass, seen completely flat-on and face-on, isolated cut-out on
> transparent background, even soft ambient lighting, no cast shadow, no
> ground, no frame, no text, high quality painterly game texture asset

Judge each generation on one question: **can you see individual needle tips
against the background at the edge?** If the outline is a smooth dark boundary,
reject it, that is the flat-blob failure and it is the only one that matters.

If they keep coming back flat, add `, thin delicate needles clearly separated
from each other, gaps of empty space between the needle clusters`.

### 0b. Drooping Grizzly Hills frond, the tiered Northrend silhouette

The classic WotLK conifer reads the way it does because each bough is a LONG,
NARROW, SPARSE frond that hangs and sweeps downward, with real gaps you can see
sky through. The tree's complexity comes from many simple fronds overlapping at
different angles, not from each frond being busy. A dense compact sprig will
never stack into that silhouette.

Note the orientation is the OPPOSITE of a single leaf: a drooping frond attaches
at the TOP and hangs down, which is also how the atlas cells are anchored.

> Hand-painted stylised conifer branch frond, World of Warcraft Wrath of the
> Lich King art style, one long narrow spruce bough hanging straight downward,
> thick attachment at the top and a long pointed drooping tip at the bottom,
> sparse widely spaced needle clusters along a central stem with clear gaps
> between them, tall narrow proportions roughly three times taller than wide,
> very dark blue-green almost silhouette, seen completely flat-on and face-on,
> isolated cut-out on transparent background, even soft ambient lighting, no
> cast shadow, no ground, no frame, no text, painterly game texture asset

Run it 4 to 6 times and keep the ones that are **sparsest**. If they come back as
solid dark masses, add `, thin and wispy, mostly empty space, only five or six
needle clusters`, over-dense is the usual failure and it is the one that kills
the look.

### 1. Conifer sprig, matches what ships now

> Hand-painted stylised conifer branch sprig, World of Warcraft art style, single
> short spruce twig with dense dark green needles, seen completely flat-on and
> face-on, stalk at the bottom and tip at the top, vertical, isolated cut-out on
> transparent background, even soft ambient lighting, no cast shadow, no ground,
> no frame, no text, painterly game texture asset, readable at small size

### 2. Broadleaf sprig, the War Within look

> Hand-painted stylised broadleaf branch sprig, World of Warcraft art style, thin
> brown twig with a dozen small rounded oval leaves, greens varying from deep
> shadow green to bright yellow-green within the sprig, seen completely flat-on,
> stalk at the bottom and tip at the top, vertical, isolated cut-out on
> transparent background, even soft ambient lighting, no cast shadow, no ground,
> no frame, no text, painterly game texture asset

### 3. Single leaf, most flexible, I scatter these myself

> Hand-painted stylised single tree leaf, World of Warcraft art style, simple
> pointed oval shape with a visible central vein, flat-on, stalk at the bottom
> and tip at the top, perfectly vertical, isolated cut-out on transparent
> background, even soft ambient lighting, no cast shadow, no gradient background,
> no frame, no text, painterly game texture asset, bold readable silhouette

### 4. Snow-laden sprig, optional

The composer makes snow twins automatically by lifting the upper part of each
leaf toward white, so this is only worth generating if you want snow that looks
hand-placed rather than derived.

> Hand-painted stylised conifer sprig laden with snow, World of Warcraft art
> style, dark green needles with thick soft snow resting along the upper
> surfaces only, flat-on, vertical, stalk at the bottom, isolated cut-out on
> transparent background, even ambient light, no cast shadow, no ground, no
> frame, no text, painterly game texture asset

### 5. Variation pass

Re-run 1 or 2 with ONE of these appended, to widen the set:

- `, slightly yellowed older foliage`
- `, sparse and windblown, fewer leaves`
- `, young bright spring growth`
- `, deep shadow side, very dark`

## Bark

### Generate the COLOUR map only

An image model cannot produce a usable normal, roughness or AO map. Ask for a
"normal map" and you get a purple picture that looks the part and means
nothing, the channels do not encode a real surface gradient, so it lights
wrong from every angle. Generate the **colour map**, derive the rest from it.
That is what the repo already does for the existing trunks (`bark()` in
make_tree_atlas.py derives its trunk bark from a plain colour JPG).

**Change these settings for bark**, they differ from the leaves:

| Setting | Value | Why |
| --- | --- | --- |
| Transparent background | **OFF** | Bark is full-bleed; there is nothing to cut out. |
| Aspect | **1:1** | Square tiles. |
| Size | 1K | Matches the terrain library, and the trunk never shows more than a couple of tiles. |

### Prompt, the Northrend conifer trunk

> Seamless tileable bark texture, hand-painted stylised World of Warcraft Wrath
> of the Lich King art style, pale grey-brown conifer trunk, long straight
> vertical striations and shallow flaking plates, soft painterly edges, flat
> even ambient lighting with no directional light and no cast shadows, no
> highlights baked in, photographed perfectly straight on and flat, uniform
> across the whole image, no vignette, no border, no frame, no text, colour map
> only, top-down orthographic surface detail

### Variants worth having

Append ONE of these:

- `, deep cracked furrows, older growth`, the big root trees
- `, patches of pale green lichen and moss`, matches Wood004's role
- `, snow dusted in the crevices`, the snow-laden set
- `, dark wet after rain`, a value variant

### The two things that will go wrong

1. **It will not actually tile.** Image models are poor at this however much you
   say "seamless". Expect a visible seam, and expect to fix it rather than
   reroll it, an offset-and-heal pass is reliable, rerolling is not.
2. **It will bake in lighting.** Albedo must be FLAT: a texture with a
   highlight down one side lights wrong on every part of the trunk that is not
   facing that way. If a generation has an obvious light direction, reject it;
   that is not fixable later.

Check both by tiling the image 2x2 and looking at the joins and at whether one
quadrant reads brighter than another.

### Deriving the other maps

Ask me and I will write the deriver, the usual chain is luminance → height,
Sobel gradient → normal, inverted-and-levelled luminance → roughness, and a
blurred cavity pass → AO. Worth knowing before you spend credits: **the tree
material currently uses colour only** (no normal, no roughness), so for these
trees the colour map alone is the whole job. The other maps only matter if we
put bark on something with a proper PBR material.

## What to do with them

Drop every PNG you like into:

```
scripts/assets/deepglass/tree_tex/src/leaves/     (fronds: tree_tex/src/fronds/)
```

(checked in: the foliage painter reads them from there)

Filenames do not matter. Mixed sizes are fine, each is cropped to its own alpha
before use. **8 to 16 good ones is plenty**; more variety beats more quantity, and
a set that spans dark to light matters more than a set that is all mid-green.

Then the chain is:

```bash
python3 scripts/assets/deepglass/compose_leaf_atlas.py
DG_LEAF_RENDER=1 python3 scripts/assets/deepglass/make_tree_atlas.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python \
    scripts/assets/deepglass/bl_dg_trees.py -- tmp/tidehold/work/trees
node scripts/assets/deepglass/finish_dg_trees.mjs tmp/tidehold/work/trees
```

The composer flood-fills every cell and warns if any leaf would end up as an
island, a leaf island in the art is a leaf floating in mid air on the tree.

## Things that will waste your credits

- **16:9.** A sprig is square; you are paying for empty canvas.
- **"photorealistic" or "3D render".** Produces a busy asset that reads as noise
  at game scale and loses the silhouette. We tried it; it did not work.
- **A whole tree.** The atlas holds foliage only, the trunk, branches and
  canopy layout are geometry.
- **Prompts without "flat-on".** You get a three-quarter view with foreshortening
  that cannot be laid flat onto a card.
