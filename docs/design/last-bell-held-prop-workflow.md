# Held-prop authoring and verification for the Last Bell cast

A record of the 2026-08-05 sword-and-shield grip repair on the concept book
(`docs/design/last-bell-concept-art.html`), written so the failure modes it
uncovered are never repeated. Five distinct mistakes stacked into one visual
bug that survived multiple "verified" claims. Each failure below carries the
rule that prevents it.

## The failures, and the rules they taught

### 1. A comment about another system was trusted over the system itself
The book mounted every blade with a literal bare bone attach
(`GRIPS["blade"]` in `scripts/assets/last_bell_crew/crew.py`) because a note
in `cast.py` claimed that is what `VisualDef.attach` does in-game. It is not:
the engine resolves a real grip transform per weapon family (`attachProp` in
`src/render/characters/assets.ts`, via `applyHandGrip` / `applyVariantGrip`
and the `KAYKIT_HAND_GRIPS` / `KAYKIT_SHIELD_GRIPS` tables).

**Rule: a comment describing another system is hearsay. Read the system, or
better, look at its rendered output.**

### 2. Matching the engine's numbers reproduced the engine's own bugs
Once the engine tables were read correctly, faithfully replicating them still
produced a wrong render, because the engine itself misroutes
`adv_sword_1handed` through the variant-pack grip (`VAR_SWORD` row in
`KAYKIT_WEAPON_ACCESSORY`), seating it across the wrist. Precision-matching
buggy data produces precisely buggy art.

**Rule: code tables are not visual ground truth. The acceptance test for a
held prop is perceptual: does it read as held. Numbers are the means, never
the verdict.**

### 3. Single static frames signed off wrong seats, twice
A fist at the blade root and a fist on the grip are nearly pixel-identical
from most single camera angles, and a sword floating half a hand off the palm
reads as "held" in a lone 440px still. Two separate wrong seats passed
"visual verification" this way.

**Rule: never sign off a spatial relationship from one 2D frame. Verify
zoomed on the contact point, from at least three yaws, in more than one clip,
and side by side with a known-good reference at the same camera station (the
in-game warrior still `public/guide-stills/player_warrior.webp`, or a
correctly seated cast member). A human orbiting the live viewport resolves in
seconds what static renders hide; when a human is available, the human
authors and approves, the agent captures and mass-produces.**

### 4. A human-authored arrangement was captured only in part
When the seats were finally hand-authored in the live Blender session, only
the sword transforms were captured; the shield was re-rendered from the old
book mount and shipped wrong again.

**Rule: when a human authors a scene, capture the transform of EVERY prop in
it. Take the whole arrangement, not the parts that were discussed most.**

### 5. A rigid bone attachment was authored and validated at one pose
The shield seat was placed against the figure posed at Idle frame 0 and
looked strapped to the forearm there. But the prop is rigid-bound to
`handslot.l`, and the authored seat sits a long lever arm away from that
bone: every other frame of Walking_A and the attack clip swings the shield
out beside the body, floating. One pose cannot validate a seat that must
survive 22 clips.

**Rule: a rigid prop seat is only correct if it reads correctly across the
CLIPS, not at a pose. Scrub Idle, Walking_A, the attack, and Block in the
viewport before accepting a seat. Keep the seat's offset from its bone small:
bind the prop to the bone that anatomically carries it, and prefer the
authored grip data extracted from the original KayKit rigs
(`KAYKIT_SHIELD_GRIPS` in `src/render/characters/held_item_grips.ts` exists
precisely because left-hand shields need to sit flat against the forearm
through every clip).**

## The workflow that works

1. **Author in the live session.** Compose the figure in the shared Blender
   instance: shipped GLB body, props imported and rigid-bound (weight-1 vertex
   group on the carrying bone plus an armature modifier) so the timeline
   previews every clip. The human places each prop and scrubs all four book
   clips before calling a seat done. Source scene from the repair session:
   `tmp/asset_src/last_bell_crew/Untitled.blend`, scene `LastBell_Grip_Review`
   (gitignored; keep it, it is the authored master).
