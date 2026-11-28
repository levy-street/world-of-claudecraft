# The Ring crystal: sources

The heart seal at the middle of the Ring's dais, one crystal that holds all four elements
(`public/models/props/smith_heart_ring_crystal.glb`, design doc section 5.13), built by
`scripts/assets/smith_heart_ring_crystal/` from the Blender step
`docs/design/raid/kit/build_smith_heart_ring_crystal.py`. `sheets/` is the owner's approved
ChatGPT turnaround sheet as WebP. The Tripo builds, the rejected sheets and the full-size images
stay local (`tmp/ring_crystal/`).

| What | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|
| The shipped crystal | `sheets/ring_crystal_sheet_v4.webp` | `02fdff39-6b3a-4fe0-a148-df44cf4d782c` | 14000 | 110 |
| Rejected: a low, even fan of four clusters | local only | `b01f9eb8-12fa-450c-a790-edac29f17c90` | 10000 | 110 |
| Rejected: the tall bouquet, thin shards | local only | `df3ebd9a-cddb-4ac1-a5eb-689128dbd5de` | 14000 | 110 |

Every build used texture size 2048. The last sheet is the owner's call of 2026-11-18, after the
amber cluster of the third sheet was named the best: the other three elements were asked to be
as big, bold and chunky as it.

## What the model is

One crystal on a broad plinth of dark granite slabs spread to the seal's inner circle (8.5 yd,
`SEAL_CRYSTAL.r` / `RING_CRYSTAL.plinthR`), 18.85 yd tall: a white-gold heart shaft standing
straight up, with the Hammer's amber (south), the Quench's ice (east), the Breath's storm (north)
and the Heat's fire (west) grown round it. The sheet's chirality is the mirror of the Ring's
compass, so the build turns and mirrors it to put each element on its own vein's side, in the
game's frame (north +z). Tripo writes a heap of over a thousand separate shells, but they are
only its UV seams: welded, the model is a dozen solids (the plinth, the heart's shaft, a few fused
formations and the loose crystals round them). The build cuts those into the pieces the burst
throws, each its own node: the plinth in six sectors, the heart's shaft, and the crystal's own
PRISMS: the skin parts at the inward folds where one prism meets the next (`--seam-deg`), so
each prism keeps its painted faces and only its base, where it joined the rest, is capped (in
one colour of the painting round it, as is every hole Tripo left); a sliver or a lone big face
joins its neighbour, and a prism belongs to the element most of its faces carry (the owner's
calls of 2026-11-18: chunks of each element's crystal floating, solid crystals, not random
pieces or flat faces). The renderer draws the whole crystal as one merged mesh and, at the
burst, lets the pieces fly; each element's prisms settle together in its own vein's quarter
round the portal.

Every vertex carries two custom attributes (glTF `_WEIGHTS` and `_PATH`): the four element
weights (assigned from each crystal's own painted hue; the white-gold heart is what is left of 1)
and the element's path (0 at the plinth's rim where its river arrives, 1 at the far tips), so each
element lights, and its light climbs, on its own crystals. The painting is the only texture,
shipped at 1024 (KTX2; the build's `--paint-size`), and the two attributes ride as 8-bit
normalized integers (the ship step quantizes them), so the file stays well under the owner's
one megabyte budget (pinned); the material is the runtime's own shader (`ring_crystal_material.ts`).

## Rebuild

From the repo root, with the full-size sheet at `tmp/ring_crystal/concept/sheet_v4.png` (the
WebP copy here works too, a little softer), split the sheet into its four views:

```bash
node scripts/assets/smith_heart_hammer_colossi/split_views.mjs tmp/ring_crystal/concept/sheet_v4.png tmp/ring_crystal/crystal/views 4
```

Build the model with Tripo (the key from the repo-root `.env`; a rerun resumes the task recorded
in its `job.json` and never pays twice), then cut and weigh it in Blender and ship:

```bash
node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/ring_crystal/crystal 14000 2048
"<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_ring_crystal.py -- --src tmp/ring_crystal/crystal/raw.glb --out tmp/ring_crystal/smith_heart_ring_crystal_src.glb --reach 8.6 --crown-r 0.15 --crown-z 0.4
node scripts/assets/smith_heart_ring_crystal/build.mjs
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_ring_crystal.glb
node scripts/build_media_manifest.mjs generate
```

Do not import `scripts/assets/smith_heart_ring_crystal/build.mjs` from a test: importing it runs
the ship step and overwrites the KTX2 file with the uncompressed one.

## The prompts

**The approved sheet.** One chat, the owner's concept art of the four elements' crystals and the
earlier sheets attached; the owner picked the amber cluster of the previous sheet as the best, so
the others were asked to match it:

> Better, and the FRONT amber one is clearly the best: big, bold, chunky prisms, heavy and solid,
> a strong powerful silhouette with great presence. Now redo the whole four-view sheet (same
> layout, same painted style, scale, plinth and dark navy background, same tall white-gold heart
> shaft in the middle, all four elements in one crystal) so the ICE, STORM and FIRE clusters are
> just as big, bold, chunky and heavy as the amber one: the same mass and presence, built the
> same way (a tall central prism, two mid-height prisms flanking it, tilted at different angles,
> and lower prisms fanning out sideways at the base), not thin, not small, not spiky filler. Keep
> each element's own colour and character: RIGHT ice = big chunky hexagonal ice-crystal columns
> with sharp faceted pointed tips, glassy pale blue with white frost on the edges, clear and
> translucent; BACK storm = big chunky angular prisms with kinked, stepped, broken jagged tops,
> deep indigo and violet, with bright blue-white lightning cracks running through them; LEFT fire
> = big thick horn-like prisms that curve and bend like flames, dark smoky crystal with glowing
> molten orange cores and white-hot fissures. Every cluster is as large as the amber one and
> fills its side of the plinth right out to the plinth's edge. Same four views: front amber,
> right ice, back storm, left fire. One solid connected piece, no floating parts, no text.

The first prompt of the chat asked for a four-view orthographic turnaround sheet of the heart
seal crystal, a tall crystal formation on a low round plinth of dark grey granite with a white-gold
six-sided heart and four identical clusters (amber, ice, storm, fire); the second and third asked
for a much bigger, more varied formation with every shard at its own angle and each element its
own shard shape (chunky prisms, needle spears, kinked lightning, flame horns).

## Look

The lit crystal keeps the painting's four colours (`RING_CRYSTAL_LOOK` in
`src/render/smith_heart/ring_crystal_core.ts`): dormant is the painting dimmed and cooled, lit is
the painting at full and a touch more saturated with its cores burning deeper, the white-gold
heart takes a share of the glow so it does not bloom into a beam, and ready is a breath of
brightness with a thin rim, never a tint. An early cut added white-gold vein light over everything
and washed the four elements out to one colour. Lit against dark is about eight to one (the
owner's call of 2026-11-18: under three to one, a lit element barely read against a dark one); the
gap is taken from the dark side, which keeps its four hues at low value, because pushing the lit
side higher washes the ice and the storm out to white. Pinned in
`tests/smith_heart_ring_crystal.test.ts`.

## Follow-ups

The Ring kit's `Kit_SealQuarter*`, `Kit_SealHeart`, `Kit_SealSpire` and `Kit_Conduit*` pieces
(`public/models/props/smith_heart_ring_kit.glb`) are no longer placed; they stay in the file until
the kit is next rebuilt, when they can be dropped.
