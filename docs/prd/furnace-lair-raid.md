# The Undermount Descent: three-wing raid PRD (Volzharr finale)

Status: DRAFT pass 6 (2026-07-28), spartan redesign per maintainer direction: three
bosses, zero engine asks, heroic at launch. Numbers marked (tuning) are proposals;
everything else is derived from code and locked by engine formulas. What pass 6 cut:
- Wing 2 (the Forge-Heart, HEAL) cut outright; its ring trio redistributed.
- The secondary-stats engine section deleted: combat ratings SHIPPED.
- The pre-launch world event replaced by a static dig-site camp.
- Odrenn loses the same-mark buff, the charge flips, and the forge meter.
- Volzharr loses the engine-field reserves (Furnace Slam, Vent Surge).
- State-keyed audio, mood boards, and realm-first gating are gone.

## Pitch, identity, lore

A 10-player, three-wing raid released in parts under Thornpeak Heights. THE FORGE IS A
FRONT: the Wyrmcult's Undermount works read as an honest (if heretical) industrial
operation, kilns and glassblowers and a master smith, but the heat and the craft exist
to crack the seal on a god. Each wing looks like part of a workshop and is secretly a
stage of the summoning, so killing its keeper RUSHES the ritual instead of stopping
it: the raid thinks it is dismantling a factory; it is pulling the pin. It reaches
Volzharr, the Buried Furnace, a primordial fire elemental sealed under Thornpeak in
the cataclysm that put Thunzharr to sleep (the names rhyme to read as siblings), and
must kill him HALF-FORMED because its own sabotage rushed the summoning. No trash mobs
anywhere: every pull is a boss or a story beat. Each wing owns one verb: balance (wing
1), sort (wing 2), survive the geography (wing 3). The raid completes tier 2: legs in
wing 2, chests in wing 3, the two missing slots. Naming rule: nothing borrowed from
WoW spells, bosses, or items (ip_scrub). Open-source game, no secrets: prestige comes
from difficulty and visible cosmetics, never hidden knowledge.

The Ember Vein (the forward hook, costs nothing here): Volzharr's fire is a VEIN,
not a point: the same deep heat that surfaces as the Drakelands' Drakemaw belt and
cinder desert to the north. Killing him half-formed does not end the fire; it
recedes north along the vein. This raid quietly explains why the Drakelands burns,
and the cult's beast-quartermaster who fled north with the kennels when the raid
came (Maerin finds his torn-out ledger page, below) is the planted villain of a
future Drakelands five-man. One lore line and one paragraph; no shared state, no
dependency in either direction.

## Release structure

- Three `DUNGEON_DEFS` entries (`undermount_wing1` .. `undermount_wing3`), each one
  arena interior in `dungeon_layout.ts` (the `nythraxis_boss_arena` shape), each with
  its OWN daily lockout id (`meta.raidLockouts`, realm-local 3 AM reset), so farm
  wings stay farmable. Each wing anchors its own instance graveyard: death is a
  spirit run from the wing entrance, never a full re-clear.
- Staged wing dates, FIXED CADENCE (resolved: realm-first unlocks are banned, they
  are cross-instance state): wing 1 opens with the patch, wing 2 opens 14 days
  later, wing 3 opens 14 days after that (dates set at patch cut).
- Within the open set, wings connect by the existing Sealed Royal Door machinery: a
  wing kill unseals the next door PER CHARACTER (the shipped gate is
  character-scoped state, verified: no account-wide store exists; whether to
  build account scope is an open question below). That is the entire gate: no
  attunement, no key, no rep. Min level 20. Raid gate: the Nythraxis machinery in
  `instances/dungeons.ts` (`RAID_MIN_PLAYERS = 10`, defined in `item_level.ts`).

## Runeseeker Maerin: the narrator NPC

