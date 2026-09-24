# World Quests round 2: plan

Date: 2026-09-22. Base: `integration/world-quests-v0440` at 829a39b117 (PR 4111). Every
source PR head (3847, 4051, 4110, 4052) is an ancestor of this tip, so the branch carries
all of the pushed quest work. Reviewed on the local rig (server :8787, Vite :5173,
account `pr4111review`).

Scope: the five changes from the 2026-09-22 playtest list plus the Clue Scroll delivery
bug found during it. Each item names the current code, the change, the pins and tests
that move, and the open calls. Sizes are for one contributor: S = under a day, M = one to
three days, L = a week.

## 0. Clue Scroll delivery bug (fix first, S)

Symptom: with `/dev clue` the hunt asked for cooking salt for Mother Sedge; she would not
accept it and every step needed `/dev clue solve`.

Cause (shared client code, so offline and online behave the same): the interact key on an
ordinary quest NPC opens the local gossip menu (`src/game/nearby_interaction.ts`
`tryNearbyInteraction`, then `QuestDialogController.open` in
`src/ui/hud/quest/quest_dialog_controller.ts`) and only sends the `interact` command for
bankers, the rift forge, the emissary, the vault keeper and chroniclers. The clue step
lives in `meta.clueHunt`, outside `npc.questIds`, so the dialog never produces a row and
the server-side check `onNpcTalkedForClueHunt` (`src/sim/clue_scrolls.ts`) never runs.
Item ids match (`cooking_salt` in the hunt, the vendor and the item def), so it is purely
routing. Every `npc` and `deliver` step whose target is a plain quest giver is affected.

Change:
- In `QuestDialogController.open`, when the world's active clue hunt step targets this NPC,
  send `world.interact()` on open (same short-circuit family as the emissary), and render
  one gossip row for the hand-over so the player sees why the visit worked. Row label is a
  new `t()` key in the quest catalog module.
- Test through the real path, not `sim.talkToNpc`: arm a one-step `deliver` hunt on an NPC
  that also owns ordinary quests, give the item, drive `tryNearbyInteraction`, assert the
  `interact` command is sent and `meta.clueHunt.step` advances. Add the same for an `npc`
  step. `tests/clue_scrolls.test.ts` keeps its direct sim cases.

## 1. Forge minigame popup above the HUD, centred (S)

Current: `src/ui/hud/vehicle/forge_action_bar_controller.ts` builds the panel with class
`vehicle-bar forge-action-bar`, so it inherits the bottom-pinned rule at
`src/styles/hud.css` (`.vehicle-bar`, `bottom: max(24px, safe-area)`, no z-index). It
toggles `body.working-forge`, and no stylesheet references that class, so it gets none of
the `operating-vehicle` accommodations that hide the action bar and lift the player frame
for the cannon and glider bars. Result: it sits on the unit frames and action bar.

Change: reparent it into the centred window family the candy and ley puzzles already use
(`.window panel`, rule in `src/styles/layout.css`: absolute, left 50 percent, top 10vh,
z-index 20; `src/ui/world_quest_puzzle_window.ts` is the reference). Keep the id, drop
`vehicle-bar`, keep the forge-specific width and grid rules, delete the dead
`working-forge` toggle. If "middle of the screen" means vertically centred too, add one
modifier on the forge id (`top: 50%; transform: translate(-50%, -50%)`) rather than
changing the family.

Pins and tests: `tests/mobile_window_coverage.test.ts` will start requiring a mobile
decision for the new `.window` id (a real `body.mobile-touch #forge-action-bar` rule in
`hud.mobile.css`, which it needs anyway, or an exceptions entry with a reason).
`tests/world_quest_forge_view.test.ts` is pure math and stays. Before and after
screenshots, desktop and mobile, under `docs/screenshots` (the `pr-screenshots` skill).

## 2. Glider: tower out, wharf launch on the hill, replays, variation, new model