2. **Capture everything.** For each prop, record `matrix_world` plus the
   owning rig's world matrix; rebase to a rig at origin. The captured object
   matrix IS the rest placement the render pipeline needs (the armature
   modifier's rigid map is independent of the object transform), so no
   re-derivation is ever required, and none should be attempted.
3. **Re-render in isolation.** Page assets are rendered in temporary scenes
   with the book's camera and light rig (mirrors `preview.py`), never in the
   author's scene. Turnarounds pose Idle frame 0; anim sheets sample each clip
   evenly at the fixed station.
4. **Gate before deploying.** Zoomed contact-point crops from at least three
   turnaround yaws and at least two cells of EVERY clip, compared against the
   authored session render. Only then replace the webps under
   `docs/design/last-bell-concept-art/` and re-check the built page.
5. **Ambiguity is a fail, not a maybe.** If any gate frame is ambiguous
   (the contact point occluded, the prop edge-on, the relationship unclear),
   the answer is never interpretation: render another angle or hand the frame
   to a human. Every false "verified" in the repair session was an ambiguous
   frame resolved by optimism.
6. **A "verified" claim must cite its evidence.** State which frames, which
   yaws, which clips were checked and against which reference. A claim that
   cannot name its evidence is a claim about the checker's checklist, not
   about the art.

## The contract: the shipped GLB is the only artifact

Everything above was written while the book and the game were TWO SOURCES OF TRUTH.
The book placed held props in Blender; the game re-derived them at runtime from the
shared grip tables. Two mechanisms agree only by coincidence, and they drifted every
single time: Ollun's staff sat level at his hip in game while the page showed it
crown-up, and Coalfast's shield sat in his fist rather than strapped to his forearm.

That split is now closed, and this is the rule that replaces the seat-capture dance:

> **A figure's fixed props are baked INTO its body GLB, and the concept book
> photographs that shipped GLB. One artifact, read by both.**

- `cast.py` marks a prop `"fixed": True`. `crew.export` keeps those (still skinned to
  their carrying bone) instead of dropping them; anything unflagged is still dropped,
  because it is a swappable prop the game mounts through `VisualDef.attach`.
- `plates.render_member` loads `public/models/chars/npcs/<id>.glb` rather than
  rebuilding the figure, so a plate is EVIDENCE ABOUT THE FILE THE GAME LOADS. Its
  manifest records which path ran, so a plate cannot quietly claim to be something else.
- The Last Bell `VisualDef`s therefore carry NO `attach`, and re-adding one puts the
  drift straight back. Pinned by `tests/visual_manifest.test.ts`, which asserts both the
  absent `attach` and the presence of each `Prop_*` node inside the shipped GLB.

### Fixed or attached

Bake it when the figure always carries that exact thing: a story NPC, a fixed piece of
characterisation. Two costs, both real: a baked prop **cannot sheathe or be swapped**
(the stow system only moves attached props), and it brings its own material, so it adds
one draw. Attach it when a player equips it, when it must sheathe, or when the model is
shared across many holders and a per-family fit is genuinely the right answer.

### The one command

    node scripts/assets/last_bell_crew/ship.mjs ollun,coalfast
    node scripts/assets/last_bell_crew/ship.mjs all

Build and export raw, optimize into `public/` (meshopt: the runtime loader cannot read a
raw export), photograph the shipped file into plates, rebuild the page, regenerate the
media manifest. The order matters: photographing before optimizing puts the book back to
picturing something that never shipped.

### The loop this is built for

1. An agent or a human composes the figure and its carry in the live Blender session.
2. The human nudges whatever looks wrong, in Blender, directly.
3. `ship.mjs` runs. The page updates.
4. The page is the review surface and the share surface. It is a plain HTML file plus a
   webp folder in `docs/design/`, so anyone with the repo opens it directly, no server.
5. When the page is right, the game is already right. There is no separate "add it to
   the game" step that can disagree, because the game loads the file the page pictured.

## Who authors a seat, when a prop IS attached

Both can. **An agent should attempt a seat**, and the attempt is judged by the gate
above, never by the search that produced it. What is NOT acceptable is treating a
numeric score as the verdict: on 2026-08-06 a sweep that scored prop-vs-cape
intersection picked a carry whose "crown-up" metric was inverted (it rendered
crown-DOWN), and its clearance-optimal answer was rejected on sight. Derive a
candidate, gate it on frames, and show it.

**A human in the live session is the final word, and is faster than another search
round.** When the authored arrangement is the one that ships, capture it (below)
rather than trying to reproduce it from a grip family.

## Where a captured seat lives (both sides)

A seat is now first-class in BOTH pipelines, from ONE captured number:

- **Book:** a `seat` key on the weapon spec in `cast.py`, a 4x4 rebased to a rig at
  the origin, applied verbatim by `parts.seated` (`crew.arm` prefers it over `GRIPS`).
- **Game:** `AttachSeat` on an `AttachDef` in `src/render/characters/manifest.ts`
  (position + quaternion + scale in the CARRYING BONE's local space), applied by
  `attachProp`, which short-circuits every derived grip path including the
  variant-pack one. Pinned by `tests/visual_manifest.test.ts`.

Capture recipe, per prop: read `matrix_world` and the owning rig's `matrix_world`,
rebase to a rig at the origin for the book number, and take
`(rig.matrix_world @ bone.matrix_local).inverted() @ obj.matrix_world` for the game
number. Bone-LOCAL is deliberate: it is pose-independent, so one number holds across
all 22 clips, and it survives the glTF Y-up conversion because it is a relative
transform between two nodes in the same hierarchy.

Do not decompose a captured seat back into rot/offset/scale, and do not hand-tune its
digits: re-derivation is failures 2 and 4 above.

## Open items as of this writing

- **Coalfast / Coalfast-sealed shield animation carry: RESOLVED.** The
  engine's authored shield grip failed the clip gate too (tray-mode in
  Walking_A and Block), so the shield was rebound to `lowerarm.l` (a strapped
  shield tracks the forearm, not the hand slot) and its seat re-authored in
  the live session; the hand-set seat then passed the gate in all four clips
  on both Coalfast variants. Confirms the rule above: the carrying bone is as
  much a part of the seat as the transform.
- **Seat plumbing and migration: RESOLVED 2026-08-06.** Coalfast (sword and
  shield, both forms), Marsh (sword) and Ollun (staff) now carry `seat` rows in
  both pipelines, captured from `LastBell_Grip_Review` / `Ollun_Tweak` in
  `tmp/asset_src/last_bell_crew/Untitled.blend`. Regenerating the book no longer
  reverts them, so the revert-the-webps dance is gone. Faithfulness was checked by
  re-rendering and diffing against the committed plates: mean absolute difference
  0.81/255 over 48 frames, concentrated on edges (anti-aliasing) plus three
  mid-swing cells where the pose samples a hair differently, with no prop-shaped
  displacement.
- **`WEAPON_GRIP_OVERRIDES` was the wrong target** (this doc previously said the
  seats should land there). It is keyed by weapon BASENAME, so it is global to a
  model: Coalfast's nudge would move every `sword_1handed` in the game, players
  included, and it cannot express a bone change at all. Per-character seats belong
  on the per-character `AttachDef`. The overrides table remains correct for what it
  is for: making one weapon MODEL sit well in any hand.
- **Game-side, still open:** `adv_sword_1handed` should still leave the `VAR_SWORD`
  row in `KAYKIT_WEAPON_ACCESSORY`. Marsh's seat bypasses that misroute for him, but
  any other holder of that model still gets the wrist-crossing grip.
- **In-game visual confirmation of the migrated seats is still owed.** They are
  gated in Blender against the shipped rigs and pinned by tests, but nobody has yet
  stood in front of these three NPCs in a running client.