The Aldric pattern (a dynamically spawned friendly NPC the encounter module owns).
Maerin is a scholar who follows the raid down; her arc is the audience realizing the
front is a front. After each boss she enters, yells 2 to 3 lines over the corpse, and
channels the next sealed door. Her beats:
- After wing 1, puzzled: "This craftsmanship... a whole guild's work, for a cult of
  arsonists? Something down here is worth hiding behind all this." Then, at the
  keepers' ledger (the Ember Vein plant, one line): "Beast provisions, wages,
  kennel feed... and the signature page torn out. Someone left in a hurry. North."
- In the abandoned quench hall between wings, suspicious: the runes are a cooling
  system. "They are not making anything. They are keeping something ASLEEP until
  they are ready."
- After wing 2, the horror: "These are not summoning wards. They are RESTRAINTS, and
  we have been CUTTING them. Every keeper we killed was a lock."
- At the last door, quiet: "There was never a factory. There was only ever him, and
  a very good disguise. Go."
Between bosses the raid walks WITH her; no gauntlets (agents are first-class players:
every challenge must be winnable by reading game state, never human reaction time).
All her text goes through the sim-emit + `sim_i18n` matcher contract like Aldric's.

## Pre-quest: meeting Maerin at the dig (surface, OPTIONAL, ungated)

