# Wobbles the Slime (slime mount)

A big blue jelly slime with a saddle, blanket, girth straps and stirrups,
built from `concept.webp` (top, side and front views). In game it is the
mount `wobbles_slime` ("Wobbles the Slime"), developer-only for now
(`DEVELOPER_MOUNTS`). The rider sits on its `saddle` bone (`MountSeatSpec` in
`src/render/mount_visuals.ts`), and it ships Idle, Walk, Run, Jump and Land
plus an ambient Bubbles loop (`VisualDef.ambientClips`). It sits on the ground
in its idle, hops to move, and jiggles.

## Files

- `concept.webp`: the turnaround the model was built from, an AI-generated
  concept supplied by the project owner.
- `slime_tripo.glb`: the Tripo model, the source of the tack. Made with the
  Tripo multiview input (front, left and right views, a 12,000 face limit;
  the multiview option is not in this branch's asset pipeline) from the front
  view and the side view and its mirror. Tripo calls the view from the viewer's left `--left`, so
  the concept's side view, which faces right, went in as `--right`. Textures
  were shrunk to 1024 px WebP for the repo.
- `assemble_mount.py`: the static mount. It finds the jelly by colour, grown
  from the bottom of the shell so that blue glints on the leather are left
  alone, and fits a smooth body to it. It keeps the tack whole and tucks the
  body just under it. The new body replaces Tripo's jelly skin, which had
  lighting and highlights baked in.
- `build_mount.py`: paints the jelly (gradient, base glow, highlights) and
  makes it translucent, adds the bubbles, then builds the rig and clips
  (Blender 5.2, headless).
- `render_icon.py` and `compose_icon.py`: the reins icon
  (`public/ui/items/reins_wobbles_slime.webp`), a render of the mount at rest
  composed onto the dark woc-item-icon-v1 ground, like the Chimeglass
  Tortoise's. Run `render_icon.py` on the `.blend` that `build_mount.py`
  saves beside its GLB, then `compose_icon.py` on the render's folder.
- `finish_mount.mjs`: resamples, prunes, dedups and converts textures to WebP,
  then checks that the clips and the saddle bone survived.

## Rebuild

From the repo root, with `$W` an empty working directory:

```sh
D=docs/design/slime-mount
blender --background --python $D/assemble_mount.py -- $D/slime_tripo.glb $W/static.glb
blender --background --python $D/build_mount.py -- $W/static.glb $W/slime_anim.glb
node $D/finish_mount.mjs $W/slime_anim.glb public/models/mounts/wobbles_slime.glb
node scripts/assets/compress_glb_textures.mjs public/models/mounts/wobbles_slime.glb
node scripts/build_media_manifest.mjs generate
```

The KTX2 step is mandatory (`tests/glb_texture_compression.test.ts`). A rebuild
changes the bytes, so update the pin in `tests/wobbles_slime_asset.test.ts`.

## What the GLB carries

- Size: 6.61 units tall, 8 units nose to tail, 7.25 wide, on the ground at
  y = 0, facing +Z.
- Rig: `root` > `move` > `squash` > `base` > `mid` > `top`, plus `move` >
  `saddle`. `squash` scales from the ground, so the slime stays planted. The
  `base`/`mid`/`top` spine bends the jelly: the body and the lower tack blend
  along it by height, so the top can lag behind the bottom or overshoot it.
  `saddle` carries the seat, the cantle and the pommel rigidly. Each frame it
  is placed where the spine carries the top of the body, turned with it but
  never squashed. Use `saddle` as the rider's seat bone (`MountSeatSpec`) so
  the rider rides the wobble.
- Look: the jelly (`slime` material) is alpha blended at 0.7 and
  single-sided, so only its near wall draws. The tack (`tack`) is
  double-sided, so the saddle's underside shows through the jelly instead
  of vanishing. The low graphics tier keeps both: its Lambert rebuild copies
  `transparent`, `opacity` and `side`.
- Bubbles: 7 opaque, faintly glowing spheres (`slime_bubbles`, material
  `bubble`), each on its own bone (`bubble_00` to `bubble_06`, children of
  `base`, so they squash and lean with the jelly). In every clip each one
  rises along a seeded random, wobbling path, swells in and pops. They are
  spread out: each keeps to its own slice of the body around the middle,
  rides out toward the skin, and is staggered in time. Each path
  repeats on a period that divides the clip length, so the loops stay
  seamless. In Idle they cross the whole body slowly; when moving they take
  short trips swept toward the back.
- Clips at 30 fps:
  - `Idle` (6 s loop): sat on the ground (no hover), breathing, swaying, with
    two little shivers.
  - `Walk` (1 s loop) and `Run` (0.9 s loop): one hop per loop. The slime
    gathers before take-off, stretches as it leaves the ground and squashes on
    landing, then jiggles down. The top lags back on take-off and carries on
    forward on landing. Each loop picks up the end of the previous landing's
    jiggle, so the seam does not show. Run hops almost four times as high
    and leans forward.
  - `Jump` (0.5 s) and `Land` (0.6 s) follow the game's held-jump contract
    (`ClipMap.land`): the arc is the game's, so neither carries a rise. `Jump`
    gathers, springs and settles on an airborne pose (stretched tall, the top
    lagging back) that the game clamps on for the whole flight. `Land` fires
    on touchdown: a splat that jiggles out and ends on the idle pose.
