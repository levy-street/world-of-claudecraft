# Hodric's Castle

A 10-player obstacle-course elimination show in the spirit of Fall Guys /
Stumble Guys, set on a floating castle island. Players queue up and race THREE
rounds of Lord Hodric's ever-rebuilt gauntlet: the field is culled each round
(six survive, then three) and the last racer standing takes the crown. Every
round is a freshly generated course. Bots fill empty slots so a show always
starts.

Status: in development on `feature/hodrics-castle` (base `release/v0.22.0`).

## Fantasy and lore

Lord Hodric, the Mad Warden of the high crag, opens his castle causeway to all
comers: survive three rounds of his gauntlet and the crown is yours. He rebuilds
the course between every round ("my castle bores me by breakfast"), tearing the
old siege-defenses down and raising new ones from the same mad kit of hammers,
logs, axes, drawspans, boulders, pistons, and spinning plates. The losers of
each round are flung to his gallery balcony by catapult to watch, with snacks.
Nobody remembers a war any of it was used in.

Naming style follows the existing world (Gravemarch, the Sowfield, the Ashen
Coliseum): the place is "Hodric's Castle", the event is "the Gauntlet", the
winner's flourish is "Hodric's Crown".

## Format

- 10 racers per match: any mix of real players and bots.
- Queue at the Gauntlet Herald NPC in the open world; solo practice runs the
  show offline against 9 bots (same code path as online).
- Lobby forms, short backfill window, then bots top the field up to 10.
- **Three rounds.** Each round: a 5s countdown at the plates, a race on a
  freshly generated course, then a cut. Round 1 qualifies 6, round 2 qualifies
  3, round 3 crowns the winner. Per-round time caps (110 / 110 / 130s) rank the
  unfinished by progress if nobody has cleared the target in time.
- **Elimination, not death.** Racers cut at the end of a round are launched by
  Hodric's catapult and land on the railed spectator gallery, where they watch
  the rest of the show. Their final placement is fixed at elimination time
  (round-1 cuts take 7-10, round-2 cuts take 4-6, the final decides 1-3).
- Between rounds a short intermission plays the catapult + gallery beat, then
  the castle rebuilds (a new course seed) and the survivors re-plate.
- Falling off the course mid-round is never elimination: you respawn at the last
  checkpoint. The punishment is time, not death.
- Combat is irrelevant inside: abilities and mounts are disabled, run speed is
  standardized for every racer (fiesta-style), so level and gear confer zero
  advantage.
- Winner takes a title flourish and the crown moment (fanfare, fireworks);
  qualifying and elimination each get their own banner + juice; a daily-task arm
  stays dormant until a `hodrics_result` task type is seeded (same pattern as
  `arena_result`).

## The course (procedurally generated per round)

A course is a VALUE, not a fixed layout: `generateHcCourse(seed, difficulty)`
(`src/sim/hodrics_course.ts`) is a pure function from a 32-bit seed to a
complete race (surfaces, colliders, checkpoints, obstacles, bot hints),
assembled from a library of hand-tuned parametric segments. The match derives a
distinct seed per round (round 1 seed, round 2 seed, round 3 seed) so Hodric's
rebuild is real: a different course each round, same match. Difficulty rises
with the round (more obstacles, tighter timing).

Every generated course is: **Start Yard** (grass, plates, countdown, START
arch) then **3 obstacle segments in round 1 / 4 after** drawn without immediate
repeats from the segment pool, each separated by a **stone landing +
checkpoint**, then a **Red Ascent** ramp and the **Finish Keep** (crown arch,
confetti, flag towers). Funnel walls are auto-emitted at every width change;
open edges over the chasm are deliberate (falls are part of the game). A railed
**gallery** balcony floats beside the yard for the eliminated.

The obstacle segment library (each parameterized: count, spacing, speed, phase):

- **Hammer Bridge (swinging maces).** A narrow wooden causeway; fat striped
  hammer heads swing across it on rigid arms from overhead gantries. A hit
  throws you sideways off the open deck.
- **Rotor Court (spinning logs).** A walled plaza with barber-pole log sweepers
  on daises turning in alternating directions. The sweep is a ground-level
  shove: it bulldozes you, walls keep you in.
- **Axe Walk (swinging axes).** A crenellated carpet walk under gold pendulum
  axes on steel arms. Narrow safe windows; a hit is a hard sideways knock.
