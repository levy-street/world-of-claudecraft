# The Undermount Descent: four-wing raid PRD (Volzharr finale)

Status: DRAFT, design partner pass 4 (2026-07-08). Numbers marked (tuning) are
proposals; everything else is derived from code and should be treated as locked
by the engine's formulas. Acceptance criteria and the staged PR plan are at
the bottom; the paper timeline audit lives in the wing 4 section.

## One-line pitch

A 10-player, four-wing raid released in parts under Thornpeak Heights: the
raid descends through the Wyrmcult's summoning ritual, sabotaging it stage by
stage, and reaches Volzharr, the Buried Furnace, a primordial fire god they
must kill HALF-FORMED because their own sabotage rushed the summoning. No
trash mobs anywhere: every pull is a boss or a story beat. Each
wing owns one verb no other encounter in the game uses: balance (wing 1),
heal (wing 2), sort (wing 3), survive the geography (wing 4).

## Release structure: wings

Wings ship in parts, each on its own patch/unseal date:

- Each wing is its own `DUNGEON_DEFS` entry with its OWN daily lockout id
  (same `meta.raidLockouts` machinery, realm-local 3 AM reset), so farm wings
  stay farmable while the raid progresses the newest one.
- Wings connect by sealed doors using the existing Sealed Royal Door
  machinery (the Abandoned Crypt -> Nythraxis arena pattern). Killing a
  wing's boss unseals the next wing's door for the account. That is the
  entire gate: no attunement quest, no key item, no rep. Min level 20.
- The narrator NPC (below) is the face of each unseal.

## Runeseeker Maerin: the narrator NPC

The Aldric pattern (a dynamically spawned friendly NPC the encounter module
owns) carries the whole raid's story. Runeseeker Maerin is a scholar who
follows the raid down, and her arc is the AUDIENCE realizing the front is a
front (the Hank-Schrader slow burn): she arrives thinking the raid is
raiding a cult forge and figures out, one wing at a time, that the forge
was never the point. After each wing boss dies she enters, delivers 2 to 3
yell lines over the corpse, and channels the next sealed door
(Aldric-wardstone style). Her four beats track the reveal:

- After wing 1: puzzled. "This craftsmanship... a whole guild's work, for
  a cult of arsonists? Something down here is worth hiding behind all
  this." (She reads the workshop as too elaborate for what it claims to
  be.)
- After wing 2: suspicious. The quench-hall runes aren't tempering marks,
  they are a cooling system for something that must not be allowed to fully
  ignite yet. "They are not making anything. They are keeping something
  ASLEEP until they are ready."
- After wing 3: the horror lands. "These are not summoning wards. They are
  RESTRAINTS, and we have been CUTTING them. Every keeper we killed was a
  lock." The raid understands it has been doing the cult's work.
- After wing 4 opens: quiet. "There was never a factory. There was only
  ever him, and a very good disguise. Go."

She is the connective tissue that replaces trash: between bosses the raid
walks WITH her through the works, and her lines re-frame what the last
kill actually did. All her text goes through the sim-emit + `sim_i18n`
matcher contract like Aldric's; she is the only warm human voice in the
raid, and the reveal is carried entirely by her, so no cutscene tech is
needed.

Design rule, stated because the codebase is public: there are no secrets in
an open-source game, so nothing here relies on discovery. Prestige comes
from difficulty and visible cosmetics, never from hidden knowledge.

### Pre-quest: meeting Maerin at the dig (surface, OPTIONAL, ungated)

You meet Maerin before the raid, on the surface, through a short quest
chain at the Undermount dig-site in Thornpeak Heights. She is a
runeseeker, an itinerant archaeologist who came to catalog what she was
told was an abandoned cult forge and found it very much not abandoned, and
running far hotter than any forge should. She is the outside investigator
who smells the front: the player's on-ramp into the front/superlab mystery
BEFORE the raid confirms it.

HARD RULE (honors the no-attunement non-goal): this chain does NOT gate
the raid. Anyone level 20 with a raid walks through the door regardless.
Maerin still spawns and guides for everyone. The quest is a lore on-ramp
plus a small reward, never a lock. If a player skips it, the raid still
plays; they just meet Maerin cold at the first door.

The chain (standard `zone3.ts` quest content: giver + kill/collect/
interact objectives, XP/copper reward, one flavor trinket; quest prose is
cheap i18n, non-Latin sparse-overlay only, unlike the item names):

1. "The Heat That Shouldn't Be" (Maerin, giver): take three rune rubbings
   from marked stones around the surface works (`interact` objects). Her
   read: the marks aren't a smith's workmarks, and the stone is warm to
   the touch a hundred feet from any fire. Establishes the wrongness.
2. "What the Cult Buried" (Maerin): recover a cult ledger by killing the
   Wyrmcult foreman and guards at the dig (a `kill` objective on the
   escalating surface camp, so this REUSES the pre-launch world-event
   mobs, one piece of surface content doing two jobs). The ledger reveals
   the forge's output does not leave the mountain: it is all being spent
   DOWNWARD, on something below.
3. "Into the Undermount" (Maerin): she resolves to go down with you.
   Turn-in is the handshake that makes her your raid guide; reward is XP,
   copper, and a cosmetic "Runeseeker's Lantern" off-hand/held flair (a
   reason to run it beyond lore, still not power). This is the seam where
   her four-beat in-raid arc begins.

Integration notes: the seeded mystery (heat that is cover, output spent
downward) is the player-side setup that Maerin's wing-by-wing reveal pays
off, so plant here, pay off in the raid. Guide/wiki gets the spoiler-safe
surface facts only (Maerin exists, the dig is a POI); the raid reveal and
Volzharr stay out of the guide.

## Why this raid

- Closes the zone's open thread. `zone3.ts` opens with "waking elementals",
  the Wyrmcult mobs "hoard their master's flame", and Thunzharr, the Waking
  Peak is already the storm half of the mountain. Volzharr is the fire half:
  the sibling the cult found first.
- Completes tier 2. The four t2 families (crownforged, nighttalon, soulflame,
  stormcallers) have helm + shoulders (Nythraxis) and gloves + belt
  (Thunzharr). Legs and chest are the two missing slots and the two largest
  slot budgets: legs drop from wing 3, chests from Volzharr, so the RAID is
  the set-completer, wing by wing, which is the reason to progress it.
- Cheap where it counts. Half the kit is data-only `MobTemplate`
  composition; the scripted half (one encounter module in the pattern
  `encounters/nythraxis.ts` established) leans on physics the engine
  already has: vertical velocity + the fall-damage model, the
  collider-swept knockback walker, `lineOfSightClear`, and the ground-AoE
  tick. The fight's physics identity is mostly arrangement, not new engine.

## Non-goals (V1)

- No trash mobs, anywhere, in any wing. This is a hard rule, not a budget
  cut: filler packs are the least-loved minute of every raid ever shipped.
- No submerge / untargetable phase on Volzharr. One continuous phase + ramp.
- No attunement, key, or quest gate. Wing doors unseal on the prior kill.
- No new AoE geometry (no cones). Everything radial, matching the engine.
- No disenchant / currency sink changes. Loot is direct drops plus copper.
- No hidden/secret content (open source; see the design rule above).

## Identity and lore

