# Getting a polearm to carry properly on the KayKit body

> **CLOSED, 2026-08-05. Not an active plan.** The attempt was made and abandoned:
> Marsh carries a plain arming sword (`weapons/adv_sword_1handed.glb`, blade family
> grip a size up). Section 3 is why, and it is the part worth reading before anyone
> reopens this: at these proportions a vertical polearm's blade is inside the figure's
> head at every roll and scale, and the only clearance is a lean so far outboard that
> it reads as a flagpole. Read section 4 too if you plan to write a grip solver; all
> four of those measurement traps were paid for.

Scoped work plan for Sergeant Marsh's halberd (`scripts/assets/last_bell_crew/`,
review page `docs/design/last-bell-concept-art.html#marsh`). Written 2026-08-05 after
a failed attempt, so the next one starts from measurements rather than from scratch.

The short version: the animation question is **settled and no longer the problem**. What
remains is a proportion problem in the weapon plus a measurement harness that has to be
rebuilt, because the one used last time could not see the defect it was meant to prevent.

Difficulty: **moderate, and front-loaded.** The harness is the real work; once the metric
is trustworthy the carry converges fast. The open risk is that chibi proportions may not
permit a clean UPRIGHT halberd at all, in which case the landing is a shouldered carry or
a different weapon model (options B and C below), not more grip tuning.

---

## 1. What is already done and should not be redone

- **KayKit's clip vocabulary is fully mapped.** The CC0 Adventurers 1.0 characters carry
  76 clips; `scripts/assets/specs/characters_v2.json` keeps 22 via `keepClips`. The
  polearm stance `2H_Melee_Idle` is among the dropped 54, along with
  `2H_Melee_Attack_Stab`, `1H_Melee_Attack_Stab`, `Blocking`, `Block_Attack`, four
  `Dodge_*`, `Throw`, `PickUp`, `Interact`, `Use_Item` and the `Unarmed_*` set. Details
  and the full finding: section 11 of `last-bell-cast-review-notes.md`.
- **Grafting a dropped clip is straightforward, and was REVERTED with the rest.** The CC0
  Adventurers 1.0 rig is bone-for-bone and rest-pose identical to the shipped one, so an
  appended action needs no retargeting at all: import the CC0 knight, keep the action,
  drop everything else, `bpy.data.libraries.load` it into the build. Two traps if anyone
  redoes it. Use a **.blend, never a GLB**: a skinless GLB round trip returns the action
  with one slot per BONE instead of one for the armature, so it binds to nothing and the
  exporter drops it silently, which looks exactly like a clean build missing a clip. And
  the slot identifier tracks the source armature's object name, which is `Rig` in
  Adventurers 1.0 and `Rig_Medium` in the 2.0 bodies, so rename the slot.
- **Both two-handed ATTACK clips are ruled out.** They are built around a sword's arc,
  where the blade ends near the wrist, so the same wrist rotation on a haft puts the
  crescent through his helmet. `1H_Melee_Attack_Slice_Diagonal` is the best available
  thrust: it levels the haft down the line of attack and reaches furthest.
- **There is no two-handed locomotion clip anywhere in the 76.** Any two-handed carry is
  an idle-and-attack read only. Do not go looking for `2H_Walking`.
- **A real export bug was found on the way and is KEPT.** `model.py` was flattening a
  built-in weapon's export path to its basename, dropping it in the NPC body directory
  instead of `models/weapons/`, so such a weapon never reached `public/` and the game went
  on attaching the shared model. Fixed; it matters for any future in-atlas weapon.
- **The brim fix is unrelated and should be kept.** `parts._relax_ring` /
  `_boundary_loops` / `kettle_hat` in `parts.py`. It touches nothing about the weapon.

## 2. The measured facts

All from the real evaluated mesh on the shipped `marsh` build, grip scale 0.94.

**The halberd, in its own units, origin at the grip:**

| Quantity | Value |
|---|---|
| Butt to head tip | 2.747 |
| Below the grip | 0.782 (28 percent) |
| Above the grip | 1.965 (72 percent) |
| Blade band | +0.571 to +1.543 above the hand |
| Blade extent, across | 0.874 |
| Blade extent, through | 0.268 |

**The body, in `2H_Melee_Idle` frame 0:**

| Quantity | Value |
|---|---|
| Head shell | z 1.183 to 2.252, x -0.514 to 0.572 |
| Helmet shell | z 1.732 to 2.299, x -0.633 to 0.692 |
| Head plus hat mass | 1.12 tall, on a 2.34 figure (48 percent) |