- **Drawspan (sliding platforms).** Gilded platforms slide across a chasm gap in
  antiphase; time the crossing, they carry you while you stand on them. Fall and
  you drop to the kill plane.
- **Boulder Climb (rolling boulders).** An uphill stone lane; beach-ball
  boulders release from the top on staggered schedules and roll down the lanes,
  bowling you back downhill.
- **Piston Ledge (pusher rams).** A one-sided ledge over the chasm; wall-mounted
  rams jab out across it on a punchy cycle to shove racers toward the open edge.
- **Spinner Court (rotating plates).** Rotating candy discs bridge a chasm gap
  between two tongues; the disc carries you around its hub as you cross, so you
  must walk against the spin and hop the rim gaps.

Visual language (from the reference `fallguys.webp`): bright candy gameshow
castle. Pink crenellated walls, cyan cone-roofed turrets with gold finials,
candy torus arches, striped floors (banded bridges, checkered plazas/keeps),
festival pennants, drifting clouds, confetti. All procedural geometry + canvas
textures except a couple of CC0 banner/torch GLBs.

## Physics (the seamless-feel contract)

All obstacle motion is **analytic in absolute sim time**: every pendulum,
rotor, platform, and boulder pose is a pure function of `sim.time` with fixed
per-obstacle phase stagger. The sim evaluates those functions at 20 Hz for
collision; the renderer evaluates the very same functions at render time for
display. Obstacles are therefore perfectly smooth on screen (60+ fps motion),
perfectly deterministic in the sim, need zero per-tick wire traffic and zero
rng (the course draws nothing from any rng stream), and the castle runs in
attract mode: everything is already swinging when you walk up. Boulders are
analytic too (a fixed release schedule per lane), not entities.

- **Impulse channel.** The base sim already integrates airborne velocity
  (`Entity.vx/vz/vy`, gravity 16, jump velocity 6, ledge walk-off detection),
  so a hit is a launch: set a small upward `vy` plus horizontal velocity and
  the existing airborne integration carries the racer on a smooth ballistic
  arc that clients interpolate cleanly (the wire mirrors positions with no
  client prediction; snaps only past 40 yd). While ragdolled (about 0.6 s
  after a hard hit) movement intent is suppressed, then control returns.
- **Jump is native.** `MoveInput.jump` exists in the base sim and the RL
  action space, so the course may use hops freely with zero new input verbs,
  zero action-space changes.
- **Pendulums (flails, axes)**: angle = A sin(wt + phase). Collision is bob
  sphere (flail) or blade capsule (axe) vs racer circle; the impulse direction
  follows the bob's instantaneous velocity, plus a touch of lift.
- **Rotors (logs)**: beam segment rotating at fixed angular speed; impulse is
  radial + tangential so it throws you along the sweep, never through a wall.
- **Drawspan platforms**: analytic triangle-wave position; racers standing on
  one inherit the platform delta before collision resolution (carry, no
  sliding).
- **Spinner discs**: the disc top is static ground; standing on one rotates the
  rider around the hub by the disc's angular speed each tick. Cross by walking
  against the spin.
- **Piston rams**: analytic asymmetric extension (fast jab, slower retract,
  flush dwell); a contact is a ground-level shove toward the open edge.
- **Boulders**: analytic release schedule per lane (one boulder per period,
  no rng); constant roll speed down the lane, self-contained ground line.
- **Height and falls.** The course band's ground-height comes from the ACTIVE
  generated course's surfaces (terraces, ramps, chasm). Leaving a platform's
  support means gravity takes over; dropping past the kill plane teleports you
  to your last checkpoint.
- **Determinism.** No obstacle pose or course-generation step reads shared
  world rng: `generateHcCourse` uses its own local `Rng` seeded from the round
  seed, and the per-match sub-stream (tickCount + match id, the fiesta
  mechanism) is used only for bot skill variance. World parity goldens never
  fork. The active course per slot lives in a registry
  (`hodrics_course.ts`) written purely from sim state, so every host (offline,
  server, headless) and the renderer converge on identical geometry.

### Generation quality (by construction, not luck)

`generateHcCourse` cannot produce an unfair or broken course: segments are
parameterized designs (not noise), the assembler funnels every width change and
reserves a length budget so nothing overruns the band, and `validateHcCourse`
asserts the invariants (continuous center-line except the deliberate gap
sections, monotone checkpoints on real ground, obstacles inside their spans,
hop-crossable spinner chains, rotor sweeps clearing their gates). The test suite
sweeps the validator across 240 seeds x 3 difficulties (720 courses) plus
segment-coverage and determinism checks.