Current: launch site `GLIDER_LAUNCH_SITE` (450, 520) in `src/sim/content/world_quest_glider.ts`
sits on the flight tower, a procedural structure in `src/sim/glider_tower_layout.ts`
(walk surface folded into ground height by `src/sim/walk_lifts.ts`) rendered in
`src/render/gale_features.ts`. Three hand-authored courses (`GLIDER_COURSES`: the base
course, valleys, switchbacks) of about 20 rings plus four wind tunnels each. The player's
glider is procedural geometry (`createGliderApparatusMesh` in
`src/render/glider_course_visual.ts`), not a GLB.

### 2a. Remove the tower, launch from a wharf on the hill (M)

Assumption to confirm: "wharf" means a Wickharbor-style stilt pier. Galecrest already has
that idiom: `GALE_HARBOR_DECKS` in `src/sim/gale_harbor.ts` (rotated rectangles anchored to
the terrain at their shore root, level on the way out, walkable via `galeDeckSurface`,
drawn by `deck_render.ts`). A launch wharf is one more `GaleDeckDef` rooted at a hill
crest above the Shear and running out over the drop, so the run starts from the end of
the planks.

Steps: pick the hill (probe ground heights around the Shear, pad it with a calm anchor in
`src/sim/terrain_calm_anchors.ts` if the crest is rough), add the deck def, move
`GLIDER_LAUNCH_SITE`, `playerLaunch`, the Flightmaster's position and ring 1 to the deck
end, delete the tower module, its walk lift and its render block, update the three
courses' opening rings for the new launch height. Tests: `tests/glider_tower_layout.test.ts`
goes, `tests/gale_harbor.test.ts` gains the new deck, the glider suites re-pin the launch
coordinates, and the terrain height parity corpus needs a re-mint if it samples the
Shear (`UPDATE_TERRAIN_HEIGHT_PARITY=1`). Check the parity goldens for any scenario that
stands at (450, 520).

### 2b. Infinite runs, reward only on the first successful run (S)

Already mostly true: `updateWorldQuests` (`src/sim/world_quests.ts`) only credits when the
quest state is `active`, and the instructor branch starts a `practiceOnly` flight once
the quest is no longer active. Work: confirm the instructor offers the replay after
completion in the dialog (not only via `/dev glider start`), make sure the retry copy
shows, and add the regression test the suite lacks: a second full winning flight after
completion pays no copper, standing or item.

### 2c. Heaps of course variation (L)

Options, in order of preference:
1. A seeded course generator `src/sim/world_quest_glider_generation.ts`, mirroring the
   daily candy and ley generator (`src/sim/world_quest_daily_generation.ts`, 32 certified
   variants keyed by day). Compose a course from authored beats (gate arcs, dives,
   tunnels, chicanes) along a spline from the wharf to the landing pad, with constraints
   the physics needs: ring spacing and the descent profile (`courseProfile` and
   `GLIDER_COURSE_MARGIN` in `src/sim/minigames/glider_flight.ts`), the 60 s timeout,
   tunnel placement along travel direction, terrain clearance via `groundHeight`. A
   certification test walks every variant of the cycle. Shared offering: all players fly
   the same variant on a given day, as the puzzles do.
2. More hand-authored courses in `world_quest_glider_levels.ts` (cheap per course, no
   generator, but each is a day of tuning and the variety stays finite).

Either way the course fields cross the wire: extend `GliderCourseDef`, the decode and
sanitize pair in `src/sim/world_quest_glider_wire.ts`, and `src/net/quest_snapshot_wire.ts`
together, then re-pin `tests/world_quest_glider_projection.test.ts` and the parity
goldens that include a glider flight.

### 2d. Swap the glider model (M, blocked on input)

Needs a source: a reference image for the `image-to-glb` pipeline, or a Tripo generation
through the `asset-pipeline` skill. Then: GLB under `public/models`, entry in
`src/render/characters/manifest.ts` (the mount entries are the pattern), regenerate
`src/render/assets/manifest.generated.ts`, replace `createGliderApparatusMesh` with a GLB
binder like `src/render/mount_visuals.ts`, and update `tests/glider_course_visual.test.ts`
plus the asset fingerprint and ktx2 audit pins.

