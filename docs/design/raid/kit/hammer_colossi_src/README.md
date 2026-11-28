# The Smith's Quarry colossi: sources

The three statues kneeling round the Quarry pit (`public/models/props/smith_heart_hammer_colossi.glb`,
design doc section 5.22), built by `scripts/assets/smith_heart_hammer_colossi/`. `sheets/` are the
owner's ChatGPT turnaround sheets and `recolour/` ChatGPT's recolours of each statue's UV texture,
with the rock reference it was shown, all as WebP. The Tripo builds and the full-size images stay
local (`tmp/hammer_colossi/`).

| Statue | Node (stands in for) | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|---|
| The Keeper | `Env_ColossusKeeper` (`Kit_ColossusVigil`) | `sheets/hv_sheet_colossus_keeper.webp` | `83ffcd5b-4e1a-4440-9594-442916c5e497` | 12000 | 110 |
| The Waking smith | `Env_ColossusWaking` (`Kit_ColossusWaking`) | `sheets/hv_sheet_colossus_waking.webp` | `7b4a6b60-693a-41af-a179-48afe973ef91` | 12000 | 110 |
| The Bearer | `Env_ColossusBearer` (`Kit_ColossusBearer`) | `sheets/hv_sheet_colossus_bearer.webp` | `ed09e282-736d-4428-a525-06fbcd57af93` | 12000 | 110 |

## Rebuild

From the repo root, with the full-size sheets at `tmp/hammer_colossi/sheets/<statue>.png`, split
each sheet (`keeper`, `waking`, `bearer`):

```bash
node scripts/assets/smith_heart_hammer_colossi/split_views.mjs tmp/hammer_colossi/sheets/keeper.png tmp/hammer_colossi/keeper/views
```

Then build each statue with Tripo (the key from the repo-root `.env`; a rerun resumes the task
recorded in its `job.json` and never pays twice):

```bash
node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/hammer_colossi/keeper
```

Then stand the statues in the old colossi's frames, paint the sheets onto them, recolour them,
and ship:

```bash
"<blender>" -b --factory-startup --python scripts/assets/smith_heart_hammer_colossi/normalize.py -- scripts/assets/smith_heart_hammer_colossi/normalize.json
node scripts/assets/smith_heart_hammer_colossi/prep_projection.mjs tmp/hammer_colossi
"<blender>" -b --factory-startup --python scripts/assets/smith_heart_hammer_colossi/project_bake.py -- scripts/assets/smith_heart_hammer_colossi/project.json
node scripts/assets/smith_heart_hammer_colossi/recolour.mjs scripts/assets/smith_heart_hammer_colossi/recolour.json
node scripts/assets/build_assets.mjs scripts/assets/specs/smith_heart_hammer_colossi.json
node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_hammer_colossi.glb
node scripts/build_media_manifest.mjs generate
```

The recolour step reads ChatGPT's results from `tmp/hammer_colossi/recolour/out/<statue>.png`
(the full-size downloads; the 1024 WebP copies in `recolour/` work too, a little softer). It
never pastes ChatGPT's pixels back: a regenerated image does not keep every small UV island in
place, so the script fits a colour grade from the painting to ChatGPT's result and applies that
to the painting itself, keeping the painting's own pixels only where ChatGPT kept a glow (the
Keeper's forge fire, the Waking smith's molten seams), which share their orange with the warm
stone it turned grey.

## The prompts

**Sheets.** One chat each, the owner's painted concept art attached as the style. Each asks
for a FRONT, LEFT and BACK view, but every sheet drew its profile facing image-right, the
statue's right side, so `split_views.mjs` writes it as the right view. The shared opening:

> Generate an image: a three-view orthographic turnaround sheet of ONE game environment
> statue, in exactly the painted style, palette and chunky faceted stone of the attached
> painting (warm sand and ochre lit planes, slate violet shadows, olive moss on the top
> surfaces, thick painterly strokes). Show the FRONT view, the LEFT side view and the BACK
> view, side by side from left to right, at one scale on one ground line, on a flat dark navy
> background with clear gaps between the views, no floor shadow, no labels, no text,
> orthographic with no perspective. The statue is one solid carved piece with no floating
> parts and no thin pieces.

Then the subject:

- **Keeper**: "a colossal bearded smith KEEPER kneeling on one knee, blocky faceted stone body,
  a domed forge cap with a heavy band, a thick braided beard, both huge fists stacked on the
  end of a great hammer planted head down on a stepped stone plinth in front of him, moss over
  his shoulders and cap, and in the plinth's front a small arched forge door glowing orange.
  Grim, heroic, huge shoulders."
- **Waking**: "a colossal HALF-CARVED bearded smith still WAKING out of a raw block of quarry
  rock: his head, his chest and his right arm are finished faceted stone, the arm resting a
  great hammer over his shoulder, while his left arm, his hips and his legs are still
  unfinished stacked cliff blocks with chisel marks and a few bright orange molten seams, moss
  on the raw rock's ledges. Fierce face looking forward, wide stance, huge silhouette."
- **Bearer**: "a colossal bearded smith BEARER kneeling on both knees with his head bowed
  forward, both massive arms raised to hold a giant stone anvil across his shoulders and back,
  a long braided beard to his belt, a heavy stone apron, thick carved chain links wrapped
  tight round his forearms, moss along the anvil's top and his shoulders, kneeling on a low
  stepped stone plinth. Strained, solemn, enormous."

**Recolours.** The painted statues came out warm orange-brown against the vein's slate-grey
cliffs, so each statue's UV texture went to its own new chat, with `recolour/rocks.webp` (three
of the cliffs' atlases side by side) attached second:

> Image 1 is a UV texture map for a 3D game model: every shape on the black background is a
> piece of a carved stone statue of a SUBJECT, unwrapped flat. Image 2 shows the rock cliffs
> that stand right behind this statue in the game.
>
> Recolour image 1 so the statue's stone is the same colour as the rock in image 2: cool slate
> grey with a soft lavender tint, pale sandy light on the brightest planes, deeper blue-grey in
> the shadows, and olive green moss where image 1 already has moss. Right now the stone is warm
> orange-brown, and none of that orange-brown should be left.
>
> Only change the colours. Do not change the UV image: every shape must stay in exactly the
> same position, at exactly the same size and rotation, with exactly the same outline, and the
> black background stays pure black. Keep every brush stroke and every light and dark area
> exactly where it is. Do not move, add, remove, merge, crop or redraw anything, and do not add
> text, labels or a border.GLOW
>
> Return one square image with the same layout as image 1.

SUBJECT was "bearded smith kneeling with a great hammer", "bearded smith half carved out of a
block of quarry rock" and "bearded smith kneeling with an anvil on his shoulders"; GLOW was
" The small patches of bright glowing orange (a forge fire) stay glowing orange." for the
Keeper, " The thin lines of bright glowing orange (molten cracks) stay glowing orange." for the
Waking smith, and nothing for the Bearer. Each came back on the first attempt with its layout
in place (island overlap 0.95 to 0.98 against its input, no offset).