### Game-feel layer (the gameshow rework)

The shipped feel iterates past the v1 numbers toward the reference image's
bounce-house energy, all still deterministic and analytic:

- **Punchier launches.** Hammer/axe/boulder knock velocities are tuned up
  (flail 13/6.5, axe 14/7, boulder 12 downhill) so a hit reads as a real yeet;
  falls off the open bridge sides are an intended, frequent outcome.
- **Per-kind re-hit grace.** Big launches keep the 0.9 s immunity; the
  spinning log is a ground-level SHOVE (vy 2.8) with a short 0.4 s grace, so a
  slow rotor bulldozes you sideways rather than ping-ponging you airborne.
- **Landing bounce.** A landing after a drop past 3.2 units rebounds into a
  small decaying hop (vy = min(3.4, drop x 0.5)); chained bounces decay since
  each peak is lower. Drawspan decks are exempt (their carry pass is the
  vertical authority there).
- **No fall damage in the band.** The base sim's fall damage is suppressed for
  the whole Hodric's band, closing the loop on "the course has no damage
  sources": a hammer yeet can cost you time, never health.
- **Haptics + juice (client-side).** Own-racer events drive the sanctioned
  Fiesta juice channels: camera shake on knocks/falls/finish, mobile vibration
  patterns per event (countdown tick, GO, knocked, fall, checkpoint, finish,
  crown), and the gold ascension pillar + holy nova as finish/crown fireworks.
  All cosmetic; no tier or setting changes race outcomes.

## Assets (all CC0, already in the repo)

The course is a bright gameshow castle matching the reference image: candy
pink crenellated walls (instanced merlon rows), cyan cone-roofed turrets with
gold finials, candy torus arches over the start and finish, yellow/orange
striped bridge and checkered plaza/keep floors (procedural canvas textures),
striped hammer heads and gold crescent axes on rigid steel pendulum arms,
barber-pole rotor logs, cyan-striped drawspan decks with gold rails,
beach-ball boulders that visibly roll, pennant strings and keep-floor
confetti (single instanced draws), and drifting cartoon clouds posed from the
same absolute clock as the obstacles. The only GLB set pieces kept are the
KayKit banners and torches (license provenance in `CREDITS.md`); everything
else is procedural geometry, so nothing new ships in the asset budget.
Character rigs already carry
`Jump_Idle` (airborne), `Death_A`/`Lie_Idle` (ragdoll/daze), and a real
`Cheer` clip (finish celebration). No new binary assets are required; the
finish confetti is a new `vfx.ts` burst recipe over the existing Kenney
sprite atlas, and the castle theme is a new procedural `composeHodricsCastle`
in `src/game/music.ts` (horn/timpani/choir palette already exists).

## Engineering shape

Follows the Gravemarch battleground playbook, one band over:

- **Band**: the course lives in its own far-x band (past the delve cap at
  x=9000 and clear of the battleground band 9600..10200 reserved on its
  branch), origin near x=11100, slots z-stacked for concurrent matches.
- **Single source layout**: `src/sim/hodrics_layout.ts` defines platforms,
  walls, heights, checkpoints, obstacle placements, and the analytic motion
  functions. Sim colliders and `src/render/hodrics_castle.ts` dressing are
  both derived from it; they cannot drift.
- **Match module** behind the SimContext seam: queue, backfill, countdown,
  race state, placements, rewards; state on Sim as a ctx view.
- **Bots** driven inside the sim tick (battleground practice-bot pattern):
  racing-line waypoints, per-bot timing skill from the match stream, obstacle
  wait-windows, knockdown recovery.
- **Wire**: IWorld additions implemented by both Sim and ClientWorld; events
  for countdown, checkpoint, finish, placement; HUD gates pid events.
- **UI**: queue window on the Herald, race HUD (countdown, progress/position,
  finish banner), index.html/play.html window parity, all strings via t().

## Out of scope (v1)

- Spectating other racers' matches (walk-up or window).
- Multiple courses / rotating rounds / team finales.
- Grabbing other players, jump or dive verbs beyond what the base sim offers.
- Elimination formats; v1 is always a single placement race.