## 3. Frostveil: move the boxes (S)

The "boxes" are almost certainly the four `sprung_trap` ground objects the wolf-trap quests
interact with (`src/sim/content/frostveil.ts`, positions at (-92, 1750), (-116, 1756),
(-80, 1770), (-72, 1756); world quest `wq_frostveil_howlers`, area (-92, 1758) r30, and
the regular quest from Trapper Brosk). The other candidate is the four decorative
Icemantle crates in `FROSTVEIL_PROPS.crates` (scenery only). Confirm which.

Change: edit the coordinate array by hand (the `/placer` tool only knows the Farshore
shipwreck kit), keeping every spot on dry land off the Shiverfen pool and off colliders,
inside the quest area radius or widen the radius with it. Verify with
`tests/ground_object_placement.test.ts` (swim depth, structure lift, count of four).
Optional and cheap variety: give the `interact` objective the same `layouts` idea the
salvage kit has, so the traps sit in a different arrangement on later offerings.

## 4. Significantly more kill and daily quest variety per zone (M, content)

Current: one classic quest per zone in `src/sim/content/world_quests.ts` (nine zones), one
slot per zone per day picked by `activeWorldQuestsForCycle` in
`src/sim/world_quest_rotation.ts` as `ids[cycle % ids.length]`. The rotation already
supports many ids per zone with no new mechanism. Objective types available today:
kill, escort, interact, gather, delivery, salvage, puzzle, match3, vehicle, plus the
one-off minigames.

Round 2 shape:
- Add three more records per zone (kill and gather first, delivery and escort where the
  zone has a story hook), each against a mob template or node that zone already has (the
  rosters are in the zone content files; never a new mob for this round). Labels come
  from the mob or item name, so no new i18n rows, deeds, wiki or art obligations.
- Widen the pin at `tests/world_quests.test.ts` ("every quest reached within four days")
  deliberately when a zone pool exceeds four, and add a per-zone seeded offset (or a
  day-keyed shuffle) so equal-sized pools do not line up and repeat the same board.
- Per-day placement variation for interact and gather quests (the salvage `layouts`
  pattern) so a returning player sees a different arrangement, which is what the variety
  brief (`statement-of-work.md`) asks for over pure permutation.
- New activity types (tracking, disrupted delivery, ley variants) stay in the brief as
  Champete's creative track, not this batch.

Obligations per zone commit: the rotation table entry, `tests/factions.test.ts` floor
(grows fine), `tests/ground_object_placement.test.ts` for any new ground object, and the
level bands from the scope (5 to 15 in Eastbrook and Mirefen, 16 to 20 elsewhere).

## Sequencing and PR split

All PRs target `integration/world-quests-v0440` while 4111 is open, as 4136 did. Land the
release base merge on the integration branch first (26 conflicting files today, no CI
since 2026-09-19 because conflicting PRs skip the workflow), so children do not inherit
the conflict.

1. Day 1, small and independent: 0 (clue routing), 1 (forge window), 3 (Frostveil).
2. Next: 2a plus 2b as one PR (launch rework with the replay pin), 4 as one PR per zone or
   one batch.
3. Then: 2c (generator) and 2d (model, once the source is chosen).

## Open calls for Reuben

- "Wharf": a new hill-top stilt pier in the Wickharbor deck idiom, yes or no? And which
  hill (I can probe candidate crests and send screenshots).
- Frostveil "boxes": the four trap objects or the decorative crates?
- Glider variation: generator (shared daily variant, certified) or more hand-authored
  courses? How many is "heaps" (a 32-day cycle like the puzzles?).
- Glider model: reference image, or generate one?
- Variety count: three new per zone (four-day pools) or more with the pin widened?
- Forge window: upper-centre like the puzzles, or dead centre?