A short `zone3.ts` chain at a STATICALLY DRESSED dig-site camp (fixed props and mobs,
no schedule, no zone-side live state; ground tremors are renderer-only ambience):
1. "The Heat That Shouldn't Be" (three rune rubbings, `interact`); 2. "What the Cult
Buried" (kill the Wyrmcult foreman and guards, recover the ledger: the forge's output
is all spent DOWNWARD); 3. "Into the Undermount" (she joins you; XP, copper, the
cosmetic Runeseeker's Lantern held flair). HARD RULE: the chain never gates the raid;
skip it and you meet Maerin cold at the first door. Quest prose is the cheap i18n
path (non-Latin sparse-overlay only).

## Cut wing: the Quenching (HEAL), possible future wing, not built

The healer-wins fight is cut from this raid, not from the idea pile. The rescue shape
if it returns: a named cult Quenchmaster whose friendly Forge-Heart is an ordinary
NPC with an ordinary HP bar AS the meter (heal it to full to win), needing no bespoke
meter or non-death win path.

## Wing 1, The Descent: the Kiln-Keepers (duo; verb: BALANCE)

One kiln, two keepers, and a gallery of GLASS STATUES of the last adventurers who
came down here (static layout props). A kill-them-together duo, fully data-only:
- **Vosh the Glazier** (melee): Vitrifying Touch stacks Glazing on his tank
  (stacking slow + fire vulnerability): let it run and the tank visibly hardens
  toward statue-hood, so taunt-swaps are self-evident. His strikes carry Cinder-Toad
  (`polymorphHex` on-hit): the tank becomes a waddling cinder-toad and the offtank
  emergency-taunts. Plus `cleave`. The toad is the wing 1 clip.
- **Saan the Stoker** (ranged caster): fire `aoePulse` as the raid hum, and the duo
  link: she channels ANNEAL on Vosh (`mendAlly`), a big interruptible heal; kick
  discipline is the casters' job. `terrify` texture.
- **The duo rule:** both carry `packFrenzy`. Stagger the kills and the survivor
  frenzies: a ~20 s kill gap wipes a wing-1-geared raid, ~10 s is survivable
  (tuning). Tank them apart (Anneal has a range, tuning), balance damage, kill in
  step.
- Machinery: ZERO encounter-module code. The onboarding fight teaches what wing 3
  grades later: debuff watching, kill discipline, taunt reflexes.

## Wing 2, The Tempering: Odrenn the Temperer (verb: SORT)

Tempering is alternating heat and quench, and Odrenn, the cult's master smith,
tempers RAIDERS. Where you stand relative to your own raid is the whole fight.
- **Temper marks, from room geography.** The tempering floor has a HOT side and a
  QUENCH side; standing on a side marks you SCORCHED or CHILLED (the room assigns
  marks, no scheduler flips; you re-sort by moving). Mixed marks within ~12 yd burn
  each other with steady, readable fire damage, never bursty: you always have time
  to read the state and move. No same-mark damage buff; grouping is about the arc.
- **Cinder Arc (the spread).** On a ~20 s cadence, an arc fires at a random raider
  and CHAINS to any player within ~8 yd of the last target, growing per jump. The
  puzzle: stand with your own side but keep a 9 to 11 yd LATTICE spacing so the arc
  cannot chain. Geography says WHO to stand near; the arc says HOW near. A clumped
  raid feeds a seven-jump arc and the clip goes up that night.
- **Enrage, no bespoke meter:** the module applies a permanent stacking damage aura
  to Odrenn on a ~45 s cadence via existing aura machinery (tuning), plus the
  ordinary `enrage` field at 15% HP.
- Machinery: one module (geographic mark assignment with hysteresis at the
  centerline, the mixed-burn proximity pass on the existing 2D player grid, two mark
  auras, the arc chain walk, the stacking self-buff). Kit texture data-only
  (`cleave`, modest fire `aoePulse`). Marks are auras, the arc target telegraphed:
  agent-completable.
- Story beat: killing Odrenn RUSHES the ritual: the vessel he was tempering shatters
  early (his death line says so), which is why wing 3's god is half-formed.

## Wing 3, The Waking: Volzharr (verb: survive the geography, on the move)

Boss: level 26, `boss: true`, `elite: true`, `ccImmune: true`, one continuous phase,
and he WALKS: `moveSpeed 5.5` (tuning, below the player run of 7), slow and
unstoppable, always advancing on his threat target. Nobody tanks Volzharr in a
corner; the tank ROUTES him along whatever corridors the vents have not eaten yet,
and the shrinking floor turns the kite path into a live problem that gets harder
all fight. The kernel is the whole fight: permanent vents and geysers, the ember
march (below), line-of-sight Eruption, Forgeheat, one scheduler; vent saturation
plus Emberfeed stacks are the twin enrage pressures. Arena: a circular
magma chamber ~70 yd across, a raised vent-free rock rim (not a safe spot: Molten
Ejecta hits it), and 5 to 7 STATIC stalagmite pillar colliders that cast survivable
Eruption shadows (`lineOfSightClear`), stop template-knockback punts, and anchor the
per-pull geography. Indestructible in V1.

Data-only kit: Molten Ejecta (fire `aoePulse`, min 22 max 30 radius 40 every 8 s,
tuning; hits the rim), Searing Grip (`smolder` on-hit, the cost of melee uptime and
the Forgeheat payoff check), Tremor (`stomp`, radius 10, ~40 s, 1.5 s stun, tuning;
lands shortly before an Eruption telegraph so the raid learns to pre-position), Final
Fury (`enrage`, belowHpPct 0.15, dmgMult 1.4, hasteMult 1.25, tuning), `yells` (3 to
4 short seismic lines), ordinary template `knockback`. Dormant Cinderlings: 8 to 10
half-sunk magma elementals, low HP, `aggroRadius` 3 to 4, deterministic-rng positions
weighted near future vent corridors; proximity wakes one early (the guilt mechanic),
the emerge sold by the render layer. No `summonAdds`: every add that will ever exist
is on the floor at pull, visible, countable, and part of the routing problem.

Scripted systems (`encounters/volzharr.ts`), the kernel only:
1. **Vent Fissures + geysers.** Every ~25 s (tuning) a permanent Vent Fissure opens
   (`groundAoEs` + the shared `pulseGroundAoE` entry point) at a deterministic-rng
   position weighted to carve corridors and islands (no two pulls share a floor).
   VENT BAITING: every third vent (tuning) opens under a random ranged player, so
   the raid partially authors the geography. A vent pulses ~15 fire/s (tuning) and
   never closes: the floor only shrinks, the true enrage timer. Entering a vent
   triggers its GEYSER: an upward launch (set `vy`; gravity + the fall-damage model
   do the rest, `FALL_SAFE_DISTANCE` 12 yd), tuned so an unmitigated landing costs
   ~half a raider's HP; below half, the fall kills, emergent from the standing
   model. Deliberate rides above half HP are legal transport across a lava-cut
   floor: a feature, not an exploit.
2. **Undermount Eruption (LoS-checked `bigCast`).** The signature hardcast, ~45 s
   cadence (tuning): a 3.0 s telegraph, then an arena-wide fire hit of 350 to 450
   (tuning) that `lineOfSightClear` exempts: a pillar between you and Volzharr means
   you live. "Get behind a stalagmite" is the screenshot moment. Its audio beat is
   the one kept scripted sound: a 2.5 s seismic riser cutting to HALF A SECOND OF
   TOTAL SILENCE before the blast.
3. **Forgeheat (the risk-reward loop, LOCKED design).** Standing within ~5 yd of an
   open vent (not in it) stacks Forgeheat: bonus damage and haste, more fire damage
   TAKEN (opener: +4% damage, +4% haste, +20% fire taken per stack, cap 5, decays a
   few seconds after leaving; tuning). Composes from existing aura effects; no new
   primitive. The nameable skill decision: "are you greeding vents?"
4. **The Embers Come Home (the empower march, maintainer design 2026-07-29).**
   Every ~30 s (tuning) the module wakes one dormant Cinderling (proximity can wake
   one early). A woken Cinderling never attacks players: it turns and SHAMBLES
   toward Volzharr at ~3 speed (tuning), slow and visible, immune to vents (it is
   magma). If it reaches him (~3 yd) he CONSUMES it: one permanent Emberfeed stack,
   +4% damage and +3% haste (tuning), uncapped: the half-formed god rebuilding
   himself from his own embers. Cinderlings are low-HP and killable anywhere along
   the walk; killing one denies the stack. The raid's DPS priority becomes
   intercepting shamblers along their walk lines while the tank routes Volzharr
   AWAY from the next wake, and Emberfeed is the fight's aging clock: a clean raid
   eats 1 to 2 stacks, a sloppy one drowns. Module-owned walk target and consume
   check, zero engine work (the module already drives per-tick logic; the walk is
   the module steering an entity it owns).
5. **One scheduler, one rule.** Control effects never overlap a cover window:
   Tremor is suppressed while an Eruption telegraph is live (it re-fires after), and
   a suppressed effect RE-ANCHORS its next fire from when it actually fired, so
   drift permanently de-syncs harmonic cadence locks. A stunned player facing a
   detonation they can read but cannot act on violates agent-completability.

Reserve list (not built; promotion is a later Levy call):
- The Floor Breathes: at Final Fury every open vent geysers on a shared 8 s pulse;
  the execute becomes burn, launch wave, reposition, burn. Reuses the geyser system
  wholesale. Playtest-gated: only if the execute is flat without it.
(Waking Fury is DELETED from the reserve, not parked: Emberfeed now owns the
aging-clock job, and one aging clock is the spartan budget.)
Furnace Slam (needs a `SimContext` knockback exposure) and Vent Surge (needs a
ground-AoE fuse field) are CUT outright, not reserved: they require engine fields
and this raid ships zero engine work.

Shared module rules:
- Every placement and cadence draw goes through `ctx.rng` in tick order; a
  `tests/parity` scenario is mandatory, and the geyser launch must replay
  byte-identically (fall damage is sim state).
- Physics fact in the module header: radius queries and ground-AoE hits are 2D
  (x/z, `spatial.ts`); airborne players take every ground pulse under them. No
  mechanic may assume height-dodging.
- Wipe/reset: clear vents, despawn woken Cinderlings, strip Forgeheat, mirroring
  `resetNythraxisEncounter`. Non-goals: no phase machine, no dialogue scheduler
  beyond the death line, no interactables, no dynamic colliders. Growth past this
  list is scope creep.

Hand-test bullets kept:
- Eruption at ~90 base was NOT "move or die" (~15% of a priest pool); corrected to
  350 to 450 (tuning): lethal-adjacent for cloth unhidden, a cooldown-forced
  survival for plate. LoS exemption is binary, so the raw number can be big.
- VERIFY at build: the geyser half-HP landing target assumes fall damage scales
  with max HP. If flat, tune launch height to half the squishiest pool and accept
  that tanks shrug it.

Tuning baseline (all tuning, anchored to Nythraxis): HP ~69,000 EFFECTIVE, 1.15x
Nythraxis (Nythraxis normal is 60,000 effective: `hpBase: 60000 / 2.3` times the
elite 2.3x at spawn, `dungeons.ts` + `entity.ts`; review-corrected, the earlier
51,239 anchor existed nowhere in the tree). The same pre-compensation idiom:
`hpBase: 69000 / 2.3`, `hpPerLevel: 0`.
Melee `dmgBase 58`, `dmgPerLevel 11.4`, `attackSpeed 2.6`, `moveSpeed 5.5`. Target
4 to 6 minutes at ilvl 29; vent saturation makes ~8 minutes a practical wipe, and
the Emberfeed curve is tuned so 1 to 2 consumed embers is par, 4 is a threat check,
6 or more is the wipe (tuning). Forgeheat uptime is in the HP budget: a no-vent
raid should feel undertuned on the enrage, a full-greed raid comfortably ahead of
it.

## Loot (Gravewyrm Sanctum structure)

Every boss pays copper + ONE GUARANTEED roll group (sums to 1.0) + ONE BONUS group
(~0.5 to 0.6, weapons 10 to 15%, alternates under). Volzharr pays TWO guaranteed
groups plus the chase group, and 15g. No tokens, no vendor hop, no currency: direct
drops only. Slot ownership: feet (wing 1), t2 legs (wing 2), t2 chests + off-pieces
(wing 3). REDISTRIBUTION NOTE (the cut Quenching wing owned rings): its ring trio
moves to the wings 1 and 3 bonus groups (Ring of the First Quench and Coalglow Band
to wing 1, Band of the Ninth Quench to wing 3); its other bonus items rehome
(Sluicebearer to wing 1, Quenchsilk Cord and Slakeleather Belt to wing 2). T2
coverage is intact: legs wing 2, chests wing 3.

Item levels fall out of the engine (`boss level + 6 epic + 3 raid`): wings 1 and 2
bosses are level 24 (ilvl 33), Volzharr level 26 (ilvl 35), a deliberate finale
step-up; boss level above the player cap is only an ilvl lever. EXACT primary-stat
budgets per `tests/item_level` (`round(ilvl * qualityMult * slotMult * 0.7)`, epic
qualityMult 1.0; primary stats only, str/agi/sta/int/spi):

| Slot | ilvl 33 (wings 1 and 2) | ilvl 35 (Volzharr) |
|---|---|---|
| chest / mainhand | 23 | 25 |
| legs | 21 | 22 |
| helmet | 20 | 21 |
| shoulder | 17 | 18 |
| waist / gloves | 16 | 17 |
| feet | 15 | 16 |

Secondary stats: combat ratings SHIPPED (flat 0.1 percent per rating point, no
diminishing returns; allowance constants in `src/sim/content/heroic_loot.ts`, budget
guards in `tests/item_level`; see `docs/prd/combat-ratings-and-jewelry.md`).
Undermount authors its "+haste" / "+crit" rating lines within the shipped raid-tier
allowances, per slot, at implementation. Zero engine work. A set piece's family is
its `set:` tag, not its display name, so display names are free; run ip_scrub over
the final list anyway.

**Wing 1, the Kiln-Keepers** (loot on the LAST keeper to die):
- Guaranteed, "what walks out of the kiln" (epic FEET, 15 pts, ~25% each):
  Slag-Tempered Sabatons (plate, str/sta), Glasswalker Treads (leather, agi/sta
  +crit), Twice-Fired Slippers (cloth, int/spi), Stokebrand Striders (shaman,
  int/sta +haste).
- Bonus (~0.55): Saan's Stoking Iron (caster staff, 23 pts, +haste, 12%),
  Glassblower's Shiv (agi 1H, 23 pts, +crit, 10%), Sluicebearer (healer mace, 23
  pts, 10%), Cindertoad Signet (tank ring: sta/armor + knockback-resist,
  pure-primary, 8%; THE meme item, tooltip references the toad), Ring of the First
  Quench (healer ring: int/spi + heal-crit, 8%), Coalglow Band (caster ring: int
  +crit, 7%). Ring budgets per the `SLOT_STAT_MULT` PR #1580 established; confirm
  before authoring.