**How badly the shipped grip fails, by signed containment:**

| Pose | Blade verts inside head | inside helmet | Nearest weapon vertex to `hand.r` |
|---|---|---|---|
| `2H_Melee_Idle` f0 | **324 of 551** | **271 of 551** | 0.143 |
| `Idle` f0 | 6 | 26 | 0.189 |
| `1H_Melee_Attack_Slice_Diagonal` f17 | 4 | 70 | 0.188 |

Two things to read off that table. **More than half the blade is inside his skull in the
stance**, which is what the review saw. And **the hand never touches the haft in any
pose**: nearest approach is 0.14 to 0.19 units, so the weapon floats beside him
everywhere. The old shipped grip's "26 buried vertices" was not a defect to be minimised,
it was the FIST CLOSED AROUND THE HAFT. Driving that number to zero removed the contact.

## 3. The core geometric constraint

This is the part that makes it hard, and it is not a tuning problem.

With the haft vertical and the grip at the hand, the blade band sits at
`hand_z + 0.537` to `hand_z + 1.450` (0.571 and 1.543 at scale 0.94). The head plus hat
mass spans 1.18 to 2.30. So:

- For the blade to clear ABOVE the hat: `hand_z + 0.537 > 2.30`, so `hand_z > 1.76`.
  That is eye level. No resting arm pose puts the hand there.
- For the blade to sit BELOW the head: `hand_z + 1.450 < 1.18`, so `hand_z < -0.27`.
  Below the floor.

**For any reachable hand height, a vertical halberd's blade overlaps the head.** Lateral
escape does not save it either: the hat is 0.68 to either side and the blade is 0.82
across, so clearing it sideways needs about 1.09 units of offset from the head's centre,
roughly half his body height out to the side, at which point the weapon reads as a
separate floating object.

The blade starts only 0.571 above the grip because the grip sits 28 percent up the haft.
That single number is the root cause.

## 4. Why the last attempt's verification passed anyway

Four independent failures. Any harness for the next attempt has to close all of them.

1. **Hand-rolled skinning.** The solver computed posed positions as
   `skin @ basis @ M0 @ v` with `skin = (M_arm @ pose.matrix) @ (M_arm @ bone.matrix_local)^-1`.
   That ignores `parts.skin`, which re-parents the prop to the rig and sets
   `matrix_parent_inverse`, so the composed `matrix_world` is not what Blender evaluates.
   The solver reported 0.995 verticality where the real posed weapon is 0.83.
   **Rule: pose, update the depsgraph, and read `evaluated_get(dg).to_mesh()`. Never
   reconstruct the deform by hand.**
2. **Unsigned distance used as a clearance metric.** `BVHTree.find_nearest` returns
   distance to the surface with no sign, so "blade 0.12 units INSIDE his head" scored
   identically to "0.12 clear of it". This is what let 324 buried vertices read as clean.
   **Rule: containment must be signed.**
3. **Ray parity on an open shell.** The fallback containment count read zero because the
   kettle hat is now an open shell (its bottom is cut off), and parity calls the inside of
   an open shell "outside". `holes_fill` the shell first, then a normal-sign test is well
   posed. The helmet fills to 0 open edges; the head shell still has 194 after filling, so
   test per shell and treat the head with care.
   **Rule: make the test mesh watertight before asking whether a point is inside it.**
4. **Single-angle eyeballing.** The thrust was checked at yaw 32, where it projects clear,
   and the book renders it at yaw 100, where the haft visibly passes through the skull.
   **Rule: confirm every candidate at a minimum of four yaws, including the yaw the plate
   actually uses.**

Also worth keeping: two objective formulations got gamed before any of this surfaced.
Minimising vertices inside the body parks the weapon behind his back; adding a
screen-space penalty for the blade landing on the head lays the polearm flat across his
chest. Both are recorded in the `GRIPS` comment in `crew.py`.

## 5. What the harness must do

A rewrite of the scoring loop, and it is most of the work. Requirements:

- Build the figure once, then per candidate: set the grip, `frame_set`, update the
  depsgraph, read the evaluated weapon mesh and the evaluated body shells.
- **Signed containment per shell**, on hole-filled copies: blade-in-head, blade-in-helmet,
  haft-in-torso, reported separately rather than as one total. Hard-fail any candidate
  with a single blade vertex inside head or helmet.
- **Require hand contact.** Some haft vertices must be inside the closed fist, or the
  haft axis must pass within the fist's radius of `hand.r`. Target the old shipped value,
  about 26 haft vertices inside the hand shell. A candidate with zero contact is invalid
  no matter how it scores elsewhere.
