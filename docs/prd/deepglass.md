# The Deepglass: deepball in the flooded Sowfield (1v1 to 5v5)

Status: planned. Supersedes the ground game in `docs/prd/vale-cup.md`.

An overhaul of the Vale Cup from a walking football match into a **three-axis
underwater ball sport** played inside a glass bell full of clear water, on
Copper Dig thrustpacks and brass diving masks. Blitzball's arena and shot
language, Rocket League's boost economy, momentum and ball-cam.

**The competition keeps its name, its ids, and its plumbing.** Everything
namespaced `vcup` / `vale_cup` stays: the queue, the brackets, the eight banner
nations, parimutuel betting, guild banners, the deeds, the standings, the
desertion lockout, the practice instances, the wire facet and its commands.
What changes is the *pitch*, the *physics*, the *kit*, and the player-facing
strings. Treating this as a re-skin plus a physics swap — not a new mode — is
what makes it affordable.

---

## 1. Lore

The Copper Dig struck water. Their deep galleries below Eastbrook flooded to the
roof in a season, and rather than abandon a hundred years of shaft the tinkers
solved it twice over. First the **brassgill**: a diving mask of blown Goldcrest
lens set in a brass collar, with a tidewisp caught behind the glass that gives
back clean air for as long as you keep it lit. Then the **thrustpack**: a brass
twin-burner worn on the back that shoves a body through water hard enough to
make a flooded gallery a commute instead of an expedition.

The gear made the tinkers famous, and famous tinkers get bored. When Copper Dig
turned up at the Sowfield for the harvest fixtures they came with a proposal for
Marshal Redbrook: let them do to the old green what the water did to their
galleries. Goldcrest Harbor sent shipwrights and every pane of tide-glass the
coast could blow. Together they raised a bell over the Sowfield basin — a sphere
of clear glass seventy-six yards across, cradled in a ring of stone arches so it
bulges out over the whole basin like a held breath — sealed it, and filled it
from the brook.

They call it **the Deepglass**. The game inside it is **deepball**, and it is
the same game it always was: two mobs, one ball, two gates, nobody bleeds. The
harvest truce holds underwater. Groundskeeper Bram still keeps the book of
fixtures at the gate, though he keeps it further back now, because the glass
sweats. The Old Sow still hangs bronzed above the tavern hearth; the ball they
play with is her likeness blown in glass around a caught lantern-wisp, buoyant
and lit. They call it **the Tidesow**. The winners still drink from the
Copper Pail.

The water is the point of pride. Goldcrest's glassmakers and the Dig's water
wrights keep it dead clear — you can stand in the west stands and watch a shot
leave a boot at the far ring. A murky bell would be a disgrace, and both houses
would hear about it.

Naming that lands in strings (ids never change):

| Thing | Was | Now |
|---|---|---|
| The venue | the Sowfield | **the Deepglass** (standing on the Sowfield) |
| The sport | boarball | **deepball** |
| The ball | the boarball | **the Tidesow** |
| The back gear | boots | **thrustpack** |
| The face gear | — | **brassgill** |
| The competition | the Vale Cup | the Vale Cup |
| The trophy | the Copper Pail | the Copper Pail |

---

## 2. What the player does

**Movement is the whole game.** Inside the bell you do not walk. You hang in
water, you point where you want to go, and you burn the pack to get there.
Nothing is on a floor; the ball is never out of play; every duel is a
three-axis one.

- **Drift** — no input, you glide. Water drag bleeds speed slowly, so momentum
  is real and everything is about lines and commitment, not stopping and turning.
- **Swim** — WASD relative to where you are looking, including pitch. 8 yd/s,
  free, always available. Crossing the bell on swim alone takes about ten seconds.
- **Boost** (held, the sprint key) — the burners light and drive you along your
  look vector to 30 yd/s, crossing the bell in two and a half. **You get about
  two and a half seconds of burn**, then the pack is spent and needs roughly six
  seconds to recharge. Boost is a committed burst, not a cruise setting.
- **Boost pads** — twelve lit vents inside the bell, symmetric across the halves,
  each an instant near-full recharge, back after nine seconds. Controlling the
  middle pads is controlling the match.
- **Wall-riding** — the glass is a surface. You can burn along the inside of the
  sphere and slingshot off the curve.

Because the burn is short and loud, everyone can see who has it. See §5 — the
booster animation is a public read on your remaining boost, deliberately.

**Playing the ball.** The Tidesow is big (2.4 yd across), lit, nearly neutrally
buoyant so it drifts slowly upward when nobody is touching it, and heavy with
drag so a struck ball travels on a long readable arc.

- **Carry** — swim into it and it rides in front of you (the existing dribble
  nudge, now in 3D). Boosting with the ball is slower than boosting without it.
- **Shot** — hold to charge, release to fire at the enemy ring. Charge scales
  power *and* spread, so a maxed shot is a prayer. (The existing charge UI and
  hold-to-power wire, unchanged.)
- **Pass** — fires at your selected teammate, leading their run in 3D.
- **Volley** — striking a ball already moving faster than 22 yd/s multiplies your
  power by 1.35. Deflections and one-twos beat carrying it in.
- **Heat** — every completed pass without a turnover adds 6% shot power, to a cap
  of +30%. The Tidesow visibly brightens. A team that passes it in scores harder
  than a team that solos it.
- **Check** — ram an opponent while moving at 18 yd/s or more: they tumble for a
  second and lose the ball. Below that speed nothing happens, so a check costs a
  burn. This is the blitzball encounter, spent as boost.
- **Netguard** (keeper) — a 3D lunge that catches a ball crossing the mouth.

**The match** keeps the existing shape exactly: 30s briefing with betting open,
3s whistle, 6:00 single period, kickoff to the conceding side, first to 5 ends it
early, golden goal with a 2:00 cap, 8s of aftermath. No damage, no death, no xp,
no loot. Daily-reward points, W/L record, winners board, guild credit.

**Ball cam** is on by default and toggleable — the camera frames the Tidesow and
you fly relative to it. A 3D ball sport is unplayable without it; this is not
optional polish.

---

## 3. The Deepglass (geometry)

### 3.1 Scale

Sized against blitzball and cross-checked against Rocket League, because
traversal time is what a ball sport actually feels like:

| | Diameter / length | Top speed | Traverse |
|---|---|---|---|
| FFX sphere pool (65,000 m³ canon) | ~50 m | — | — |
| FFX sphere pool (fan estimate from play) | 91–122 m | — | — |
| Rocket League pitch | ~100 m | 23 m/s | ~4.3 s |
| **The Deepglass** | **76 yd (69 m)** | **30 yd/s** | **2.5 s boosted, 9.5 s drifting** |

That is about 176,000 m³ of water — 2.7× the canonical FFX volume, and inside
the low end of the play-derived estimate. The wide gap between drift and boost
traversal is deliberate: it is what makes a burn a decision.

### 3.2 The bell

A **true sphere**, not the ellipsoid an awkward site would force. The trick that
makes a 76-yard ball fit a 90-by-58 flatten is that **only the cradle needs flat
ground** — the sphere's widest point is thirty-eight yards up, so the rest of it
simply overhangs the basin.

```
                                     y 79  ── crown of the bell
                                ╭─────────────╮
                          ╭─────╯             ╰─────╮
                       ╭──╯                         ╰──╮
        y 41  ── ◎══════════  the Tidesow  ══════════◎ ──   equator, ring line
        west ring   ╰──╮                         ╭──╯   east ring
                west     ╰─────╮           ╭─────╯   east
                stand  ▟▛▔▔▔▔╲  ╰───┬───┬───╯  ╱▔▔▔▔▜▙  stand
                      ▟▛      ╲  ╭──┴───┴──╮  ╱      ▜▙
        ══════════════════════ ╰══ cradle ══╯ ═══════════════  y −2.6
                       x −49        x −11         x 27
```

```ts
// src/sim/vale_cup_layout.ts — replaces PITCH / PITCH_WALLS / GOAL_* / STAND_*
export const DEEPGLASS_CENTER = { x: -11, y: 41, z: -110 };
export const DEEPGLASS_RADIUS = 38;        // glass inner face
export const DEEPGLASS_PLAY_R  = 36.4;     // clamp for a player body
export const DEEPGLASS_CRADLE_R = 20;      // stone arch ring; the only flat-ground need
```

Glass height above the flatten at horizontal distance `d` from the axis is
`41 − sqrt(38² − d²)`:

| d | 10 | 20 | 22 | 30 | 38 |
|---|---|---|---|---|---|
| glass at | 4.3 | 8.7 | 10.0 | 17.7 | 41 |

- **Span**: x [−49, 27], y [3, 79], z [−148, −72].
- **Cradle footprint** is only r = 20 → x [−31, 9], z [−130, −90], which sits
  well inside the existing `SOWFIELD_FLAT` (x [−56, 34], z [−141, −83]) with
  twenty yards of margin on every side. **The terrain flatten does not change at
  all.** It gains a ring of stone arches, ~11 yd tall, carrying the glass.
- **Clearances**: the sphere reaches z = −148 against the world-rim ramp at
  −150, but the glass is 41 yd up there, so the ramp is untouched. Reliquary Hill
  at z ≈ −60 has twelve yards and forty-one yards of air. The Copper Dig camps
  and the Bandit Camp sit outside x [−49, 27].
- **Decoration exclusion** already covers this. `SOWFIELD_EXCLUDE` is
  x [−66, 44], z [−151, −73] — almost exactly the sphere's shadow. It needs one
  yard on `zMax` and nothing else. Trees under the high overhang can stay: woods
  standing beneath thirty yards of glass and water is worth keeping.