The governing idea, in one line: THE FORGE IS A FRONT. The Wyrmcult's
Undermount works read, from the surface, as an honest (if heretical)
industrial operation, kilns, glassblowers, a master smith, a legitimate
reason for a mountain to run this hot. That is the cover. The heat, the
craft, the whole workshop exist to do one thing nobody is meant to see:
crack the seal on a god. Breaking Bad's chicken shop over the superlab.
The deeper the raid descends, the more the craft falls away and the truth
underneath gets worse, until wing 4 is just the operation with the cover
stripped off: no tools, no artisans, only the god the forge was always
for.

Volzharr, the Buried Furnace. A primordial fire elemental sealed under
Thornpeak in the same cataclysm that put Thunzharr to sleep. The Wyrmcult has
been feeding him relic flame (their "master's flame" hoard) to crack the seal.
The raid interrupts the waking: he is fought half-emerged from the mountain's
magma heart, enraged and not yet at full power, which is the lore cover for why
ten adventurers can kill a primordial.

The reveal is structural, not a cutscene: each wing looks like part of a
workshop (a kiln room, a quenching hall, a tempering floor) and each is
secretly a stage of the summoning, which is why killing its keeper RUSHES
the ritual instead of stopping it. The raid thinks it is dismantling a
factory. It is pulling the pin.

Naming rule: nothing borrowed from WoW spells, bosses, or items (ip_scrub).
"Volzharr" deliberately rhymes with Thunzharr to read as siblings. All mechanic
names below are original.

## The lair (shared physical space)

- Four `DUNGEON_DEFS` entries (`undermount_wing1` .. `undermount_wing4`),
  each following the `nythraxis_boss_arena` shape: one arena interior in
  `dungeon_layout.ts`, a boss (or event), a sealed door onward, no crawl.
  Wings 1 to 3 are single chambers on the descent; wing 4 is the magma
  heart described below.
- Surface entrance: the Wyrmcult territory of Thornpeak Heights (zone3), a
  fissure dig-site. Exact `doorPos` picked at implementation next to the
  existing Wyrmcult camps.
- Each wing anchors its own instance graveyard (the existing dungeon/raid
  graveyard machinery), so any death is a spirit run back from the wing
  entrance: the punishment is the walk of shame, never a full re-clear.

## Wing 1, The Descent: the Kiln-Keepers (duo; verb: BALANCE)

(Two earlier drafts died here: a threat-steering boss, CUT for
implementation risk, and a corpse-explosion demolition, CUT as a direct
Garr copy. Wing 1 ships first, so it gets the safest boss that is still
genuinely fun.)

