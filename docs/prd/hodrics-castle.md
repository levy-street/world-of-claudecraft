# Hodric's Castle

A 10-player obstacle-course race minigame in the spirit of Fall Guys / Stumble
Guys, set on a floating castle island. Players queue up, race the gauntlet
through six obstacle sections, and the first challenger through the finish arch
takes Lord Hodric's crown. Bots fill empty slots so a race always starts.

Status: in development on `feature/hodrics-castle` (base `release/v0.22.0`).

## Fantasy and lore

Lord Hodric, the Mad Warden of the high crag, opens his castle causeway to all
comers: race his gauntlet and the crown is yours until the next challenger
takes it. The course is his old siege-defense line, kept oiled and swinging by
his groundskeepers out of pride. Nobody remembers a war it was used in.

Naming style follows the existing world (Gravemarch, the Sowfield, the Ashen
Coliseum): the place is "Hodric's Castle", the event is "the Gauntlet", the
winner's flourish is "Hodric's Crown".

## Format

- 10 racers per match: any mix of real players and bots.
- Queue at the Gauntlet Herald NPC in the open world; solo practice runs the
  course offline against 9 bots (same code path as online).
- Lobby forms, short backfill window, then bots top the field up to 10.
- 5 second countdown at the start gates, then one race, roughly 90 to 150
  seconds for a decent run.
- Finish order is the placement. The race ends when everyone has finished or
  the 4:00 cap expires (unfinished racers place by course progress).
- Falling off the course is never elimination: you respawn at the last
  checkpoint after a short daze. The punishment is time, not death.
- Combat is irrelevant inside: abilities and mounts are disabled, run speed is
  standardized for every racer (fiesta-style), so level and gear confer zero
  advantage.
- Winner takes a title flourish and the crown moment (fanfare, fireworks);
  placements award copper on a small curve; a daily-task arm stays dormant
  until a `hodrics_result` task type is seeded (same pattern as
  `arena_result`).

## The course

Eight beats, matching the reference art (start at the low grass yard, finish
at the keep). Between beats, checkpoints; below everything, a kill plane.

1. **Start Yard.** Grass terrace with the purple START arch between two banner
   towers. Ten start plates in two rows. Countdown here.
2. **The Flail Bridge (swinging maces).** A wooden causeway over the chasm.
   Spiked flails on chains swing across it from overhead gantries in an
   alternating rhythm. A hit throws you sideways, and the causeway has no
   rails: you can be thrown clean off. Checkpoint 1 on the far landing.
3. **The Log Court (spinning logs).** A walled purple-stone plaza with two
   great rotating log sweepers on round daises, turning in opposite
   directions. The sweep shoves you back and drops you on your rear; walls
   keep you in, so the cost is time and dignity. Checkpoint 2 at the far gate.
4. **The Axe Walk (swinging axes).** A crenellated wall-walk where giant
   pendulum axes swing through slots in the battlements. Narrow safe windows;
   a hit is a hard sideways knock. Checkpoint 3 at the end of the walk.
5. **The Drawspan (moving bridge).** A gilded platform slides back and forth
   across a gap on Hodric's chain-work. Time your crossing; the platform
   carries you while you stand on it. Fall and you drop to the moat ledge and
   respawn at checkpoint 3. Checkpoint 4 on the far side.
6. **Boulder Alley (rolling boulders).** An uphill stone lane toward the keep.
   Boulders release from the top on a staggered schedule and roll down the
   lanes. A hit bowls you back downhill. Checkpoint 5 at the top.
7. **The Red Ascent (final ramp).** The steep red ramp to the finish: pure
   sprint, slightly slowed by the grade, so close races stay close to the very
   end.
8. **The Finish Arch.** Purple arch, gold crown, two flag towers. Crossing
   fires the fanfare, fireworks, and the placement banner.

Visual language (from the reference): grey castle stone with purple banner and
carpet accents, gold/crown highlights, tan wood causeways and gantries, green
grass terraces, pine trees on the crag edges, torch flames, floating-island
underside falling away to clouds.

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
- **Moving platform**: analytic triangle-wave position; racers standing on it
  inherit the platform delta before collision resolution (carry, no sliding).
- **Boulders**: lane entities on a staggered release schedule (the only rng in
  the course, drawn from the per-match stream); constant roll speed downhill,
  despawn at the base wall.
- **Height and falls.** The course band has its own ground-height function
  from the layout module (terraces, chasm, moat ledge). Leaving a platform's
  support means gravity takes over; dropping past the kill plane teleports you
  to your last checkpoint with a short daze.
- **Determinism.** No obstacle reads shared world rng. The per-match stream is
  seeded from tickCount + match id (the fiesta mechanism), so world parity
  goldens never fork.

## Assets (all CC0, already in the repo)

The whole course dresses from packs already bundled under `public/models/`
(license provenance in `CREDITS.md`): the KayKit Dungeon Remastered kit for
castle walls, arches, gates, ~60 banner variants, torches and braziers; KayKit
Medieval Hexagon castle/tower/bridge silhouettes for the skyline; KayKit
warhammers as flail heads and battleaxes for the pendulums; Quaternius logs
and boulders for the rotors and Boulder Alley. Character rigs already carry
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
