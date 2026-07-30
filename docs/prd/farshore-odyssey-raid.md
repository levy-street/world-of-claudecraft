# PRD: The Far Shore Voyage, a Gullhaven sailing raid (Glasswake Covenant)

Status: INCUBATION, draft pass 2 (2026-07-26) for discussion with Levy. Not scheduled
and not eligible for Stage 5. The reduced raid core still needs an explicit Stage 3
scope decision before its existing handoff can be dispatched.
Depends on the Farshore zone on the `feature/procedural-dungeons` branch
(umbrella PR #1584) landing first. Supersedes the earlier Wickharbor-anchored
draft. Pass-2 scope cut
(maintainer direction): entry is the standard click-the-moored-ship raid
gate, and every cross-instance or single-crew system is removed (bell
relay, Gullhaven Answers, previous-crew ghost ship, town-side live state);
the design assumes many groups raid concurrently. Pass-3 cuts (2026-07-26):
Wreck Train reduced to the single hulk rescue, Bells route staged to a
follow-up patch, Wake Doubles recorder replaced with class-mirror mob
reflections, the Captain's bespoke ability kit dropped, scar/absorb finale
bookkeeping dropped, per-wing lockouts collapsed to one. Heroic mode added
as a launch requirement on the existing machinery. Pass-4 cut
(2026-07-26, maintainer direction: lame bosses out, a 2-to-3 boss raid is
fine): the Teeth crag and Wake Doubles wings are CUT outright, along with
the entire two-route system and the staged Bells patch. The raid is THREE
bosses (Vessarine, Szethkar, Sereva) plus the launch and the
open-sail hulk rescue.

## One-liner

The game's first sailing raid: ten level-20 players crew one visible ship out of
Gullhaven through a three-boss voyage against the Glasswake Covenant, and the
crew's rescue and election decisions reshape that run's ship and return-leg finale
without creating persistent per-crew world state.

## Portfolio alignment

- Proposed lane: incubation until the first dungeon and raid pipelines are proven, not yet
  Levy-approved.
- Protected identity: one crew, one visible ship, the Name-Taker election, and Sereva's
  return-leg finale.
- Scope rail: the pass-4 three-boss cut is the maximum initial raid. Cross-instance state,
  town-side live state, route branches, extra wings, bespoke Captain buttons, and trophy
  moves remain cut.
- First schedule cut: the weekly low-tide assault becomes a separately approved post-raid
  extension. It cannot delay or share the initial raid dispatch.
- Next-stage gate: Hullworks and one raid prove the pipeline, Levy approves the reduced
  raid core, and the `feature/procedural-dungeons` branch (umbrella PR #1584) lands. The
  low-tide extension receives its own later scope decision.

## Why this patch

Design target is shareability. Every encounter is built around one recognizable
screenshot or chat transcript. The elected Captain and optional hulk rescue may
change the return-leg frame without changing the world outside the instance.
Secondary target: showcase what this game uniquely is, a deterministic sim where
AI agents are first-class players, by giving humans and agents mechanics they
solve together (information splits and votes).

Entry is deliberately boring: the raid ship is moored at the Landing, and
a raid group clicks it to enter the instance (the standard raid-gate plus
dungeon-door pattern, nothing custom). Everything the raid does happens
INSIDE the instance; the design assumes many groups run it concurrently,
so no system below ever refers to "the" crew at sea. Endgame content
berthed in a starter zone is still the flavor win (geared players moor at
a level-5 dock), but it is set dressing, not machinery.

Everything below is agent-completable by policy: coordination, information
asymmetry, resource math, and positioning on readable timers. No
human-reflex mechanics anywhere.

## Setting and dependencies

Stage is the existing Farshore content (nothing invented here):

- Gullhaven, the island fishing town (Warden Coalfast, Bellkeeper Tam,
  Quartermaster Edda, Mender Saul, Fisher Bram, Riftwatch Ollun).
- The Landing, where the Ferrywalk sandbar meets the island, with its
  watchbell (the existing q_fs_bell_at_the_landing breadcrumb).
- The Sundered Cliffs: the siren strait.
- The Riftfields and the breaks: the zone's existing sea-rift siege, which
  this patch's fiction plugs into rather than replaces.
- The Three Bells (existing quest motif): flavor only; the raid adds no
  live town-side state (pass-2 rule: no single-crew systems).

Dependency: the Farshore ships on the `feature/procedural-dungeons` branch
(umbrella PR #1584). This PRD stacks on it or follows it; it does not fork it.

## The enemy: the Glasswake Covenant

Naga-style serpent people, all names original. Doctrine, rewired to the
Farshore's existing fiction: where the breaks tear the sea, the shallows
fuse into rift-glass, and the Covenant harvests it. They believe the breaks
are the sea opening its one true eye, and a crown of rift-glass will let
their Crowned speak for it. Gullhaven thinks it has a rift problem; it has
a rift problem AND a congregation that follows the rifts ashore. The two
sieges explain each other.

Unit archetypes:

| Unit | Role | Signature mechanic |
|---|---|---|
| Keelgrip Bulwark | Frontline | Hooks a target to a deck post (visible cast); armored until another player breaks the chain |
| Wakeglass Siren | Song caster | Splits information between player groups, masks cast names, projects false headings; sings the Beckoning (the faction's mind-control verb, below) |
| Wreckstitch Diver | Salvage engineer | Repairs enemy stations, cuts the raid's tow cables, raises wreck constructs |
| Lantern Thief | Support skirmisher | Steals one player buff into a targetable glass lantern; break the right lantern to get it back, break a decoy and an add spawns |
| Deepchart Augur | Navigator | Draws deterministic current lanes and marks future boarding points, readable by humans and agents alike |

Visual signature (every unit, every screenshot): a tall crown or back-fin of
jagged rift-glass, cobalt blue, bound in strips of saturated red sailcloth.
Blue rim light off the glass, red streamers off the silhouette. One crown
plus one streamer identifies the faction at any zoom.

## Post-raid extension: Low tide on the Ferrywalk

This weekly event is conceptually related but is not part of the initial raid
scope or dispatch. It receives a separate Levy decision after the raid clears
PBE, owns its own state, and cannot require a choice or persisted field from a
raid run.

The extension stays scaled to the zone's 3 to 7 band so the starter island
defends itself. At low tide the sandbar widens into a broad seabed road and the
Glasswake walk it in phalanx toward the Landing. Islanders and low-level players
defend Gullhaven. If approved, event-local aid choices may let timber build
barricades, oil light the exposed seabed, or medicine add rescue tents. This is
supporting content that teaches raid fiction at level 5, not a raid prerequisite.

The assault also teaches the Beckoning small: one Siren walks with each
phalanx, singing a handful of GULLHAVEN VILLAGERS (named friendly NPCs,
never players in the open world) into a slow march toward the waterline.
Any player of any level can grab a villager (2 s channel) to snap them
out; every villager saved is a defense objective and feeds a small deed.
Once the extension ships, level-5 players learn "interrupt the singer,
grab the walker" before later meeting the raid's lash counter.

(Cut at pass 2: the Bell Relay cross-lockout message system and the
Gullhaven Answers open-world skiff event. Both assumed a single crew at
sea and needed custom cross-instance plumbing with no precedent. The
low-tide assault above is a separate post-raid extension, not the raid's
open-world footprint.)

## The space: one ship, one arena

The entire raid is fought on the deck of the raid's own ship. The boat is
the arena; the world moves past it. There are no islands, no landfalls,
and no second room in v1:

- Boss 1 plays out as the ship runs the Sundered Cliffs strait: sirens
  sing from the sea stacks AROUND the boat, boarders come over the rails,
  and the Beckoned walk happens on the deck planks.
- The open sail is the same deck with open water around it; the hulk is
  hooked from the rail.
- Boss 2 is a boarding action: the Name-Taker forces the command crisis
  on your own deck.
- Boss 3 is the harbor mouth: Sereva coils around the hull and the town's
  boats circle the fight.

The movement model, stated plainly because it is the load-bearing
implementation fact: nothing ever moves in sim space. The instance map
holds THREE dressed copies of the same deck, stamped at three fixed
locations on the one instance grid: the strait deck (real sea-stack and
cliff geometry around it), the open-water deck, and the harbor deck
(town backdrop, room for the NPC boats). "Sailing" between legs is a
short scripted teleport of the whole raid to the next deck copy when the
prior encounter ends, the exact machinery dungeons already use to move
parties, wrapped in a departure and arrival beat. Nobody steers, there
is no ship-driving verb, and no geometry ever moves. Players never leave
the deck they are on: the rails and the boarding nets below are the
arena boundary, and going overboard means the nets and a walk back up.

This is a deliberate build economy: ONE deck collider layout authored
once and stamped three times, real (static) scenery per leg instead of
faked motion, one `interior` entry.
The known risk is visual monotony (three fights on the same planks); the
named mitigation, if playtest agrees, is moving Boss 2 below decks into
the hold, a second small interior on the same ship (open question below).

## The raid: three bosses, 10 players, level 20, one evening

### The launch: the Tenfold Sail (not a boss)
The group clicks the moored ship, zones in on deck, and the launch plays
out in-instance: each raider's heraldic panel (generated from class,
weapon silhouette, and chosen color) stitches into the ship's mainsail as
a deckhand NPC reads the manifest. Agents get panels and manifest lines
identically to humans. The sail takes damage and collects trophies all
run: the before and after shots tell the run's whole story. Render-side
compositing only, no new sim system.

### Boss 1: Vessarine, First Voice of the Glasswake (the Sundered Cliffs)
Vessarine, the siren matriarch who taught the Covenant to sing, is coiled on
the tallest sea stack, conducting. She pulls when the ship enters her
strait, opening on a yell ("Every wreck on this coast learned my name
before the water took them. Learn it dry."). Her Wakeglass Sirens sing
from the broken cliff stacks around her, and the fight
alternates between the song's two movements on a loud, readable cadence:

- The Verse (navigation): the song splits the raid into two five-player
  watches that swap every 35 seconds: the Current Watch sees safe
  channels, hidden casts, and the true heading but not the deck; the Deck
  Watch sees boarders, stations, and the wheel but a fogged route.
  Everyone keeps full combat agency; success is short calls between
  watches ("port after this cast"). The swap cadence means nobody owns
  the caller role and everyone plays both halves.
- The Chorus (the Beckoning, the mind-control beat): a Siren turns her
  song on one or two raiders (long telegraphed cast, interruptible, loud
  personal warning). A Beckoned raider loses input and walks slowly,
  visibly, toward the rail and the sea. Three counters, all
  coordination: interrupt the Siren mid-cast; LASH the Beckoned player
  to the mast or a deck post (an ally channels 2 s on them with rigging
  rope, holding them safely until the verse ends, the Odyssey image as
  counterplay); or let them walk and fish them out of the boarding nets
  below the rail (no death, no fall damage, an 8 second walk back and a
  soaked movement debuff: a positioning tax, never a kill).

The Beckoning is the one NEW sim primitive this raid asks for: a "lured"
state that replaces a player's movement input with a slow server-driven
walk toward a point, breakable by the lash interact, the Siren's death
or interrupt, or expiry. It is agent-completable by construction (the
state, the walk target, and the lash interact are all readable game
state on generous timers). Fallback needing zero engine work: the
Beckoning uses the existing polymorphHex incapacitate (the raider stands
entranced instead of walking), losing the walk-to-the-rail image but
keeping the interrupt/lash play. The walking version is the one that
produces the clip of a guildmate marching overboard while nine people
scream, so this PRD recommends funding the module.

### The open sail (between fights: trash pulls and the rescue beat)
The sail legs carry the raid's trash rhythm, because a raid night needs
pulls between bosses: two to three boarding parties per leg, each a
readable Glasswake squad built from the unit table (a Keelgrip anchor
line, a Lantern Thief cutting purse, a Wreckstitch crew trying to saw
through the rail), coming over the sides with grapnel telegraphs. Classic
pacing: pull, reset, banter, next pull.

One rescue beat also rides the sail: the prison hulk, a
wrecked prisoner transport adrift on the route. Hooking it (one tow
cable, a ground object interact) slows the ship's repairs for a stretch
but frees its captives, who transfer to a trailing rescue boat inside the
instance, cheer during the finale, and feed the full-rescue deed and the gull
pet. No town-side or cross-instance state is created.

(Pass 4, boss-count cut: the Teeth crag wing and the Wake Doubles wing
are CUT, and with them the entire two-route system including the staged
Bells patch. Three bosses is the raid. The hulk rescue survives here.)

### Boss 2: Szethkar the Name-Taker (the boarding)
Szethkar is the Covenant's herald, the one who collects names off stolen
manifests for the crown, and he boards mid-sail with a Keelgrip honor
guard: a proper villain with a ledger, not an abstraction. He opens the
mutiny with his demand, "WHO COMMANDS YOU?", and each raider answers in
/say with one
of the ten crew names (clickable options in the UI, exposed in structured
state for agents). The majority pick becomes Captain for the phase: all
enormous boss threat plus a defensive mantle, nine defenders. The name is then
struck and cannot repeat, so three rounds elect three different captains.
The Captain's mantle is existing aura machinery only: enormous boss threat
plus a defensive buff for the phase (pass 3: the bespoke command-ability
kit is cut; the social moment is the election, not new buttons). Every
clear produces a different transcript; agents nominate humans, humans put
an agent in command, friends betray each other. Ties and silence resolve
deterministically, so it cannot deadlock.

### Boss 3, the finale: The Island Answers
Boss: Sereva, Crown of the Glasswake. She rises across the strait on the
return leg, coils around the raid's own ship in sight of the Landing, and
begins dragging it toward the largest break.

- The island answers: Coalfast, Tam, Edda, and Bram launch four named
  boats, scripted NPC allies inside the instance (spawned set pieces, the
  same machinery as any add wave, dressed as boats). They intercept adds
  and carry signals; they never provide required damage. (Cut at pass 2:
  the previous-crew ghost ship and open-world responder skiffs, which
  assumed a single crew and cross-instance plumbing.)
- The ship is the weapon: Sereva cycles 12-second orders (HOLD COURSE, CUT
  THE COIL, OPEN THE LENS) against ten fixed deck posts, fully exposed in
  game state. Failure damages a known ship section, never a reflex-kill.
- The voyage pays off, lightly: the rescued hulk captives cheer from a
  trailing boat. Cosmetic ship scars only; nothing mechanical carries
  forward (pass 4: the trophy moves died with the route wings).
- The shot: at 10 percent her rift-glass crown catches the light of the
  break beneath her and fires it skyward; the crown shatters into a
  colored aurora across the INSTANCE sky as the NPC boats spiral around
  the Tenfold Sail. The frame contains this crew, their sail, the rescued
  captives when that optional beat was completed, and the town's named boats.
  None of it leaks outside the instance.

**Future flourish:** A first-server-clear plaque would be realm-global persisted
state, which conflicts with the raid's no-cross-instance-state rail. It needs its
own persistence design, including a `server/` surface and serialize/load coverage,
before it can be scheduled.

## Loot direction (sketch)

Glasswake theme: rift-glass and wrecked-fittings gear, one weapon per armor
class off Sereva, and a gull shoulder pet for full-rescue hulk runs.
Numbers follow the existing level-20 stat budget rules; no numbers are
proposed here. Naming direction, because loot is half the fantasy: items
read like salvage with a history, in the classic register. Examples
(names only, all original, final list at implementation): Vessarine's
Hushing Choker, Manifest of Stolen Names, Szethkar's Ledger-Blade,
Coilwarped Breastplate, Sereva's Shattered Facet, Gullhaven Deckhand's
Mitts.

## Character and voice (the classic-raid dressing)

All of it rides the existing yell machinery and the sim_i18n matcher,
zero new systems, priced into the i18n scope:

- Every boss gets an RP pull line, two mid-fight yells keyed to their
  signature mechanic (Vessarine sings names before each Chorus; Szethkar
  reads the elected Captain's name off his ledger, aloud, which is the
  transcript moment), a kill quote, and a raid-wipe quote.
- A named deckhand, Bosun Hetta Vail, crews the ship as the raid's warm
  voice: she reads the manifest at launch, calls the hulk sighting, and
  gets the last line sailing home. NPC record in the content module.
- The town boats in the finale each get one bark on arrival (Coalfast,
  Tam, Edda, Bram), so the cavalry moment has voices, not just hulls.

## Heroic mode (required at launch)

Heroic rides the existing machinery end to end, nothing bespoke: the
heroic difficulty flag on the instance (the dungeon_difficulty pattern),
tuned-up boss stats per the standing heroic multipliers, and loot through
the heroic RAID variant tier (heroic_variants.ts: scaled primary rating
plus a complementary secondary, the Nythraxis heroic precedent). Exact
ilvls fall out of the tier-position decision (open question below). No
heroic-only mechanics in v1: heroic is numbers and loot, per the shipped
convention.

## Explicit non-goals

- No new action-combat verbs; everything is tab-target, GCD, threat, mana.
- No cross-instance or single-crew systems of any kind: nothing in the
  zone reflects a run in progress, and no instance reads another run's
  state. Many groups raid concurrently; the design never assumes "the"
  crew.
- No chat free-text parsing: every chat-integrated mechanic offers a finite
  clickable and machine-readable answer set.
- No WoW-derived names anywhere in the faction, bosses, or abilities.
- No changes to the Farshore's existing 3 to 7 leveling content in the raid
  build; the rift-siege quests stay exactly as authored. The separately
  approved low-tide extension owns any later zone changes.

## Rollout

Per the contribution process: this is a large content feature, so the gate
order is (1) a conversation with Levy on the reduced raid core, (2)
implementation behind the Farshore dependency, (3) a PBE round for community
testing, (4) raid release, and only then (5) a separate decision on the
low-tide extension. i18n scope is large (faction, three bosses, ability names, bell
quest prose) and follows the standard catalog plus overlay
workflow, budgeted as its own task.

## File plan (build reference)

Files ADDED:
- `src/sim/content/farshore_voyage.ts`: the raid's DungeonDef-style instance
  records (ONE lockout id on `meta.raidLockouts`, pass 3: per-wing lockouts
  collapsed; heroic difficulty flag per the dungeon_difficulty pattern),
  the three boss MobTemplates, ground objects (deck posts, the hulk
  cable), items (normal plus heroic variant tier), and the on-ramp quest
  (temple.ts precedent).
- Sim modules behind the SimContext seam, each with its own test file:
  `src/sim/voyage_ship.ts` (ship state, trophies; sail panels derive
  client-side from party composition, zero sim cost),
  `src/sim/voyage_watches.ts` (Vessarine watch split, aura-keyed; server-side
  interest scoping honors the watch flags without putting viewer-specific fields
  in shared cached payloads, so the fogged route never ships in the snapshot),
  `src/sim/beckoning.ts` (the lured walk
  state, the one NEW primitive), `src/sim/voyage_vote.ts` (Name-Taker
  election). The later low-tide extension owns `src/sim/lowtide_assault.ts`
  only if separately approved. (Pass 2/3 cuts: bell_relay.ts, wake_doubles.ts
  recorder, wreck_train.ts; pass 4 cut the Teeth and Wake Doubles wings
  outright; the hulk rescue is a ground object plus a flag.)
- `src/render/voyage_ship.ts` (ship, sail compositing, flotilla) and
  `src/render/voyage_fx.ts` (aurora finale), called by the renderer, never
  method banks on `renderer.ts`.
- `public/audio/music/` tracks (sail theme plus one per boss);
  `public/models/` ship/naga GLBs via the `image-to-glb` skill
  (`.claude/skills/image-to-glb/SKILL.md`) plus
  `docs/image-to-glb-asset-workflow.md`. Icons and non-GLB kit elements are
  plain authoring work with no named skill.
- Tests: `tests/farshore_voyage.test.ts` per module, one `tests/parity`
  scenario + golden per boss.

Files MODIFIED:
- `src/sim/data.ts` (merge the new defs), `src/sim/content/deeds.ts`
  (append rows), `src/sim/sim.ts` (tick calls for the new modules, thin),
  `server/game.ts` (SIM_LAP_PHASES pins for each per-tick module).
- `src/world_api/` facet(s) for sail/vote read state, implemented in
  BOTH `Sim` and `src/net/online.ts` (ClientWorld), pins updated in
  `tests/world_api_parity.test.ts`.
- `src/ui/sim_i18n.ts` (matcher dicts, AURA_NAME_KEY, yells),
  `src/ui/i18n.catalog/items.ts` for English item names, five non-Latin
  overlays for M16 quest prose, regenerated
  `src/ui/i18n.resolved.generated/*`.
- `src/game/instance_music.ts` + `src/game/music_tracks.ts`,
  `src/ui/icons.ts` (ITEM_IMAGE_IDS), `public/ui/items/mapping.json`,
  `CREDITS.md`, `tests/deeds_content.test.ts` pins,
  `tests/dungeon_entry_clearance.test.ts` coverage, guide regen
  (`npm run wiki:content` + `guide.*` keys).

## Open questions for Levy

1. Visual monotony lever: keep all three fights on the open deck, or move
   Boss 2 below decks into the hold (one extra small interior on the same
   ship)? Deck-only is cheaper; the hold buys variety.
2. The Beckoning mind control: fund the "lured" walk module (recommended,
   it is the raid's most clippable moment and the faction's identity
   verb), or ship the polymorphHex entrance fallback? Related taste
   call: is losing movement control for up to ~8 seconds acceptable
   player feel for this game, given every counter is in the raid's
   hands? (Players are never Beckoned in the open world; only the raid
   instance and only with the lash counter available.)

## Post-raid extension question for Levy

If the raid ships cleanly, decide whether the low-tide Ferrywalk assault is
worth a separate contribution. If approved, keep it at zone level 3 to 7 and
give it event-local aid choices; do not add raid-run persistence to fund it.