- **Goal rings** at x = center.x ∓ 30 (west −41, east 19), radius 6, plane
  perpendicular to x, centred on the bell's axis. The sphere's cross-section
  there is 23.3 yd, so a ring is about a quarter of the mouth — blitzball
  proportions. Team A defends west, B defends east, so every `'A' | 'B'` scoring
  path survives verbatim. A short net pocket behind each ring settles the ball
  during the goal celebration.
- **Spawns**: five 3D points per side, team B mirrored across `center.x` exactly
  as `VC_SPAWNS_B` does today. Index 0 is still the kickoff taker.
- **Boost pads**: twelve, positions symmetric under the x-mirror so neither side
  is favoured — one at the bell's centre, four on a ring at x = center.x, three
  per half toward the rings.

### 3.3 Stands, under the glass

The stands go where the overhang makes room: **east and west, outside the cradle
and beneath the sphere**, facing straight down the barrel of a goal ring.

- West stand x [−49, −33], east stand x [11, 27], both z [−128, −92]. Inside the
  existing flatten, clear of the cradle by two yards.
- The glass ceiling over a stand rises from 10 yd at the front to 41 yd at the
  back, so spectators sit in a stone colonnade under a curved wall of lit water
  with the ring hanging above them. `sowfieldStandLift` keeps its tier and ramp
  logic with the axis swapped from z to x.
- **The gate at (−11, −85)** becomes the dive-lock, now standing under twelve
  yards of overhang. Bram and the Copper Pail plinth do not move. Players are
  teleported to spawns at kickoff, as they are today, so the lock never has to
  function as a door.

### 3.4 Collision

The 2D OBB/circle collider grid cannot express a sphere. The split:

- `valeCupColliders()` keeps *outsiders* out — the cradle arch ring plus the
  stand back rails. Nobody walks into the glass. The overhang needs no colliders
  at all: it is thirty yards overhead.
- *Participants* are clamped analytically to `DEEPGLASS_PLAY_R` by the match
  code, exactly the way practice players are already clamped to their instanced
  pitch copy. Inside a match the static grid is not consulted for the bell.

---

## 4. Physics

Two pure modules, both keeping the current discipline: no `SimContext`, no
clocks, **no shared-rng draws on the tick path**, so `tests/vale_cup_ball.test.ts`
can keep driving them directly and determinism holds.

### 4.1 The ball — `src/sim/vale_cup_ball.ts` (rewritten in place)

Gravity, ground bounce, rolling friction and axis-aligned board reflection all
go. What replaces them is smaller:

| Constant | Value | Note |
|---|---|---|
| `DG_BALL_RADIUS` | 1.2 | up from 0.49 — must read across 76 yards |
| `DG_BALL_BUOYANCY` | 0.8 yd/s² | up; an untouched ball slowly rises |
| `DG_BALL_DRAG` | 0.34 /s | isotropic, exponential |
| `DG_BALL_MAX_SPEED` | 34 yd/s | see the playtest note below |
| `DG_GLASS_RESTITUTION` | 0.82 | the glass is lively — wall play matters |
| `DG_VOLLEY_MIN_SPEED` | 15 yd/s | above this, a strike is a volley (×1.25) |
| `DG_BODY_RADIUS` / `DG_BODY_CENTRE_Y` | 1.5 / 1.0 yd | the contact blob, centred on the CHEST |
| `DG_CONTROL_REL_SPEED` | 13 yd/s | at or under this a body simply takes possession |

**Playtest revision — the ball was too fast to play.** The first pass ran the
cap at 55 yd/s, which is 2.75 yd of travel per 20 Hz tick: wider than the
contact sphere, so a struck ball regularly finished a tick on the far side of a
body it should have hit, and "the ball clips through the player" was the single
loudest note off the first session. Three changes together:

