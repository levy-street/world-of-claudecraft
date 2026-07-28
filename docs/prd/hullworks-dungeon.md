# PRD: The Hullworks, a five-player smuggler-shipyard dungeon

Status: DRAFT pass 1 (2026-07-25), for discussion with Levy. Numbers marked
(tuning) are proposals; engine-derived numbers follow the formulas named
inline. Archetype: the classic "criminal syndicate digs under the coast and
builds a warship in a cave" first-story-dungeon, rebuilt with original
fiction and this engine's primitives. Not a copy of any existing MMO
instance: the shape (descend a worksite, reach the hidden ship) is genre
furniture; the climax (flooding the drydock to launch and ruin the ship)
and every name, faction, boss, and mechanic are original.

## One-line pitch

A five-player, THREE-boss dungeon at levels 13 to 15, 20 to 30 minutes:
the party descends a salvage-works dug under the Galecrest cliffs south
of Wickharbor, opens the sea-lock sluices to flood the Redwake Company's
hidden drydock, launching their half-built war-galleon before she is
ready, and kills Captain Ede Redwake on the ruined, slowly sinking deck.
(Pass 2, maintainer direction: cut from five bosses plus an optional wing
to three, and the Deadmines-style cannon-door breach replaced with the
flood, which the wrecker fiction actually earns: they drowned a hundred
ships to build this one, and you drown it back.)

## Portfolio alignment

- Proposed lane: first approval candidate and first dungeon build, not yet Levy-approved.
- Protected identity: a functioning salvage site shuts down room by room, the party floods
  the drydock to launch the ship early, and Redwake dies on the ruined unfinished deck.
- Scope rail: the flood and the rising water stay cosmetic (render dressing on a fixed
  arena); the dungeon adds no ship-physics or water-simulation system.
- Schedule cut applied at pass 2: three bosses (Charwick, the Hulljack, Redwake), no
  optional wing, no cannon beat; Overseer Brack and Quartermaster Sallow cut outright.
- Next-stage gate: Levy chooses the 13 to 15 or level-20 band, PR #2321 lands, and the PBE
  commitment is recorded. The proposed portfolio position is not approval.

## Where it sits

- Location: the Galecrest coast, just south of Wickharbor. The sea cave
  sits under the cliffs in the lee of the harbor cove, its work-lift head
  tucked beside the road down from the Windway pass, so lower-level
  parties reach it from Mirefen through the pass with only a short
  escorted run, the classic "dungeon mouth in a scary zone" move. The
  Company's hulls are stolen off the Wreckfields to the north, and
  Harbormaster Odile's noticeboard carries the lead-in quest: Wickharbor
  thinks it has a salvage-theft problem, the party finds a navy.
- Hard dependency: the Galecrest zone (#2321) must land first. This PRD
  stacks on it.
- Level band: minLevel 13, tuned for 14 to 16 (tuning). Bridges the gap
  between the Sunken Bastion (~11 to 13) and the Glimmermere Temple (15 to
  16); nothing currently owns 13 to 15. OPEN QUESTION (Levy): the
  Galecrest is authored as a level 20 zone, so a 13 to 15 dungeon inside
  it needs its entrance pocket kept clear of level-20 camps (as specced
  above), OR the dungeon re-bands to 20 and becomes a heroic-adjacent
  five-man. This doc recommends 13 to 15 with the sheltered pocket: the
  20 band is already crowded and the leveling ladder has the hole.
- Sequel fiction: the Redwake Company and the Glasswake Covenant (the
  naga faction of the Farshore voyage raid PRD,
  docs/prd/farshore-odyssey-raid.md) are natural rivals: the Covenant
  harvests wrecks the Company manufactures, and the raid's fiction can
  name the Company as the ones whose false beacons fed the sea its
  ships. Loose coupling only; neither ships blocked on the other.

## The faction: the Redwake Company

Wreckers posing as a salvage guild. They do not find wrecks, they make
them: false beacons on the reefs, then "salvage rights" on what drowns.
The Hullworks is their endgame, one real warship built from a hundred
murdered ones, enough to tax every hull on the coast. Uniform: tar-black
oilskins with a single red-dyed sleeve (the "red wake"), instantly
readable in a screenshot the way the Glasswake's cobalt crowns are.

Trash-free-ish: not zero-trash like the Undermount raid; a leveling dungeon
wants pulls. But every pack is a WORK CREW doing a legible job (sawyers
ripping planks, rat-catchers, a powder line passing kegs hand to hand), and
killing the crew visibly stops the work. The dungeon should read as a
functioning site you are shutting down room by room, not corridors of
guys.

## Layout and flow (three bosses, one flood beat)

Linear, 20 to 30 minutes at level (tuning):

1. The Liftworks (descent, two crew pulls)
2. Boss 1: Charwick the Fusemonger, in the powder magazine
3. Boss 2: The Hulljack, in the assembly hall
4. THE FLOOD: the Sluiceworks (story beat, not a boss)
5. Boss 3: Captain Ede Redwake, on the deck of the launched, ruined
   galleon

Doors reuse the existing sealed-door machinery (`nythraxis_crypt`
keystone pattern: kill the boss, the door unseals). The Sluiceworks: the
drydock's two sea-lock wheels sit on opposite galleries; opening each is
a wardstone-style channel while the party holds one crew response wave
per wheel. Both wheels open, the lock gates part, the sea comes in, and
the half-built galleon lurches off her blocks and settles, afloat and
wrong: the ship they murdered a hundred crews for, launched a season
early by five strangers. The inrush of water is the dungeon's signature
audio sting, and the party rides the rising water up to her deck (a
scripted lift, render dressing on the fixed arena).

## Bosses (engine primitives only, all agent-completable)

Every mechanic below is coordination, positioning on readable timers, or
target priority. No reflex gates anywhere: every dodge has a full
telegraph cast bar, every interact is a channel, nothing requires
sub-second reaction. Primitive names reference the existing boss-kit
fields in `src/sim/content/dungeons.ts` (aoePulse, cleave, summonAdds,
knockback, manaBurn, mortalStrike and friends); anything not already in
the kit is flagged NEW.

### 1. Charwick the Fusemonger (level 16)
Powder alchemist in a magazine stacked with kegs. The room is the fight.

- Kegs are targetable ground objects. Charwick lights a crawling fuse
  toward a random keg cluster (a visible line that advances on tick, NEW
  ground-object state but deterministic and slow); any player can channel
  1.5 s to cut it (interact). Uncut, the cluster detonates a large
  groundAoE.
- Flashpan: frontal cone blind on the tank's side (existing school/debuff
  plumbing), tank swap or eat reduced threat uptime, party choice.
