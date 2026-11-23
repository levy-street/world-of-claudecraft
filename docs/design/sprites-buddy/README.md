# Sprite buddy (yellow and teal)

Two floating fire sprites (gold, coloured yellow, and teal) that share one
buddy slot and turn green where they join, built procedurally in
Blender from the sprite sheet (`sprites_sheet.png`, turnarounds in `concepts/`).
In game as the buddy Flicker and Glimmer (key `sprites`, developer and admin
grants only so far): `public/models/buddies/sprites.glb`, with live flames over
the orbs drawn by `src/render/sprites_buddy_flame.ts`. What is still open is in
`INTEGRATION_PLAN.md`.

To refresh the game asset after a rebuild:

```sh
node docs/design/sprites-buddy/finish_buddy.mjs docs/design/sprites-buddy/sprites_buddy.glb public/models/buddies/sprites.glb
node scripts/assets/compress_glb_textures.mjs public/models/buddies/sprites.glb
node scripts/build_media_manifest.mjs generate
```

## Files

- `sprites_buddy.glb`: the current model. One skinned rig (59 bones), 9,192 tris, two face
  meshes with 9 morph targets, 10 clips at 30 fps (Idle, Walk, Run, Jump,
  Search, and the idle fidgets Idle_Nuzzle, Idle_Peekaboo, Idle_Dance,
  Idle_Doze, Idle_Leapfrog).
- `colours.png`: the pair apart, and merged (green) mid-Idle.
- `merge_seam.png`: green spreading from the seam as they merge (top row) and
  shrinking back as they split (bottom row).
- `expressions_sheet.png`: every morph target on both sprites.

`expressions_sheet.png` and the concepts predate the recolour and still show
gold as orange.

## Rebuild

Blender 5.2, headless. From an empty working directory `$W`:

```sh
D=docs/design/sprites-buddy
for p in gold teal; do
  blender --background --python $D/build_sprite.py -- ${p}_sprite $p $W noface
done
blender --background --python $D/build_sprite.py -- merged_sprite green $W noface nocheeks
blender --background --python $D/animate_sprites.py -- $W $W/sprites_buddy.glb
blender --background $W/sprites_buddy.blend --python $D/faces.py -- $W
blender --background $W/sprites_buddy.blend --python $D/export_glb.py -- $W/sprites_buddy.glb
```

The output is byte-identical to the committed `sprites_buddy.glb`.

- `build_sprite.py`: sphere and painted equirect texture per sprite.
- `animate_sprites.py`: the rig (`<c>_move`, `<c>_squash`, `<c>_spin` per
  sprite) and every clip, baked per frame, one NLA track per clip. Each sprite
  also has a green shell inside it, turned by an `<c>_aim` bone to face the
  other sprite and skinned to 25 ring bones (`<c>_merged_00`..`_24`, one per
  7.5 deg away from that facing). Each ring is a uniform scale that pushes its
  band of the shell just past the surface (under the face), so in Idle green
  shows only as a cap round the seam where the two join. It grows as teal sinks
  in until the merged sprite is all green, and shrinks back on the split.
- `faces.py`: face meshes, shape keys and per-clip expression timelines.
- `flame_preview.py`: a Blender-only look preview of the transparent flame
  over each sprite (run on the blend after `faces.py`, it saves a separate
  blend and exports nothing). In game the flame is meant to run live, reacting
  to the buddy's real movement; the script's shader and lean spring are the
  reference for that.
- `clip_util.py`: helper for previewing one clip in the Blender GUI.

Clip rules: loops close (first frame equals last), and every one-shot starts
and ends exactly on Idle frame 0, so the game can cut in and out of them.
