# The Last Bell cast: review notes and follow-ups

Living worklist for the Farshore cast models (`scripts/assets/last_bell_crew/`,
shipped bodies in `public/models/chars/npcs/`, review page
`docs/design/last-bell-concept-art.html`).

Maintainer review of the first full pass, recorded verbatim in intent so nothing
gets quietly dropped. Status column is the honest one: `OPEN` means not started,
`FIX` means the cause is understood and the change is known, `DONE` means landed
and re-reviewed on the page.

Ordered so the cheap certain fixes land before the speculative art passes.

---

## 1. Grip and prop defects (cheap, causes understood)

These are all the same class of bug and all live in `GRIPS` in
`scripts/assets/last_bell_crew/crew.py` plus the `weapons` lists in `cast.py`.
Props are mounted in the bone's local frame (`parts.held`), so one tuning per
family fixes every clip at once. Every value in that table was chosen by
rendering candidates into a real clip and looking; these are the ones that were
read wrong.

| # | Figure | Defect | Fix | Status |
|---|---|---|---|---|
| 1.1 | Coalfast | Shield is **back to front**: the inside faces the enemy | `shield` grip is `(90, 0, 0)`, which presents the BACK. The candidate grid's `-90` variants showed the painted face, so the shield family wants `(-90, 0, 0)`. Re-run the Block-pose grid to confirm before committing. | FIX |
| 1.2 | Marsh | Shield back to front (same cause as 1.1) | Same one-line fix; both shields share the family. | FIX |
| 1.3 | Marsh | Spear sits **sideways** in the animations | `pole` is `(0, 0, 0)`. Needs its own grid pass in `Block` AND `1H_Melee_Attack_Chop`, not just `Idle`: a pose that reads at rest can still be wrong mid-swing. | FIX |
| 1.4 | Ollun | Staff is **upside down** (brass crown at the bottom) | `stave` is `(90, 0, 0)`; invert to `(-90, 0, 0)`. | FIX |
| 1.5 | Ollun | Holds the open journal **like a shield**, out in front | Move it off `handslot.l`. Either carry it closed at the hip as bespoke geometry, or drop the held book and keep the record as the hip satchel that is already modelled. Preference: closed book at the hip. The idea is right, the execution needs care. | OPEN |
| 1.6 | Ewald | Should carry **no weapon at all** | Remove the boat gaff from his `weapons` list. His outfit carries him without it. | FIX |
| 1.7 | Edda | Remove the second-hand item, keep only the hammer | Drop `tools/tongs.glb` from her `weapons`. | FIX |
| 1.8 | Saul | Not holding the lantern properly | Holding a swinging lantern correctly needs a rig and animation pass that is probably out of scope. Default to **removing it** unless the bail can be made to read at a glance. | OPEN |
| 1.9 | Marsh | Spear reads as a **tribal** spear, not a warrior's | `spear_a.glb` is the only spear in the kit and it is the tribal one. Either re-point him at a different shipped polearm (`halberd.glb`) or generate a plain militia spear through the Tripo pipeline (see section 4). | OPEN |

## 2. Model defects

| # | Figure | Defect | Fix | Status |
|---|---|---|---|---|
| 2.1 | Ewald | **Haircut pokes through the hat.** The hat itself is the best thing in the pass and stays exactly as it is. | The sou'wester is built off the measured skull, but the ranger head's hair sits proud of it in places. Either grow the crown radius until it clears the hair, or re-UV the hair to the oilskin cell the way Ollun's is, so anything that does poke through reads as hat. | FIX |
| 2.2 | Saul | "Some messed up things on the front of his shirt" | The four apron patches. They are reading as artefacts rather than repairs at this size. Reduce to two, enlarge them, and seat them flatter against the apron so they read as cloth rather than floating tiles. | FIX |
| 2.3 | Tam | Reads too much like a **shaman**. Needs normal town clothes. | The barbarian body's fur mantle and wrap are doing it. Re-palette away from the teal/fur combination toward plain town wool and leather, and drop the mantle's fur cell to a coat colour. | FIX |
| 2.4 | Tam | Needs **hair** (currently bald) | The barbarian head is bald under the bear hat. Options: bespoke hair geometry, or a Tripo-generated hair cap fitted in Blender (section 4). | OPEN |
| 2.5 | Edda | Wants a **plaited** haircut | Not achievable by repaint: the rogue head's hair is fixed geometry. Tripo-generate a plait, fit and skin it to the head bone in Blender (section 4). | OPEN |

## 3. Approved, do not touch

- **Nell** looks great. Leave her alone.
- **Ewald's hat and outfit** are the strongest thing in the pass. Only fix the
  hair poke-through; change nothing else.
- **Marsh** and **Coalfast** read well as figures and are properly distinct from
  each other. Their problems are all props.
- **Edda** is fine apart from the second-hand item and the hair.
- Tam is "fine" apart from clothes and hair.

## 4. The creatures need a different pipeline

The maintainer's read, which supersedes the skeleton-repaint approach for the
break-spawned:

> Riftspawn need to be more **demonic**, and more like **something from a dream**,
> to be true to the lore. We need a few runs through the image-to-GLB pipeline
> using Tripo to make some really cool looking things that match the art style but
> are more **nightmare-like**. Same for all the NPCs. **The wolf and spiders are
> the weakest.**

What that means concretely:

- The KayKit skeleton repaint was the right move away from the Quaternius blobs,
  but a skeleton is a *dead body*, not an unfinished one. The lore is "unfinished
  rooms from the Dreamer's Sleeping World pressing into the waking world", which
  wants dream-logic wrongness rather than undeath.
- `void_stalker` (wolf) and `tidemill_stalker` (spider) are the weakest figures in
  the book. Both are ordinary animals with a colour wash. Neither says rift.
- Route: the `asset-pipeline` skill (Tripo API, `scripts/asset_pipeline/pipeline.mjs`)
  to generate candidates from concept prompts, then the `image-to-glb` workflow and
  Blender for fit, scale, rig and fine-tuning. Expect several runs; judge candidates
  on a contact sheet before committing to one.
- Art-style constraint: whatever comes out must sit next to the KayKit chibi cast
  without looking like a different game. Nightmare-like, not photoreal, not gory.

Same pipeline is the answer for the hair items (2.4, 2.5).

## 5. Review-page requirement

**The page must play the animations, not just show stills.** Idle, walk,
`1H_Melee_Attack_Chop` and Block, per figure, playable, so poses and props can be
judged in motion. Static plates hid exactly the defects in section 1: a shield
that reads fine standing still is obviously reversed once it moves.

Implementation: render each clip as a frame sequence, stitch to one sprite sheet
per clip, and drive it with a CSS `steps()` animation plus a play or pause control.
Sprite sheets rather than one file per frame keeps the request count and the
committed weight sane.

## 6. Already-known open items (carried from the first pass)

- **Tidemill Stalker's carried mill roof** is not modelled. Slate courses were
  prototyped and cut; every seating read as a floating shelf. Likely resolved by
  section 4 replacing the body outright.
- **Star-glass shards on the wolf and spider** were built and cut; they read as
  pale ice spikes standing off the back. Also likely moot after section 4.

## 7. Not in scope, decided

- **Outrider Bren gets no model.** He dies before the campaign starts and never
  appears; the point of him is the chair nobody sits in. A still life of his gear
  was built and cut.
