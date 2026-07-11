# The Vale Cup: boarball at the Sowfield (1v1 to 5v5)

Status: in development (feature/vale-cup, based on release/v0.21.0)

A World Cup inspired football minigame played IN the world: a permanent stadium,
the Sowfield, at the southern edge of Eastbrook Vale. Teams of 1 to 5 pick a
banner nation and a sport role, kick a big ball around a walled pitch, and score
goals. One live match at a time at the stadium; anyone can walk up and watch
from the stands. Role-based sport abilities temporarily replace the class kit.

## Lore

Long before the dead woke, Eastbrook's farmhands played boarball on the stubble
fields after harvest: two mobs, one boar's hide stuffed with straw, and two
wagon gates dragged to either end of the green. The first ball, the Old Sow,
hangs bronzed above the tavern hearth, and the prize was always the same dented
milk pail the winners drank from, the Copper Pail. When the Ashen Coliseum
began sanctioning war games, the vale answered with something gentler: Marshal
Redbrook declared a standing harvest truce on the old green, the wagon gates
became goalposts, and word went out along every road. Now companies come from
every corner of the realm and beyond to play under their banners for the Copper
Pail, and folk call the whole affair the Vale Cup. The green got walls, stands,
and a name, the Sowfield, and Groundskeeper Bram keeps the book of fixtures at
its gate. Nobody bleeds at the Sowfield: the truce holds, boots and shoulders
only, and the loudest thing on a match day is the crowd.

## The eight banner nations

Each team plays under a banner. Flags are procedural (field colors + emblem).

| Nation | Colors | Emblem |
|---|---|---|
| Eastbrook Vale | green and gold | wheat sheaf |
| The Mirefen | teal and grey | heron |
| Thornpeak | ice blue and white | mountain peak |
| The Ashen Coliseum | red and black | crossed swords |
| The Pale Choir | pale blue and silver | bell |
| The Ogre Clans | orange and umber | fist |
| The Pale Moon | violet and silver | crescent |
| The Copper Dig | copper and brown | pickaxe |

Team captain (party leader or solo queuer) picks the nation; if both teams pick
the same one, the away side plays the inverted palette.

## Player-facing rules

- Formats: 1v1, 2v2, 3v3, 4v4, 5v5 (pick the bracket when queueing). Queue solo
  or as a party up to the bracket size; queue from anywhere in the overworld via
  the Vale Cup window or Groundskeeper Bram at the Sowfield gate.
- One live match at a time per realm, at the physical Sowfield. The queue holds
  until the pitch is free. Walk-up spectating from the stands, always.
- Sport kit: on kickoff your class kit is temporarily swapped for a role kit
  (your level, talents, and gear are untouched and restored exactly):
  - Everyone: Kick (quick ground-aimed pass or shot), Second Wind (sprint burst).
  - Striker: Big Boot (long aimed lob), Feint (short sidestep dash).
  - Sweeper: Shoulder (bump an opponent off the ball, brief tumble), Hoof It
    (long defensive clear).
  - Keeper: Keeper's Grip (a ball entering your own goal box sticks to you for
    a beat), Dive (directional lunge that catches a crossing ball), Long Punt.
  - 1v1 and 2v2 default to an all-rounder kit (Kick, Big Boot, Shoulder,
    Second Wind).
- The ball: one big boarhide ball (about chest high). It rolls with friction,
  banks off the pitch boards (no out of play), bounces, and nudges along in
  front of you as you run into it (dribbling is just running with the ball).
  Kicks aim with the ground reticle; power is fixed per ability.
- No damage, no death: tackles tumble (1.2s, diminishing returns), nothing
  hurts. Pets are stowed for the match and restored after.
- Match: 6:00 single period, kickoff at center (teams in own halves, 3s
  whistle), kickoff to the conceding team after each goal, first to 5 ends it
  early. Draw at full time goes to golden goal (first score wins, 2:00 cap,
  then it is a draw).
- Rewards: no xp or loot (truce rules). Daily-reward points on a decided match,
  a Vale Cup wins/losses record, and a live winners board in the window.
- Deserting mid-match benches your slot (team plays short) and locks you out of
  the queue for 5 minutes (the Groundskeeper remembers).
- Offline: a Practice button starts a full bot match immediately; online, bots
  backfill after 60s so the queue always pops (backfilled matches count no
  record).

## The Sowfield (site plan, from the measured heightfield)

- Site: the empty southern basin, stadium shell x [-56, 34], z [-145, -79]
  (90 by 66), center (-11, -112). Clears the Copper Dig camps (west), the
  Bandit Camp (east), Reliquary Hill, the Vale Chapel Yard graveyard, and stays
  north of the world-rim ramp at z = -150. Walkable approach from town down the
  x = 0 column past Reliquary Hill to a north gate.
- Pitch: 44 by 26 (x [-33, 11], z [-125, -99]), long axis east-west, goals in
  the east and west walls (8 wide mouths with post colliders and a goal box).
  Perimeter boards (solid low walls, ball banks off them) with one north gate.
- Stands: raised tiers north and south of the boards (benches, crates,
  foundation tiles on the flattened bowl), banner poles flying all eight nation
  flags plus the two competing flags on match days, braziers for floodlighting,
  the Copper Pail on a plinth by the gate, Groundskeeper Bram at the book.
- Terrain: a bespoke flatten arm in world.ts keyed off the layout const
  (MIREFEN_IMPACT_CRATER precedent; height stamps are circles-only so the
  rectangular plateau is hand-authored), a generateDecorations exclusion for
  the footprint, and colliders derived from the same layout module inside
  staticWorldColliders. Sim ground, collision, and render dressing all read one
  layout module: src/sim/vale_cup_layout.ts.

## Engineering plan (scout-verified lanes)

