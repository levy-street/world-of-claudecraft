# Battlegrounds: The Gravemarch (5v5)

Status: in development (feature/battlegrounds, based on release/v0.20.0)

A queued, instanced 5v5 battleground in the spirit of League of Legends, adapted to
classic-era MMO combat: two lanes of marching undead minions, defensive Bulwark towers,
a neutral objective, and a Warstone whose destruction wins the match. Queue from
anywhere, a persistent HUD indicator shows queue and live-match state, and any player
can spectate a match that is underway.

## Story

On the Revenant Fields below the Gravewyrm Sanctum lies the vanguard of the last army
that tried to take Thornpeak, two hundred years buried. Each dusk the old battle wakes:
shield lines form, columns drill, and the dead march the two roads they died on. The
wardens of the Ashen Coliseum found the war banners of both hosts still standing, and
whoever raises a banner commands its dead. So the Coliseum sanctioned a war game.

Two companies of five champions each take up a banner: the Ember Company (red) and the
Pale Company (blue). Each company leads its columns of Boneclad Revenants down the old
roads, breaks the enemy Bulwarks, and shatters the enemy Warstone, the soul-anchor that
keeps the other host marching. At the field's heart hangs the Knell, the bell that
raised this army; its keeper, the Knell Warden, tolls the dead awake. Silence the
Warden and your own columns march the harder for it.

Nobody truly dies on the Gravemarch: the field itself refuses it. The fallen wake at
their Warstone, a little slower each time.

(Fits existing lore: the Revenant Fields POI and the buried vanguard are established in
zone 3 content; tolling bells, wardstones, and risen soldiers are established motifs;
PvP stays consensual and faction-free, teams are transient sides under Coliseum rules,
exactly like the arena.)

## Player-facing rules

- Format: 5v5. Queue solo or in a party of 2 to 5; the leader queues the party.
  Queueing from anywhere in the overworld (not from inside an instance). Level 10+.
- Standardization: fiesta-style. Every fighter fights at level 20 with the default
  talent build for their class; real level/xp/talents are restored afterward. No gear
  changes, no consumable restrictions (v1).
- Map: the Gravemarch, a flat dusk battlefield about 170 by 240 yards. Two bases
  (north and south), each holding a Warstone. Two lanes (the Shield Road, west; the
  Spear Road, east), each defended by an outer and an inner Bulwark per team. Between
  the lanes lie the Barrows: broken ground, cover, and the ruined bell chapel at the
  center.
- Minions: every 32 seconds each team spawns a column of 4 Boneclad Revenants per lane
  (3 footmen + 1 arbalist; every third wave adds a banner sergeant). Columns march
  their lane, fight enemy minions, players, and structures. Minions give no xp and no
  loot.
- Bulwarks: heavy ranged towers. They prefer minions but immediately punish enemy
  players who damage an allied player in range. Outer must fall before inner takes
  damage; a lane's inner Bulwark must fall before the enemy Warstone can be harmed
  (either lane opens it).
- The Knell Warden: a neutral elite at the center chapel, first appears at 2:00,
  respawns 120 seconds after death. The team that fells it "silences the Knell":
  its next 3 minion waves are empowered (tougher, harder-hitting, bonus damage to
  structures) and the team deals +10% damage to structures for 60 seconds.
- Death: no corpse run. The fallen are benched and respawn at their Warstone after
  8s + 1s per own prior death + 1.5s per elapsed match minute, capped at 30s.
- Win: destroy the enemy Warstone. Hard cap 15:00; at the cap the winner is the team
  with more enemy structures destroyed, then higher total structure HP fraction;
  within 2% it is a draw.
- Rating: per-player Gravemarch Elo (start 1500, K=32, floor 100), applied as one
  team-average delta per side, arena-style. Wins/losses tracked. Matches with bot
  backfill are unrated. Ladders: live online top 10 plus an all-time leaderboard.
- Deserting: leaving the queue is free. Disconnecting or logging out mid-match removes
  the fighter (team plays short-handed), counts as a loss for a rated match, and
  applies the Deserter's Knell: no re-queue for 5 minutes.
- Backfill and practice: if a queue has waited 75 seconds with at least one human
  unit, both teams fill with scripted bots (unrated). Offline, a Practice button
  starts a full bot match immediately (the fiesta practice precedent).
- Rewards: no xp, loot, or currency (arena precedent). Daily-reward points and a
  Discord activity card on match end; standings on the character sheet later.

## HUD and spectate

