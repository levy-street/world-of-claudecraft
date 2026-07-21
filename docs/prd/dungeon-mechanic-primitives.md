# Design: Dungeon Mechanic Primitives, Difficulty Modes, and the Encounter UI

Status: draft v3 (design only, nothing here is implemented)
Owner: design
Companion docs: `docs/prd/heroic-mythic-dungeons.md` (difficulty plumbing,
forge, chest, ladder), `docs/prd/badges.md` (the reward loop),
`docs/prd/talents-2.0.md` (owns the player interrupt, see the P8 dependency)

Dependency: the player kick is NOT built here. The interrupt ENGINE
(`interrupt` AbilityEffect: cancels a non-physical cast, applies the school
lockout with DR, `uninterruptible` AbilityDef flag, works against non-player
casters) already merged in Talents 2.0 foundation **PR #1305**. Player ACCESS
to it (Pummel / Counterspell / Kick and the other per-class L8 choice-row
options) ships with the open Talents 2.0 epic **PR #1348**. P8 below and every
"once the kick exists" line in sections 5 and 6 block on #1348 landing.

## 1. Summary

The heroic/mythic+ PRD ships the difficulty LADDER: instancing, scaling,
affixes, forged drops. It deliberately reuses the existing boss mechanics
wholesale. This doc designs the missing half: the MECHANICS that make climbing
that ladder fun.

Three claims, each grounded in the codebase:

1. **The current dungeon mechanic vocabulary is passive.** Every dungeon boss
   is some mix of `aoePulse`, `summonAdds`, `enrage`, `stomp`, `cleave`, and
   on-hit debuffs. Nothing asks a player to move, face, kick, swap, or spread.
   The healer sweats; everyone else executes a rotation.
2. **The Nythraxis raid already hand-rolls the missing vocabulary.** The
   encounter script (`src/sim/encounters/nythraxis.ts`) contains a working
   frontal cone (Gravebreaker: facing + half-arc check), a stack-to-split bomb
   (Soul Rend: lethal damage divided by marked players within 5 yd), a
   telegraphed 10 s boss cast on the entity cast-bar fields (Deathless Rage),
   counter-play objects (wardstone channels), timed add waves, and a 5 percent
   soft enrage. The engine can do all of this today; it just cannot do it
   **declaratively**, on more than one boss.
3. **Therefore the work is extraction, not invention.** Each primitive below
   is a `MobTemplate` field in the exact style of `aoePulse`/`stomp`,
   generalizing something Nythraxis (or an existing system) already proved.
   Heroic dungeons are the test bed for the primitives one at a time; mythic
   turns on the full kit; mythic+ scales it and layers affixes on the same
   hooks.

## 2. Grounding: what the sim already has

From a capability audit of `src/sim/`:

| Capability | Status | Where |
|---|---|---|
| Persistent ticking ground zones | EXISTS | `GroundAoE` (`entity_roster.ts:37`), `pulseGroundAoE` shared entry, `groundAoE` effect |
| Threat table, taunt, forced target | EXISTS | `threat.ts`; `mob.threat`; `applyTaunt` sets `forcedTargetId`/`forcedTargetTimer` |
| Frontal cone geometry | EXISTS (hand-rolled) | Gravebreaker: `angleTo` vs `boss.facing` within `HALF_ARC` (`encounters/nythraxis.ts:505`) |
| Stack-to-split bomb | EXISTS (hand-rolled) | Soul Rend: `maxHp / marked within STACK_RANGE` (`encounters/nythraxis.ts:743`) |
| Boss cast bar | EXISTS (fields; current casts are scripted, uninterruptible) | Deathless Rage drives `boss.castingAbility`/`castRemaining`/`castTotal`; `castStart` SimEvent |
| Counter-play objects | EXISTS (hand-rolled) | Wardstone channels during Deathless Rage |
| Stacking auras, heal reduction | EXISTS | aura system; `mortalStrike` is a working healing-reduction debuff |
| On-death payload | EXISTS | `deathThroes` + corpse detonate (`mob/lifecycle.ts:157`) |
| Knockback | EXISTS (on-hit only) | `knockback` on-hit affix |
| Line of sight | EXISTS | `hasLineOfSight` (`sim.ts:3012`), gates ranged + AoE |
| Telegraph render hooks | EXISTS | `castStart` + `spellfx` (`nova`/`beam`/`projectile`) SimEvents |
| Interrupt engine (cast-break + school lockout + DR + `uninterruptible` flag) | MERGED (PR #1305) | `interrupt` AbilityEffect; resolves against non-player casters too |
| Player access to an interrupt (Pummel/Counterspell/Kick per class) | BLOCKED on Talents 2.0 (PR #1348, open) | L8 choice-row grants; one interrupt-family OPTION per class, not baseline |
| Location-anchored telegraph decal | MISSING | `spellfx` flashes at entities; no "this circle on the ground, in 2 s" event |

The genuine engineering gap left for THIS doc is the **ground telegraph
event** (a SimEvent carrying position + shape + arm time so the renderer can
draw the decal before the hit). The interrupt, which draft v2 called the one
real system build, turned out to be Talents 2.0's P1 primitive: the engine is
already merged (#1305) and the player-facing kicks ship with the open epic
(#1348). What remains here is the mob-side half only: declarative boss-cast
records that route through that same interruptible pipeline. Everything else
is generalizing code that exists.

## 3. The primitive catalog

Each primitive is a declarative, optional `MobTemplate` field (data-as-code in
`src/sim/content/`, types in `types.ts`), implemented once in the mob update
path, reused by any boss via tuning. All randomness through `Rng`, fixed draw
order. Names below are working names; per-boss flavor names ride the record
(`name:` field) like `aoePulse` does today.

### Tier 1: extract and prove in heroic

**P1 `tankBuster`** (new). Every Nth melee (or on a cadence) applies a
stacking debuff to the current threat leader: damage taken up, or healing
taken down. Past the tuned comfort point the tank must taunt-swap or the boss
must be turned by cooldowns. Reuses threat + taunt + stacking auras wholesale;
the cheapest primitive on the board and the one that gives tanks a job.
Fields: `{ everyNthSwing | every, aura: { dmgTakenPct | healTakenPct, duration }, maxStacks, name }`.

**P2 `groundHazard`** (generalize `GroundAoE`). On a cadence, place a
telegraphed zone at a placement-policy position (under a random player, under
the tank, at range, fixed point). Telegraph for `armTime`, then tick damage
for `duration`. "Do not stand in the fire," the atomic movement mechanic.
Needs the new telegraph SimEvent; the zone itself is the existing `GroundAoE`.
Fields: `{ every, radius, armTime, duration, tickDamage, placement, count, name }`.

**P3 `frontalBreath`** (extract Gravebreaker). Telegraphed cone from the
boss's facing: windup on the cast bar, facing snapshot at cast start, then
heavy damage in `angle`/`range`. The tank faces the boss away; melee step
out of the front. Gravebreaker keeps its identity as the Nythraxis tuning of
this record (its current untelegraphed form becomes `armTime: 0`).
Fields: `{ every, angle, range, armTime, damage, offTankMult, name }`.

**P4 `soulMark`** (extract Soul Rend). Mark K random non-tanks; after
`fuse` seconds each mark detonates for damage divided by the number of marked
players within `shareRange` (stack to survive), or, with `mode: 'spread'`,
full damage to everyone within `splashRadius` of the carrier (spread to
survive). One record, sign-flipped, covers both classic shapes and creates
tension against P2/P3 positioning.
Fields: `{ every, targets, fuse, damage, mode: 'stack' | 'spread', shareRange | splashRadius, name }`.

**P5 `fixate`** (reuse `forcedTargetId`). On a cadence the mob locks onto a
random non-tank for `duration`, ignoring threat, moving at `speedMult`;
contact hits hard or applies a stack. The taunt machinery already forces
targets; fixate is the same field with a different selection policy and a
"taunt does not break it" flag. The fixated player kites, ideally through
ground the P2 hazards have not claimed.
Fields: `{ every, duration, speedMult, target: 'random' | 'farthest', contactDamage, name }`.

**P6 `berserk`** (the Patchwerk lever). A hard enrage on a fight-length
timer: at `after` seconds the boss gains `dmgMult`/`hasteMult` (effectively
unhealable), with emote warnings at 60/30/10 s. This is THE clean DPS check
for an untimed mode: the RUN has no clock, but a boss can. Distinct from the
existing `enrage` (an HP threshold); this is a wall-clock-of-the-fight
threshold on sim time. Also doubles as the anti-turtling guard the untimed
PRD needs.
Fields: `{ after, dmgMult, hasteMult, warnAt: number[], name }`.

**P7 `shockwave`** (knockback, area form). Telegraphed radial wave on a
cadence: everyone within `radius` is knocked `distance` from the boss and
takes damage. Positioning turns it from a nuisance into a threat: knocked
into a P2 pool, out of `shareRange` during a P4 stack, or off the healer's
range. Reuses the on-hit `knockback` displacement math on an area trigger,
with the P2 telegraph.
Fields: `{ every, radius, armTime, distance, damage, name }`.

### Tier 2: the interactive layer (mythic and up)

**P8 `bossCast`** (mob-side only; the kick is Talents 2.0's). A first-class
interruptible mob cast: visible bar (`castStart` and the entity cast fields
already exist), `payload` on completion (nuke, heal, summon, CC), broken by a
player interrupt through the `interrupt` effect that PR #1305 merged (it
already resolves against non-player casters). The player-side kick is
explicitly NOT this doc's work: Talents 2.0 grants one interrupt-family
option per class at the L8 choice row (PR #1348, open), and its own PRD plans
to give mobs an interrupt cast so players feel the counterplay, which is
exactly this record. **Hard dependency: P8 content cannot ship before #1348.**
And because the kick is a build CHOICE, not baseline, a legal party can have
zero interrupts: every P8 cast must be survivable uninterrupted at heroic
(expensive, not lethal), and only mythic tuning may assume at least one kick
in the group. Deathless Rage stays a scripted special (its counter is
wardstones, not kicks) but moves onto the same cast plumbing. This primitive
is what makes trash packs interesting, not just bosses, and it is what
finally makes `mendAlly`/`desperateHeal` casters into kill-or-kick decisions.
Fields: `{ every, castTime, payload, interruptible, lockout, name }`.

**P9 `priorityAdd`** (compose, not build). `summonAdds` output tagged with a
role: an add that channels healing into the boss, empowers it, or detonates
if alive at `softEnrage`. Composition of `summonAdds` + P8 (or `deathThroes`).
Creates the "what do I hit right now" decision.
Fields on the summoned template: `{ role: 'healer' | 'empowerer' | 'bomber', payload, softEnrage }`.

### Tier 3: deferred (map-coupled or moving geometry)

Rotating beams (P2 with a time-varying transform), pillar/LOS gaze (LOS
exists, but arenas would need authored occluders), knock-off-ledge (needs
kill volumes in arena data), tethers (pair-distance constraint; delve
`linkIds` is precedent but nothing combat-side consumes it). All good, none
worth their infra until Tier 1 and 2 are proven and the arenas carry region
data.

### Affixes are these primitives, broadcast

Every mythic+ affix in the companion PRD is one of these records applied
dungeon-wide instead of per-boss. Build once, expose twice:

| Affix (working name) | Primitive reused |
|---|---|
| Ichor Pool (Sanguine-like: on-death heal pool) | `deathThroes` payload spawning a P2 zone that heals mobs |
| Eruption (Volcanic-like: plumes under players) | P2 with `placement: randomPlayer`, short arm |
| Cornered (Raging-like: sub-30 percent damage enrage) | existing `enrage`, applied to all non-boss mobs |
| Festering (Grievous-like: ramping DoT below 90 percent HP) | stacking aura, HP-gated |
| Corrosion (Necrotic-like: melee stacks reduce healing taken) | P1 pointed at whoever is hit |
| Volatile (Explosive-like: destructible orbs) | P9 with `role: bomber`, retuned to pulse rather than one-shot (untimed mode) |

Seeded weekly rotation and level thresholds per the PRD (5.3), plus a
conflict rule: never draw two same-lesson affixes (two on-death punishers,
two movement hazards) in one week.

## 4. The difficulty ladder (amended)

The PRD defines heroic as a pure numbers rebase. This doc amends that into a
three-step mechanics ladder, because the primitives need a place to be
learned before they can be stacked:

- **Normal**: unchanged. The leveling experience, current mechanics only.
- **Heroic (L20 rebase + ONE new mechanic per boss)**: the numbers transform
  from the PRD, plus each boss gains exactly one Tier 1 primitive, chosen to
  teach it in the friendliest possible room. Heroic is the tutorial tier for
  the vocabulary. Daily badge cadence per badges.md.
- **Mythic (fixed, the full kit)**: one difficulty, no keystone, sitting
  between heroic and mythic+ 2. Every boss runs its complete mechanic kit
  (the heroic mechanic plus one or two more, incl. P6 berserk DPS checks on
  the meters bosses) at fixed tuning. Mythic is where the dungeon's "real"
  encounter design lives; mythic+ then scales exactly this. Weekly loot
  lockout on bosses (badges still daily-slotted), so mythic is the weekly
  "learn the dance" tier, not a farm tier.
- **Mythic+ (keystones 2 and up)**: mythic mechanics + compounding
  health/damage + affixes at 4/7/10, untimed, per the PRD. The mechanics do
  not change with key level; the margin for failing them does, and P6 berserk
  timers become the de facto gear gate at high keys (you cannot out-turtle a
  boss whose berserk you cannot beat).

Instance keying, entry gating, chest, forge, and ladder all per the PRD; the
difficulty enum just gains the `mythic` value between `heroic` and keyed
levels.

## 5. Heroic Nythraxis (10-player raid)

The PRD scopes mythic+ away from the raid; a single heroic raid difficulty is
the right-sized raid analogue. Same room, same phases, same wardstones; each
existing mechanic gets its screws turned using the primitives, and the fight
gains the raid's only true DPS check.

- **Gravebreaker** becomes the P3 record it inspired: a 1.5 s telegraphed
  windup (it is instant today), the arc widened from 120 to 150 degrees, and
  anyone hit who is not the current tank is also knocked back (P7 math).
  The dance: melee step out on the windup, tank alone eats it.
- **Soul Rend** marks 4 players instead of 3, and each detonation leaves an
  Ichor Pool (P2 zone) at the point of impact for 20 s. The room fills with
  consequences; stacking spots must rotate.
- **Raise Fallen** guards become P9 priority adds (`role: healer`): a Royal
  Guard that reaches the boss channels Deathless Vigor, healing him 1 percent
  per second until killed or (once P8 lands) kicked. Ignoring adds stops
  being an option.
- **Deathless Rage** is unchanged in shape (it is already the best mechanic
  in the game) but heroic requires the three wardstones to be channeled by
  three DIFFERENT players, and taking damage interrupts a channel. The raid
  must pre-assign runners.
- **Final Stand** (5 percent) is replaced by a true P6 berserk: at 8 minutes
  Nythraxis gains 25 percent damage, again every 30 s thereafter, until the
  raid dies or he does. Patchwerk pressure without a run timer: the raid can
  wipe and re-pull forever, but every pull must beat the 8-minute check.
- **Loot**: the existing epic table at a heroic bonus rate, plus forge rolls
  (PRD 5.5) at raid-tier chances. Shared 24 h lockout with normal (one
  Nythraxis kill per day per character, either difficulty): open question 4.

## 6. Per-dungeon difficulty sketches

Heroic teaches one primitive per boss; mythic completes the kit. Numbers are
placeholders for the playtest pass; per the PRD they live in per-dungeon
scaling records, never inline. Flavor names are working copy.

### 6.1 The Hollow Crypt (heroic teaches: P2 ground, P1 stacks)

The friendliest room, so it teaches the two most fundamental habits: watch
the ground, watch the tank debuff.

| Boss | Today | Heroic (+1) | Mythic (full kit) |
|---|---|---|---|
| Sexton Marrow (miniboss) | plain stats | **P1 Gravedigger's Blow**: every 3rd melee stacks +15 percent damage taken, 12 s | P1 + widow adds join at 50 percent (existing `summonAdds` reuse) |
| Morthen the Gravecaller | `aoePulse` (Shadow Pulse) | **P2 Graven Miasma**: every 12 s, a 5 yd pool under a random player, 2 s arm, 15 s lifetime | P2 + **P9 Bone Servitors** (healer role, channel to Morthen) + Shadow Pulse magnitudes up |

Trash: Hollow Acolytes gain a P8 interruptible Dark Mending on mythic once
the interrupt exists; until then they keep `desperateHeal`.

### 6.2 The Sunken Bastion (heroic teaches: P3 facing, P4 stack/spread)

The positioning dungeon.

| Boss | Today | Heroic (+1) | Mythic (full kit) |
|---|---|---|---|
| Knight-Commander Olen (miniboss) | `cleave` | **P3 Sweeping Blade**: cleave becomes a telegraphed 90 degree, 10 yd frontal every 10 s | P3 + **P1 Sunder** (tank stacks) + **P7 Tide Slam**: radial knockback off the dais toward the water line |
| Vael the Mistcaller | `aoePulse`, `summonAdds` | **P4 Mist Rend** (stack mode): 3 marks, 6 s fuse, split within 6 yd | P4 + thralls become **P9 bombers** (`deathThroes` if alive 20 s) + **P6 Rising Tide** berserk at 4 min (the flood takes the room) |

### 6.3 Gravewyrm Sanctum (heroic teaches: P1 swaps, P5 kiting; mythic is the meters check)

The endgame calibration anchor stays the hardest, and Korzul becomes the
game's Patchwerk.

| Boss | Today | Heroic (+1) | Mythic (full kit) |
|---|---|---|---|
| Korgath the Bound | `enrage`, `stomp` | **P1 Bonecrusher**: every 4th melee, +20 percent damage taken, 15 s (the tank-swap teacher; solo-tank groups burn cooldowns) | P1 + **P5 Chained Fury**: snaps his bindings and fixates a random player for 6 s at 1.3x speed |
| Grand Necromancer Velkhar | `summonAdds` | **P9 kill-order**: bonewalkers that reach Velkhar empower him +10 percent damage each (stacking) | P9 + **P2 Desecration** pools + **P8 Dark Ritual** (3 s interruptible raid nuke) once the kick exists |
| Korzul the Gravewyrm | `aoePulse`, `enrage` | **P3 Necrotic Breath**: 2 s windup, 60 degree, 16 yd cone; tank turns him from the group | P3 + **P7 Wing Buffet** (radial knockback into his own breath line) + **P6 Consume the Dead** berserk at 6 min: the pure gear-and-execution check that anchors mythic+ scaling |

Mythic+ (all three dungeons): exactly the mythic kits, health/damage
compounding per the PRD, affixes from section 3 at 4/7/10. No per-key
mechanic changes; the design intent is that key 10 Korzul is the same dance
as mythic Korzul with no room left for error, and his berserk is what gear
progression is measured against.

## 7. UI elements

Everything here consumes `IWorld` (extended first, implemented in both `Sim`
and `ClientWorld`) or new SimEvents; render/ui never touch a concrete world.
Every label is a `t()` key; sim-emitted lines get `sim_i18n.ts` matchers in
the same change; mechanic auras register `AURA_NAME_KEY`.

**Difficulty selection and status**
- Dungeon door / meeting-stone dialog: leader-only difficulty picker
  (Normal / Heroic / Mythic / Mythic+ N), with the keystone stepper capped at
  `bestCleared + 1` and the party-minimum rule surfaced inline ("Aldra has
  not cleared 6: cap 7 -> 5"). Non-leaders see the selection read-only.
- In-instance banner: the zone-in text and the persistent HUD tag under the
  minimap ("Gravewyrm Sanctum, Mythic+ 7"), plus active affix icons with
  tooltips. Week's affixes also shown on the dungeon selector before entry.

**Telegraphs (the load-bearing new render surface)**
- A new `telegraph` SimEvent (position or source entity, shape circle/cone,
  radius or angle+range, arm time) drives ground decals: an outlined ring or
  wedge that fills as the arm timer elapses, then flashes on resolve.
  P2/P3/P7 all ride this one event; this is the single most important UI
  investment in the doc, because an undodgeable-looking dodge mechanic reads
  as unfair.
- Boss cast bar on the target frame, reusing the existing `castStart` event
  and entity cast fields (Deathless Rage already populates them).
  Interruptible casts (P8) render with a bright border; uninterruptible with
  the standard shield motif; a successful kick flashes the bar.

**Personal warnings**
- P4 marks: a debuff icon with a fuse countdown on the player frame, a decal
  ring around the carrier sized to `shareRange`/`splashRadius`, and a
  center-screen line ("Soul Rend: stack!" / "spread!") through the existing
  FCT/raid-warning channel.
- P5 fixate: a marker over the fixated player, a center-screen "Korgath
  fixates on you!", and a glow on the boss nameplate for everyone else.
- P1 stacks: the debuff already renders in the aura row; add a stack-count
  emphasis at `maxStacks - 1` on the party/tank frames so the swap call is
  visible to the other tank, not just the victim.
- P6 berserk: no timer bar (classic fidelity: the pressure is felt, not
  displayed); boss emotes at the `warnAt` marks through the existing yell
  channel, red tint on the model at berserk.

**Ladder and rewards**
- Leaderboard window: per-dungeon best-key ladder (PRD 5.7), a new sort key
  on the existing paginated `leaderboard_page.ts` surface.
- End-of-run chest panel: reuse the personal-loot window; forge outcomes get
  the tier label and bonus lines in the item tooltip from wire data
  (Valeforged/Swiftforged rendering per PRD 6, client-side `t()` keys).
- Character sheet: `bestCleared` per dungeon on a small progress pane in the
  dungeon selector, so the "your key" state is always discoverable.

**Wiki**
- `npm run wiki:content` regen plus `guide.*` prose pages for difficulty
  modes and (spoiler-safely) the affix roster. Boss mechanic kits stay out of
  the guide per the existing spoiler policy.

## 8. Invariants that bind every section above

- All primitive state lives on `Entity`/`MobTemplate` types in `types.ts`;
  behavior in the mob modules behind `SimContext`; content records in
  `src/sim/content/` merged by `data.ts`. No balance numbers inline.
- Every roll (placement, target picks, marks, affix rotation) through `Rng`
  in fixed draw order; zone/cone membership evaluated in stable entity-id
  order so float boundaries reproduce across the three hosts. New mechanics
  with rng draws get `tests/parity` scenarios; the heroic Hollow Crypt golden
  run from the PRD (7) extends to cover each primitive as it lands.
- Difficulty transform stays a pure function (PRD 5.9); primitives read their
  tuning through it so heroic/mythic/key-level magnitudes are data.
- Gates: `tests/architecture.test.ts`, `tests/localization_fixes.test.ts`,
  `tests/guide.test.ts`, and golden parity, per the PRD.

## 9. Open questions

1. RESOLVED: the player kick is Talents 2.0's, not this doc's. The engine
   merged in PR #1305; the per-class L8 choice-row kicks ship with PR #1348,
   which P8 and the P9 healer role block on. The residual question is tuning
   policy: interrupts are optional build choices, so how punishing may an
   uninterrupted P8 cast be at each tier? Proposed: survivable at heroic and
   mythic with cooldowns, lethal-if-ignored only at high keys where a kick
   (or a stun, which also breaks casts through the same #1305 machinery) can
   be assumed.
2. Mythic lockout shape: weekly loot lockout (proposed) vs daily like heroic.
   Interacts with badges.md paid-kill slots.
3. P6 berserk timers on 5-player bosses: 4 to 6 minutes proposed; needs the
   wind-tunnel pass against actual group DPS at honest gear levels.
4. Heroic Nythraxis lockout: shared daily lockout with normal (proposed) or
   separate, which doubles raid loot per day.
5. Telegraph density: how many simultaneous decals before the floor is noise?
   Proposed cap of 3 active P2 zones per boss and one affix hazard batch, to
   be playtested.
6. Does `fixate` need pathing work, or does existing chase locomotion feel
   right at 1.3x speed? Prototype before committing P5 to two bosses.