Sim (src/sim/social/vale_cup.ts behind SimContext, S3 glob covered)
- Queue per bracket, nation and role choices carried on queue units; matchmaker
  packs premades first; one match slot (the stadium). Match lifecycle:
  kickoff countdown, active, goal reset, golden goal, over, restore.
- The ball is a bell-pattern inert mob entity ('vale_cup_ball': hostile false,
  moveSpeed 0, aggroRadius 0, ccImmune, hpBase 1): velocity lives in match
  state; a new end-of-tick phase (appended AFTER updateDelveRuns) integrates
  friction, gravity and ground restitution, reflects analytically off the wall
  segments of the layout module, nudges from player contact (dribble), and
  ctx.rebuckets. ZERO shared-rng draws on the tick path (professions set the
  precedent); any match randomness uses a per-match sub-stream Rng.
- Sport kit swap: valeCupStandardize swaps ONLY meta.known to the role kit via
  a shared pure resolver (level/xp/talents untouched, so persistence is safe
  with no restore snapshot); wireRev++ propagates it; restore rebuilds known
  from class/level/talents. Pets stowed via the delve-park helpers. Sport
  abilities are new class-agnostic records in src/sim/content/vale_cup.ts
  merged into ABILITIES (school physical, cost 0, ground-aimed kicks via
  targetMode 'position'/castAt); new AbilityEffect arms: ballKick (impulse
  toward castAim), sportDash (directional knockback-walker dash); tackles reuse
  the stun effect (PvP DR applies), sprints reuse buff_speed.
- Goal detection: ball center crossing a goal plane between posts; celebrate
  4s (fireworks event), reset to kickoff. Non-participants on the pitch during
  a live match are nudged to the stands line each tick.
- Hostility: sport arm in isHostileTo scoped to tackle-type targeting only (no
  damage anywhere); targeting arm so opponents are targetable for Shoulder.

Wire and IWorld
- New facet src/world_api/vale_cup.ts: cupInfo (queue state incl. bracket and
  queue size, nation catalog, myMatch: score, clock, phase, rosters with roles
  and nations, ballEntityId, liveMatch summary for the indicator, winners
  board) + commands vcup_queue {bracket, nation, role}, vcup_leave, vcup_role.
  Practice is an offline method (online no-op). Self delta key 'vcup' at 2 Hz
  next to 'arena'; a 'sport' role field rides the wireRev-gated heavy block so
  the ONLINE action bar rebuilds the sport kit (the one wire trap: ClientWorld
  derives known client-side and needs the same shared resolver).
- Ball entity rides the normal entity wire with a full-rate isUpdateDue
  carve-out (one entity at 20 Hz regardless of distance) and a nameplate
  suppression carve-out.
- Guard pins to bump in the same commits (v0.21 values): command_schema
  118/127/9, IWORLD_MEMBERS 170/42/128 + facet pin 22 to 23, ALL_DELTA_KEYS
  30 to 31, CALLBACK_KEYS appends, HEAVY_SELF_CMDS for kit-affecting commands.

Server
- Dispatch cases beside arena_queue with per-field validation; detectActivity
  arm for cup results (daily rewards); presence name 'The Sowfield' when inside
  the stadium footprint; desertion resolved before the leave save.

UI
- Vale Cup window (nation flag grid picker, role picker, bracket tabs, queue
  join/leave, live score, winners board, offline Practice); pure core + painter.
- Match HUD strip: two flags, score, match clock, phase banners (KICKOFF,
  GOAL, GOLDEN GOAL, FULL TIME); goal banners with scorer name; respawn-free.
- Persistent indicator states: queued (bracket + position + wait) and
  live-match (score + clock, walk up or open window). Never tier-shed.
- Sport hotbar: a new 'sport' HotbarForm (bear/cat/stealth precedent) seeded
  from the role kit so real bars are untouched; Kick uses the existing ground
  aim reticle. Groundskeeper Bram gossip menu button opens the window (delve
  board precedent). New keybind for the window (pick a free key).
- Music: a 'vale_cup' MusicZone with a jaunty match theme inside the stadium
  radius; crowd ambience bed (amb_crowd) near the stadium; goal horn + crowd
  roar one-shots on events.

Render
- src/render/vale_cup_stadium.ts modeled on impact_site.ts: built once in the
  renderer ctor, cullRadius ~300, dressed from shipped CC0 kits (dungeon
  barriers for boards and goal frames, benches/crates/foundations for stands,
  banner GLBs with nation flag canvas textures, braziers on the fireLights
  budget), everything seated on terrainHeight + lift, counts gated by GFX tier.
- src/render/vale_cup_flags.ts: procedural nation flag CanvasTextures (own
  module, never touching textures.ts's shared LCG).
- The ball: a bespoke renderer visual for templateId 'vale_cup_ball' (procedural
  stitched-leather sphere, client-side roll rotation from position deltas, faint
  trail at speed); goal fireworks via a new per-particle-color Vfx method.

Tests
- vale_cup.test.ts (queue/nations/roles/kit swap round-trip/kickoff/goal/
  golden goal/desertion/restore/persistence safety), vale_cup_ball.test.ts
  (physics determinism: friction, bounce reflection, dribble nudge, goal plane;
  rng draw accounting via Rng.setObserver, professions test precedent),
  vale_cup_online.test.ts (wire, arena_online template), view-core tests for
  window/hud/indicator, layout-vs-collider single-source pin, starter-rations
  aware inventory assertions, run-twice determinism, tests/parity stays green.

Out of scope v1 (recorded deliberately)
- Tournaments/brackets across teams, cosmetic kits/tabards, instanced overflow
  pitches, spectator camera anchoring (walk-up is the mode), penalties or
  shootouts, ball spin/curve physics, cross-realm fixtures.