- **Score over the real plate frames**, the ones in `cast.py` `poses`, not arbitrary
  mid-clip samples, plus a walk frame and the thrust peak.
- **Render the top few candidates at four or more yaws and look**, before committing a
  number. The repo's own convention, and the only thing that caught this.
- Cheap first pass on a coarse rotation grid is fine, but the cheap metric must not be one
  the expensive metric can contradict. Prefer a coarse pass that is the same signed
  containment on a decimated mesh.

Budget the harness as the majority of the effort. Everything after it is fast.

## 6. Options for the carry, with numbers

**Option A: move the grip down the haft, keep it upright.** Cheapest real fix. `GRIP_AT`
in `weapons.py` currently maps the grip 28 percent up. Move it to the butt
(`GRIP_AT` about -0.85 in source units) and the blade starts 1.292 above the hand instead
of 0.571; at scale 0.94 and a hand at roughly 1.2 the blade bottom lands near 2.42, which
clears the 2.30 hat top. Costs: nothing below the fist, so no haft to plant, and the
weapon tops out around 3.8 against his 2.34, reading as a pike. Dropping the scale to
about 0.75 keeps the height sane but pulls the blade bottom back to roughly 2.17 and into
the hat again. There is a narrow band here; it needs the harness to find it.

**Option B: shoulder it.** Tilt the haft roughly 35 to 40 degrees so it rests across the
shoulder with the blade up and BEHIND the head. This sidesteps section 3 entirely, because
the blade no longer has to fit in the vertical gap beside his face, and it is what a
marching militiaman actually does. Loosest constraints of the three, and the most likely
to look right on chibi proportions. Costs the "grounded at his post" silhouette the book
copy currently claims, so that copy changes with it.

**Option C: a weapon model with better proportions.** The current head is 0.874 across on
a figure whose hat is 1.36 wide, so the blade is roughly two thirds the width of his head:
it dominates whatever you do with it. A halberd with a smaller head and its grip authored
low makes option A straightforward. `weapons.militia_halberd` already narrows the crescent
by `blade_k`, so pushing that further is the cheap version of this; a genuinely different
source model is the thorough version.

**Recommendation: B, with C if a new model is being made anyway.** A is worth one harness
run because it is a single constant, but section 3 says the upright band is narrow and the
result will be a pike rather than a halberd.

## 7. How to run things

```
# build and export (body plus its bespoke weapon)
CREW_MEMBER=marsh CREW_OUT=tmp/asset_src/last_bell_crew \
  blender --background --python scripts/assets/last_bell_crew/model.py
node scripts/assets/build_assets.mjs scripts/assets/specs/last_bell_crew.json
node scripts/build_media_manifest.mjs generate

# review plates, ALL figures live in tmp/crew_plates, do not use a fresh dir
CREW_MEMBER=marsh CREW_PLATES=tmp/crew_plates \
  blender --background --python scripts/assets/last_bell_crew/model.py
node scripts/assets/last_bell_crew/build_concept_book.mjs tmp/crew_plates
```

`build_concept_book.mjs` rebuilds the page from whatever member JSONs the plates dir
contains, so rendering one figure into an empty dir silently drops the others from the
book.

## 8. Files in play

| File | Role |
|---|---|
| `scripts/assets/last_bell_crew/crew.py` | `GRIPS['militia_polearm']`, `add_clips`, `POLEARM_CLIPS` |
| `scripts/assets/last_bell_crew/weapons.py` | `GRIP_AT`, `blade_k`, `militia_halberd` |
| `scripts/assets/last_bell_crew/figures.py` | `build_marsh` mounts the weapon |
| `scripts/assets/last_bell_crew/cast.py` | plate `poses`, book copy, palette |
| `scripts/assets/last_bell_crew/parts.py` | `mount`, `skin` (the parenting that broke the math), `kettle_hat` |
| `scripts/assets/last_bell_crew/source/` | the clip library and its builder |
| `src/render/characters/manifest.ts` | `npc_marsh` clips and attached weapon |
| `docs/design/last-bell-cast-review-notes.md` | living worklist, section 11 is the KayKit finding |

## 9. Copy that becomes false depending on the option chosen

`cast.py` currently claims, and the built page repeats, that he carries it "grounded and
vertical, head up, butt at his feet" and that the stance reads as "both hands on the
haft". Neither is true of the current build (the hand does not touch the haft at all), and
option B would replace both. Fix the copy in the same change as the carry, not after.
