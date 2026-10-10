# Hollow Crypt creatures

> Superseded for the Chapel Gargoyle, the Ossuary Drake, the Knellwyrm, Sexton Marrow,
> Cantor Ilvane and the Lady of the Bonechill: each now ships the art guide's model
> (concept, Tripo P2, a skeleton and every clip built in Blender), as
> `public/models/creatures/woc_crypt_*.glb` from `scripts/assets/specs/woc_crypt_*.json`.
> The builds below are kept for the Carrion Crow, Morthen and as reference; their
> output GLBs for the replaced creatures are no longer in the repo.

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

## Sexton Marrow, the gravedigger

`build_marrow.py` builds the crypt's first boss with the Sunken Bastion's sculpt
kit (`../sunken_bastion_drowned/kit`, unchanged; the creature modules are in
`marrow/`: `anatomy.py`, `dressing.py`, `shading.py`, `clips.py`): a stooped
skeleton about twice a player's height, every bone a signed-distance sculpt bound
rigid to the bone it rides; a big grim skull grown 1.16x about the neck (soul-green
light deep in the sockets on the `Eyes` bone), the deep peaked cowl and ragged
capelet of grave cloth, knee breeches, the leather apron on its spring chain
(`ApronF1`, `ApronF2`), earth-caked boots, a rope belt with the ring of church
keys, and the hooded tin lantern on its own spring bone (`Lantern`) at the hip,
its tallow light a flat glow material. The spade rides the never-keyed `Weapon`
bone in the right fist, the left fist closing on the haft by the kit's grip
solver; `BLADE_ROLL` turns the blade round the haft so the dish bites forward,
carries up and flings up and forward (tuned on probes of the posed spade). Two
twins are shown by keyed scales: the shovelful of earth on the blade (`Dirt`, in
Idle's dig and Shovelful, flung away on the release frame) and the spade planted
in the yard while he rings the bell (`SpadeStuck`, under `Root`, its root motion
cancelled by a keyed offset so it stands still on the flags).

```
blender -b --factory-startup --python build_marrow.py -- <abs>/marrow_raw.glb --bake 2048 --tex <abs>/tex --blend <abs>/marrow.blend --stats <abs>/stats.json --work <abs>/work
cp <abs>/marrow_raw.glb public/models/creatures/crypt_sexton_marrow.glb
node scripts/assets/hollow_crypt_creatures/optimize.mjs public/models/creatures/crypt_sexton_marrow.glb
KTX_BIN=<KTX-Software bin> node scripts/assets/compress_glb_textures.mjs public/models/creatures/crypt_sexton_marrow.glb
node scripts/build_media_manifest.mjs generate
```

`--k 1.6 --nobake` gives a quick clay build; the kit's `reclip.py` re-keys the
clips on a built .blend and `review.py` renders the views, sheets and objective
checks (`--builder <abs>/marrow`). The `crypt_skel_sexton` VISUALS row maps the
clips; its `height` and `hover` are the build's printed `IDLE_HEIGHT` and `MINZ`.
Clips (24 fps): Idle (the dig, a 4.4 s loop: the shovelful flung off at 3.1),
CombatIdle, Walk, Run (also his stride to the bell rope), Attack (contact 0.6),
Attack2 (0.55), Hit, Death (down 1.25, the eyes out by 2.0), and the bar-locked
casts of `src/sim/encounters/hollow_crypt/marrow.ts`: Shovelful (1.2 s bar, the
earth flung at 1.0), Measure (1.0 s bar, the spade levelled at the mark from 0.5),
GravediggersBlow (0.8 s bar, impact 0.7), and BellRing (a 1.0 s loop played three
times, both fists on the rope on his own axis, the haul bottoming at 0.9 on
`ropePull`).

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

## The Lady of the Bonechill

`build_lady.py` builds the crypt's second boss (the sim's `rimeweb`, frozen from
the spider placeholder): the ghost of a bride buried in the ravine's ice, about
6.5 yd from the frozen hem to the ice crown, floating half a yard over the floor.
Her flesh (head, neck, bodice, arms, clawed hands) is SCULPTED as signed-distance
fields with the Sunken Bastion drowned kit (`../sunken_bastion_drowned/kit/sdf.py`,
meshed through OpenVDB): a body field, finer head and hand fields cut under a
frozen choker and inside the lace cuffs, skin weights from the sculpt's own
primitives so the jaw, elbows and fingers bend as flesh. The gown, underskirt,
veil, blusher, sleeves and their angel tails are organic-kit membranes on hanging
spar bones that carry a per-vertex ALPHA; the bake (`bake_ghost`) folds it into
the albedo's alpha channel, so the ghost cloth ships as one alpha-BLENDED,
double-sided image material (`CreatureGhostVeil`: no transmission, no runtime
vertex alpha, so the far-LOD bake keeps it) while the face and hands stay solid
(`CreatureBody`). The eyes, frozen tears, the cracked heart and the crown's gem are
on `CreatureGlow`, cold white-blue. AO is folded in with its shadows pushed toward
violet; the head and hands are grown before the unwrap so they take a larger
share of the atlas.

