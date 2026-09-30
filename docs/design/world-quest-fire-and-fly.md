# Fire and Fly: The Gunner's Trials

A personal World Quest at the Evergarden gate. Master Gunner Alder recruits
defenders for the ramparts and tests each one first: the player climbs an old
cannon tower in a private arena and holds it against waves of monsters with a
fast-reloading cannon whose shells both wound and throw. A hit monster flies,
tumbles, bounces off trunks and lands further out; a survivor gets up and walks
back. The fun is the throw, not the kill count.

The mini-game is called Fire and Fly (the arena's display name); the world quest
is The Gunner's Trials, and each difficulty is a named trial. Every name here was
web-checked before it shipped (`docs/design/naming-audit.md`, "Fire and Fly world
quest at the Evergarden gate").

## The arena and the tower

- The arena is a private open-field interior (`FIRE_AND_FLY_DUNGEON_DEFS` in
  `src/sim/content/fire_and_fly_arena.ts`): no overworld door, no spawns, hidden
  from the guide, one slot per player claimed under their solo key (never the
  party's) by `claimTurretArena` in `src/sim/turret_arena_session.ts`. A realm
  holds `INSTANCE_SLOT_COUNT` (`src/sim/data.ts`) arenas at once, the same pool
  size as every instanced interior; with all of them manned, the next player is
  refused with the `full` line ("Every Fire and Fly tower is manned") and stays
  where they stood. An ended run keeps its slot while its player stays on the
  roof for Replay.
- `src/sim/fire_and_fly_field.ts` is the one pure leaf for its shape: a gently
  rolling clearing, flat at the tower's foot, a few rocks, a dense tree ring,
  the tower's body (`FIRE_AND_FLY_TOWER`, measured from
  `public/models/biome/hex_tower_cannon.glb`), and the static colliders the sim
  and the renderer read from the same lists. Placements hash their index: no rng.
- The player stands on the tower's roof. Only the head (the turret and barrel)
  turns toward the aim, eased; the barrel lifts to the shot's elevation and
  recoils (`src/render/turret_tower_visual.ts` over `turret_tower_core.ts`).
- The camera is the normal third-person orbit, free all the way round: the player
  never moves, right-drag and the turn keys turn the view, the wheel zooms, and
  a ground reticle under the mouse aims (`src/game/turret_controls.ts`,
  `src/ui/hud/vehicle/turret_aim_core.ts`). One click is one shot; holding the
  button does not auto-fire.
- Leaving (the Leave button, or Escape with nothing else to close) ends the seat
  and returns the player exactly where they stood, remounting the mount they rode
  in on when they still hold it and are out of combat. Death inside revives at
  that point. A save taken while seated records the return point
  (`src/sim/turret_save_position.ts`), so a restart never strands a player in
  the arena.
- A pet cannot follow onto the roof: the seat parks it in the pet stash the delves
  and the ferry use (`parkPetForArena` in `src/sim/turret_arena_session.ts`; a save
  meanwhile still carries a hunter's beast) and hands it back beside its owner when
  the seat ends, once the owner is alive. Left standing where its owner was, a pet
  a mob pulled would pull the owner into combat and end the run.

## The engine

The run is a pure, deterministic engine with private actors, in the pattern of
the cannon world quest (`docs/design/world-quest-cannon.md`): the
monsters are not sim mobs, never enter shared combat, and are invisible to other
players. Their stats and models come from the real templates in `MOBS`, so they
are the game's own monsters, living only inside this mini-game.

- `src/sim/minigames/turret_defense.ts`: phases (intro, wave, between, won,
  lost), spawning, the march, the wind-up and strike, the shot and its blast.
  State is plain JSON-safe data; the seat (`src/sim/turret_defense_session.ts`,
  the `turret` kind of `PlayerMeta.vehicle` dispatched from `vehicles.ts`) drives
  it once per tick and publishes a view cloned once per engine revision.
- **Motion segments** (`src/sim/minigames/thrown_body.ts`). Every body holds one
  closed-form segment (march, fly, skid, still) with its start and end tick, so a
  host samples any frame analytically and the state changes only at transitions.
  Contacts (ground, water, a collider, the void) are found once, when a segment
  is planned, through an injected `ThrowProbe` bound to the arena's ground and
  colliders.
- **Throws.** A blast's falloff (`blastFalloff`) scales both damage and launch;
  the launch pushes away from the blast and pops upward, divided by the body's
  mass class (`TURRET_SIZE_CLASSES`), so a wolf flies far and a yeti barely hops.
  A fast landing bounces, then skids, lies down, rises and marches again. A graze
  below `TURRET_WEAPON.grazeFalloff` wounds without a throw, so a body lying past
  the range can always get up. A monster killed in the air flies on as a corpse
  and lies still once landed; later shots never move a corpse.
- **Bowling** (`src/sim/minigames/turret_bowling.ts`, tuned by
  `TURRET_BOWLING`): a body flying fast and low, corpses included, knocks over
  the grounded monsters it crosses, each pair once per flight.
- **Kegs** (`src/sim/minigames/turret_barrels.ts`, tuned by
  `TURRET_EXPLOSIVE_BARREL`): each wave stands powder kegs on a ring inside the
  march, with every lane kept clear of them. A blast or a fast thrown body lights
  one; it blows after a short fuse with a bigger blast on the shell's rules, so a
  chain reads as a ripple.
- **The strike.** A monster reaching the tower winds up once (a red ring under
  it). A shot during the wind-up throws it back at no cost. A completed wind-up
  strikes once and the monster vanishes, costing `turretBreachPoints`: its size
  class's breach value scaled by its remaining health, at least one point. Raw
  monster health is never the cost.
- **The boundary.** An invisible wall stands just behind the inner tree row
  (`FIRE_AND_FLY_WALLS`, `FIRE_AND_FLY_WALL_RADIUS`). A thrown body bounces off
  the inner trunks or the wall between them and never reaches the rows behind,
  which are scenery with no collider. Pinned by `tests/fire_and_fly_boundary.test.ts`
  and `tests/fire_and_fly_field.test.ts`.
- **Randomness.** The run draws nothing from the world stream: one world rng draw
  at seat time becomes the hidden session seed (`turretSessionSeed`), and every
  in-run draw is a stateless private one (`turretDraw` in
  `src/sim/minigames/turret_defense_rng.ts`, the camp private rng pattern), keyed
  by stream and site.
- **Feedback.** Engine events land in a sequence-numbered ring on the seat
  (`src/sim/minigames/turret_feedback.ts`, `TURRET_FEEDBACK_LIMIT`) and in an
  owner-scoped `turretDefense` SimEvent; the HUD, renderer and sound read new
  entries by sequence, with no event plumbing of their own.

Every tuning constant named above (`TURRET_SIZE_CLASSES`, `TURRET_WEAPON`,
`TURRET_BOWLING`, `TURRET_EXPLOSIVE_BARREL`) and the standard waves
(`TURRET_WAVES`) live in `src/sim/content/turret_defense.ts`.

Engine suites: `tests/turret_defense_engine.test.ts`, `tests/thrown_body.test.ts`,
`tests/turret_bowling.test.ts`, `tests/turret_barrels.test.ts`,
`tests/turret_feedback.test.ts`, `tests/turret_defense_session.test.ts`.

## The trials

A trial is a `TurretScenarioDef` in `src/sim/content/fire_and_fly_scenarios.ts`,
resolved against the real templates into a deep-frozen plan by
`resolveTurretPlan` (`src/sim/minigames/turret_defense_plan.ts`): the tower's
points, the medal bars, health from the shared mob formula times the entry's
scale, march speed from the template's own speed, per-kind physics, a fixed
spawn order and an arrival pattern per wave. The plan reaches the client once per
seat, so anything a trial varies lives in the plan, never in a constant both
sides must agree on.

| Trial | Scenario | Shape |
|---|---|---|
| Recruit's Trial | `TURRET_SCENARIO_INTRODUCTION` | a few short waves of the smallest monsters from the whole ring, slow spawns, a sturdier tower |
| Standing Watch | `TURRET_SCENARIO_STANDARD` | the original run (`TURRET_WAVES`), from wolves up to a final guardian; the default trial |
| Veterans' Test | `TURRET_SCENARIO_HARD` | Standing Watch made meaner: tougher and more numerous monsters, faster spawns, more large ones, and arrivals in patterns |

Arrival patterns (`src/sim/minigames/turret_arrival.ts`) pick which bearings of
the spawn ring a monster comes through: the whole ring, one arc, two or three
flanks, or bursts of packs from their own side. The kegs' lane rule applies
inside the chosen sector. Every value is mini-game tuning to settle by playtest,
not a classic-era formula. Pinned by `tests/turret_scenarios.test.ts` and
`tests/turret_defense_content.test.ts`.

## Medals and points

`turretResult` (`src/sim/minigames/turret_result.ts`) scores a finished run:

- **Medal** from the share of the tower's points still standing: bronze for any
  win, silver and gold at the trial's own bars (`medals` on the scenario), none
  for a loss.
- **Points** (`TURRET_POINTS`) rank runs holding the same medal: a share per
  kill, a larger share per tower point kept, and a small bonus for keg kills and
  monsters bowled over. The bonus is capped below one tower point
  (`TURRET_BONUS_CAP`), so the fun parts separate runs that defended equally well
  and never lift one above a cleaner defense.

The result card shows the medal, the points breakdown and the run's records
(longest throw, longest airtime, accuracy). Pinned by `tests/turret_result.test.ts`
and `tests/fire_and_fly_score.test.ts`.

## The world quest

- **Record.** `WORLD_QUEST_FIRE_AND_FLY` in
  `src/sim/content/world_quest_fire_and_fly.ts`, a `turret` objective owned by
  Master Gunner Alder (`fire_and_fly_instructor`), who stands beside Gatewarden
  Pell at the Evergarden gate. He is a dynamic NPC spawned lazily like the
  glider's instructor (`ensureFireAndFlyInstructor`). The quest is always
  active: every day, in every rotation.
- **Entry.** Talking to him opens the instructor dialog with one button per trial
  (`src/ui/world_quest_fire_and_fly_view.ts`); the pick rides the shared
  `startWorldQuestActivity` course choice (`src/sim/world_quest_activity.ts`), and
  the plain talk seats the default trial. `startFireAndFly`
  (`src/sim/world_quest_fire_and_fly.ts`) checks, in the glider's order, a known
  trial, the instructor at his post, a living player, the level, talking range,
  and a row to play for, then seats the player. A rider is set on foot, with the
  mount remembered for the way home.
- **Daily reward.** A win in any trial pays the ordinary world quest reward once
  per day, through `completeWorldQuestTurret` in `src/sim/world_quests.ts`, from
  the run the start captured on the seat (the arena lies far from the quest's
  area, so no area check applies).
- **Practice.** Once the day's row is complete, any trial can still be played as
  practice: no reward, the same scoring.
- **Deed.** The first win of any trial grants the cosmetic exploration deed
  `exp_gunners_oath` (The Gunner's Oath) with that day's paid completion
  (`src/sim/content/deeds.ts`, pinned by `tests/deeds_content.test.ts`). No
  title, mount or unique item is awarded, so the quest owes no Reliquary page.
- **Development.** `/dev turret [scenario | leave]` (`src/sim/dev_turret_defense.ts`)
  seats a dev run in the player's own arena, only where dev commands are enabled.
  A dev seat never pays and never scores.

Pinned by `tests/world_quest_fire_and_fly.test.ts`, `tests/world_quests.test.ts`
and `tests/dev_turret_defense.test.ts`.

## The boards

Each trial has a daily and a lifetime ladder, ranked by medal first, then points;
there is no quest-wide board (`src/sim/fire_and_fly_scoreboards.ts`). Board ids
carry the trial's score version (`FIRE_AND_FLY_SCORE_VERSIONS` in
`src/sim/content/fire_and_fly_scenarios.ts`): any tuning
change of a trial, or of the points, raises its version so runs under the old and
new tuning never share a ladder.

- A won run seated by the instructor for today's row reports its score once
  (`reportFireAndFlyScore` in `src/sim/fire_and_fly_score.ts`); practice runs
  score too (the glider precedent: the reward pays participation, the boards are
  the challenge). A loss or a dev seat never scores.
- The sim decides the medal and the points; the server only mirrors the event onto
  the trial's ladders (`server/world_quest_leaderboard.ts`) after bounding it
  (`fireAndFlyScoreValid`), into its own bounded table of at most two rows per
  character and versioned trial (`server/fire_and_fly_scores_db.ts`).
- Offline, the character keeps its own best daily and lifetime run per trial
  (`src/sim/fire_and_fly_personal_records.ts`).
- The ladders open from the rankings noticeboard beside Alder
  (`FIRE_AND_FLY_RANKINGS_BOARD_ID` from `src/sim/fire_and_fly_scoreboards.ts`,
  placed by `src/sim/content/noticeboards.ts`) and from the game's rankings
  window. The board's title, ladder names and rules are `t()` keys under
  `hudChrome.leaderboard.fireAndFly*` (`src/ui/world_quest_leaderboard_view.ts`).

Pinned by `tests/fire_and_fly_scoreboards.test.ts`,
`tests/server/fire_and_fly_scores_db.test.ts`,
`tests/server/fire_and_fly_leaderboard.test.ts` and
`tests/world_quest_scoreboards.test.ts`.

## Replay and Leave

A run never ends the seat by itself. The result card unfolds from the status
strip with two buttons:

- **Replay** starts the same trial again on the same roof, without leaving the
  arena (`replayFireAndFlySeat` in `src/sim/fire_and_fly_replay.ts`, routed as the
  seat's `turret_replay` action). A fresh run comes from a new world draw; an
  instructor's seat gets its run context again under the current day's rules, so
  a replay after the day's reward is practice and one after the daily rollover
  belongs to the new day. Every refusal is silent.
- **Leave** ends the seat and returns the player where they stood.

Pinned by `tests/fire_and_fly_replay.test.ts` and `tests/turret_hud_controller.test.ts`.

## Online authority

The server runs the one shared engine; the client only draws it.

- **Commands.** A shot is a `vehicle_action` with the `turret_fire` action and a
  ground point; Replay is `turret_replay` (`server/vehicle_command_wire.ts`).
  Leaving uses the ordinary vehicle exit.
- **Wire keys** (`server/turret_self_wire.ts`, decoded by
  `src/net/turret_session_wire.ts`). The owner-only `turp` self key carries the
  resolved plan once per seat; `tur` carries the seat state minus the ring and the
  plan, serialized once per engine revision, pruned of fields the client never
  reads and rounded on the wire (`turretWireNumber`), so the online view matches
  the authoritative one within a millimetre. The feedback ring is rebuilt on the
  client from the `turretDefense` events (`src/net/turret_feedback_mirror.ts`).
  Every decoder re-validates untrusted JSON and rejects a malformed value whole.
- **The own-shot ledger** (`src/ui/hud/vehicle/turret_own_shot_core.ts`). A click
  the server will surely accept plays at once (the head's recoil, the muzzle, the
  shell and the report), then is adopted by the server's `fired` entry and
  re-timed to its impact; a click the server may refuse waits for the server.
  Each `fired` entry resolves once against the marks it may confirm, so nothing
  plays twice. The server stays authoritative: the ledger decides no shot.
- **The salt.** The realm server draws a 64-bit private salt at every boot
  (`freshPrivateSalt` in `server/sim_boot_config.ts`, `SimConfig.privateSalt`) and
  keys every private draw of a run with it (`turretRunKey`, a HalfSipHash keyed
  mixer), so a client that sees the spawns cannot rebuild the run from the seed.
  The salt never leaves the process and no view carries the run key; without a
  salt (offline, the RL host) the draws are unchanged.
- **Disconnect.** A dropped socket ends the seat at once: the run is forfeited
  with no score and the player is returned before the linkdead save.

Pinned by `tests/turret_session_wire.test.ts`, `tests/turret_self_wire.test.ts`,
`tests/turret_online_round_trip.test.ts`, `tests/turret_own_shot_core.test.ts`,
`tests/turret_private_salt.test.ts`, `tests/server/private_salt_boot.test.ts` and
`tests/vehicle_command_wire.test.ts`.

## Look, sound and HUD

- Monsters are real `CharacterVisual` rigs from lazily grown per-model pools,
  built when the player first sits, attached behind the compile gate with a
  stand-in at their exact position (`src/render/turret_defense_visual.ts`), posed
  for the march, tumble, landing, lying and rising
  (`src/render/turret_monster_pose_core.ts`), with health bars, strike rings and
  ground markers (`src/render/turret_ground_markers.ts`).
- The shell, muzzle, blast, dust and scorch share one pooled puff system
  (`src/render/cannon_shell_visuals.ts`, `cannon_puff_core.ts`); kegs are the hex
  kit barrel with a painted stencil bomb (`src/render/turret_barrel_visual.ts`).
- Sounds (`src/game/turret_defense_sfx.ts`, `turret_monster_sfx.ts`) ride the SFX
  manifest pipeline; the seat plays the shared cannon track, softer.
- The seat HUD (`src/ui/hud/vehicle/`): a status strip at the top (the wave,
  monsters left, the next wave's countdown), a tower integrity rail at the bottom,
  wave banners, damage numbers, a red screen-edge flash on a strike, and the result
  card. The trial's name labels the minimap and heads the result card
  (`src/ui/fire_and_fly_trial_view.ts`). The player frame and the XP rail hide
  while seated. Every seat HUD string is a `t()` key under `hudChrome.turret` and
  `questUi.worldQuest.fireAndFly`.
- Arena monsters show on the dungeon minimap with the ordinary mob markers.

## Graphics tiers and fairness

Graphics settings stay gameplay-neutral
(`docs/design/graphics-settings-fairness.md`):

- Every monster, its health bar, its strike ring and its ground marker are drawn
  on every tier. Blast dust and smoke never hide a monster: occlusion per source
  is capped and equal across presets, and bars and rings draw above the dust
  (pinned through `tests/helpers/cannon_smoke_occlusion.ts` by
  `tests/cannon_puff_core.test.ts`, `tests/turret_contact_dust_core.test.ts` and
  `tests/turret_barrel_core.test.ts`).
- The forest is the one thing a tier thins. `FIRE_AND_FLY_TREE_ROW_KEEP` in
  `src/render/fire_and_fly_arena_core.ts` keeps a share per row, read from the
  static preset (`fireAndFlyTreeDensity`), never the FPS governor. The inner row
  is always whole and the wall stands just behind it, so every trunk a thrown body
  can reach is drawn on every tier; only the rows behind the wall thin, far rows
  first. Pinned by `tests/fire_and_fly_arena_render.test.ts` and
  `tests/fire_and_fly_arena_painter.test.ts`.
- The arena is built hidden ahead of the teleport while the player talks to Alder
  (`src/render/fire_and_fly_arena_prebuild.ts`, intent in
  `fire_and_fly_arena_intent_core.ts`), so its programs link and its textures
  upload before the first frame inside. Pinned by
  `tests/fire_and_fly_arena_prebuild.test.ts` and
  `tests/fire_and_fly_arena_intent_core.test.ts`.

## The limited weapons

Every trial grants the same per-run arsenal (`TRIAL_ARSENAL` in
`src/sim/content/fire_and_fly_scenarios.ts`): 2 Shockwaves and 3 fragmentation
shells. The plan carries it (`TurretArsenal` in
`src/sim/minigames/turret_defense_plan.ts`), and the charges left are what the run
has not spent (`turretChargesLeft`). The balance pass with scripted aimers (recorded
at the top of the scenarios file) found the weapons barely move the medals, so the
bars stayed.

- **Shockwave** (`src/sim/minigames/turret_shockwave.ts`, tuning
  `TURRET_SHOCKWAVE` in `src/sim/content/turret_defense.ts`). The tower slams and a
  front rolls from its wall to 12 yd in 0.4 s, shoving every grounded monster it
  meets outward, low and flat, for 0.3 of the wave's shell damage. It cancels
  wind-ups, so it answers the monster stuck at the tower's foot. It fires at once,
  wherever the aim is, and rearms in 1.5 s. Pinned by
  `tests/turret_shockwave.test.ts` and `tests/turret_shockwave_core.test.ts`.
- **Fragmentation shell** (`src/sim/minigames/turret_fragmentation.ts`, tuning
  `TURRET_FRAGMENTATION`). Aimed, flown and reloaded like a shell, it bursts over its
  point into a fixed star of 6 bomblets: one on the point, 5 on a 4.5 yd circle
  turned to the shot's bearing, the first straight ahead. They land one tick apart
  from 0.2 s after the burst, each a small shell blast (half the shot's damage)
  that also lights kegs; the frag counts one hit if any bomblet lands one. No draw
  anywhere: the star is the same every time, and the armed reticle shows every
  landing point from the same function the engine uses (`writeTurretFragStar`).
  Pinned by `tests/turret_fragmentation.test.ts`,
  `tests/turret_frag_landing_marks.test.ts` and `tests/cannon_frag_core.test.ts`.
- **Controls** (`src/game/turret_controls.ts`,
  `src/ui/hud/vehicle/turret_aim_core.ts`). Keyboard: key 1 slams the Shockwave;
  key 2 arms the fragmentation shell for the next click, and key 2 again, a right
  click or Escape disarms it with no charge spent. Gamepad: Y slams, LB arms or
  disarms, the pad's cancel disarms. Touch and mouse: two weapon sockets beside the
  tower rail show the charges, the Shockwave's rearm, and a gold pulse once
  monsters wind up at the foot (`turret_weapon_bar_view.ts`, reusing the action-bar
  painter); the first wave's banner names the keys. Pinned by
  `tests/turret_weapon_bar_view.test.ts`, `tests/turret_weapon_sockets.test.ts` and
  `tests/turret_weapon_tooltip.test.ts`.
- **Online.** The server checks every weapon action like a shot (a wave running,
  a charge left, the reload or the rearm done); the charges reach the client in the
  `tur` stats and the bomblets and the rolling front in the feedback ring.
- **Look and sound.** The slam's stone ring (`src/render/turret_shockwave_core.ts`)
  and the burst (`src/render/cannon_frag_core.ts`) draw through the shell visuals
  (`cannon_shell_visuals.ts`, `turret_weapons_visual.ts`); both have their own sounds. The result card
  lists the weapons used, and hides a row for a weapon the trial gives none of.

Later candidates, not decided: a perimeter to defend (a chest or an NPC inside
the dirt ring) instead of the tower itself, a first-person view from the cannon,
sprite impostors for the far tree rows, and a gold-on-Veterans' deed with a title
(which would owe a Reliquary page).
