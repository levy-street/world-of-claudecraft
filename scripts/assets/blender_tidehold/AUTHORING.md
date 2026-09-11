# Nudging a Tidehold building by hand

The build scripts place every piece from code, which is precise but hostile to
"move that torch a bit left". This is the round trip for doing it by eye in
Blender and getting the change back into the game.

Both scripts take the building on a prepended line, e.g. `BUILDING='castle'`
(the bridge passes prepended `VAR=...` lines in as globals).

## 1. Open it, un-joined

```bash
SCRATCH=/tmp/bl                      # wherever you copied the scripts
printf "BUILDING='castle'\n" | cat - $SCRATCH/bl_author.py > $SCRATCH/_author.py
python3 ~/.claude/tools/blender_bridge.py run $SCRATCH/_author.py
```

With Blender open this rebuilds the building with **every piece as its own
object**, 689 of them for the keep, sorted into one collection per storey
(`castle_L0`, `castle_H1`, `castle_H2`) and named `L0.014.CastleWall_01` so the
outliner is searchable. It also turns off relationship lines, which otherwise
spray dotted black over every interior view.

Then just move things. Grab, rotate, scale, delete, duplicate, anything.

## 2. Bake it back

```bash
printf "BUILDING='castle'\n" | cat - $SCRATCH/bl_bake.py > $SCRATCH/_bake.py
python3 ~/.claude/tools/blender_bridge.py run $SCRATCH/_bake.py
```

It prints exactly what you changed against the authored baseline before it
writes anything:

```
=== CHANGES vs the authored build (castle)
  moved: 3   deleted: 0   added: 0
    L0.291.Fire_01     moved  0.500 kit  rot 0.0d  scale 0.000  -> [-2.1, -1.6, 0.68]
    L0.276.Throne_01   moved  0.350 kit  rot 0.0d  scale 0.000  -> [0.0, -4.8, 1.0]
```

then joins, scales by S and writes `out/tidehold_<building>.glb` plus its
collision JSON. **The bake works on a throwaway copy**, so your editable scene
survives, nudge, bake, look, nudge again, without re-running author mode.

## 3. Into the game

```bash
node tmp/_install_tidehold_buildings2.mjs castle
node tmp/_merge_tidehold_collision2.mjs castle
node scripts/gen_collision_overrides.mjs && node scripts/gen_asset_catalog.mjs
```

If the building's bounds changed, also update `SIZE` and `AUTHORED` for it in
`src/sim/deepglass/citadel.ts` from the numbers the install script prints, and
any `fireEffects` positions that moved with a prop.

## The one thing the round trip cannot do for you

**Collision does not follow.** The colliders are authored in the build script,
not derived from the meshes, so they are carried through the bake unchanged.
For props that is usually fine, a torch's box is coarse and a small nudge
stays inside it. For anything structural it is not, so the bake tags those
lines:

```
L0.014.CastleWall_01  moved 0.400 kit ...   <-- STRUCTURAL: its collider does not follow, needs a look
```

When you see that tag, the matching `col()` / `col_wall()` / `ramp()` call in
`bl_castle.py` has to move by the same delta. Same for the walkable decks in
`tmp/_merge_tidehold_collision2.mjs` if you move a floor.

Rule of thumb: **nudge props freely, and tell me when you move structure** so I
can move its collision with it and re-run the referee
(`tmp/_castle_collision.mjs`, `tmp/_gallery_reach.mjs`).

## Starting over

Re-running author mode rebuilds from the script and discards every scene edit, that is the reset. Anything you want to keep permanently should end up back in
`bl_<building>.py`; tell me what you moved and I will fold the numbers in.


## The bake must delete its temporaries by TAG

`finalize()` renames the joined survivors (`L0_0`, `H1_0`, ...) and removing the
temp root first orphans its children, so a cleanup that sweeps by NAME or by
PARENT leaves full merged CLONES of the building sitting exactly on top of the
real one, invisible in a wireframe glance, obvious the moment you move a piece
and its old copy stays put. Every temp object is stamped `obj['_baketmp'] = 1`
and the sweep deletes by that property, which survives both the rename and the
join. The bake prints `cleaned N bake temporaries` and names any stray.

If you ever do find clones, `bl_cleanup.py` removes them (and purges orphan
mesh/material datablocks) without touching anything under the real `BLDG` root.


## Always re-author immediately before you bake

`bl_crit_shots.py` (and anything else that `exec`s a build script's body) starts
with `reset_build()` and then adds render-only helpers, the 1.8yd player proxy
cylinders go in UNDER the `BLDG` root. Bake straight after one of those and the
proxies are exported into the game asset. The bake's own change report is the
tell: a clean bake says `moved: 0  deleted: 0  added: 0`, so anything like
`deleted: 669  added: 677` means the scene is not the one you authored, stop
and re-run `bl_author.py`.

Cheap proof after any install: the keep's GLB should carry exactly
`CartoonTown_01`, `CartoonTown_Roof`, `CartoonTown_02` and nothing else.


## Once you build geometry by hand, the .blend is the source, not the script

`bl_castle.py` can place kit pieces from code, but it cannot reproduce a
gatehouse you built by duplicating walls in the viewport. From that point the
**`castle.blend` in this folder is the authoritative geometry** and re-running
`bl_author.py` would discard it, author mode rebuilds from the script.

So the loop becomes: open `castle.blend`, edit, `bl_bake.py`, install. Save the
.blend again whenever you want a checkpoint:

```python
bpy.ops.wm.save_as_mainfile(filepath='.../blender_tidehold/castle.blend', copy=True, compress=True)
```

## Collision for hand-built geometry

The build script's `col()` calls only know about pieces the script placed.
Collision for anything built by hand lives in
**`castle_extra_collision.json`**, which `bl_bake.py` merges into `COLS` /
`RAMPS` at bake time. Editing that file needs no re-author, so no hand edit is
ever at risk.

Two rules for entries in it:

- Every box must carry `rz` (even `0.0`). `finalize()` reads `c['rz']`
  unconditionally and a missing key aborts the bake with `KeyError: 'rz'`
  *after* it has already printed the change report, which looks like success.
- Prefer a SOLID box to a walkable deck for anything raised. The engine keeps
  one walkable ground per (x, z), so a rampart deck laid over the courtyard
  floor deck fights it and can launch a player standing below. The wall-walk
  between the two curtain walls is therefore solid masonry, and the courtyard
  floor deck in `tmp/_merge_tidehold_collision2.mjs` was trimmed from
  `hx: 12.43` to `hx: 9.9` so the two never overlap.