```
blender -b --factory-startup --python build_lady.py -- public/models/creatures/crypt_lady_bonechill.glb [--blend out.blend] [--work dir] [--fast] [--nobake]
node scripts/assets/hollow_crypt_creatures/optimize.mjs public/models/creatures/crypt_lady_bonechill.glb
KTX_BIN=<ktx>/bin node scripts/assets/compress_glb_textures.mjs public/models/creatures/crypt_lady_bonechill.glb
node scripts/build_media_manifest.mjs generate
```

Clips (24 fps, keyed from time 0; the one-shots start and end on `CombatIdle`): Idle, CombatIdle,
Walk, Run (a glide: no steps), Attack (the right claw raked across, contact at 0.54 s),
Attack2 (both claws raked down from overhead, contact at 0.58 s), Hit, Death (a silent
scream, then she rises and shrinks to nothing as the gown scatters; the game adds
the snow), Wail (3 s: Bride's Lament, and the Bridal Freeze at 1.2), EmbraceReach
(the Frozen Embrace's 1.2 s bar: the hands close round the victim's spot, 1.5 yd
ahead and about 3 yd up, on its last frame), EmbraceHold (a 2 s loop cradling the
held body while the sim lifts her) and Release (0.6 s, the arms open). The cloth
bones are aimed in world space every key (their rest hang, streamed back, floated
up, flared and rippled by a travelling wave), and every bone's quaternion keys keep
one hemisphere (Morthen's fix). The build prints `IDLE_HEIGHT` and `MINZ` (the
`crypt_lady_bonechill` row's `height` and `hover`), `EMBRACE` (the hands in the
hold) and any IK overreach (`REACH`).

## Cantor Ilvane

`build_cantor.py` builds the crypt's third boss (`cantor_ilvane`, the
`crypt_skel_cantor` VISUALS row) on the organic kit, Morthen's way: a tall
skeletal choir mistress, about 6 yd authored and drawn at her template's 1.1
(about 6.5 in game). A long cassock of faded violet blackening to soot at its torn
hem; a torn white surplice over it with bell sleeves that hang from the forearms
(their spar bones are aimed toward the floor every key, so they fall back when she
lifts her arms); a pleated millstone ruff; a deep violet stole stitched with silver
staves and violet notes; a long fine skull (`skull_point`, Morthen's sculpt made
finer, grown 1.32x about the neck) with violet flames in its sockets and a violet
`Voice` in its throat that swells when she sings; a black lace veil and her long
pale hair falling from a crown of seven silver organ pipes. In the left hand the
hymnal (`Hymnal`, its covers on `PageA` and `PageB`, so it shuts and falls open), in
the right fist the baton, a long finger bone with a violet light (`BatonLight`).
The song is violet everywhere, never Morthen's green.

```
blender -b --factory-startup --python build_cantor.py -- public/models/creatures/crypt_cantor_ilvane.glb [--sheet dir] [--blend out.blend] [--fast] [--nobake]
node scripts/assets/hollow_crypt_creatures/optimize.mjs public/models/creatures/crypt_cantor_ilvane.glb
KTX_BIN=<ktx>/bin node scripts/assets/compress_glb_textures.mjs public/models/creatures/crypt_cantor_ilvane.glb
node scripts/build_media_manifest.mjs generate
```

The pose language is Morthen's `RollRig` plus three pieces: hands placed in the
chest's frame and turned by their frame (the baton across the right fist, the palm
under the hymnal; the build prints the worst wrist bend per clip, `WRIST`), cloth
that follows the legs (the cassock and surplice spars turn with the thighs and
shins) with a floor guard that swings any hem a pose pushes under the flags out
until it clears (so the robe pools when she kneels), and a keyed bone offset so the
hymnal can leave her hand (it hangs over the organ's keys in PlayOrgan and falls
open on the floor in Death). Every bone's quaternion keys keep one hemisphere.

Clips (24 fps; the one-shots start and end on `CombatIdle`): Idle (head bowed over
the hymnal), CombatIdle, Walk, Run, Attack (the baton slash, contact f12), Attack2
(the hymnal backhand, shut on impact at f13), Hit, Death, Sing (the Dirge, 60
frames: the peak lands at f43, 1.75 s, inside the Crescendo's 1.8 s bar, and is
held, climbing, to the 2.5 s bar's end; bar-locked), Conduct (a 2 s bar of four
beats, looping) and PlayOrgan (a 100 frame loop at the keys, facing the pipes).
The build prints `IDLE_HEIGHT` and `MINZ` (the row's `height`) and the lowest
vertex per clip (`MINZ_CLIP`).