**Wing 2, Odrenn the Temperer** (tempered gear, fitted to you):
- Guaranteed t2 LEGS (21 pts, ~25% each, family `set:` tags): Crownforged
  Warleggings (+crit), Nighttalon Prowlers (+crit), Soulflame Kilt (+haste),
  Stormcaller's Legwraps (+haste).
- Bonus (~0.55): The Even Temper (str 1H mace, 23 pts, +crit, 12%: the meme weapon,
  a smith's hammer named for the thing his fight destroys), Cinderarc, Odrenn's Rod
  (caster mainhand, 23 pts, +haste, 12%: loot the mechanic that killed you),
  Twicetempered Girdle (plate waist, 16 pts, 10%), Ashwalk Sandals (caster feet, 15
  pts, +haste, 8%), Quenchsilk Cord (cloth waist, 16 pts, +haste, 7%), Slakeleather
  Belt (leather waist, 16 pts, +crit, 6%).

**Wing 3, Volzharr, the Buried Furnace** (ilvl 35):
- Guaranteed A, t2 CHESTS (25 pts, ~25% each): Crownforged Heartplate (+crit),
  Nighttalon Emberweave (+crit), Soulflame Vestments (+haste), Stormcaller's
  Hauberk (+haste).
- Guaranteed B, ilvl-35 off-pieces (~25% each): Volzharr's Knucklestone (ring:
  str/sta +crit), Magmastrider Greaves (plate feet, 16 pts), Footwraps of the
  Waking Floor (cloth feet, 16 pts, +haste; the in-joke for anyone who fought him),
  Forgeheat Cinch (leather waist, 17 pts, +haste).