- At 30 percent he stops lighting single fuses and lights THREE: triage,
  cut two, soak one at range. The party picks which corner of the room
  dies.
- Teaching goal: interact triage under damage.

### 2. The Hulljack (level 17, the walking-rig set piece)
A salvage rig built from a crane, four wreck hulls, and spite, piloted by
Company enginewrights. The dungeon's monster-silhouette screenshot.

- The rig has one pilot at a time. Killing the PILOT (priority target,
  low HP, on top of the rig) sends the rig BERSERK for 10 seconds
  (random slow cleaves, no target logic), then a fresh enginewright runs
  from the queue at the wall to re-mount, 6-second window to burn the
  rig itself while its damage is undirected.
- Three pilots total; after the third, the unmanned rig runs a fixed
  overload sequence (three telegraphed aoePulse rings, then inert).
- Grapple Claw: tank-target grab and 8-yard drag (existing knockback
  plumbing inverted), breaks on 100 percent of a stun or the pilot's
  death.
- Teaching goal: add priority and burn windows.

### 3. Captain Ede Redwake (level 18, on the launched galleon)
Fought on the actual deck she never got to finish: masts scaffolded, hull
ribs open, water you let in lapping at the berth. Three phases.

- Phase 1 (100 to 70): duel on the quarterdeck. Riposte stance windows
  (a visible stance buff during which attacking her from the front
  reflects a cleave; attack from behind or hold, the classic positional
  check).
- Phase 2 (70 to 30): "ALL HANDS." She rings the ship's bell and the
  surviving site crew swims and climbs aboard in waves; she fights amid
  them, cleave discipline plus her Broadside cone.
- Phase 3 (30 to 0): the flood you started reaches the gun deck; she
  fights on as the ship settles lower (rising-water render dressing on
  the fixed arena, cosmetic), with a Waking-Fury-style damage ramp
  (tuning) so the fight cannot be turtled forever. Her ship is dying
  under her feet and she knows whose fault it is.
- Her death line sets the sequel hook: "You broke the ship. You did not
  break the ledger."
- Teaching goal: everything the dungeon taught, at once.

## Loot (sketch, budget-gated as always)

- Rares off bosses 1 and 2, ilvl per the engine's dungeon formula off
  boss level; every stat sum obeys `tests/item_level` budgets (exact
  numbers authored at implementation, marked (tuning) until then).
- One epic per class-armor lane off Redwake (boss level 18: epic ilvl per
  the engine formula), including the dungeon's signature weapon, a
  boarding axe.
- Meme item: "Redwake's Plumed Hat", a cosmetic epic head skin with a low
  drop rate (tuning). The hat IS the screenshot economy; classic games
  ran for years on one good hat.