- Persistent indicator (the user-visible heart of the feature): a compact badge near
  the minimap that shows, in priority order: your queue state ("In Gravemarch queue,
  Nth, ~Ms waiting"), a live match on the realm ("A Gravemarch battle rages, 07:42,
  12 to 9. Watch"), or nothing. Clicking opens the Battlegrounds window. Never shed or
  delayed by graphics tiers (it is actionable information).
- Battlegrounds window (new keybind, minimap micro-button, mobile tray entry): queue
  join/leave, party status, your rating and W/L, the live-match list with Watch
  buttons, online ladder, all-time leaderboard, offline Practice button.
- In-match HUD: top strip with team kill counts, match timer, structure pips per team,
  and Knell status; a respawn overlay while benched; event banners (Bulwark fallen,
  Knell silenced, Warstone under attack, victory/defeat). Snapshot-driven (self-heals
  on reconnect), one-shot juice from events (fiesta HUD pattern).
- Map/minimap: a battleground schematic mode (delve map precedent): lanes, structures
  with team color and alive/destroyed state, allied positions, self, the Knell. Enemy
  champions are NOT shown (classic fidelity: you see what your snapshot sees).
- Spectate: from the window or indicator, any player (not dead, not in an instance,
  not queued or in a match) can watch a live match. The server re-anchors their
  snapshot to a participant (moderator-spectate mechanism, player-gated, no GM grant),
  with a privacy-reduced self record (no bags/inventory/quests/talents of the target).
  Spectators can cycle the followed participant, see the match HUD, and chat. Spectate
  ends on request, on match end, or if the match empties. The spectator's own entity
  parks in limbo and is restored exactly as moderator spectate does.

## Engineering plan (seams and decisions)

World geometry
- New instance band in src/sim/data.ts: cap isDelvePos at DELVE_BAND_X_MAX = 9000,
  then BG_X_MIN = 9600, BG_X_MAX = 10200, bgOrigin(slot) = {x: 9900, z: -1250 +
  slot * 800}, BG_SLOT_COUNT = 2. Slot spacing 800 clears the map z-extent (about 240)
  plus the 130yd NPC interest radius with margin. Band predicates threaded through
  colliders.ts routing (resolvePosition, movement, cameraOcclusion, lineOfSightClear),
  zone-name overrides (HUD zone label, world map, server presence), sim.ts
  dead-on-load and addPlayer relocation ladder (relocate to Highwatch, or the persisted
  bgReturnPos).
- Map as plain data: src/sim/battleground_layout.ts (DungeonLayout-style): base walls,
  lane definitions with waypoints, structure positions, chapel ring, barrow clutter,
  spawn points, all driving BOTH layoutColliders-derived colliders and the render
  module. Flat ground (groundHeight already returns 0 past x=600).

Sim system (the core, behind SimContext)
- src/sim/social/battleground.ts (auto-covered by the S3 i18n glob): queue arrays +
  matches map + busy slots as Sim fields exposed as ctx views; updateBattlegrounds(ctx)
  appended to the end-of-tick block AFTER updateArena (never reordered); eligibility
  guards cloned from arenaQueueJoin; greedy rating-nearest team packing (premades
  intact, fill with solos); match lifecycle countdown(10s)/active/over with returns
  map; fiestaStandardize/fiestaUnstandardize reused for level-20 normalization.
- Match-internal randomness through a per-match seeded sub-stream Rng (one draw from
  sim.rng at match start), zero sim.rng draws on idle ticks, so parity goldens do not
  fork.
- Minions, Bulwarks, Warstones, and the Knell Warden are mob-kind entities spawned
  from declarative templates in src/sim/content/battleground.ts (no xp, no loot), but
  DRIVEN by the battleground module itself (lane waypoints, target acquisition,
  swing timers via ctx.dealDamage), not the wild-mob AI, keeping threat/leash systems
  untouched and rng draws in-match only.
- Hostility: a battleground arm in Sim.isHostileTo (cross-team players, and bg mobs
  hostile to the opposing team and its mobs only), a countdown-targeting arm in
  targeting.ts, and a kill-routing arm in combat/damage.ts using the fiesta bench
  pattern (no real death, respawn at base).
- Persistence: bgRating/bgWins/bgLosses (+ bgReturnPos while in a match, cleared on
  return; deserter lockout in-memory) in PlayerMeta -> CharacterState JSONB with the
  arena legacy-fallback pattern.

Wire and IWorld
- New facet src/world_api/battleground.ts: BgInfo (queued state + queueSize, myMatch
  BgMatchInfo with rosters/structures/knell/timer/respawn/ally positions, liveMatches
  summaries, standings, online ladder) + commands bg_queue, bg_leave, bg_spectate,
  bg_spectate_next, bg_spectate_leave. Registered append-only in COMMAND_NAMES +
  COMMAND_FACETS; pinned counts bumped (command_schema, world_api_parity,
  snapshots delta keys).
- Server: validated dispatch cases beside arena_queue; maybe('bg', ...) self key at
  BG_WIRE_HZ = 2 (events carry the instant transitions); pid-scoped SimEvents
  (bgQueued/bgFound/bgCountdown/bgStart/bgKill/bgStructure/bgKnell/bgEnd/bgDown);
  detectActivity arm for daily rewards + Discord card; presence/instanceZoneName arm;
  spectate generalization: session.spectating gains mode 'match' with privacy-reduced
  selfWireJson (heavy private maybe() keys skipped) and no GM grant; auto-retarget on
  anchor leave, auto-exit on match end.
- ClientWorld: bgInfo mirror (delta-guarded), cmd senders, spectate frames reused.

UI (pure core + painter pairs, all registered in UI_PURE_CORES)
- battleground_indicator_view.ts + battleground_indicator.ts: the persistent badge.
- battleground_window_view.ts + battleground_window.ts: the ArenaWindow-shaped queue,
  live matches, ladder window (three Hud touchpoints: instantiate, closeManagedWindow
  case, cadence-band render + relocalize).
- battleground_hud_view.ts + battleground_hud.ts: the in-match strip/respawn overlay,
  composed by Hud, snapshot-driven from bgInfo.myMatch.
- Minimap/world map battleground mode painter (delve map painter precedent).
- Keybind + onUiKey + main.ts routing + mobile tray + minimap micro-button.
- i18n: all client strings in hud_chrome.* (flat, English-only compiles; wordy values
  get the five M16 non-Latin fills in-change). Sim emit strings kept minimal and
  reusing already-matched arena error text verbatim where semantics match; any new
  emit gets its sim_i18n matcher rule + DICT entries in the same change. Events carry
  no English (typed events -> t() in hud).

Render (src/render/battleground.ts, composed by renderer)
- Open-air interior: a 'battleground' state in the updateAmbience fog machine that
  KEEPS sun/sky/IBL, with a dusk ash-grey fog preset; ash-fall weather over the band.
- Ground: a custom battlefield ground mesh over the flat band (scorch/ash/mud
  palette, paved lane roads), built from battleground_layout data.
- Dressing from shipped CC0 kits: KayKit hex castle/tower/wall pieces for the bases
  and Bulwarks, the 380-piece dungeon kit for ruins/braziers/banners (red vs blue
  banner sets for team color), Quaternius dead trees and rocks for the Barrows,
  graveyard props, planted spears, torn banner rows, the bell chapel at center.
- Team-tinted brazier flames on structures (dungeon variant flame-tint pattern);
  destruction states (tower collapses to rubble, VFX burst + bloom); Warstone as a
  glowing team-tinted monolith (delve portal shader pattern).
- Optional dusk sky via the shipped-but-unused night HDRIs if the mood needs it.

Tests (templates named in tests/ maps)
- tests/battleground.test.ts (queue/matchmaking/lifecycle/win conditions/forfeit/
  persistence round-trip, run-twice determinism), tests/battleground_module.test.ts
  (lane/tower/knell logic), tests/battleground_online.test.ts (wire, cloned from
  arena_online), tests/battleground_window_view.test.ts + indicator/hud view tests
  (Sim-shaped and ClientWorld-shaped stubs), spectate coverage extending
  snapshots.test.ts, band-layout suite (delves.test.ts pattern), a parity sub-stream
  scenario, and every pinned guard updated in the same commit (command counts, IWorld
  members, delta keys, UI_PURE_CORES, CALLBACK_KEYS, hud_perf_budget lists).
- Wiki: src/guide/pages/battlegrounds.ts + route + guide.* keys + sitemap +
  npm run wiki:content (spoiler-safe: concepts, no numbers).

Out of scope for v1 (recorded deliberately)
- In-match items/gold, more maps, ranked seasons, cross-realm queue (per-realm only,
  matching every existing scoping rule), reconnect-into-match, surrender votes,
  spectator delay, jungle buff camps beyond the Knell Warden, minimap pings.