- Chase group: Corebreaker, Heart of the Undermount (2H, 25 pts, +crit AND +haste,
  3%), The Last Restraint (caster staff, 25 pts, +haste, 3%; named for Maerin's
  rune line), Band of the Ninth Quench (physical ring: str/agi +haste, 10%), plus
  the ultra-rare Moltenheart chroma skin (`skins.ts`, cosmetic).

Set bonus extension, the 5-piece tier: with legs + chest every t2 family reaches 6
owned slots. Add ONE new tier at 5 pieces in `item_sets.ts` (6/6 stays pure
flex/transmog, never mandatory): crownforged 5pc +3% crit, nighttalon 5pc +3% crit,
soulflame / stormcallers 5pc +3% spell crit (all tuning). Crit is the one set-bonus
axis t2 does not use yet; set crit and item crit ratings are additive.
`SET_HASTE_3PC` stays untouched.

## Heroic at launch

Each wing carries the existing per-wing heroic difficulty flag from its release
date. Loot goes through the shipped heroic raid variant tier: on Nythraxis that
tier lifts heroic EPICS to ilvl 33 and heroic LEGENDARIES to 37 (`heroic_loot.ts`
levels by quality, not a normal/heroic pair; review-corrected labelling), so
Undermount normal 33/35 auto-generates heroic variants at roughly
37/39, keeping the `set:` field, per the established variant machinery. Stat
multipliers only: no heroic-only mechanics, no extra abilities. Heroic first-kill
deed rows per wing (see Deeds). This dissolves the old ilvl-overlap question:
Undermount heroic extends the ladder above the Nythraxis heroic ceiling (37) instead
of colliding with it; normal Volzharr at 35 interleaving Nythraxis heroic is
accepted.