- Heroic mode ships at launch on the existing machinery (maintainer
  direction): heroic difficulty flag, standing multipliers, and the
  automatic five-man heroic swap doing the loot (these 13-to-15 drops are
  below the swap's upgrade floor, so variants generate for free). No
  heroic-only mechanics, nothing bespoke to author.

## Deeds (per the design/deeds.md authoring contract, same change as the
DUNGEON_DEFS entries)

- Per-boss first-kill deed rows, plus:
- "Dry Powder": kill Charwick with zero keg clusters detonated.
- "She Never Sailed": open both sluice wheels without a party death
  during the flood beat.
- Redwake first kill carries the title deed (title: "the Wrecker's
  Wrecker" (tuning)).

## Audio and music

- Streamed track via `src/game/instance_music.ts` + `music_tracks.ts`:
  work-shanty rhythm section over the Galecrest theme's chord spine,
  hammering and saw layers that thin out as wings die (implementation:
  one track with the site-noise baked in; the "work stops" reading comes
  from the SFX side going quiet, which the existing per-room ambience
  already supports).
- The sluice inrush (groaning gates, then the sea) is the one loud moment
  the whole dungeon builds to; give it the full SFX pipeline treatment.

## i18n scope (priced in, not deferred)

- New ITEM NAMES require English catalog rows in the contributor PR.
  Maintainers fill remaining locale overlays before release.
- New quest prose: sparse-overlay rules, the five non-Latin locales
  (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU) per the M16 gate.
- Boss/mechanic names ride the sim_i18n matcher dictionaries plus
  AURA_NAME_KEY; no test catches misses there, so the checklist lives in
  the staged PR plan below.

## Staged PR plan

1. PR A: dungeon shell, layout, crew packs, bosses 1 to 2, entrance,
   DUNGEON_DEFS entries, deeds, quests, i18n, tests (entry clearance,
   command schema, deed catalog pins).
2. PR B: the flood beat, Redwake, heroic flag, loot tables, the hat,
   music track, remaining deeds.
3. PBE round per the contribution process before any release branch
   merge; this PRD goes to Levy before PR A starts.

## Acceptance criteria

- Every mechanic passes the agent-completability review: no sub-second
  windows, every interact is a channel with a cast bar, every hazard has
  a full telegraph.
- All new sim behavior lands as modules behind the SimContext seam with
  tests; the coordinators do not grow.
- `npm run gate` green including the i18n tiers above.
- A full five-player clear by the in-repo bot harness (the same bar the
  Slag Run gauntlet failed): if the bots cannot clear it at level, the
  tuning is wrong, not the bots.

## File plan (build reference)

Files ADDED:
- `src/sim/content/hullworks.ts`: instance def with sealed doors, the
  three boss MobTemplates, work-crew packs, the two sluice-wheel ground
  objects, items (including the hat), and the noticeboard lead-in quest.
- Sim modules behind SimContext, with tests: `src/sim/fuse_lines.ts`
  (Charwick's crawling fuses + cut interacts), `src/sim/rig_pilot.ts`
  (Hulljack pilot/berserk/remount state). (Pass 2: cart_lanes.ts and
  wreck_train.ts cut with their bosses; the sluice beat is ground-object
  channels plus a door flag, no module.)
- `src/render/hullworks_set.ts` for the flood dressing and rising water
  (renderer-only spectacle on the fixed arena) and cove dressing; GLB
  props via gen-3d-asset; one music track; `tests/hullworks.test.ts` +
  parity scenario for Redwake.

Files MODIFIED:
- `src/sim/data.ts` (merge), `src/sim/content/deeds.ts` (append),
  `src/sim/sim.ts` (module ticks) + `server/game.ts` SIM_LAP_PHASES pins.
- `src/sim/content/galecrest.ts` (branch #2321 file): the entrance
  work-lift POI, the entrance pocket kept clear of level-20 camps, and
  Odile's noticeboard quest hook; the ONLY zone-file edit, kept minimal.
- `src/ui/sim_i18n.ts`, `src/ui/i18n.catalog/items.ts` for English item
  names and five non-Latin overlays for M16 quest prose, regenerated
  resolved files; `src/game/instance_music.ts` + `music_tracks.ts`;
  `src/ui/icons.ts` + `public/ui/items/mapping.json`; `public/ui/mobs/`
  portraits; `CREDITS.md`; deeds/entry-clearance test pins; guide regen.

## Open questions for Levy

1. Level band 13 to 15 confirmed, or push to 14 to 16?
2. Trash density: work-crew pulls as specced, or leaner toward the
   raid's no-trash philosophy?
3. The rising-water finale dressing: renderer-only spectacle as specced,
   or cut for scope (the fight works without it)?
4. Hat drop rate: properly rare (memorable) or pity-timered (kind)?
