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

## Open items as of this writing

- **Coalfast / Coalfast-sealed shield animation carry: RESOLVED.** The
  engine's authored shield grip failed the clip gate too (tray-mode in
  Walking_A and Block), so the shield was rebound to `lowerarm.l` (a strapped
  shield tracks the forearm, not the hand slot) and its seat re-authored in
  the live session; the hand-set seat then passed the gate in all four clips
  on both Coalfast variants. Confirms the rule above: the carrying bone is as
  much a part of the seat as the transform.
- **Game-side:** `adv_sword_1handed` should leave the `VAR_SWORD` row in
  `KAYKIT_WEAPON_ACCESSORY`, and the hand-authored seats should land as
  `WEAPON_GRIP_OVERRIDES` rows so the game and the book finally agree.
- **Book pipeline:** `crew.py` `GRIPS["blade"]` still encodes the bare
  attach; regenerating the book without baking the authored seats first will
  resurrect the original bug.