## Actionable-decal color contract (fairness invariant)

One hue family per meaning, identical at every `data-fx-level` including
reduce-motion; spectacle layers on top of these, never instead. Vents: saturated
red-orange ring, black core. Geyser trigger: white-hot inner ring. Forgeheat ring:
thin gold band. Scorched/Chilled: ember-orange vs steel-blue aura glyphs, and the
tempering floor's hot/quench sides must read unambiguously at every tier, since
marks derive from the geography. Wing ambience may dim cosmetically as vents
accumulate, but decals and actionable info keep full contrast at every tier.

## Audio

One static streamed track per wing (`instance_music.ts` selection over tracks in
`music_tracks.ts`, under `public/audio/music/`) plus one ambient loop per wing (kiln
roar; anvil heartbeat; sub-bass mountain groans). No state-keyed layers, no
meter-keyed mixing, no transposition hooks. The ONE kept scripted beat: Eruption's
2.5 s seismic riser cutting to half a second of total silence before the blast.
Voice: Volzharr sub-bass and laconic, Vosh and Saan bicker, Odrenn counts hammer
blows, Maerin is the only warm human voice in the raid.

## Deeds

Per `docs/design/deeds.md`, shipped in the same change as each wing's `DUNGEON_DEFS`
entry (never retrofitted): a first-kill deed row per wing boss, a heroic first-kill
deed row per wing, the full descent (all three wings in one lockout week) as the
meta deed, and Volzharr's half-formed kill carrying the raid's title-bearing deed.
Ids, copy, and icon briefs are authored in the wing PRs in
`src/sim/content/deeds.ts`.