One kiln, two keepers: Vosh the Glazier shapes what goes in it, Saan the
Stoker keeps it hot. The chamber is decorated with GLASS STATUES of the
last adventurers who came down here (static layout props: free
environmental storytelling and the raid's first "oh no" moment). The
encounter is a kill-them-together duo (the Twin Emperors VERB, none of its
parts):

- **Vosh the Glazier** (melee): Vitrifying Touch stacks a Glazing debuff
  on his current tank (stacking slow + fire vulnerability): let it run and
  your tank visibly hardens toward statue-hood, so taunt-swaps are
  self-evidently necessary, readable by the whole raid. His strikes also
  carry Cinder-Toad (`polymorphHex` on-hit): occasionally the tank simply
  becomes a waddling cinder-toad for a few seconds and the offtank must
  emergency-taunt. Plus `cleave`. The toad is the wing 1 clip.
- **Saan the Stoker** (ranged caster): fire `aoePulse` as the raid hum,
  and the duo link: she channels ANNEAL on Vosh (`mendAlly`), a big
  interruptible heal, so while she lives Vosh effectively does not die.
  Kick discipline (`silence`-school counterplay) is the casters' job.
- **The duo rule, data-only:** both carry `packFrenzy`. Stagger the kills
  and the survivor frenzies: tuned so a ~20 s kill gap is a wipe for a
  wing-1-geared raid and ~10 s is survivable (tuning). Tank them apart
  (Anneal has a range, tuning), balance the damage, kill in step.
- **Optional module twist (cuttable, the one scripted hook):** if the
  frenzied survivor lives 25 s past their partner's death, they drag the
  corpse into the kiln and RE-FIRE it at 40% HP (`delayedEvents` + the
  respawn machinery). A resurrection mechanic told as a joke: they
  literally put the boss back in the oven.
- Machinery: the CORE is fully data-only (`packFrenzy`, `mendAlly`,
  `polymorphHex`, `terrify` on Saan as texture, `aoePulse`, `cleave`);
  wing 1 still carries zero required scripting, and the raid's onboarding
  fight stays the codebase's onboarding fight.
- Wing 1 lessons that wing 4 grades later: watching debuff state, kill
  discipline across two targets, and taunt reflexes.

## Wing transitions (no gauntlets, by design)

Between wings the raid simply walks the cult's abandoned dig with Maerin,
whose dialogue beats are the transition content. An earlier draft had a
lava-bridge gauntlet here (the Slag Run); it was CUT deliberately: a pure
human-reflex nerve check is unplayable for AI agents, and this game's
posture is that agents are first-class players (the RL env and the
agent-realm plans both depend on raid content staying agent-completable).
Standing rule for this raid: every challenge must be winnable by reading
game state and acting on it, never by human reaction time alone. The
telegraphs elsewhere in this doc (3.0 s Eruption, wave-telegraphed Vent
Surge, vent rings) all clear that bar.

## Wing 2, The Quenching: the Forge-Heart (verb: HEAL)

The cult force-feeds the half-formed god through a molten Forge-Heart. The
raid cannot damage it; HEALERS win the fight by channeling cooling into it
(its "HP bar" is a quench meter the module owns) while cult ritualists burn
it hotter and send pressure at the healers. DPS exist to peel ritualists off
and to soak; the kill credit belongs to the healers, on purpose: twenty
years of raiding elsewhere and healers still barely have a fight that is
THEIRS.

- Machinery: `applyHeal` already heals arbitrary entities; the Forge-Heart
  is a friendly entity on the Aldric dynamic-spawn pattern whose received
  healing the module converts into meter progress. Ritualist waves are
  timed spawns with existing affix kits (`manaBurn`, `tongues`,
  `mendAlly` on each other).
- Failure mode: the meter regresses while ritualists live, so the fight is
  a tug-of-war, not a patience check.
- This is the wing where healer throughput gear (the t2 caster pieces from
  wing drops) visibly matters, a deliberate loot-to-mechanic echo.

## Wing 3, The Tempering: Odrenn the Temperer (verb: SORT)

(An earlier draft had a hot-potato brand herald here; CUT as too close to
a Molten Core mechanic in a raid that already ends in a fire god.)

Tempering metal is alternating heat and quench, and Odrenn, the cult's
master smith, tempers RAIDERS. Two interlocking systems, one lesson:
where you stand relative to your own raid is the whole fight.

- **Temper marks (the sort).** The module marks every raider SCORCHED or
  CHILLED (deterministic rng). Same-mark players within ~12 yd empower
  each other (a stacking damage buff: the raid's throughput comes from
  good grouping); mixed marks within that range burn each other with
  steady, readable fire damage (never bursty: you always have time to
  read the state and move). Every ~30 s (tuning) a subset of marks FLIPS
  and the raid re-sorts on comms as one organism. The chant writes
  itself: "flip check, SORT."
- **Cinder Arc (the spread).** On a ~20 s cadence, an arc fires at a
  random raider and CHAINS to any player within ~8 yd of the last target,
  growing per jump. Together with the marks this is the actual puzzle:
  same marks must group for the buff but stay ~9 to 11 yd apart so the
  arc cannot chain, a loose LATTICE, grouped but never bunched. Sorting
  tells you WHO to stand near; the arc tells you HOW near. A raid that
  masters the lattice visibly melts him; a raid that clumps feeds a
  seven-jump arc and the clip goes up that night.
- **Forge meter (soft enrage):** mixed-mark contact and long arc chains
  feed Odrenn's forge; a full forge is a raid-wide detonation (tuning).
  Sloppy sorting is the enrage timer, so discipline IS throughput twice.
- Machinery: one module (mark assignment + flip scheduler, a proximity
  pass on the existing 2D player grid, two mark auras, the arc chain
  walk, the meter). Kit texture data-only (`cleave`, modest fire
  `aoePulse`). Everything is state-readable: marks are auras, the arc
  target is telegraphed, flips are announced: clears the
  agent-completability bar.
- Story beat unchanged: killing Odrenn does not stop the ritual, it
  RUSHES it: the vessel he was tempering for the god shatters early (his
  death line says so), which is the canonical reason wing 4's god is
  half-formed. The raid caused the finale.
- (The stacked-vs-spread stance mechanic from the cut herald joins
  chained-pairs in the reserve bin.)

## Wing 4 lead-in

Maerin unseals the last door over Odrenn's corpse, the mountain shakes
(zone-wide `spellfx` beat), and the raid descends the final dig into the
magma heart. Everything from here down is the Volzharr encounter as
previously designed; it is unchanged by the wing restructure except that it
is now the payoff of three wings of causality instead of a walk-in.

## Pre-launch world event: The Mountain Stirs

In the 1 to 2 weeks before wing 1 opens, the Wyrmcult surface camps in
Thornpeak Heights escalate on a server-side schedule: bigger packs, 2 to 3
named rare minibosses at the dig site (normal world loot + one cosmetic),
new barks about the digging, and periodic ground tremors near the fissure
(a zone-wide fx event, cosmetic only). The day the raid opens, the tremor
becomes the door unsealing. Cheap server-side content staging with an
enormous hype-to-effort ratio: the raid becomes a world fact, not a patch
note. (Lineage: the war-effort/gate-opening events, reshaped; nothing is a
copy.) These same escalating camps are the kill target for Maerin's
pre-quest chain (see Pre-quest above): one surface build serves both the
hype event and the quest on-ramp.

## Wing 4, The Waking: Volzharr encounter design

Boss: level 22, `boss: true`, `elite: true`, `ccImmune: true`, 10-player.
One continuous phase; difficulty ramps through Waking Fury and floor loss.

### The magma heart (wing 4 arena)

- Arena: a single circular magma chamber, floor diameter about 70 yd
  (Nythraxis arena scale), with a raised rock rim the lava vents never spawn
  on (see Vent Fissures: the rim is the shrinking-floor pressure valve, not a
  safe AFK spot, because Molten Ejecta still hits it).
- Stalagmite pillars: 5 to 7 STATIC pillar colliders scattered across the
  floor, part of the `dungeon_layout.ts` interior like any wall. They matter
  three ways: `applyKnockback` is collider-swept, so a pillar at your back
  stops a Furnace Slam punt; the Undermount Eruption is line-of-sight checked
  (`lineOfSightClear`), so pillars cast survivable shadows; and they anchor
  the per-pull floor geography as vents open around them. Pillars are
  indestructible in V1 (crumbling cover needs dynamic colliders, a real
  engine change; see Open questions).
- Raid gate: reuse the Nythraxis raid-gate machinery in
  `instances/dungeons.ts` (10-player raid required to open the boss door,
  `RAID_MIN_PLAYERS = 10`).

### Kit part 1: data-only MobTemplate primitives

| Mechanic | Primitive | Behavior | Tuning |
|---|---|---|---|
| Molten Ejecta | `aoePulse`, fire school | Raid-wide splash every few seconds, the healer throughput check; hits the rim too | min 22, max 30, radius 40, every 8 (tuning) |
| Searing Grip | `smolder` on-hit | Stacking fire DoT on melee attackers, the cost of uptime; also the payoff stat check for Forgeheat's fire sensitivity | existing smolder shape (tuning) |
| Tremor | `stomp` | Radial stun pulse; fired on a cadence that lands shortly before an Eruption telegraph, so the raid learns to pre-position behind cover instead of reacting | radius 10, every ~40 s, 1.5 s stun (tuning) |
| Final Fury | `enrage` | Burn-window finisher on a shrinking floor (Waking Fury is the ramp; this is the cliff) | belowHpPct 0.15, dmgMult 1.4, hasteMult 1.25 (tuning) |
| Yells | `yells` | engage / enrage barks, plus death line (see i18n). Volzharr is laconic: 3 to 4 short seismic lines total, so each lands | copy below |

Dormant Cinderlings (data-only adds, replacing HP-threshold summons): 8 to
10 small magma elementals, half-sunk in the rock floor, low HP and low
damage, `aggroRadius` 3 to 4, scattered per pull at deterministic-rng
positions weighted near future vent corridors. Stray close (or get punted
onto one) and it RISES FROM THE GROUND and attacks: proximity IS the wake
mechanic, straight from `aggroRadius` semantics, with the emerge moment
sold by the render layer (a molten hump in the floor until triggered). The
shrinking floor herds the raid across the dormant clusters, so positioning
discipline tightens as the fight goes on. No `summonAdds` field on the
boss.

### Kit part 2: the scripted systems (`encounters/volzharr.ts`)

The module owns one identity: the floor and the physics. Six systems, listed
in build-priority order; each is independently cuttable.

1. **Vent Fissures + geysers.** Every ~25 s (tuning) the module opens a
   permanent Vent Fissure: a persistent ground AoE (`groundAoEs` + the
   `pulseGroundAoE` shared entry point) at a deterministic-rng position,
   weighted to carve corridors and islands rather than uniform noise (no two
   pulls share a floor). VENT BAITING: every third vent (ratio tuning,
   playtest) opens under a random RANGED player's feet instead of at a
   weighted spot, so the raid partially authors the geography: stack ranged
   where you can afford to lose floor, keep them off the pillar lanes you
   are saving for Eruption cover. Floor placement becomes a raid-leadership
   skill instead of pure rng. A vent pulses ~15 fire/s (tuning) to anyone in it
   and never closes: the floor only shrinks, which is the true enrage timer.
   Entering an open vent also triggers its GEYSER: an upward launch (set
   `vy`; the existing gravity + fall-damage model does the rest,
   `FALL_SAFE_DISTANCE` 12 yd). Launch height tuned so an unmitigated
   landing costs about half a raider's HP: below half, the fall kills you,
   and the kill is emergent from the standing fall-damage model, not a
   scripted execute. Deliberate geyser rides above half HP are legal
   transport across a lava-cut floor; that is a feature, not an exploit.
2. **Furnace Slam (distance-scaled AoE knockback).** Replaces the flat
   `knockback` field. On a ~20 s cadence (tuning) the module slams everyone
   in the arena away from the boss via `applyKnockback`, with shove distance
   scaled INVERSELY by range: melee eat a huge punt, ranged barely stumble
   (e.g. 18 yd at melee range tapering to 2 yd at 30+, tuning; knockback
   resistance applies as normal). Counterplay is geometric: keep a
   stalagmite at your back, or eat a flight toward the vent field. Needs a
   `SimContext` exposure for the knockback walker (append-only callback).
3. **Undermount Eruption (LoS-checked `bigCast`).** The signature hardcast
   on a ~45 s cadence (tuning): long telegraph (3.0 s, tuning), then a
   massive arena-wide fire hit (350 to 450, tuning; sized against real
   pools in the paper hand-test below) that `lineOfSightClear` exempts:
   anyone with a pillar between them and Volzharr survives. "Get behind a stalagmite"
   is the fight's screenshot moment. The telegraph gets a low seismic
   WebAudio cue and a bark, the one loud theatrical beat in the fight.
   CADENCE-COLLISION RULE (applies module-wide): the module owns one
   scheduler, and control effects may never overlap a dodge or cover
   window: Tremor is suppressed while a Vent Surge channel or an Eruption
   telegraph is live (it re-fires after), because a stunned player facing a
   detonation they can read but cannot act on violates the
   agent-completability rule this raid is built on. Naive fixed cadences
   (40/45/50 s) WILL collide at their common multiples; the scheduler must
   enforce priority, not hope.
4. **Forgeheat (the risk-reward loop, LOCKED design).** Standing within
   ~5 yd of an open vent (not in it) stacks Forgeheat: each stack grants
   bonus damage dealt and haste, and increases fire damage TAKEN (Molten
   Ejecta, Searing Grip, vent pulses, Eruption all scale it). Stacks build
   on the vent tick while in the ring, decay a few seconds after leaving
   (numbers tuning; opener: +4% damage, +4% haste, +20% fire taken per
   stack, cap 5, so a 5-stack greeder takes DOUBLE fire damage). Composes
   from existing aura effects applied by the module; no new primitive. This
   is the nameable skill-expression decision: "are you greeding vents?" The
   20% fire-taken knob is deliberately harsh because Waking Fury (below)
   multiplies against it as the fight ages: early greed is cheap, late
   greed is a coin flip.
5. **Waking Fury (time-based soft enrage).** Volzharr is WAKING UP: every
   30 s (tuning) he gains a permanent, non-decaying stack of +5% fire
   damage dealt (tuning). Every fire source scales: Molten Ejecta, vent
   pulses, Eruption, Vent Surge. Together with vent saturation this gives
   the fight two independent clocks (floor space and incoming damage), and
   it squeezes Forgeheat greed hardest exactly when the raid most wants the
   throughput. The HP-threshold Final Fury stays as the finisher on top.
6. **Vent Surge (channeled eruption barrage, the dodge dance).** On a
   ~50 s cadence (tuning), Volzharr roots and CHANNELS for 6 s: in waves
   (every 1.5 s), short-fuse eruption circles telegraph and detonate under
   the current positions of random raiders, while every OPEN VENT flares
   and detonates in sequence. The raid weaves between marks across the
   scarred floor they built that pull, so the per-pull geography pays off
   as a unique dodge pattern every attempt. Distinct counterplay from the
   big Eruption on purpose: Undermount Eruption = hide behind cover, Vent
   Surge = keep moving, cover does not help. Implementation: module-spawned
   short-lived ground AoEs with a delayed first pulse (verify the ground-AoE
   record supports a fuse before first pulse; if not, that is a small
   additive field on the shared record, not a new system).
7. **The Floor Breathes (Final Fury finale). PLAYTEST-GATED: build last,
   ship only if the execute phase feels flat without it.** When Final Fury
   triggers at 15%, every open vent geysers on a shared 8 s pulse (tuning):
   the endgame becomes a rhythm of burn, launch wave, reposition, burn.
   Geysers here are TRANSPORT, not a dodge: ground AoE hit checks are 2D
   (x/z), so being airborne gives no immunity to anything; the value of a
   deliberate ride is crossing a saturated floor faster than walking around
   it. Reuses the geyser system wholesale. The gate exists because this
   stacks on Waking Fury + Final Fury + Vent Surge all at once; if the
   combined execute is a fail-cascade in playtest, this is the mechanic
   that goes, not the others.

Shared module rules:

- Every placement and cadence draw goes through `ctx.rng` in tick order
  (determinism invariant; a `tests/parity` scenario is mandatory, and the
  geyser launch must also replay identically, since fall damage is state).
- A physics fact the design leans on, so it goes in the module header
  comment: spatial radius queries and ground-AoE hit checks are 2D (x/z
  squared distance, `spatial.ts`). Airborne players still take every ground
  pulse under them. No mechanic in this fight may assume height-dodging.
- Wipe/reset: clear all vents, despawn woken Cinderlings, strip Forgeheat,
  mirroring `resetNythraxisEncounter`.
- Explicit non-goals: no phase machine, no dialogue scheduler beyond the
  death line, no interactable objects, no dynamic colliders. If the module
  grows past this list, that is scope creep. Cut order if the budget bites:
  The Floor Breathes first (playtest-gated anyway), then Vent Surge, then
  Waking Fury (vent saturation alone still enrages), then vent baiting
  (fall back to pure weighted placement), then the Slam scaling (fall back
  to the flat `knockback` field). Vents + geysers, Eruption LoS, and
  Forgeheat are the identity; if those do not fit, the boss is not ready to
  build.

### Why this fight shape

Nythraxis: add management, interacts, a transition, target-priority pressure.
Volzharr: positioning, physics, a shrinking arena, and one greed dial
(Forgeheat). A raid that has Nythraxis on farm gets tested on a different
axis, and the five daily lockouts (Nythraxis + four wings) together make a
full, varied raid night.

Memorability levers, named so we protect them in tuning:

- No two pulls share a floor (weighted vent placement = per-pull geography).
- The comedy physics chain: Furnace Slam punt -> vent -> geyser launch ->
  fall death (or landing on a dormant Cinderling cluster and waking it).
  Knockback distance stays generous
  enough that mistakes are funny, not statistical.
- The stacked-in-a-pillar-shadow Eruption survival as the screenshot moment.
- Forgeheat greed as the thing raiders argue about after the kill.
- Veteran tech: knockback resistance is an existing stat and the T1 cloth
  2pc grants it, so old Gravewyrm gear has situational value here. Do not
  patch that out; discovering it is the point.

### Paper timeline and hand-test (design audit, pass 4)

Superimposing the proposed cadences (Slam 20 s, vents 25 s, Waking Fury
30 s, Tremor 40 s, Eruption 45 s, Surge 50 s) over the first three minutes
exposes every overlap in advance:

| t (s) | events | verdict |
|---|---|---|
| 20 | Slam | clean |
| 25 | vent 1 | clean |
| 40 to 45 | Tremor (stun ends 41.5) then Eruption telegraph 42 to 45 | INTENDED combo: pre-position, get stunned, telegraph fires, you are already behind cover |
| 50 | Surge channel + vent 2 opens | RULE: a vent opened mid-Surge does not flare in that Surge |
| 80 | Tremor + Slam | HARMONIC LOCK: Slam (20) divides Tremor (40), so EVERY Tremor lands with a Slam. Punting stunned players is unreadable chaos, not comedy |
| 100 | Slam + Surge channel | punt mid-dodge = unavoidable wave hit |
| 150 | Surge + bait vent | covered by the mid-Surge rule |
| 177 to 180 | Eruption telegraph + Slam at 180 | punted OUT of cover after committing to it |

Resolution, folded into the scheduler rule above: the module's single
scheduler suppresses Slam and Tremor while a Surge channel or Eruption
telegraph is live, and a suppressed effect RE-ANCHORS its next fire from
when it actually fired (drift on purpose), which permanently de-syncs the
harmonic locks after the first suppression. No hand-tuned co-prime
cadences needed.

Damage hand-test against real pools (priest is the floor: `baseHp 38 +
11/level` + `hpFromStamina`, roughly 550 to 650 HP raid-geared at 20;
warriors roughly double):

- Molten Ejecta avg 26 every 8 s is ~4% of the priest pool per pulse:
  correct as a throughput hum, and still sane at Waking Fury minute five
  (+50%: ~6%) for a disciplined raid.
- A 5-stack Forgeheat greeder at minute four takes ~73 per pulse (~12%):
  survivable alone, dead to any overlap. Matches the "late greed is a coin
  flip" intent exactly. No change.
- FINDING: Undermount Eruption at ~90 base is NOT "move or die": it is
  ~15% of a priest pool. Corrected to 350 to 450 (tuning): lethal-adjacent
  for cloth unhidden, a cooldown-forced survival for plate, and worth the
  theater. The LoS exemption is binary, so the raw number can be big.
- ASSUMPTION TO VERIFY at build time: the geyser "landing costs ~half your
  HP" target assumes the fall-damage model scales with max HP. If it is
  flat damage, tune the launch height to half of the SQUISHIEST pool and
  accept that tanks shrug it, or the mechanic silently stops mattering
  for cloth.

### Boss tuning baseline (all tuning, anchored to Nythraxis)

- HP: ~59,000 EFFECTIVE (Nythraxis is 51,239 effective; this is ~1.15x, no
  transition downtime to pad the fight). NOTE the 2.3x elite HP multiplier
  in `entity.ts` applies at spawn, so the template value is
  `hpBase: 59000 / 2.3` with `hpPerLevel: 0`, same pre-compensation idiom
  Nythraxis uses (`51239 / 2.3`). All HP numbers in this doc are effective.
  Forgeheat uptime is expected in the HP budget: a raid that never touches
  vents should feel undertuned on the enrage, a full-greed raid comfortably
  ahead of it.
- Melee: `dmgBase 58`, `dmgPerLevel 11.4`, `attackSpeed 2.6`, tank-checked
  the same as Nythraxis, with the scripted Furnace Slam as the twist (no
  `knockback` field on the template; the slam is the module's).
- Target fight length: 4 to 6 minutes for an ilvl-29-geared raid, with vent
  saturation making ~8 minutes a practical wipe.

## Lockout

Identical machinery to Nythraxis: per-character daily raid lockout
(`meta.raidLockouts`, realm-local 3 AM reset via `raidResetMs`), granted on
kill, one lockout id PER WING so wings are independently farmable and all
independent of Nythraxis. Minimum level 20 to enter. No attunement; wing
doors unseal account-wide on the prior wing's first kill.

## Loot (Gravewyrm Sanctum structure; full plan, names locked here)

Structure, locked (SUPERSEDES the earlier "2 to 3 guaranteed epics"
note): the Sanctum shape at raid quality. Every boss pays copper + ONE
GUARANTEED roll group (sums to 1.0, the reason to kill this boss every
day) + ONE BONUS group (sums to ~0.5 to 0.6, Korzul-style: weapons at 10
to 15%, alternates under that). Volzharr pays TWO guaranteed groups plus
the chase group. So wings 1 to 3 average 1.5 epics per kill and the god
pays 2 plus lottery, and a full clear showers the raid the way a Sanctum
clear does, without any single boss being the only farm target.

Interspersion rules (the "who drops what and why"):
- No slot is owned twice: feet (wing 1), rings (wing 2), legs (wing 3),
  chests (wing 4). Alternates in bonus groups fill the gaps crosswise so
  every wing has at least one item for every archetype.
- The guaranteed group THEMATICALLY matches the boss: the Kiln-Keepers
  drop what walks out of a kiln (feet), the quenching fight drops quenched
  jewelry (rings), the herald's procession drops the marching slot (legs),
  the god drops the heart slot (chest).
- Tank items front-load (wings 1 to 2): progression needs tanks geared
  first. Healer signature sits on wing 2 (they carried it). The meme item
  lives on wing 1 because wing 1 is the fight with the joke.

### Item levels (NORMAL mode: 33 for wings 1 to 3, 35 for Volzharr)

The quoted item levels are NORMAL mode. (Difficulty modes, if added per
the mythic+/forged lineage in `docs/prd/mythic-plus-and-forged.md`, scale
UP from these; this doc only specs normal.)

Item levels fall out of the engine (`boss level + 6 epic + 3 raid`). Wings
1 to 3 bosses are level 24 (ilvl 33); Volzharr is level 26 (ilvl 35). That
is a deliberate TWO-step finale jump (the god is the clear pinnacle), 33
for the first three bosses and 35 for the last, a clean tier over
Nythraxis (29). Boss level above the player cap of 20 is only an ilvl
lever here; nothing reads player level off it.

EXACT primary-stat budgets per `tests/item_level`
(`round(ilvl * qualityMult * slotMult * 0.7)`, epic qualityMult 1.0),
computed against the engine's real floating point. PRIMARY stats only:
str/agi/sta/int/spi. Haste and crit are SECONDARY and off this budget
(see the next subsection):

| Slot | ilvl 33 (wings 1-3) | ilvl 35 (Volzharr) |
|---|---|---|
| chest / mainhand | 23 | 25 |
| legs | 21 | 22 |
| helmet | 20 | 21 |
| shoulder | 17 | 18 |
| waist / gloves | 16 | 17 |
| feet | 15 | 16 |

### Secondary stats: haste and crit RATING (already engine-supported)

CORRECTION (verified against release/v0.24.0; an earlier draft of this
section was written against an older branch and was WRONG): per-item
haste/crit rating is ALREADY wired. This is DATA-ONLY, not an engine
change.

- ENGINE (shipped): `ItemDef` already has `critRating` / `hasteRating`
  fields, and `recalcPlayerStats` already aggregates them off equipped gear
  (`bonusCritRating += item.critRating`, `bonusHasteRating += item.hasteRating`),
  adds set-bonus rating, and converts to a fraction via
  `critFractionFromRating` / `hasteFractionFromRating`. The rating model is
  `HASTE_RATING_PER_PCT = 10` and `CRIT_RATING_PER_PCT = 10` (10 rating =
  1%), so the game already uses RATINGS, not flat percents, and
  `item_sets.ts` already grants them. Authoring secondaries on this raid's
  loot is just setting `critRating`/`hasteRating` on the item records. PR A
  needs NO `recalcPlayerStats` change (this supersedes the old claim that
  it did).
- BUDGET GAP (still real): `tests/item_level` only sums PRIMARY_STATS
  (str/agi/sta/int/spi), so `critRating`/`hasteRating` are invisible to it,
  i.e. "free power" with no guard. Existing gear authors rating by hand with
  no test. Self-imposed convention for this raid: an item carries EITHER a
  full primary budget OR trades a fixed slice for rating (roughly 1 primary
  point buys ~12 rating, i.e. ~1.2%, tuning), never both at full. A small
  `item_level` guard extension would enforce it; recommended but not
  strictly required (the rest of the game ships without it).

Who carries secondaries (the raid's identity, not every piece): weapons
and the off-piece rings/waists lead with them (the "texture" notes below
become REAL itemized haste/crit), and each t2 set piece carries a small
secondary so the tier itself reads as the haste/crit tier. Pure-primary
pieces still exist for the tank/survival slots. The 5pc set crit bonus
still stacks on top; itemized crit and the set crit are additive.

Naming note: a set piece's family is its `set:` tag, NOT its display name
(the crownforged helm displays as "Bonewrought Dreadhelm"), so display
names are free everywhere. All names below are original; run the ip_scrub
pass over the final list anyway before implementation.

Point values in the per-boss tables below are the item's PRIMARY budget;
"+haste"/"+crit" marks the secondary an item trades part of that budget
for, per the convention above.

All wing 1 to 3 point values are ilvl 33 primary budgets; Volzharr is
ilvl 35. "+haste"/"+crit" = the itemized secondary (part of the budget
traded per the convention).

**Wing 1, the Kiln-Keepers** (loot on the LAST keeper to die):
- Guaranteed, "what walks out of the kiln" (epic FEET, one per archetype,
  15 pts, ~25% each): Slag-Tempered Sabatons (plate, str/sta), Glasswalker
  Treads (leather, agi/sta +crit), Twice-Fired Slippers (cloth, int/spi),
  Stokebrand Striders (shaman, int/sta +haste). The first haste/crit
  itemization a fresh raider ever sees.
- Bonus (~0.55): Saan's Stoking Iron (caster staff, 23 pts, +haste, 15%),
  Glassblower's Shiv (agi 1H, 23 pts, +crit, 12%), Cindertoad Signet (tank
  ring: sta/armor + knockback-resist texture, pure-primary, 10%; THE meme
  item, tooltip flavor references the toad). Balance to ~0.55 with two
  uncommon fillers.

**Wing 2, the Forge-Heart** (the quenched-jewelry boss):
- Guaranteed ring trio (~33% each; budgets per the ring `SLOT_STAT_MULT`
  PR #1580 established, confirm before authoring): Ring of the First
  Quench (healer: int/spi + heal-crit; mandatory, the healers carried the
  fight), Coalglow Band (caster dps: int +crit), Band of the Ninth Quench
  (physical: str/agi +haste).
- Bonus (~0.5): Sluicebearer (healer mace, 23 pts, 15%), Quenchsilk Cord
  (cloth waist, 16 pts, +haste, 12%), Slakeleather Belt (leather waist,
  16 pts, +crit, 12%).

**Wing 3, Odrenn the Temperer** (tempered gear: what a master smith
fits to you):
- Guaranteed t2 LEGS (~25% each, 21 pts, family `set:` tags; each carries
  a small secondary so the tier reads as haste/crit): Crownforged
  Warleggings (+crit), Nighttalon Prowlers (+crit), Soulflame Kilt
  (+haste), Stormcaller's Legwraps (+haste).
- Bonus (~0.5): The Even Temper (str 1H mace, 23 pts, +crit, 12%: the meme
  weapon, a smith's hammer named for the thing his fight destroys),
  Cinderarc, Odrenn's Rod (caster mainhand, 23 pts, +haste, 12%: the raid
  gets to LOOT the mechanic that killed them), Twicetempered Girdle (plate
  waist, 16 pts, 12%), Ashwalk Sandals (caster feet, 15 pts, +haste, 12%).

**Wing 4, Volzharr, the Buried Furnace** (ilvl 35, the finale step-up):
- Guaranteed A, t2 CHESTS (~25% each, 25 pts, each +haste or +crit):
  Crownforged Heartplate (+crit), Nighttalon Emberweave (+crit), Soulflame
  Vestments (+haste), Stormcaller's Hauberk (+haste).
- Guaranteed B, ilvl-35 off-pieces (~25% each): Volzharr's Knucklestone
  (ring: str/sta +crit), Magmastrider Greaves (plate feet, 16 pts),
  Footwraps of the Waking Floor (cloth feet, 16 pts, +haste; the name is
  the in-joke for anyone who fought him), Forgeheat Cinch (leather waist,
  17 pts, +haste).
- Chase group: Corebreaker, Heart of the Undermount (2H, 25 pts, +crit AND
  +haste, the flagship secondary piece, 3%) AND The Last Restraint (caster
  staff, 25 pts, +haste, 3%; named for Maerin's rune line, resolving open
  question 4 with two chases: one physical, one caster). Plus the
  ultra-rare Moltenheart chroma skin (`skins.ts`, cosmetic).
- 15g guaranteed, matching Nythraxis.

Loot friction rule: no tokens, no vendor hop, no currency. Direct drops only.

### Set bonus extension: the 5-piece tier

With legs + chest, every t2 family reaches 6 owned slots. Add ONE new bonus
tier at 5 pieces in `item_sets.ts` (leaving 6/6 as pure flex/transmog value,
so the last slot is never mandatory):

- Plate (crownforged): 5pc: +3% crit (tuning).
- Leather (nighttalon): 5pc: +3% crit (tuning).
- Cloth (soulflame / stormcallers): 5pc: +3% spell crit (tuning).

Rationale: 2pc/3pc already grant AP/stats/haste; crit is the one set-bonus
stat axis t2 does not use yet, and it reinforces the raid's new crit
itemization (the two are additive, set crit + item crit). Keep
`SET_HASTE_3PC` untouched. This whole raid is the debut of secondaries as
gear stats: on individual items (new `recalcPlayerStats` support) and in
this 5pc tier at once.

## Feel: the mood board (art, color, sound, music direction)

One feeling governs the whole raid: THE FRONT AND THE SUPERLAB (Breaking
Bad). The top is a chicken shop, a real working forge with real
craftsmen, warm and mundane and faintly funny; the bottom is the meth
lab, the thing it was all cover for, a god. The descent is the camera
tracking from the friendly counter down into the truth. Early wings feel
industrial, inhabited, lit like a business that wants to be seen; by wing
4 the business is gone and only the operation is left. Comedy lives up top
(toads, statues, bickering craftsmen), dread at the bottom: the raid
should FEEL the cover story peel away one floor at a time.

Breaking Bad's other signature is COLOR AS STORY, and this raid uses the
same trick with a single rule: the COVER palette is warm, domestic,
handmade (amber lantern light, glass, brass, workshop clutter); the TRUTH
palette is the raw fire underneath it (incandescent orange on black rock,
no human warmth). Each wing is a fight between the two, and the truth wins
a little more each floor, until wing 4 is truth with no cover left. When
the cover palette drops out of a room, the audience should feel the front
slipping without being told.

Per-wing palette and light (procedural textures + scene lighting):

- Wing 1, the kiln workshop: AMBER + GLASS-GREEN. Warm lantern light,
  glints off the statue gallery, visible tools and half-finished glasswork
  props. The statues are lit like museum pieces: the room is proud of
  them. Mood word: workshop comedy.
- Wing 2, the quenching hall: TEAL + WHITE STEAM against furnace orange.
  The one COOL-toned room in the raid, so the healer wing literally reads
  as relief; steam plumes on the quench meter's progress. Mood word:
  pressure.
- Wing 3, the tempering floor: ALTERNATING EMBER-RED and STEEL-BLUE, and
  this is load-bearing: Scorched/Chilled mark colors ARE the room's art
  direction, so the fight's information design and its look are the same
  thing. Rhythmic light from an unseen forge, like the room has a pulse.
  Mood word: rhythm.
- Wing 4, the magma heart: BLACK ROCK + INCANDESCENT ORANGE, nothing
  else. No props, no craft, no furniture: the workshop is over. Ambient
  light dims subtly as Waking Fury stacks (COSMETIC ONLY: decals and
  actionable info keep full contrast at every tier per the fairness
  invariant). Kill state: vents cool to black glass, the light goes gray,
  silence. Mood word: geology.

Actionable-decal color language (fairness-first, one hue family per
meaning, identical at every fx tier including reduce-motion):

- Vents: saturated red-orange ring, black core. Geyser trigger: white-hot
  inner ring. Forgeheat ring: thin gold band. Vent Surge marks: violet
  (deliberately OUTSIDE the lava palette so "dodge this" never blends
  with cosmetic fire). Scorched/Chilled: ember-orange vs steel-blue aura
  glyphs. Spectacle layers on top of these, never instead.

Sound design (new `sfx_prompts.mjs` entries; the forge ambient loop
already exists as a base layer):

- Wing 1: kiln roar ambient, GLASS STRESS CREAKS keyed to Glazing stacks
  (the tank's peril is audible to the whole raid), a fat wet "brrp" for
  the toad (the sound IS the meme), statue shatter debris.
- Wing 2: pressurized steam hiss keyed to quench-meter progress (the
  healers HEAR their winning), ritualist chant loop that thins as they
  die.
- Wing 3: anvil strikes as the room's heartbeat, a rising electric-crackle
  arpeggio for Cinder Arc where EACH JUMP RAISES THE PITCH (a seven-jump
  disaster is audibly a disaster: information design by ear, cosmetic
  layer only), deep quench *shunk* on mark flips.
- Wing 4: sub-bass mountain groans on a slow random timer, vent pre-open
  rumble, geyser steam-cannon whoosh with doppler on launched players
  (funny by physics), and the Eruption's signature: a 2.5 s seismic riser
  that cuts to HALF A SECOND OF TOTAL SILENCE before the blast. The
  silence is the telegraph's exclamation point and the thing players will
  describe to each other.
- Volzharr's voice (voice pipeline): sub-bass, slow, laconic; his 3 to 4
  lines are half earthquake. Vosh and Saan get bickering-craftsmen
  banter barks (the meme carrier); Odrenn counts hammer blows out loud;
  Maerin is the only warm human voice in the whole raid, on purpose.

Music (`music.ts`: add raid moods to the `MusicMood` union, same
procedural system): the spine is a DESCENT VARIATION SET on the existing
Thornpeak cold anthem: wing 1 plays it warm and workshop-busy (hammered
dulcimer over the forge loop), wing 2 cools it into suspended steam
chords, wing 3 locks it to an anvil ostinato in alternating hot/cold
phrases (the music sorts with the raid), and wing 4 abandons melody
almost entirely: low brass, bowed metal, and the mountain's own groans,
with the battle-theme transposition system dropping it a further step as
Waking Fury climbs. The player should be able to close their eyes and
know how deep they are.

Name quality audit (honest): the keepers are The Last Restraint (best
name in the raid), Corebreaker, The Even Temper, Cindertoad Signet,
Sluicebearer, Footwraps of the Waking Floor, and Volzharr, the Buried
Furnace itself. Two were flat and are hereby renamed: "Tempering Band" ->
**Band of the Ninth Quench** (lore texture: the smith numbers his
quenches), and "Ashsilk Slippers" -> **Twice-Fired Slippers** (kiln term,
reads as a story). "Magmastrider Greaves" and "Coalglow Band" stay plain
on purpose: a loot table needs some workhorse names so the good ones
land.

## Content and pipeline checklist (costs to budget, not optional)

- ~30 new item names (the loot plan is fully enumerated in the Loot
  section: 8 t2 set pieces, ~13 off-pieces, 5 rings, 2 chase weapons, 2
  boss weapons) plus the cosmetic skin: full translation in all locales,
  or the item-name i18n gate fails. This is the single biggest non-code
  cost of the PRD. Wings amortize it: each wing's items translate with
  that wing's release.
- Four boss/encounter names, Runeseeker Maerin, ritualist/miniboss names,
  four wing dungeon names, all yells, Maerin's between-wing dialogue, and
  the world-event barks: id additions to `world_entity_i18n.ts` lists;
  everything sim-emitted needs its `sim_i18n.ts` matcher rows in the same
  change (S3 guard). Maerin is the biggest single dialogue surface since
  Aldric; budget her lines like content, not flavor.
- The pre-quest chain (3 quests + giver + a surface miniboss + the
  Runeseeker's Lantern cosmetic): quest prose is the CHEAP i18n path
  (non-Latin sparse-overlay only, per the quest-translation workflow), a
  deliberate contrast to the ~30 item names. The Lantern is a cosmetic
  held/off-hand, no stats, so it dodges the exact-stat-budget gate.
- Mechanic aura names (Searing Grip, etc.): `sim_i18n` dictionaries +
  `AURA_NAME_KEY`; no test catches a miss here, so it goes on the review
  checklist explicitly.
- New set-bonus text rows: overlay translations per the established process.
- Guide: `npm run wiki:content` regen + `wiki:stills` for the boss model
  (spoiler-safe surface only: the guide must not describe mechanics or loot).
- ENGINE: none required for secondaries. Per-item `critRating`/`hasteRating`
  are already aggregated in `recalcPlayerStats` on release/v0.24.0 (see the
  Secondary stats section). Optional nicety: a `tests/item_level` guard
  extension for the primary+rating on-budget convention, not a blocker.
- Tests: `tests/parity` scenario covering vent + nest + Vent Surge rng draw
  order AND a geyser-launch replay (fall damage is sim state); item budget
  rows land free in `tests/item_level`; encounter unit tests for vent
  accumulation, Forgeheat stack/decay, Waking Fury ramp, Slam distance
  scaling, Eruption LoS exemption, Vent Surge wave timing, and full reset,
  in the `nythraxis_*.test.ts` style.

## Acceptance criteria (per wing; "done" is observable, not "looks done")

Wing 1, the Kiln-Keepers:
- A 10-player raid can enter `undermount_wing1`, and the raid gate refuses
  fewer than `RAID_MIN_PLAYERS`.
- Killing one keeper frenzies the survivor (`packFrenzy`); a staggered
  kill ~20 s apart wipes a wing-1-geared raid, ~10 s apart is survivable
  (open question 9's tuning).
- Saan's Anneal heals Vosh, is interruptible, and stops at its tether
  range when they are tanked apart; Vosh's Glazing stacks and Cinder-Toad
  (`polymorphHex`) both force observable taunt swaps.
- Loot and the kill path fire on the LAST keeper to die regardless of kill
  order; a wipe (or one keeper resetting) resets BOTH cleanly.
- Kill grants the wing 1 lockout, spawns Maerin, her lines fire in order,
  and the wing 2 door unseals account-wide.
- Zero REQUIRED encounter-module code: the core is data + layout only (the
  re-kiln twist, if built, is the only scripted hook and is cuttable).

Wing 2, the Forge-Heart:
- The quench meter only advances from player healing on the Forge-Heart
  entity, regresses while any ritualist lives, and its win fires the kill
  path (loot, lockout, Maerin) without any entity dying to damage.
- Healing thrown at the Forge-Heart generates no threat-wipe anomalies and
  respects the effective-healing definition (open question 8).
- An agent reading only game state (meter value, ritualist spawns) can
  sequence the fight: no hidden timers.

Wing 3, Odrenn the Temperer:
- Every raider carries exactly one mark aura (Scorched or Chilled) at all
  times; mark assignment and every flip are deterministic under parity.
- The proximity pass empowers same-mark pairs and burns mixed pairs at the
  SAME radius (~12 yd), evaluated on the existing player grid, with
  hysteresis at the boundary so edge-dancing cannot flap state per tick.
- Cinder Arc chains only across gaps under ~8 yd, grows per jump, and its
  full chain is reconstructable from the combat log (each jump is an
  event), so lattice failures are debuggable by the raid.
- Mixed-mark contact and arc jumps feed the forge meter; a full meter
  fires the detonation exactly once and the meter is visible game state.
- His death line fires, Maerin's wing 4 unseal plays, and the t2 legs roll
  group drops every kill.

Wing 4, Volzharr:
- All acceptance points implied by the scripted-systems list, plus: the
  scheduler suppression rules are unit-tested (no Slam/Tremor during Surge
  or telegraph windows); a full wipe clears vents, Cinderlings, Forgeheat,
  and Waking Fury; and the parity scenario replays a full pull including a
  geyser launch byte-identically.
- The fairness gate: vents, geyser rings, and the Forgeheat ring render
  unambiguously at every `data-fx-level` including reduce-motion.

Cross-cutting:
- Every player-visible string (bosses, items, auras, Maerin, yells) passes
  the S3 guard and the item/i18n gates; the guide regen is committed.
- `npm test` green including the new parity scenarios; no whole-repo biome.

## Build plan (staged PRs, wings ship in release order)

- PR A (wing 1): dungeon defs + layouts for the lair entrance and wing 1
  (including the statue-gallery props), Vosh + Saan mob records, loot
  table, lockout wiring, Maerin NPC + wing-unseal flow, the surface
  pre-quest chain that introduces her (its kill objective points at a
  baseline surface camp if the full world event PR F is not yet live),
  i18n for all of it, tests. Data-heavy, no required encounter module:
  deliberately the cheapest PR first, and it proves the wing/unseal
  skeleton every later PR reuses. No engine change needed for secondaries
  (per-item `critRating`/`hasteRating` already ship on v0.24.0); wing 1
  gear just sets those fields. (The optional re-kiln hook, if kept, rides
  PR A as its one small scripted piece or slips to a follow-up.)
- PR B (wing 2): the Forge-Heart module (quench meter, ritualist waves),
  its arena, rings + loot, i18n, meter unit tests + a parity scenario.
- PR C (wing 3): the Odrenn module (marks + flips, the proximity pass,
  Cinder Arc, the forge meter), t2 legs, the 5pc set tier, i18n, tests.
- PR D (wing 4 core): Volzharr arena + the identity systems (vents +
  geysers, Slam scaling, Eruption LoS, Forgeheat) + the scheduler, t2
  chests + chase weapon + skin, i18n, the full parity scenario.
- PR E (wing 4 polish): Waking Fury, Vent Surge, vent baiting, The Floor
  Breathes behind its playtest gate, the wind-tunnel bot-raid script, and
  tuning from its first runs.
- PR F (world event, lands any time before wing 1 opens): the escalating
  camps, rares, tremor fx, and door-opening beat.

Each PR follows the house rules independently: release-branch base, own
worktree, screenshots for anything visual, `npm run gate` green.

## Open questions

1. Does the rim of the arena take reduced Molten Ejecta, or full? (Current
   design: full, rim is only vent-free. Revisit in playtest.)
2. Cinderling guilt: should each woken-and-killed Cinderling leave a small
   permanent raid-wide fire-taken stack, so sloppy positioning compounds?
   Cheap in the module, but stacks with Forgeheat's fire sensitivity; needs
   a combined-worst-case healer check before locking.
3. Crumbling pillars (Eruption cover cracks after 1 to 2 uses): wants
   dynamic colliders, which `colliders.ts` does not do. V2 candidate only if
   playtest shows static cover trivializes Eruption.
4. RESOLVED in the loot plan: two chase weapons (Corebreaker physical,
   The Last Restraint caster), 3% each.
5. Visual identity of vents, geyser trigger rings, and the Forgeheat 5 yd
   ring at low graphics tiers: all three are actionable information, so
   every `data-fx-level` including reduce-motion needs unambiguous ground
   decals (fairness invariant) before any spectacle layers on top.
6. Forgeheat numbers (per-stack damage/haste/fire-taken, cap, decay window)
   and geyser launch height vs the 50% HP landing target: tuning pass on the
   first playtest build.
7. Wing release cadence: 1 to 2 weeks between wings, or gate wing N+1 on a
   realm-first kill of wing N? Cadence is predictable ops; realm-first is a
   community event but risks stranding small realms. Maintainer call.
8. Forge-Heart quench meter: is received healing 1:1 meter progress, or do
   overheal rules apply? Needs a decision before healer-balance tuning, and
   it should reuse the effective-healing accounting `healingThreat` already
   does rather than inventing a second definition.
9. Kiln-Keepers duo tuning: the packFrenzy numbers that make a ~20 s kill
   gap a wipe and ~10 s survivable; Anneal's tether range and heal size
   (large enough that ignoring Saan is a loss, kickable enough that a
   coordinated raid fully denies it); and whether Glazing's statue endpoint
   is organic (the stacking slow makes swaps obvious) or a hard scripted
   stun at N stacks. Also verify one keeper resetting/leashing resets the
   pair, so a half-pull cannot cheese the duo rule.
10. Chained-pairs (Sludgefist-style tether) and the stacked-vs-spread
    stance mechanic stay in the reserve bin: first mechanics to reach for
    if any wing encounter tests flat in playtest.
11. Odrenn geometry tuning: the empower/burn radius (~12 yd) must exceed
    the arc-chain radius (~8 yd) by enough that the lattice is learnable
    (9 to 11 yd spacing) for 10 players in his chamber; also the flip
    subset size and cadence, and whether the forge detonation is a wipe or
    a survivable-once spike. Validate the lattice actually fits the room
    at implementation.
12. RESOLVED (normal mode): first three bosses ilvl 33, Volzharr ilvl 35
    (boss levels 24 and 26). Heroic/higher-mode ilvls, if the raid gains
    difficulty modes, are deferred to the mythic+/forged PRD.
13. RESOLVED: the game already uses a rating model (`critRating`/`hasteRating`,
    10 rating = 1%), so secondaries are data-only. Remaining tuning: the
    primary->rating trade ratio (~1 primary : ~12 rating placeholder) and
    whether to add the optional `item_level` budget guard.

## Implementation follow-ups (from the slice-2 codex review)

The walking skeleton (PR #1704) enforces the seal per-character, in-memory,
proximity-credited, mirroring `grantNythraxisLockout`. These refinements are
tracked but deliberately out of the skeleton's scope:

1. Persistence: `PlayerMeta.undermountCleared` is session-only. Give it its own
   slice: add to `CharacterState`, load in `addPlayer`, write in
   `serializeCharacter`, with a save/load round-trip test and a migration-safety
   review (it is new persisted JSONB).
2. Credit by instance membership, not a 260 yd radius: find the `InstanceSlot`
   whose `mobIds` contains the boss and credit that slot's party. Removes the
   theoretical adjacent-slot overlap (disks of r260 centered 500 apart touch)
   and correctly credits members outside the radius (ghosts, rejoiners). Applies
   to `grantNythraxisLockout` too.
3. Party-shared unseal: the seal check gates on the entering player's own
   progress before resolving an existing party claim, so a raid member who did
   not personally clear the prior wing cannot rejoin the group's already-open
   next wing. Resolve the live claim first and scope the gate to it once
   party/account-wide unseal is specced.