1. The cap came down to 34 and every strike power with it (a bot strikes at 24,
   a player's Shot at 30, a Pass at 22).
2. Contact became a SWEPT test — `sweptContactTime()` solves the quadratic over
   the tick's relative motion, so a crossing between two samples is still a hit.
3. Contact is measured from the chest, not the entity origin at the soles, and
   it ALWAYS does something: square on a fast ball traps it, a glancing one
   deflects off the body, and anything slow is possession.

- `stepBallFluid(b, currents)` — integrate buoyancy and drag, cap speed.
- `reflectOffBell(b)` — if `|p − c| > R − r` and the radial velocity is outward,
  mirror the velocity about the unit radial normal and push the centre back
  inside. Six wall segments and their span tests collapse into four lines.
- `crossesRing(prev, cur, ringX, ringR)` — the existing goal test grows one axis.
  Today it interpolates the crossing point and range-checks z; now it
  interpolates and range-checks the *radius* in (y, z). The `'A' | 'B'` return
  contract is unchanged, so nothing downstream moves.
- `applyDribbleNudge` / `applyBodyTrap` / `launchBall` keep their shape and gain
  a y component.
- **Currents** — three deterministic toroidal bands driven by `sin/cos` of the
  match clock, applied as an acceleration to the ball and to players. Visible as
  drifting motes. Zero rng: the clock is the only input, so replays and the
  offline/online hosts stay byte-identical.

### 4.2 The player — a new flooded-flight pass

The game **already has three-axis player movement plumbed end to end**, and this
is the single biggest cost saving in the plan. The swim system carries a graded
vertical steer from the camera all the way to the sim:

- `src/game/input.ts` — `readSwimSteer()` turns camera pitch into `dive` /
  `surface` bands plus a graded `swimSteer` in 0..1.
- `src/sim/move_input.ts` — sanitizes it.
- `src/net/online.ts` — ships it as the terse `ss` field.
- `src/sim/player_motion.ts` — `swimVerticalPass()` owns Y outright: no gravity,
  no fall damage, `onGround` forced true to suppress the jump pose and the
  landing thud.
- `src/render/self_motion.ts` — the client predictor mirrors it.

`deepglassFlightPass()` is modelled directly on `swimVerticalPass` and slots in
beside it:

| Constant | Value |
|---|---|
| `DG_SWIM_SPEED` | 9 yd/s (unboosted cruise) |
| `DG_BOOST_SPEED` | 26 yd/s |
| `DG_BOOST_ACCEL` | 30 yd/s² |
| `DG_CARRY_MULT` | 0.82 (carrying the Tidesow is slower) |
| `DG_DRAG` | 0.4 /s (low: a body GLIDES) |
| `DG_SPOOL_UP` / `DG_SPOOL_DOWN` | 1.5 s / 1.1 s |
| `DG_SPOOL_FLOOR` | 0.34 (thrust and ceiling at zero spool) |
| `DG_COAST_DECAY` | 0.25 /s (the ceiling's walk-down off the throttle) |
| `DG_BOT_SPEED_SCALE` | 0.82 (a bot's body handicap) |

**The spool.** Thrust authority and the speed ceiling both ramp in over
`DG_SPOOL_UP` and decay over `DG_SPOOL_DOWN`, tracked as `Entity.dgSpool` (0..1).
The first pass gave the pack full authority on tick one, so a body went from
dead stop to cruise in a fifth of a second and stopped just as fast — the bell
handled like a mouse cursor. Now you push off slowly, wind up to pace, and coast
a long way when you let go. The render reads the same `dgSpool` to size the
burner cones, so the pack visibly spins up with you.

**Flying three axes at once.** Three further passes, all aimed at the same
thing — making the bell easy to HANDLE rather than merely fast:

- **Steering lag** (`DG_STEER_LAG`, 0.13 s) — the thrust vector chases the keys
  instead of snapping to them. Raw axes made every key press a step change in the
  acceleration, which at 20 Hz reads as the body twitching between headings
  rather than flying between them. It costs no authority: the turn-authority term
  below is what keeps hard changes of direction sharp.
- **Vertical authority** (1.25) — climb and dive get their own weight rather than
  being one third of a normalised 3-vector. Changing altitude on the move is the
  single most common thing a flier does in here and it was the softest input in
  the game.
- **Altitude hold** — hands off the vertical axis, the climb/sink component bleeds
  away, so you stay at the height you picked while you concentrate on the ball.
  Horizontal drift is untouched: that is momentum, and momentum is the point.

**Turn authority — the Rocket League rule.** Spool alone bought the momentum and
none of the snap: the bell handled like a barge. A car in Rocket League
accelerates in a straight line at a measured rate but redirects the instant you
flick the stick, and that is the whole feel. So thrust is scaled by how much it
DISAGREES with the body's current motion: `DG_TURN_AUTHORITY` (2.2x) at a full
reversal, tapering to 1x when you are simply going faster the way you already
were. Top speed is untouched; cornering is crisp. `DG_BOOST_KICK` adds a 4.5 yd/s
shove on the tick the throttle opens, so a burn cracks on rather than sighing in.

**The final whistle sets you down.** `endDeepglassMatch` records where every body
stood before the bell seated it and puts them back there on the real terrain
height, resetting `fallStartY` with the position. Without that last part the
teardown released the body at y=41 with its fall still measured from up there,
and the bout ended by dropping the player forty yards onto the slate and killing
them on their own kickoff spot.

### 4.3 Getting there — Steward Aleyn Tidewell

The bell is its own world (`?map=deepglass`), so "take me to the Deepglass" is a
world boot rather than a walk. `deepglass_steward` keeps a berth on Goldcrest
Harbor's Grand Plaza with a `deepglassSteward: true` flag on her `NpcDef`; the
gossip menu turns that flag into one row, and the row sends the client to
`?map=deepglass&bout=N`, which calls the whistle as soon as the arena is up.

Two deliberate choices. She is `dynamic: true` and spawned at world init under a
reserved entity id through `findSafePos` — the Scorching Wastes / Groundskeeper
Bram pattern — because Goldcrest's ground only exists once the city map document
is loaded, and without it the base world's square is still open sea. And the
arrival hook calls `startDeepglassMatch` directly rather than the `/deepglass`
dev command, which is gated on a DEV build; the steward is shipped content.

### 4.3b The stadium and the caldera

The bell on its own was a glass ball on a stone plaza in the dark. Two modules
put a place around it.

**The arena** (`src/render/deepglass_stadium.ts`) is built the way
`vale_cup_stadium.ts` builds the Sowfield: structural masonry bakes a per-vertex
colour and merges into a couple of vertex-coloured meshes, while only the parts
that glow or move take their own material. About 6.8k triangles for the whole
building. Read from the middle out:

| Ring | Radius | Height | What |
|---|---|---|---|
| concourse | 42 → 52 | 0 | pale apron with gold inlay |
| the bowl | 52 → 88 | 0 → 27 | six tiers, risers + decks + two banked seat rows each |
| cornice / plinth | 88 | 27 / 0 | heavy rim above, dark course grounding it below |
| pylons ×16 | 85 → 47 | 27 → 74 | buttress towers, tapering, LEANING in over the water |
| flying arches | off each pylon | ~40 | spring toward the bell's equator, stop short of the glass |
| crown ring | 23 | 96 | a gold band floating unsupported over the crown |

Plus banners hung between the pylons in the two house colours, a colonnaded
causeway in from the arrival point, and crystal lanterns on every pylon head.
Only four of the sixteen pylons carry a real light (plus one under the crown):
sixteen dynamic lights re-link every lit material in the scene and read no
differently from the floor.

The palette is the FF trick — the architecture is nearly white, so every bit of
colour in frame comes from light. **A north gap** (`BOWL_GAP`) is cut through
every ring of the bowl for the causeway; without it the arrival point sits
inside the seating with a riser wall filling the screen. Mind the three
different theta conventions in that file: `RingGeometry` measures from +x toward
-z once flattened, `CylinderGeometry` from +z, and the pylon loop uses
`x = cos a, z = sin a`. Each is commented at the point of use.

**The caldera** (`src/sim/deepglass/world.ts`) replaced the flat slate, and is
deliberately unlike anywhere else in the realm — a dead-flat terrace out to
r 104, a ring chasm bottoming at about −55, and a jagged massif rising to +76
around the horizon, all stamped from first principles rather than lifted off any
zone's heightfield. Overlapping `add` stamps STACK, so the stamped deltas are a
fraction of the depths they produce; the profile is verified by sampling
`terrainHeight` along a radial rather than by eye. `slopeRock` and `snowCaps`
come on for the peaks — with real mountains those rules finally have something
to do — while `rimMountains` stays off, since the caldera is what replaces it.

**The chasm is railed.** A fifty-five yard drop at the edge of the terrace is
not scenery, it is a hole you walk into and die in — which is exactly what
happened the first time it was walked. `parapetBlockers()` rings the lip at
r 99 and the stadium draws the matching balustrade; the two share the radius so
they cannot drift apart.

**The arena keeps its own hour.** `startOffline` pins the day/night phase to
late afternoon whenever `presentationMode === 'deepglass'`. The venue has a
stadium, a lit bell and sixteen crystal pylons; what it must never be is
whatever the real UTC clock says, because half of that clock is a night in which
the entire arena is a black shape against a black sky. The `/time` dev command
still overrides it afterwards.

### 4.4 The boost economy and the two powerups

**The map is the fuel supply — Rocket League's rule.** Passive regen used to hand
back 17/s, which made boost a cooldown rather than a resource: you never had to
go anywhere for it, and the twelve lit vents were a convenience nobody detoured
for. Regen is now a 2.5/s trickle that exists only so a stranded fighter can limp
to a pad. Everything else comes off the vents:

| | Where | Gives | Relights |
|---|---|---|---|
| Big vent (×5) | the x = 0 plane — centre, crown, floor, north, south | full tank | 13 s |
| Small vent (×8) | the running lines toward each ring | 34 | 7 s |

The five big ones are equidistant from both goals by construction, so holding the
middle is holding the fuel. A taken vent goes dark until it relights, because
where the boost is *not* has to be as legible as where it is.

**Two powerups**, on the bell's vertical axis so both are a genuine detour off
the ball, and neither half is favoured. One carried slot: a second pickup
replaces the first, and one bar button (`dg_power`) spends whatever you have.

- **The Tidewarden's Lance** — 27 yd below the centre, on the floor. Hitscan
  down your aim (`DG_BEAM_RANGE` 42 yd, ~14° cone), and the first OPPONENT in it
  freezes for three seconds: no controls, and their own momentum bleeds out under
  them. A clean miss still draws its beam to full range, because a shot that
  leaves no mark reads as the button not working.
- **Overburn** — 27 yd above the centre, at the crown. Ten seconds of burners
  that do not touch the tank. This replaced the old permanent `dg_overburn` bar
  ability: free infinite boost on a 16 s cooldown made the whole pad economy a
  formality.

**Bots take Overburn and leave the Lance.** They have no aim routine to spend it
with, so they would sit on the orb denying it to a human — and a bot that *did*
fire it would freeze you solid for three seconds with no counterplay, which is
the "the bots are too good" note coming back wearing a hat. A bot low on charge
does break off the play to fetch the nearest lit vent, weighting the big ones.

### 4.5 The rush (src/render/deepglass_rush.ts)

Local player only, both driven purely by real speed:

- **Aura** — a teardrop shell sheathing the body, stretched along travel, with
  ripples running backwards down it. Kept narrow and faint (0.17 alpha over a
  tight band): the first pass at half alpha across a wide band whited the screen
  out at speed, because the sheath sits between the chase camera and your body.
- **Speed lines** — the Dragon Ball Z streaks. A ring-buffered `LineSegments`
  pool: each dash spawns ahead of you in a ring around the line of flight,
  streams past at 85% of your real pace, stretches as it goes and dies. One draw
  call, and unlike motion blur it reads at any frame rate.

The burners gained their own two: an additive glow ball seated in each nozzle
(unlit, bloom does the work) and ONE real point light, on the local player's pack
alone — ten dynamic lights in a scene re-links every lit material's shader when
the roster changes, and the light you actually read is the one washing the water
in front of you. Both are deliberately restrained, because the chase camera is
often looking straight into the nozzles.

**Where the nozzles point: the opposite of the thrust, always.** That is the
whole rule, and it is Newton's. The thrust is not guessed from the body's motion
— momentum in the bell is long and drag is low, so a body's velocity is mostly
where it has BEEN, and a pass that aimed off velocity held a hard forward pose
while drifting sideways with the throttle shut. It reads `Entity.dgWish`: the
direction the flight pass is genuinely accelerating along, already lag-smoothed
by the sim, and zero the moment the sticks are released.

**What the hardware can reach.** The pack is bolted to a back, so its nozzles
sweep one fan and not the sphere: from straight down the wearer's spine
(`pitch 0`, which the model is authored at) round to straight out behind the
shoulders and a little past (`BOOSTER_PITCH_MAX`), with `BOOSTER_YAW_MAX` either
side for vectoring. Read on a body flying prone — which is how a fighter in the
bell is drawn nearly all the time — that fan is exactly right: pitch 0 trails the
plumes straight back to drive you forward, and a quarter turn stands them on end
to lift you. What it cannot do is fire out through the wearer's own chest, so
`boosterAim` PROJECTS onto the fan: the closest reachable direction, not two
independent clamps. Clamping pitch and yaw separately is not merely less
accurate — for a target outside the fan it returns the nozzle pointing the exact
opposite way, which is what a live prone body asked to climb did.

- **Braking splays them.** A push the fan cannot serve — most often reverse
  thrust — fans the pair outward like reverse-thrust buckets rather than firing
  the plumes through the wearer.
- **Servos, not lerps.** Both axes are driven by an underdamped second-order
  spring: ~0.1 s to swing, with a small overshoot on arrival. Lighting the
  throttle throws an extra kick into the pitch servo, so the gimbal jolts
  against its stops when the burners crack open.
- The burn buzz still rides on top of the pitch.

**The burners answer the shove.** The flight pass's turn authority means a hard
change of direction is the pack's BIGGEST push — bigger than holding a straight
line at top speed — and none of that used to reach the model. A `surge` term now
spikes on any large change of velocity and decays after it, lengthening the
plumes, brightening the glow and spinning the cog up, so every corner and every
ignition barks out of the burners.

`DeepglassWake` gained a second pool per body for the exhaust. It is FROTH, not
smoke: underwater, churned water catches light rather than blocking it, so the
first pass's soft normal-blended puffs read as a grey blob stuck to your back.
Now it is many small rimmed bubbles, additive, living 4.2 s (against the wake's
1.15) and stamped along the last tick's travel rather than all at one point — so
at boost speed the trail is continuous and runs a long way behind you.
| `DG_CHARGE_MAX` | 100 |
| `DG_CHARGE_BURN` | 40 /s → **2.5 s of burn** on a full tank |
| `DG_CHARGE_REGEN` | 2.5 /s trickle only — see the boost economy in 4.4 |
| `DG_PAD_REFILL` / `DG_PAD_RESPAWN` | 45 / 9 s |
| `DG_CHECK_MIN_SPEED` | 18 yd/s |

Wire: the existing `swimSteer` grade is reused for pitch. Boost charge is
predicted client-side off the same constants and reconciled from the 2 Hz `vcup`
self delta — the pattern `swimStroke` already uses, because a 2 Hz boost meter
would feel broken.

**Traps this pass must handle:**

- `src/sim/breath.ts` drowns a submerged player in 60 seconds. A six-minute match
  underwater would kill the whole roster. The brassgill is the fiction; the code
  still needs an explicit gate on `updateBreath` keyed off wearing it.
- Mounts, flight, jump, fall damage and the ledge snap-down are all suppressed
  for the duration, the way the sport kit already suppresses the class kit.
- Swim animation clips (`public/models/chars/players/swim_anims.glb`) are the
  starting pose set. A boosting player wants a distinct forward-lean clip, and
  the KayKit chibi rig's known reach limits apply — budget for authoring one
  thrust pose rather than assuming a retarget.

---

## 5. The gear

Two wearable assets, both **match equipment**: granted at kickoff and removed at
teardown, exactly as the sport kit is. Neither goes through the wardrobe.

### 5.1 The thrustpack (exists, needs porting)

Both packs are finished but live in another clone on another branch:
`~/Documents/WOC asset gen v2` on `feature/hover-cosmetics`, which is **not
merged upstream** — none of `hover_cosmetics.ts`, `hover_vfx.ts` or
`jet_fire.ts` exist in any `~/Documents/woc` worktree.

- `public/models/cosmetics/hover_jetpack.glb` — *Tinker's Jetpack*. Brass and
  copper twin-cylinder. Standard issue, worn by every fighter in a match.
- `public/models/cosmetics/brennoch_jetpack.glb` — *Brennoch, Engine of the
  Fallen Heart*. Four-nozzle brass engine, split by
  `scripts/build_brennoch_jetpack.mjs` into `core` / `cog` / `booster.l` /
  `booster.r` so the burners fire out of phase, with a gas-flame shader on its
  `gas_fire_*` materials. The legendary pack.

Port `src/render/hover_vfx.ts` (both anchors already exist: `hover_jetpack` at
`[0, 0.12, -0.52]`, `brennoch_jetpack` at `[0, -0.02, -0.77]`),
`src/render/jet_fire.ts`, and the back-attachment seat in the character visual.

**Scope call: port the attachment and the VFX, not the wardrobe.** The
`feature/hover-cosmetics` branch is a whole cosmetic system — an identity wire
field (`hov`), a `change_hover` command, an account mirror, generated country
flags. None of that is needed to put a pack on ten fighters at kickoff. Merging
the full cosmetic system is separate, independently valuable work and should not
be on this critical path.

One behavioural note: the hover cosmetic is documented as **render-only** —
"movement speed, collision, jumping, swimming, and every combat number are
untouched". Deepball is the first thing that makes a pack actually move you, and
that logic belongs in the flight pass, not in the cosmetic.

### 5.2 The booster animation contract

**The model is the boost meter.** A player must be able to tell, from any
distance and with no HUD, whether an opponent has a burn left. Four states, and
every one of them has to be unmistakable in silhouette:

| State | Nozzles | Trail | Body |
|---|---|---|---|
| **Idle** | pilot flames only, a stub of plume held at the collar | none | neutral swim pose |
| **Lighting** (first ~0.2 s) | flare, a servo kick in the gimbal, plume cracks out to full | first bubble burst | shoulders roll back |
| **Burning** | full plume, `cog` spinning, the two burners churning out of phase | cavitation cone + bubble ribbon, brightest at max speed | hard forward lean, arms swept |
| **Spent** | cut out — dark, cold nozzles with a wisp of vapour | none | pose relaxes, visible drift |

The recharge is legible too: pilot flames climb back over the ~6 s regen, so a
pack that is nearly ready looks different from one that just died.

**What the plume is made of.** Not the jetpack GLB's own `fire.*` cones — those
are a 128-vertex straight taper with a circular section, and at the size a burn
actually draws them they read as an orange traffic cone stuck to the model. They
survive only as SOCKETS (the gimbal aims them; their material is switched off),
and `models/cosmetics/brennoch_plume.glb` hangs off them instead:
four nested parts authored in `scripts/assets/deepglass/dg_plume.py` —

- `plume_wash`, a short flared collar at the mouth that does NOT stretch, so the
  plume always looks socketed into the nozzle however far the rest runs;
- `plume_core`, the white-hot spike, PINCHED twice down its length so the shock
  diamonds are in the geometry rather than faked with a gradient;
- `plume_veil`, the long soft envelope, five-lobed and twisting so its
  silhouette is never a circle, lit at its rim so it reads as a volume;
- `plume_tail`, three crossed ribbons whipping out past the tip.

Every vertex arrives knowing where it sits — `uv` carries around-and-along, a
second UV set carries across-a-ribbon and a per-ribbon seed — so the heat
gradient, the soft edge, the shock banding and the turbulence are all functions
of numbers the mesh already has, with no texture fetch anywhere. The four are
driven APART from one shared throttle: that is what lets the collar stay put
while the tail runs out to four times its resting length.

Plume length tracks THRUST rather than travel — a pack shoving a body off a
standing start is at its hardest working and used to draw its smallest flame —
with a light hand from speed still in it, so a boosted player slowed by a check
visibly loses their plume.

**The body under the pack.** The "hard forward lean, arms swept" row above is an
authored clip, not a procedural tilt: `Swim_Glide` (tmp/swim/build_swim.py,
shipped in `swim_anims.glb`) is the burner pose — hands thrust out ahead, elbows
locked, legs pinned together with the toes pointed, head up out of the prone tuck
and looking down the line of flight. It is a HELD pose rather than a cycle
(`locomotionTimeScale` returns null for it), carrying only a slow ripple so a
body under thrust is not stone-still, and it outranks every other water state
including the swim idle — a fighter who has just opened the throttle has no speed
yet, and the pose has to answer the throttle rather than the result.

The reach is the same goalpost the strokes use, because the head on these bodies
is deeper than the arm is long. It was swept against `tmp/swim/_armclear.mjs` on
the knight (the widest head in the game): spread 88 / elbow-out 62 / depth 16
crosses 110 arm triangles against the shipped breaststroke's 226 on that same
body. `depth` is the lever, not spread — pressing the reach DOWN takes it under a
head that sits above the shoulders, where widening it only slides the arm along
the helmet.

**Banking.** Every drawn body now leans into its turn (`advanceBankRoll`), off
the rate the DRAWN facing is sweeping at — the same displayed-motion discipline
as the swim pitch, so peers bank with no wire traffic. In water it is a full
airplane roll (up to 0.8 rad, scaled by travel so spinning the camera on the spot
cannot roll a stationary body over); on land the same signal drives a runner's
inside lean an order of magnitude smaller. Flooded flight also gets its own
nose-over reference (`DG_PITCH_FULL_SPEED` 13 against the lake's 3.2): the swim
figure saturates on the first tick of any climb in here, which turned the pitch
into a two-position switch.

### 5.3 The brassgill (new asset)

A diving mask that makes underwater breathing diegetic instead of a hand-wave.
Blown Goldcrest lens in a brass collar, leather head strap, a caught tidewisp
glowing faintly behind the glass — the same conceit as the Tidesow, so the ball
and the mask read as a matched set.

Build it the way the packs were built: a Tripo generation post-processed by a
`scripts/build_brassgill.mjs` in the mould of `build_hover_attachments.mjs`,
emitting `public/models/cosmetics/brassgill.glb` with the lens as its own node
so the wisp glow can be driven separately.

Technical seat — this is the part with real integration cost:

- Head attachments today run through `ArmorSlot` `'head'` and `HelmKind` in
  `src/render/characters/modular.ts:646`, which is `'none' | 'hat' | 'full'`.
  Both real kinds **drop hair and brows** (`modular.ts:1680`). A mask covers the
  *face*, not the scalp, so hair must survive. This needs a fourth kind,
  `'mask'`: hides nothing on top, seats on the face plane.
- It must render in the portrait path (`characters/portrait.ts`) so the match
  briefing and nameplates are consistent.
- Watch the earring plate. Earrings pierce the ear plate's bottom edge, which is
  exactly where a mask strap wants to run — expect a clipping pass, and consider
  hiding earrings under `'mask'`.
- The mask is what the `updateBreath` gate keys on, so sim and render agree on
  one fact rather than two.

---

## 6. Water, light and legibility

**The water is clear.** This is a design requirement, not an art preference: it
is a 76-yard arena and a ball sport, so a player must be able to see the far
ring, read a teammate's run across the whole bell, and track a 55 yd/s shot. Any
treatment that trades visibility for atmosphere is wrong here.

- **Fog**: exponential, tuned so extinction across the full 76 yd is roughly
  15–20% — a faint cool cast at maximum range, nothing at combat distance. Not
  the 80% murk a normal underwater volume would use.
- **Tint**: very light blue-cyan, accumulating only past ~40 yd. Player silhouettes
  and nation colours must stay readable at the far ring.
- **No** depth-of-field, no heavy desaturation, no screen-warp. The
  underwater read comes from motion and light, not from degrading the image.
  - **The one carve-out is the goal celebration**, and it is deliberate. This
    rule protects *play*: the ball must be trackable and a teammate's run
    readable. During the `'goal'` phase there is no play — the ball is settled
    in the pocket and the sim is counting down to the kickoff — so for 3.4 of
    those 4 seconds `src/render/deepglass_goal_wave.ts` drains the frame to
    near-grey and bursts the scoring side's colour out of the net in ripples
    that wash the whole building. It is bounded by the phase and fully
    recovered before `resetForKickoff`, so no ball is ever in flight under it,
    and reduced motion drops the warp and most of the drain while keeping the
    colour. Nothing here licenses a screen effect during `'active'`.

What sells "underwater" without costing visibility:

- **Caustics** projected onto players, the cradle arches and the stands — the
  single strongest cue, and cheap.
- **Light shafts** from the crown of the bell, cutting down through the volume.
- **Bubbles**: pack trails, a slow ambient rise, and a burst on every check.
- **Motes** drifting along the three current bands, which doubles as the only
  visualisation the currents get.
- **Refraction** on the inner face of the glass only, so the world outside the
  bell bends slightly when you look out — the fishbowl read, applied where it
  costs one surface instead of a volume.
- **Slowed secondary motion**: hair, cloth and particles damped, so bodies read
  as submerged even in clear water.

This direction is also materially *cheaper* than dense volumetrics, which
matters given the draw-call risk in §8.

---

## 7. Abilities

The kit architecture does not move: still class-agnostic records in
`src/sim/content/vale_cup.ts`, still school `physical`, cost 0, `offGcd`, still
resolved by the one shared `resolveSportKit()` so the offline Sim and the online
ClientWorld build identical bars.

| Id (unchanged) | Was | Becomes |
|---|---|---|
| `sport_shoot` | Shoot | **Shot** — hold to charge; 3D aim at the ring; overcharge scatters |
| `sport_pass` | Pass | **Pass** — leads the receiver in three axes |
| `sport_second_wind` | Fresh Legs | **Overburn** — instant full recharge + 4s of uncapped burn |
| `sport_dive` | Dive | **Netguard** — keeper's 3D lunge catch |
| `sport_shoulder` | Shoulder | **Check** — speed-gated ram, 1.0s tumble |
| *new* `sport_volley` | — | **Volley** — timed strike on a fast ball, ×1.35 |

Boost is a held input, not an ability — it belongs on the sprint key, not the
bar. Kits stay four slots so `SPORT_KITS` and the hotbar form are untouched:

```
allrounder / striker / sweeper : Shot · Pass · Volley · Overburn
keeper                         : Shot · Pass · Netguard · Overburn
```

---

## 8. Reuse ledger

| Area | Verdict |
|---|---|
| Queue, brackets, matchmaker, premade packing | **untouched** |
| Match lifecycle, phases, timers, briefing, ready-up | **untouched** |
| Eight banner nations, procedural flags, team tints | **untouched** |
| Parimutuel betting, guild banners, guild leaderboard | **untouched** |
| Deeds, daily rewards, standings, desertion lockout | **untouched** |
| Kit-swap architecture, `resolveSportKit`, wireRev | **untouched** |
| Ball-as-inert-mob-entity wire trick, full-rate carve-out | **untouched** |
| Practice instances (`match.origin`, 8 slots) | **untouched** — now bell copies |
| Terrain flatten arm, decoration exclusion | **untouched** — the cradle fits inside |
| Wire facet `src/world_api/vale_cup.ts`, command names | grows boost charge + ball cam |
| `vale_cup_layout.ts` | pitch section replaced; site/Bram/gate kept, stands rotated |
| `vale_cup_ball.ts` | rewritten (still pure, still ~300 lines) |
| `social/vale_cup.ts` (2333 lines) | possession/kick/goal arms reworked; the other ~80% stands |
| `player_motion.ts` | new flight pass beside `swimVerticalPass` |
| `content/vale_cup.ts` | six ability records retuned, one added |
| `vale_cup_bots.ts` | seat/backfill/showcase scaffolding kept, **brain rewritten for 3D** |
| `render/vale_cup_stadium.ts` (1311 lines) | boards/goals/stands rebuilt as bell + cradle |
| `render/vale_cup_ball.ts` | leather sphere → lit glass Tidesow |
| `characters/modular.ts` | **new** `HelmKind` `'mask'` that keeps hair |
| UI (13 modules) | shells kept; HUD gains boost + heat, window gains rules copy |
| Camera, water treatment, brassgill asset | **new** |
| Tests (14 suites) | `_ball` and `_layout` rewritten; match/meta/bots mostly survive |

---

## 9. Risks

1. **Bot AI in three dimensions is the hardest single item.** The current bots
   reason on a plane. A 3D chaser that does not look drunk needs intercept
   prediction, boost budgeting and role spacing in a sphere — and a 76-yard bell
   is a lot of volume to look stupid in. Practice, the idle showcase and online
   backfill all depend on it, so it cannot be deferred, but it should be its own
   milestone rather than a tail on the physics work.
2. **Render cost.** Ten characters × (pack + mask + burner flame + bubble trail),
   a 76-yard transparent sphere, caustics and light shafts. The weapon-skin crowd
   benchmark on this project measured 100 legendary skins dropping 35 fps to
   20.7, driven by doubled draw calls and a shader-compile stall — the same
   failure mode is available here. Budget a tier-gated A/B early and pre-warm the
   flame program. The clear-water direction helps: no dense volumetrics.
3. **A bigger bell magnifies every physics error.** Interception, lead-passing
   and the goal test all get harder to tune at 55 yd/s across 76 yards. Expect
   the tuning pass to be longer than the implementation.
4. **Authored-map leakage.** `sowfieldIsLive()` exists because the fixed-world
   Sowfield rectangle switched the crowd bed, the match theme and the join arms
   on inside somebody else's map. Every new Deepglass reader must self-gate the
   same way from day one.
5. **Breath, mounts, fall damage.** Systems that assume "submerged = drowning" or
   "no ground = falling" each need an explicit match gate. Missing one is a
   whole-roster kill.
6. **`HelmKind` is load-bearing.** Adding `'mask'` touches hair, brows, stubble,
   earrings and the portrait framing. It is a small type change with a wide blast
   radius; do it early and look at every set.
7. **Wire budget for boost charge.** Predicted client-side or it feels broken;
   reconciled or it desyncs. Get this right in M2, before it is load-bearing.
8. **i18n.** Every player-facing string changes across the full locale set,
   through `scripts/i18n_build.mjs`. The guide pages
   (`src/guide/pages/vale_cup.ts` + `content.generated.ts`) are hand-written
   prose about a game that no longer exists.
9. **Guard pins.** `command_schema`, `IWORLD_MEMBERS`, `ALL_DELTA_KEYS` and
   `CALLBACK_KEYS` carry counted pins that must be bumped in the same commit as
   each wire change, exactly as the original build did.

---

## 10. Milestones

Each one is meant to end somewhere you can look at.

- **M0 — gear.** Port the two pack GLBs, the anchor table, `jet_fire.ts` and the
  back-attachment seat. Author the brassgill and add `HelmKind` `'mask'`. A
  fighter wears a pack and a mask, in world and in portrait. No gameplay.
- **M1 — the bell.** Layout module rewrite, cradle arches in the render, the
  glass sphere, relocated east/west stands, outsider colliders, `deepglassIsLive`
  gating. You can walk up, stand under seventy-six yards of overhang, and look at
  it.
- **M2 — flight.** The flooded-flight pass, boost charge, pads, ball cam, the
  breath/mount/fall gates, and the §5.2 animation contract wired to real state.
  **No ball.** This is the milestone that decides whether the whole thing is fun;
  if flying an empty bell is not fun, nothing later fixes it.
- **M3 — the Tidesow.** 3D ball physics, bell reflection, ring goals, carry, trap,
  shot, pass. Playable 1v1 against nobody.
- **M4 — the sport.** Check, Volley, heat combo, Netguard, Overburn, currents,
  goal celebration and pocket settle.
- **M5 — bots.** 3D brain, practice, backfill, idle showcase.
- **M6 — water and wrapper.** The §6 clear-water treatment, caustics and shafts;
  HUD boost and heat; window rules copy; briefing and betting strings; i18n
  regeneration; guide rewrite; underwater music bed and goal horn.
- **M7 — polish.** Pad VFX, current motes, crowd under the glass, replay of the
  scoring shot.

Suggested branch: `feat/deepglass` off clean upstream (`~/Documents/woc/v035` is
`test/v0.35.0`), *not* off the Studio fork in `dryrun` where this document sits.
`vale_cup_ball.ts` is byte-identical across the worktrees; `vale_cup_layout.ts`
and `social/vale_cup.ts` carry fork drift, so re-diff those two before starting.

---

## 11. Out of scope (deliberate)

- The full hover-cosmetic wardrobe merge (pack selection, store, account mirror).
  Match-granted gear only; Brennoch as a fixed reward skin at most.
- Brassgill variants. One mask for everyone in v1.
- Underwater terrain, obstacles or moving hazards inside the bell.
- Spectator free-camera. Walk up to the glass and watch, as today.
- Tournaments, cross-realm fixtures, penalties or shootouts.
- Keeping the old ground game as a second bracket variant. Two physics models
  means two bot brains, two tuning passes and two test suites for one mode's
  worth of players — if the ground game is wanted back, it should return as its
  own mode later, not as a fork inside this one.

---

## 12. Tuning log (offline arena build)

Numbers measured over full bot bouts with a headless harness, not eyeballed.
Recorded because every one of them was a surprise.

**Bots hit the five-goal cap in ~90 seconds.** Three causes, all fixed:

- *No keeper.* The bell was an open net. A side of two or more now posts one
  (`DG_KEEPER_MIN_SIDE`); it holds a standoff on the ball-to-ring line, charges
  only when the ball is already inside 16 yd, and **clears rather than shoots** —
  a keeper that tried to score walked the ball into its own net.
- *Flat aim error.* Bot spread was a constant, so a shot from half court was as
  good as one from the mouth. It now scales with range
  (`DG_BOT_SPREAD_PER_30`): lethal close, hopeful far.
- *The ball lived on the glass.* It sat in the outer band roughly half the time
  because nothing brought a dead ball back — the currents are tangential and
  deliberately fade to nothing at the wall. `DG_BALL_RETURN` is the radial
  counterpart, biting only in the outer band so midfield is untouched.

Result, 300 s cap, three kickoff times each:

| Bracket | Before | After |
|---|---|---|
| 2v2 | 5.45 goals/min, over in 55 s | 0.8–2.15/min, 183–300 s |
| 3v3 | 2.30/min | 1.34–1.66/min, incl. a 4-4 at full time |
| 5v5 | 2.08/min | 1.12–1.82/min |

**Every bout was byte-identical.** Bot aim is a pure function of (tick, pid) for
determinism, so a fresh Sim replayed the same match to the tick — same score,
same goal times, across every seed. `DgMatch.salt` (the sim tick at kickoff,
read ONCE at start) breaks the tie without putting rng on the tick path.

**Performance is not the risk §9 predicted — yet.** A live 5v5 measured ~100
draw calls and ~482k triangles per frame, with the bell itself 65 meshes and
25.5k triangles; hiding the whole dome moved draw calls by less than the noise
floor of a four-second sample. Note the honest caveat: this is *without* the
thrustpack and brassgill models, so it is not a verdict on the finished feature —
ten packs plus burner VFX are exactly what the weapon-skin benchmark warns about.

**Two readability fixes the numbers could not show.** Authored lighting at
sunset washed the additive bell into a flat grey ball (§6 now records the dark
twilight it wants instead), and from *inside* the bell — where the match is
actually played — the fresnel rim faces away, leaving a featureless wash with no
way to judge distance to the wall. A brass latitude/meridian cage on the inner
face is the spatial reference.

---

## 13. The feel pass (controls, physics, and a roster that plays)

The playable slice was correct and unsatisfying. Everything in this section came
out of asking, per complaint, *what is the player actually unable to do?*

### 13.1 The camera is the aim (`MoveInput.aimPitch`)

The one change everything else hangs off. `dive` / `surface` are latched swim
BANDS — a three-position switch — so the bell's thrust was flat no matter where
the view pointed, and `aimOf` could only ever launch a shot at one of three
pitches. A ring twenty yards above you was not something you aimed at.

The move frame now carries **`aimPitch`**: the camera's real pitch, continuous,
signed, positive up (`deepballAimFromPitch` negates camPitch and removes its
0.32 rest offset — a player who has touched nothing must be aimed *level*, not
eighteen degrees into the floor). Quantised to 24 steps, because the aim rides
the change-detected input frame and a raw float would resend it on every
mouse-move.

Consequences, all of them wanted:

- **W flies where you look.** The horizontal axes ride the LOOK frame.
- **Space and Ctrl stay absolute.** A vertical trim you can hold while aiming
  somewhere else is what makes lining a shot up possible at all. In the bell the
  camera bands stop writing `dive` entirely (`Input.deepballFlight`), so looking
  down while flying forward is one input doing one job.
- **A shot leaves down the line you were looking.** Same vector, same tick.
- Altitude hold is now gated on the whole vertical *intent*, not just the trim
  keys, or it fought every nose-up climb.

### 13.2 Three controls the bell did not have

| Control | What it is | Why |
|---|---|---|
| **Throttle alone** | F with no direction thrusts along the look | A throttle that needs a second key held is not a throttle |
| **Air brake** | Back key adds `DG_BRAKE` damping on top of the retro thrust | 26 yd/s in 0.4/s drag took ~3 s to stop; "I cannot stop" is what made the bell feel like ice. Measured: 26 → 5 yd/s in half a second |
| **Dash** | Double-tap any movement key: `DG_DASH_SPEED` impulse along that axis, `DG_DASH_COST` charge, 0.75 s cooldown | The long momentum left a flier with no answer to anything sudden. A double-tap because every letter on the board is claimed, and because every game with a dodge already taught the gesture |

The dash rides the same speed ceiling everything else does, and survives it
because the ceiling's coast term is measured *after* the impulse — otherwise the
dash was deleted on the tick it fired. Bots dash by synthesising a real
double-tap (press / release / press), so there is exactly one dash in the codebase
and a keeper's lunge spends the same charge a player's does.

### 13.3 Ball physics: spin, and a contact without a cliff

- **Spin and Magnus.** The Tidesow carries angular velocity. A strike takes spin
  from the part of the striker's motion that is *across* the shot line, so a
  push down the line flies true and a slice bends. `a = k(w × v)`, applied before
  drag so a long curler flattens out at the end of its flight rather than hooking
  hardest when it is slowest. Spin also grips the glass, so a curler comes off
  the wall at an angle a straight ball never would.
  The payoff nobody had to write: **bots project straight lines, so keepers get
  beaten by curve.**
- **The contact cliff.** Below `DG_CONTROL_REL_SPEED` a touch handed the ball on
  at 1.15× the carrier's pace; a hair above, 0.6×. Nothing reads worse than an
  outcome that doubles for no visible reason. The factor now ramps across the
  band to `DG_TRAP_FULL_REL_SPEED`, and the sweep is pinned by a test that
  refuses any step over 2.2 yd/s.
- **Dribbling is a skill now.** A carry keeps a quarter of the ball's own
  sideways drift (`DG_CARRY_SLIP`) instead of welding it to the carrier's exact
  heading, so holding the Tidesow through a turn is something you do.
- **Fighters are solid to each other.** They were not: six bodies converged on
  the ball and occupied the same yard of water. Equal masses, one impulse along
  the contact normal, overlap split — and a contact over
  `DG_BUMP_TUMBLE_SPEED` spins the slower body out for a beat.
- **Pace you bring is pace on the ball** (`DG_SPEED_INTO_SHOT`). `dg_shot`'s base
  came down 30 → 26 to make room under the ball's 34 yd/s cap: at 30 a standing
  tap and a full-pace strike were both pinned to the cap and the run into the
  ball bought nothing.

### 13.4 The roster (`src/sim/deepglass/bots.ts`)

The old bots were a tracker: true ball position and velocity every tick, aim at
the ring with a wobble, strike the instant it was in range. A body handicap hid
how much they knew, but the tell was never that they were too good — **it was
that they were never surprised.** A deflection off a shoulder re-aimed the whole
roster on the same tick, and there is no human in that.

So a bot never reads the ball. It reads its **belief** about the ball, refreshed
on a glance every 2–8 ticks (by `vision`) with error scaling on distance (by
`skill`), and dead-reckoned forward in between with buoyancy at half strength and
nothing else. Every mistake worth having falls out of that one decision:

- a ball that changes direction between glances leaves a bot committed to where
  it thought the ball was going, and it has to turn around;
- **a bot can strike at a ball that is no longer there and whiff outright** — the
  reach test is against the belief, the match resolves against the real ball
  (2–14% of strikes, measured);
- currents, the radial return and Magnus are all invisible to a belief, so a
  curling shot beats a keeper with no code about curve;
- the roster reacts in a ragged stagger, because no two bots glance on the same
  tick. The old global `botReactHold` — the whole side hesitating in unison — is
  gone with it.

On top of that, a **temperament** drawn once at kickoff and fixed for the bout:
`skill`, `vision`, `aggression`, `discipline`, `composure`, `flair`. Every field
is allowed to be *bad*, because a roster whose worst fighter is merely average
plays like a roster of one fighter. It drives touch and aim spread, glance rate,
how far out of position they get, whether they keep a burn in hand or fly the
tank dry, whether they hoof it clear in panic near their own ring, and how often
they try something flashy. Sides now **pick** their keeper by
`keeperFitness(composure, skill, steadiness)` rather than posting whoever sat in
the last seat — a fearless 0.2-touch hothead in goal decided bouts before anyone
had touched the ball.

Also new: role **commitment** with hysteresis (a side that re-elects its chaser
every tick produces two fighters swapping the ball and neither arriving),
attacking runs when their side has possession instead of only ever falling back,
separation so a pack has shape, outlet passing that checks whether the lane is
actually open, a keeper that projects the crossing point and **lunges** for it,
ball-watching (a rare, brief beat of doing nothing at all), and refuelling trips
when the tank runs dry.

Measured bot-only over 2v2 / 3v3 / 5v5, three kickoff times each (320 s cap,
first to five ends it early):

| Bracket | goals/min | whiffed strikes | body contacts |
|---|---|---|---|
| 2v2 | 1.86–2.99 | 5–12% | 36–481 |
| 3v3 | 1.48–2.64 | 2–11% | 123–212 |
| 5v5 | 2.16–2.66 | 10–15% | 250–396 |

Goals are overwhelmingly *struck* rather than scrambled off a body (typically
7 of 8), so it reads as a sport and not as pinball; own goals run at 0–1 a bout,
which is about right for a sphere with bodies in it.

### 13.5 The readouts a flier in a sphere cannot play without

- **A ball marker.** A 2.4 yd ball inside a 76 yd sphere is gone the moment it
  leaves the screen. The HUD projects it: a ring while it is in view, an edge
  pointer with a yard count when it is not (negating the NDC when the ball is
  *behind* the camera, or the pointer lands on exactly the wrong edge).
  Deliberately a marker and **not** a ball camera: in the bell the camera is also
  the aim, so a camera that swung itself onto the ball would take the player's
  aim with it and there would be no way to place a shot at all.
- **A speed dial** next to the charge, with a hairline at the unboosted cruise —
  momentum is the thing you are actually managing.
- **Goal credit**: scorer, assist (previous touch by the scoring side, void if an
  opponent touched it in between), and own goals called by name.
- **Sudden death**: a drawn bout used to just stop, which is a flat ending for a
  sport whose whole shape is a comeback.

### 13.6 The bell had no voice (audio), and the camera was lying about speed

**Every cue is synthesised — there are no new assets.** The clip pipeline is an
ElevenLabs generator run (`scripts/gen_sfx.mjs`), which is a poor fit for ten
short percussive transients and a licensing decision besides, so the bank follows
the `dragon_audio.ts` / `water_elemental_audio.ts` precedent instead: pure math in
`src/game/deepglass_audio.ts`, baked into buffers at startup beside the Vale Cup's
procedural crowd (`sfx.ts installProceduralBuffers`) and played through the
ordinary positional path. A strike across the bell is quiet and behind you, which
is also how you find the ball by ear.

Ten cues — `strike`, `bump`, `dash`, `brake`, `ignite`, `vent`, `powerup`,
`whistle`, `goal`, `wall` — and one idea runs through all of them: **everything
here happens underwater.** Nothing carries much above 2.5 kHz (a bright transient
is the loudest tell that a sound was recorded in air), attacks take a few
milliseconds rather than none, there is a sub layer under every impact, and most
cues carry a tail of small *rising* pitched blips. That rise is the whole
illusion: a bubble shrinks as it climbs and its resonance climbs with it, so a
flat blip reads as a synth click and a chirped one reads as water.

Two cues are the arena itself rather than the sport. The Deepglass is a BELL, so
the kickoff is a struck bell (hum, prime, tierce, quint, nominal, detuned so the
partials beat) and a goal is the same bell struck harder and rung twice under the
Vale Cup's crowd roar.

The sim has no event bus for any of this, so the renderer edge-detects the cues
off state it already reads each frame (`syncDeepglassCues`): the touch log for a
strike or a body, the pack flags for a dash, a brake or an ignition, the phase for
the whistle and the goal, the local charge for a vent. Measured over 45 s of a
live 3v3: 2 whistles, 18 ignitions, 15 body touches, 8 dashes, 6 brakes, 4
strikes, 1 goal.

#### 13.6.1 The room, the burners, and the bounce

The ten cues above are all *events*. Three things were still missing, and they
are the three a player hears constantly rather than occasionally.

**The room tone.** The bell had cues but no ambience, so between events it fell
back to whatever open-air bed the biome ladder picked — a ridge wind, a hundred
yards under water. `dg_ambient` is a nine-second bed: a pressure rumble under
~90 Hz that is felt more than heard, a slow band of water moving over it, the
glass shell groaning (paired detuned partials, because two close partials *beat*
and a beat is what says the thing groaning is enormous), and bubble streams
drifting up out of the dark. There is deliberately **no bright layer at all** —
the first version carried a whisper of air over the top and it read instantly as
a room recorded in air, which is the one tell that undoes the illusion. Which bed
plays is still decided in one place: `sfx.ambience()` takes a `submerged` flag
and drops every surface bed when it is set, rather than the deepball code raising
a bed of its own beside beds nobody turned off.

**The burners under load.** `ignite` lights the pack; nothing sustained it. The
`dg_boost` bed runs for as long as the burners are lit, one positional loop per
fighter, so a boost across the bell is a thing you hear go past — information, in
a sport played at 26 yd/s. A jet in water has no whistle and no top end: it is a
broad low-mid roar with the cavitation flutter of collapsing bubbles beating
through it (two rates, not one — a single rate is a buzz with a pitch). Gain
*and* pitch ride the body's actual speed, against the bell's own cruise rather
than the world's run speed, which is the same saturation trap the camera FOV kick
had. `sfx.loopRate` is new for this: ambience never needs a bed to change pitch,
and thrust is exactly a bed that must.

**The bounce.** The one sound a player hears a hundred times a bout, so it is the
one that has to survive the hundredth. The reference is a **basketball** — the
sound everyone already knows for "inflated ball, struck hard": a rubber slap,
the air cavity ringing under it as a short pitched pock, and a sub thump you
feel. Under water the slap loses its edge, the cavity ring sustains (the water
loads the shell) and cavitation wraps the whole thing. It is three separate
recipes, not one buffer at three volumes, because a hard hit is not a loud soft
hit: `bounce_soft` is the pock alone, `bounce` is the basketball proper, and
`bounce_hard` layers extra shell, a longer lower ring and a slower boom on top.
`bounceMixFor` (pure, unit-tested) crosses between them by impact and pitches the
whole thing *down* with force, because a bigger deformation is a lower note.

Two things worth keeping about that:

- **Hardness is the CLOSING speed, not the ball's speed afterwards.** The hardest
  contact in deepball is a rocket trapped dead on a chest, which leaves the ball
  at nearly zero. The renderer keeps last frame's ball velocity and measures it
  against the body's, and lets the post-contact speed vote as well for the
  opposite case (a slow ball smashed away by a body arriving at pace).
- **The layers stack on one transient, so their gains are one budget.** Core and
  heavy both peak on the instant of contact; the first version summed to about
  1.8 of full scale. The engine's trim and the distance panner hide that almost
  everywhere except a point-blank hit during a boost — which is most hard hits.
  It was caught by rendering the mix to a WAV and counting clipped samples, which
  is worth remembering as a technique: nothing in the bell would have reported it.

**The camera's speed widening was pinned at maximum for the whole bout.** It is
measured against `RUN_SPEED`, and the kick maxes out by about 10 yd/s — but a
flier cruises at 9 and boosts to 26, so across the entire range a player actually
uses, the FOV was a constant and said nothing. This is the same failure the swim
pitch had against its own lake-speed reference (§13.1's cousin), and it takes the
same fix: `stepCameraFeel` now accepts the reference, and the bell passes cruise.
Measured live: idle 0, cruise 0, boost the full 6° (FOV 60 → 66). Widening now
means *the burners are lit*.

The same pass gave impacts a physical read: a shake and an outward FOV punch on
YOUR OWN strike only (a bout is a hundred strikes and shaking for all of them is a
headache, not feedback), a shake scaled by pace when you meet the glass, and the
biggest kick of the three — inward, plus the bump cue — when you are spun out by a
Check, the one deepball moment where the controls are taken off you.

#### 13.6.2 The soundtrack: two cues, one venue

Everything in §13.6 is an *event*. The music is the other half, and unlike the
cues it is not synthesised at runtime — it is a pair of streamed mp3s, because a
three-minute score is exactly what a file is for.

The bell scores like a stadium, not like a zone: **"Tidesong"**
(`/audio/deepglass-waiting.mp3`) holds the grounds whenever you are in the bell
without a bout on, and **"The Bell Roars"** (`/audio/deepglass-match.mp3`) takes
over at the whistle. They were written as a pair on the same tonic in opposite
modes — D Lydian and D minor/Dorian — so the crossfade never moves the bass note
under you.

Two things about how they are wired:

- **This is the Sowfield's mechanism, generalised, not a second one.** The Vale
  Cup already ran a waiting/match crossfade pair that ducks the procedural score
  to silence while you are at the ground, so the director's `setSowfieldTrack`
  became `setVenueTrack(venue, track)` with the file pair keyed by venue
  (`VENUE_MUSIC` in `music.ts`). Both tracks of a venue play from the moment you
  arrive and the *gains* pick which one you hear, so the whistle crossfades into
  a track that is already in progress rather than starting one from the top.
- **Presence in the bell is the arming signal, not a position test.** The
  Sowfield is a rectangle in the overworld, so `isAtSowfield` gates it; the bell
  is a whole WORLD (`presentationMode === 'deepglass'`), so the HUD reports
  `inArena` plus the bout phase and the venue music is on the entire time you are
  there. `countdown` and `over` are still the grounds cue — the walk-out and the
  final horn belong to Tidesong; only `active` and `goal` ride the match track.

### 13.7 The Rocket League pass (camera, controls, momentum, music)

Three complaints from play, and what each turned out to be.

**"The camera still feels bad."** Two things, one of which was a bug.

- **The ball cam is gone.** It was tried two ways — as the aim (you could only
  fly *at* the ball) and, briefly, as a Rocket League camera with the mouse
  steering a separate body heading. Neither played: a 76 yd sphere is not a
  flat pitch, and a camera swinging onto a ball above or behind you took the
  view off the flier every time. Removed outright: `Input.ballCam`, the
  `ballCam` keybind (Shift+B, and its i18n row), `trackBallWithCamera`, the
  HUD chip and the aim marker. The camera is the aim again, everywhere in the
  bell (13.1). The ball MARKER stays (the `ballMarker` bind).
- **Near the glass the camera flew off to the caldera.** Not the ball cam: the
  chase boom's pivot-minus-boom point lands OUTSIDE the sphere near the
  perimeter, and the terrain ground-clamp then read the caldera's massif under
  it and lifted the camera onto that terrain, tens of yards from the body.
  `bellBoomLimit` (renderer.ts) now shortens the boom to the last point inside
  the glass (`DG_CAM_GLASS_MARGIN` 0.6), and in flight the terrain clamp and the
  swimmer's water ceiling (the icy sea's level near the perimeter) are skipped —
  the sphere is the only floor that counts there. Measured: camera 48.8 yd from
  the centre against R 49.4, 3.3 yd behind the head, where it used to sit 30+
  yd away.
- Kept from the pass: base FOV eases 60 → **76** in the bell (RL's 110
  horizontal at 16:9), and the boom spring runs at half stiffness with a 2.4×
  leash (`stepCameraBoom` gained `leashScale`) so a burn reads as camera lag.
- **The body pitches to its direction of TRAVEL** (`DG_PITCH_MAX` 0.95 → 1.25).
  It used to pitch to `vy` over a reference speed, which never reached its
  ceiling once forward motion shared the cap — a body climbing on Space alone
  was drawn nose-forward. Now `atan2(vy, horizontal)` drives it: a pure climb
  is nose-up (measured −1.22 rad at 9.8 yd/s up), W-cruise is level.

**"The movement feels restrictive."** Tuning that fought momentum.
`DG_ALTITUDE_HOLD` 1.8 → **0.5**/s (it parked you at your last height inside
half a second — a car that leaves the ground keeps going); `DG_SWIM_SPEED` 10.5
→ **13** and `DG_BOOST_SPEED` 26 → **28** (the ball's cap is 34; an unboosted
flier could never stay with a moving ball); `DG_BOOST_ACCEL` 30 → **36**; spool
0.5 s → **0.35 s** with floor 0.78 → **0.86**; `DG_COAST_DECAY` 0.25 → **0.18**.
Turn authority, brake, dash and the magnet are unchanged. Pinned in
`tests/deepglass.test.ts` ("flight momentum").

**"The music plays at the wrong times."** Two bugs. The venue armed a
"waiting" cue for the whole visit, so arena music played over the city with no
bout anywhere near starting — now `instanceMusicDecision` arms `'match'` only
while a bout object exists (countdown through the final horn) and `null`
otherwise, and the deepglass venue declared **no waiting track**. *(Reverted in
part on 2026-09-07: Troy wanted the older exploration music back, so the venue
declares `deepglass-waiting.mp3` again and the decision arms `'waiting'` in the
bell whenever no bout is on; the bout-only match cue and the boss theme stand.)*
And between bouts
the score resolved through the OVERWORLD's zone table at the arena's own
coordinates (seven zones across the map), because the game ignored
`WorldContent.music` entirely — the Studio's "Map track" was write-only. It is
honoured now (`resolveMapMusicZone`: smallest containing area, then
`zoneTrack`, ids validated against `ALL_MUSIC_ZONES`), so the Deepglass world's
declared `amber` plays outside a match and any authored map's track works.

**Also on request (2026-09-02):** goal holes `DG_HOLE_R` 7.4 → **8.2**
(pass 6.52, drawn ring 6.0 — the mouth geometry, ring planes and gate GLB
placement all derive from it); the causeway rides the dark cobble bag
(`CAUSEWAY_DARK`) instead of the pale deck tiles, so the road reads as the
caldera slate it crosses; the card crowd is thinner (`FILL` 0.86 → 0.68, idle
day one seat in 5 rather than 4) and CLUMPED — a two-harmonic density wave
around each ring (`CLUSTER_WAVES` 11, phase per tier) plus per-seat jitter
along the row, so fans sit in knots with thin stretches between instead of an
even speckle.

**Tidehold's stairs (2026-09-02, `citadel.ts` climbStairs).** Three faults on
every flight, all from the same construction: stone-step courses laid over a
stepped terrain ramp. (1) The terrain pierced the treads in a diamond pattern —
each tread's top sat exactly AT its plateau and the heightfield's rise toward
the next plateau came up through the back half of every step. Steps are now
seated one riser higher (`STAIR_LIFT`), so a tread's top is its plateau plus a
riser, above anything the interpolation can reach; this also makes the flight a
proper staircase (first step a riser above the foot, last tread flush with the
head). (2) The walk is a sloped `collider/plane` per flight through the
tread-top midpoints (`citadelColliderVolumes`, merged into the world's
`colliderVolumes`), so the body rides the stone within half a riser; verified
live, W from the causeway foot climbs 0 → 18 smoothly at full stride. (3) A
brick WEDGE under each flight — an inline built model (`procedural://model`,
a triangular prism from half a yard under the foot plaza up to just under the
treads, 0.35 yd skirt either side, `PavingStones046`) — encases the terrain so
the sides read as masonry and the footing is flush. Walk-through; the plane is
the floor. And the staggered courses are CLIPPED to the flight's width (the
stagger used to slide every other row half a slab sideways, a sawtooth down
both edges); end slabs of staggered courses are half-width. The Studio adapter
carries the wedges (`MODEL_ASSET_ID` + `meshes`). Trap: `citadel.ts` must not
import `map_doc` (it pulls `world.ts` before the zone tables exist — every
deepglass suite failed to load with "zones is not iterable"), so the path
string is spelled out there and pinned equal in `tests/deepglass_shipped_map.test.ts`.

**Click dash and the Zap Shot (2026-09-02).** The double-tap dash is gone: a
hand rolling across WASD fired dashes nobody asked for and made the click feel
optional. The dash is the LEFT CLICK, aimed by whatever keys are held, read in
the look frame (forward + click flips down the nose, camera pitch included; a
strafe + click is a side flip; nothing held flips straight down the camera
line), the Rocket League directional flip. Bots use the same gesture
(`MoveInput.dash` + the held key for one tick). The Tidewarden's Lance is now
the **Zap Shot**: same aim cone and closest-enemy fallback, but a hit
DEMOLISHES the victim (`Entity.dgDeadTicks`, `dgZappedBy`): they drop out of
every roster loop (`dgAlive`), are hidden by the renderer with a burst on the
spot, and respawn 3 s later in front of their own goal (`DG_RESPAWN_A/B`,
`DG_RESPAWN_CHARGE` 34). While the local player is dead the HUD greys the whole
view with a backdrop filter (works on every graphics tier) and counts the
respawn down. Bots still never take the orb.

**The Realm Builder of the Month monument on the Fountain Plaza (2026-09-02).**
The Wardens' Fountain is gone; the plaza's centrepiece is the Realm Builder
monument (upstream PR #3695, still open there, ported into this fork as a
squash patch: server routes + `realm_builder_honours` table, admin dashboard
page, the honour-roll card, the sculpt). Tidehold's copy is three things that
agree on one seat, `citadel.ts TH_MONUMENT`: the shipped GLB placed by the city
at 9.5 yd (Eastbrook's is 7.6), the renderer's `RealmBuilderMonumentFx`
(projected honouree name + lantern embers) built in the Deepglass world and
re-baked by `setRealmBuilderHonouree` like Eastbrook's, and the inspect entity
`spawnTideholdRealmBuilderMonument` seats at reserved id `2_000_000_101` so
clicking it opens the same honour roll. The name comes from the database:
`GET /api/realm-builder` on world load, admins write from Content > Realm
Builders, every write republishes into the sim. Offline worlds show `Your Name
Here`. The fountain's `amb_water` point sound went with it.

### 13.8 The colonnade pillars (a Blender-authored asset)

The processional's colonnade was sixteen eight-sided cylinders with a flat gold
disc on top, drawn straight into the stadium mesh. They are now placements of
one authored model, `public/models/props/deepglass_pillar.glb`: a fluted shaft
with entasis on a stepped plinth and torus base, a flared capital, a gold neck
ring and a gold cap plate (2,536 triangles, two materials, 9 yd tall with the
origin at the foot, 1.9 yd footprint). `colonnadePlacements()` in
`src/sim/deepglass/world.ts` seats one at every spot the old cylinders stood,
scaled by `h / 9` so the run still shortens from 9 yd to 5.5 yd toward the
bell, `detached: true, groundY: 0` on the plaza floor. They carry no collider of
their own: the spheres in `stadiumColliderVolumes` were already standing at
those seats. `deepglass_stadium.ts` keeps the causeway deck, kerbs and lamps and
no longer draws pillars.

The asset is built by `scripts/assets/build_deepglass_pillar.py` run HEADLESS
(`Blender -b --python`): bmesh geometry, glTF export with `export_yup`. Two
attempts to export over the live BlenderMCP bridge crashed Blender 5.1, and
`bpy.data.libraries.write` hung, so author-in-GUI / export-headless is the
recipe for any further stadium props.

The same request covered the Tidehold "colossi": the citadel stood the arena's
own `cradle_pylon.glb` at the gate (58 yd), along the boulevard (26 yd) and at
the bridge heads (34 yd). Those eighteen placements now use
`public/models/deepglass/warden_pylon.glb`, Blender-authored by
`scripts/assets/build_deepglass_warden_pylon.py` to the cradle pylon's exact
envelope (3.05 x 8.77 x 3.05 yd, origin at the foot) so `citadel.ts` places it
by the same heights with the same collision: a stepped plinth and flared foot,
three tapered stone drums, two brass collars and a brass neck, four glowing rune
slits per drum, a flared crown, an octagonal cap and a crystal finial (3,348
triangles, four flat PBR materials, the slits and finial emissive). The arena's
own sixteen cradle pylons gripping the bell (`deepglass_kit.ts`) are untouched.

The Warden Wall and Tower kit (`deepglass/warden_wall`, `warden_wall_pillar`,
`warden_tower`, authored on feat/deepglass by `scripts/assets/deepglass/dg_wall.py`
and `dg_tower.py`) was still untracked in that worktree, so this tree, the Studio
asset browser and its collision bake never saw it. Ported here: the three GLBs
and both scripts, the `SIZE` rows, `wallRunW` on the Warden wall instead of the
kcas wall, and every hexb tower placement (gate, barbican, keep, Seat) on the
Warden tower, then the media manifest, the asset catalogue and
`scripts/assets/bake_collision.mjs` regenerated so the pieces list under the
browser's `deepglass` category with baked hitboxes.

**Team aura at distance (fix).** The report was "the aura is the model standing
up at distance, not swimming like the animation". The hull twins in
`deepglass_aura.ts` were built from EVERY drawn mesh under the body, and the
character carries a shadow-only stand-in, `character_shadow_proxy` (a static
copy in the baked idle pose, `colorWrite: false`, hung on the pose wrapper),
which the renderer shows in the mid-distance shadow band while the articulated
rig is still the visible body. Its twin was an upright, unanimated outline
standing inside the swimming one. Now `isHullable` refuses the proxy by name
and refuses any `colorWrite: false` material, and the renderer keeps a
Deepglass flier's articulated shadow through the proxy band (the far mesh was
already off for fliers), so neither the outline nor the shadow ever shows the
idle bake in the bell. Pinned by `tests/deepglass_aura.test.ts`.