## Content and pipeline checklist

- Item names (fully enumerated above) + the skin: contributor PRs add English
  catalog rows; maintainers fill locale overlays at release.
- Boss names, Maerin, wing names, yells, dialogue: `world_entity_i18n.ts` ids;
  everything sim-emitted needs `sim_i18n.ts` matcher rows in the same change (S3
  guard). Maerin is the biggest dialogue surface since Aldric.
- Mechanic aura names (Searing Grip, Forgeheat, Glazing, marks): `sim_i18n`
  dictionaries + `AURA_NAME_KEY`; no test catches a miss, explicit review item.
- Pre-quest: cheap i18n path (non-Latin sparse-overlay); the Lantern is a no-stat
  cosmetic, dodging the stat-budget gate. Set-bonus text rows: overlay translations
  per the established process.
- Guide: `npm run wiki:content` regen + `wiki:stills` (spoiler-safe surface only).
- Tests: `tests/parity` scenarios for Odrenn mark/arc determinism and Volzharr vent
  placement + a geyser-launch replay; encounter tests for vent accumulation,
  Forgeheat stack/decay, Eruption LoS exemption, full reset; item budget rows in
  `tests/item_level`.

## Acceptance criteria (per wing; "done" is observable)

Wing 1: a 10-player raid enters `undermount_wing1` and the gate refuses fewer than
`RAID_MIN_PLAYERS`; killing one keeper frenzies the survivor (~20 s stagger wipes,
~10 s survivable, tuning); Anneal heals Vosh, is interruptible, and stops at tether
range when tanked apart; Glazing and Cinder-Toad both force observable taunt swaps;
loot and the kill path fire on the LAST keeper regardless of order, and a wipe or
single-keeper reset resets BOTH cleanly; the kill grants the wing 1 lockout, spawns
Maerin, her lines fire in order, the wing 2 door unseals for the character; ZERO
encounter-module code.

Wing 2: every raider carries exactly one mark aura at all times, derived
deterministically from floor side, with hysteresis at the centerline so edge-dancing
cannot flap state per tick; mixed-mark pairs burn at ~12 yd on the existing player
grid and there is no same-mark buff; Cinder Arc chains only across gaps under ~8 yd,
grows per jump, and each jump is a combat-log event so lattice failures are
debuggable; the stacking enrage aura is visible game state; his death line fires,
Maerin's unseal plays, and the t2 legs group drops every kill.

