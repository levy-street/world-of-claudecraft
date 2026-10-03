# Hollow Crypt creatures

The Chapel Gargoyle, the Carrion Crow and the Ossuary Drake of the Hollow Crypt
trash (`src/sim/content/hollow_crypt_trash.ts`), modelled, rigged and animated in
Blender from code, in the chunky KayKit style of the rest of the cast:

- `creature_kit.py`: the shared helpers. Bodies reuse the Hollow Crypt kit's
  primitives (`docs/design/dungeon-rework/kit/hckit.py`) and its weathered vertex
  colours; every part is RIGID-skinned to one bone. Poses are written as turns in
  the rest armature frame (`.L` mirrored onto `.R`), clips as keys at 24 fps.
- `build_creature.py`: one creature per run, straight to its shipping GLB:

  ```
  blender -b --factory-startup --python build_creature.py -- gargoyle public/models/creatures/crypt_gargoyle.glb [--preview out.png] [--blend out.blend]
  blender -b --factory-startup --python build_creature.py -- crow     public/models/creatures/crypt_crow.glb
  blender -b --factory-startup --python build_creature.py -- drake    public/models/creatures/crypt_drake.glb
  ```

  then `node scripts/assets/compress_glb_textures.mjs <file.glb>` (every shipped
  GLB texture is KTX2, pinned by `tests/glb_texture_compression.test.ts`) and
  `node scripts/build_media_manifest.mjs generate`. The same two steps follow the
  hero creature, Morthen and Sunken Bastion exports below.

Clips: Idle, Walk, Run, Attack, Hit, Death, Cast on all three (Attack2 on the
gargoyle and drake), plus the drake's Breath, TailLash and WingGust. The
`VISUALS` rows (`mob_crypt_gargoyle`, `mob_crypt_crow`, `mob_crypt_drake` in
`src/render/characters/manifest.ts`) map them; the crow's Death drops the body by
its `hover` so the corpse lies on the floor.

## The hero creatures (third pass)

The Ossuary Drake and the Chapel Gargoyle outgrew the chunky kit: they are built
by `build_bone_drake.py` and `build_stone_gargoyle.py` on `organic_kit.py`
(smooth anatomy parts bound to one bone each, membranes weighted across their
finger bones, an IK and aim posing rig, a Cycles bake of a procedural bone or
cracked-stone surface with its ambient occlusion into one albedo plus a normal
map). Both are authored at their in-game size in yards; the `VISUALS` rows keep
that size (`height` is the measured mid-idle height).

```
blender -b --factory-startup --python build_bone_drake.py -- public/models/creatures/crypt_drake.glb [--sheet dir] [--blend out.blend] [--fast]
blender -b --factory-startup --python build_stone_gargoyle.py -- public/models/creatures/crypt_gargoyle.glb [--sheet dir] [--blend out.blend] [--fast]
node scripts/assets/hollow_crypt_creatures/sheet.mjs <sheetDir> <drake|gargoyle> <out.png>
blender -b <out.blend> --python render_views.py -- <outDir> <Clip:frame:az:el:dist:fx:fy:fz> ...
```

`--fast` bakes at 512 for quick iteration. `--sheet` renders four frames of every
clip beside a player-sized reference; `sheet.mjs` lays them out as one animation
sheet. The effects that ride these clips (the breath torrent, the shockwaves) live
in `src/render/hollow_crypt/crypt_creature_fx.ts`, anchored on the jaw and head
positions measured off these clips (`crypt_creature_fx_core.ts`).

## Morthen, the Lich Bishop

`build_morthen.py` builds the crypt's last boss on the organic kit, in the
family of the Sunken Bastion's Vael (v2): a deep near-black cowl over a skull with
soul-fire eyes, the tall bone mitre with its slit eye of soul fire and linen
lappets, a mozzetta over a tattered cope that parts on an open ribcage of soul
fire, a stole sewn with closed-eye sigils, and a churning funnel of dark green
soul smoke below; no candles, no Book of Names. The bell staff's crest unfolds
into a scythe (Blade1 and Blade2 fold on their hinges and grow on a keyed scale).
The arm keys keep quaternion hemisphere continuity inside `clip()`, so no
in-between frame spins the long way round. Every clip exists in
two stances, the staff set and the `Scythe*` set, plus the `Transform` between
them; the flames and the soul fire flicker on keyed bone scales. A fourth
material (`CreatureMetal`) keeps the bell, iron and gold metallic.

```
blender -b --factory-startup --python build_morthen.py -- public/models/creatures/crypt_morthen_lich.glb [--sheet dir] [--blend out.blend] [--fast]
node scripts/assets/hollow_crypt_creatures/optimize.mjs public/models/creatures/crypt_morthen_lich.glb
node scripts/build_media_manifest.mjs generate
```

The `crypt_morthen_lich` VISUALS row maps the clips; `VisualDef.phaseClips`
swaps the stance, driven by `src/render/hollow_crypt/morthen_fx.ts`. Its `height`
and `hover` are the build's printed `IDLE_HEIGHT` and `MINZ` (measured half a
second into Idle, as the game measures him).

The weapon is held, never spun: the staff is modelled IN the right fist (both
hands are bony fists closed round a bar) and the Staff bone keeps its rest turn
against Hand.R in every key (`tests/morthen_lich.test.ts` pins it). Each pose
places the grip, the shaft and the blade's facing in the body's frame and the
solver carries them with the shoulder, the elbow, the spine and the floating body:
it turns the blade a little round the shaft and nudges the grip so the wrist stays
straight, bends the elbow toward where a straight wrist wants it, and closes the
off hand round the shaft for the two-handed blows. The build prints, per clip, the
worst wrist bend, how far either fist strays from the shaft, and the staff's turn
against the fist (`GRIP ...` lines; `--diag` prints every key). The skull is one
sculpted surface (`skull_point`), its sockets and nose pressed in, grown 1.3x about
the neck to fill the mitre; soul flames flicker in the sockets on their own bones.
The souls that circle him are drawn by the effect layer (`soulOrbit`), and the
smoke below the torn alb is a translucent `CreatureSmoke` material (vertex alpha).

Debugging aids: `--nobake` skips the Cycles bake (fast pose checks), `--solo
Part,Part` builds only the named parts, `-` as the output skips the export, and
`--sheet dir --clips A,B --frames N` renders chosen clips.