Wing 3, kernel only: permanent vents and geysers, LoS Eruption, Forgeheat,
deterministic placement, full reset, and a byte-identical geyser replay; the fight
is completable with ordinary template knockback and vent saturation as its enrage
pressure; fairness gate: vents, geyser rings, and the Forgeheat ring render
unambiguously at every `data-fx-level` including reduce-motion.

Cross-cutting: heroic flags per wing with variant loot at 37/39 and heroic deeds;
every player-visible string passes the S3 guard and item/i18n gates; guide regen
committed; `npm test` green including the new parity scenarios; no whole-repo biome.

## File plan and staged PRs

File plan: TWO new sim modules only, `src/sim/encounters/odrenn.ts` and
`src/sim/encounters/volzharr.ts`. Wing 1 is data-only (`MobTemplate` records +
layout). Zero new engine primitives, zero `SimContext` exposures, zero new fields on
shared records.

- PR A (wing 1, data-only, cheapest first): dungeon defs + layouts for the entrance
  and wing 1 (statue gallery), Vosh + Saan records, loot with ratings within
  shipped allowances, lockout wiring, heroic flag + variants, Maerin + unseal flow,
  the static dig-site camp + pre-quest chain, deeds, i18n, tests. Proves the
  wing/unseal skeleton the later PRs reuse.
- PR B (wing 2): the Odrenn module (geographic marks, mixed-burn pass, Cinder Arc,
  stacking enrage), arena, t2 legs, the 5pc set tier, heroic, deeds, i18n, tests +
  a parity scenario.
- PR C (wing 3): the Volzharr module (vents + geysers, Eruption LoS, Forgeheat, the
  scheduler), arena, t2 chests + off-pieces + chase + skin, heroic, deeds, i18n,
  the full parity scenario.
- PR D (conditional, only on a later Levy promotion): The Floor Breathes behind its
  playtest gate, Waking Fury, the wind-tunnel bot-raid script, tuning from first
  runs. PR C must remain shippable if PR D never exists.

Each PR follows the house rules independently: release-branch base, own worktree,
screenshots for anything visual, `npm run gate` green. This plan is sequencing
reference, not authorization: Levy approves scope first.

## Open questions

0. Door-unseal scope: the shipped gate is per character; the friendlier
   account-wide unseal needs a small new persisted store. Ship character-scoped
   (recommended, zero new machinery) or fund account scope?
1. Does the arena rim take reduced Molten Ejecta, or full? (Current: full; the rim
   is only vent-free. Revisit in playtest.)
2. Cinderling guilt: should each woken-and-killed Cinderling leave a small permanent
   raid-wide fire-taken stack? Cheap, but stacks with Forgeheat's fire sensitivity;
   needs a combined-worst-case healer check.
3. Crumbling pillars (Eruption cover cracks after 1 to 2 uses): wants dynamic
   colliders, which `colliders.ts` does not do. V2 candidate only if static cover
   trivializes Eruption in playtest.
4. Forgeheat numbers (per-stack values, cap, decay) and geyser launch height vs the
   50% HP landing target: first-playtest tuning pass.
5. Kiln-Keepers duo tuning: the packFrenzy numbers for the 20 s / 10 s line;
   Anneal's tether range and heal size (ignoring Saan is a loss, a coordinated raid
   fully denies it); whether Glazing's statue endpoint is organic or a hard stun at
   N stacks; verify one keeper leashing resets the pair so a half-pull cannot
   cheese the duo rule.
6. Odrenn geometry: the burn radius (~12 yd) must exceed the arc radius (~8 yd) by
   enough that the 9 to 11 yd lattice is learnable for 10 players in his chamber;
   validate the lattice fits the room and that the centerline hysteresis band is
   wide enough to walk through cleanly.
