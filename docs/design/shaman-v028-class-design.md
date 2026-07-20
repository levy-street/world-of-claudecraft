# Shaman v0.28.0 Class Design

Status: Levy-approved owner design direction, pre-implementation
Owner: Ryze
Target: v0.28.0, PBE Wave A
Approval: Levy, confirmed 2026-07-20

## Purpose

Shaman should express three relationships with elemental power:

- Thundercall builds and vents a storm.
- Warspirit converts melee pressure into spell power and can adopt an off-tank posture.
- Spiritmend establishes an efficient healing current and spends it when damage arrives.

The three specializations share shocks, Shadewolf, shields, and elemental utility, but must
produce different rotational decisions. Weapon enhancements are spec-specific rather than a row
of class-wide buttons.

## Specialization PRDs

This class document owns the shared Shaman kit, spec-specific weapon-enhancement rules, class-wide
talent framework, and mobile contract. The specialization PRDs own each rotation, payoff,
presentation, balance knobs, and PBE acceptance criteria:

- [Thundercall](../prd/shaman-thundercall-elemental-v028.md)
- [Warspirit](../prd/shaman-warspirit-enhancement-v028.md)
- [Spiritmend](../prd/shaman-spiritmend-restoration-v028.md)

When a shared rule and a specialization PRD disagree, this class document wins. Existing ability
behavior on `release/v0.28.0` remains canonical unless a PRD explicitly identifies an approved
change.

## Owner review decisions

- Spiritmend remains Chain Heal-oriented. Cascading Mend retains the shipped `chain_heal` id and
  core Chain Heal role as the specialization signature; it is not a talent morph of Mending
  Waters. Mending Waters prepares allies, then Cascading Mend consumes their Mending Currents.
- Thundercall remains an Arc Bolt builder and shock spender. Chain Lightning may remain optional
  talent space, but it does not replace Arc Bolt or become a required baseline builder or vent.
- Warspirit unlocks one-handed dual wielding. Landed main-hand and off-hand base weapon swings each
  add one cadence step, while Galeheart echoes never add steps. A Stonebound player may replace the
  off-hand weapon with a shield, accepting slower cadence in exchange for the existing block
  benefit. Warspirit never dual wields two-handed weapons.

## Design principles

### Mobile responsiveness is a hard requirement

- Prefer empowering Arc Bolt, shocks, Ancestral Strike, weapon enhancements, shields, and Mending
  Waters over adding new actions.
- No specialization adds a new resource bar. Charges and stored power appear as aura stacks.
- A specialization may add at most one required rotational button beyond its signature and
  selected talent grants.
- Proc and payoff windows must remain visible for several seconds and usable with touch input.
- Every full-charge, defensive, or instant-cast state needs an aura badge and action-bar cue that
  remains readable with reduced motion.
- Totem or ground placement cannot require pixel-precise targeting during the normal rotation.
- Warspirit off-tanking must use a deliberate stance, imbue, or loadout decision rather than
  extra reactive buttons.

### Spec-specific weapon enhancements

The existing weapon enhancements are consolidated. Changing specialization changes which weapon
magic is available instead of leaving every enhancement on every Shaman action bar:

| Specialization | Available enhancement | Combat purpose |
|---|---|---|
| Thundercall | Pyrebrand Weapon | Supports spell damage and elemental pressure. |
| Warspirit | Galeheart Weapon or Stonebound Weapon | Chooses offensive melee-to-cast pressure or the off-tank posture. |
| Spiritmend | Lifespring Weapon | Strengthens healing and Mending Current generation. |

Rimebound Weapon no longer exists as a separate weapon enhancement. Rime Jolt remains the shared
frost slow and control action. The class-owner PR must migrate existing action bars cleanly when an
old enhancement is no longer available to the selected specialization.

Each specialization normally shows one relevant weapon-enhancement action. Warspirit shows two
because selecting Galeheart or Stonebound is its explicit role decision. Applying one removes the
other.

### Spec-specific action ownership

Arc Bolt, Mending Waters, the three Jolts, Thunder Ward, and Shadewolf remain the shared class
backbone. New rotation actions and specialization behavior are gated as follows:

| Specialization | Exclusive actions and states |
|---|---|
| Thundercall | Pyrebrand Weapon, Thunder charges, Faultwake's vent behavior, and Primal Mastery |
| Warspirit | Galeheart Weapon, Stonebound Weapon, Ancestral Strike, Stormcast, and every off-tank rider |
| Spiritmend | Lifespring Weapon, Mending Currents, Tidecall, and Cascading Mend |

The wrong specialization must never receive an exclusive enhancement, action, aura, threat rider,
or stored pool. Respecializing removes the old posture and stored state before the new kit is
resolved.

### Class-wide talent rows

- Levels 5, 8, 11, 14, 17, and 20 follow movement, defense, control, kit amplification, major
  cooldown, and capstone themes.
- Every option must benefit Thundercall, Warspirit, and Spiritmend.
- Shared shock and elemental effects are preferred over spec-locked talent effects.
- Specialization loops live in automatic passives, signatures, and masteries.

## Thundercall

### Fantasy

Thundercall gathers electrical pressure through ordinary spellcasting and releases it through a
shock. The screen should clearly communicate that a storm is being banked and when it is ready to
vent.

### Core loop

1. A successful Arc Bolt builds one Thunder charge, up to five.
2. The offensive charge count is presented through Thunder Ward and a visible aura stack, but
   remains mechanically separate from the shield's canonical defensive retaliation charges.
3. Earthen Jolt consumes the bank for concentrated single-target damage.
4. Faultwake consumes the bank for prepared area damage.
5. A full bank receives a persistent armed cue on both payoff actions.
6. Primal Mastery creates a faster build-and-vent window using those same actions.

### Player decision

The player chooses whether to vent immediately for reliable damage or continue banking for a
larger discharge. At full charge, the player also chooses Earthen Jolt for one target or Faultwake
for a group.

### Guardrails

- Stormbank should use the existing shield or charge vocabulary, not a second resource UI.
- Charges must not expire on a short timer.
- A proc-less or non-Thundercall build must not consume additional random draws.
- Shock choice should remain understandable without reading hidden coefficients.

## Warspirit

### Fantasy

Warspirit is a melee battle shaman whose weapon strikes call down spells. It can sacrifice some
offense to become a credible temporary off-tank for adds, emergencies, and small-group play.

Warspirit is built around one-handed dual wielding in its damage posture. Both hands feed the same
three-step cadence through the existing auto-attack system; they do not create separate banks.

### Core loop

1. Galeheart Weapon or Stonebound Weapon establishes the offensive or defensive posture.
2. Landed main-hand and off-hand base melee attacks each build one step of a visible three-step
   melee-to-cast cadence.
3. Every third landed melee attack with Galeheart triggers two automatic echo strikes.
4. The same third hit arms the next Arc Bolt, Jolt, or Mending Waters as an instant and cheaper
   cast.
5. Ancestral Strike advances the cadence by two steps and can trigger at most one Galeheart event.
6. Stonebound keeps the instant-cast cadence but replaces Galeheart echoes with armor, threat,
   damage smoothing, and defensive shock or shield behavior.

### Galeheart contract

Galeheart is deterministic so the player can plan around it and PBE can tune it without extreme
random burst:

- Every third landed base melee attack triggers two immediate echo strikes.
- Ancestral Strike counts as two steps toward the next trigger.
- Echo strikes deal a tunable percentage of normal weapon damage.
- Echo strikes cannot trigger Galeheart, add melee-to-cast steps, grant mana, or recursively fire
  other melee procs.
- Missing, being out of range, or striking an invalid target adds no step.
- The third-hit state and instant-cast state use one compact aura presentation rather than two
  resource bars.

The resulting offensive rhythm is:

```text
melee
  -> melee
  -> Galeheart echo burst and instant spell armed
  -> Arc Bolt, Jolt, or Mending Waters
  -> repeat
```

### Player decision

The player chooses between Galeheart pressure and a Stonebound package with armor, threat, and
damage smoothing. In either posture, the player also chooses whether each earned instant cast
becomes damage, control, or emergency healing. Both choices must remain visible rather than hidden
in passive statistics.

### Off-tank boundary

- Warspirit can hold an add, cover a dead tank briefly, or tank suitable small-group encounters.
- It should not outperform a dedicated Protection specialization on sustained boss mitigation.
- Defensive power depends on Stonebound Weapon and therefore carries a real
  damage tradeoff.
- Stonebound increases armor, reduces incoming damage, and increases threat from weapon attacks.
- While Stonebound is active, Earthen Jolt provides snap threat and a short forced-target effect,
  while Thunder Ward contributes retaliation and damage smoothing.
- The melee-to-cast cadence remains available for instant Mending Waters self-sustain, but
  Galeheart's echo strikes are unavailable.
- Threat, mitigation, and shield behavior require dedicated benchmark tests.
- Leaving the defensive posture must remove its threat and mitigation effects immediately.

## Spiritmend

### Fantasy

Spiritmend shapes healing like a current. It establishes efficient healing through steady casts,
then spends the stored current to answer sudden group damage.

### Core loop

1. Mending Waters creates or enlarges a Mending Current healing pool on its target.
2. Mending Current heals gradually while its remaining stored amount stays visible.
3. Tidecall heals an ally immediately and increases the size of that ally's Mending Current.
4. Cascading Mend follows its canonical bounce behavior and consumes the Mending Current on every ally it
   reaches.
5. Each consumed Mending Current immediately heals that ally for more than its remaining stored amount.
6. The player chooses steady healing over time or a prepared Cascading Mend burst.

### Mending Current contract

Mending Current is a healing-over-time pool attached to an ally, not another resource bar:

- Mending Waters creates a 12-second Mending Current on its target.
- Another Mending Waters adds to the remaining pool and refreshes its duration.
- Each ally can hold one Mending Current from the Shaman, capped relative to that ally's maximum health.
- Mending Current periodically heals from its stored pool, reducing the remaining amount.
- The Tidecall boost heals immediately, adds a tunable amount to the pool, and refreshes its
  duration. Its cooldown, charges, and healing coefficient remain PBE values.
- Lifespring Weapon increases the amount deposited by Mending Waters and the instant boost.
- The party frame and ally presentation show the pool's relative size and remaining duration.

Mending Current may use calculated healing before overheal so the Shaman can prepare for expected damage,
but the maximum-health cap prevents unlimited preloading. Exact deposit, tick, and cap values are
balance knobs.

### Cascading Mend consumption

Cascading Mend is the banked-healing payoff:

1. It performs its existing initial heal and deterministic bounce selection.
2. On the initial target and every ally reached by a bounce, it checks for the Shaman's Mending Current.
3. If one exists, Cascading Mend consumes its entire remaining pool.
4. The ally immediately receives a proposed 125% of that remaining healing in addition to the
   normal Cascading Mend amount.
5. The Mending Current is consumed even if some of the burst becomes overhealing.
6. An ally without Mending Current receives the canonical Cascading Mend amount, so the signature remains
   functional without preparation.

Consumption cannot recursively trigger another Cascading Mend, recreate Mending Current, or alter the
canonical bounce order. PBE tunes the starting 125% multiplier against mana efficiency, prepared
group burst, and overhealing risk.

### Player decision

The player chooses whether to leave Mending Currents active for efficient healing over time, enlarge them
for expected group damage, or consume them now through Cascading Mend to save endangered allies.

### Guardrails

- Spiritmend should not copy Doctrine's damage-to-healing identity.
- Damage spells may provide utility or efficiency, but cannot be mandatory for baseline healing.
- The loop must remain functional when only one ally is injured.
- Mending Current pool size, remaining duration, instant-boost readiness, and Cascading Mend consumption
  require clear mobile cues.
- Cascading Mend must consume Mending Currents from every ally it reaches, not only the initial target.
- Preparing several allies cannot require precision ground input or rapid target switching.

## Baseline major group action

Storm Chorus becomes a baseline level 20 Shaman action. Its existing release behavior remains the
starting implementation. Group haste is too important in organized play to compete against
ordinary capstones, because that would make the Storm Chorus choice effectively mandatory.

## Shaman Talents 2.0 grid

These are functional working names and starting PBE values. Every choice benefits all three
specializations, and each row grants at most one new action.

### Level 5: movement

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Wolfstep | Shadewolf becomes instant. Entering it removes roots and movement slows. | Immediate escape and reliable repositioning. |
| Gathering Winds | Entering Shadewolf grants 60% movement speed for 3 seconds, once every 20 seconds. | Planned movement bursts without another action. |
| Flowing Elements | After using a Jolt, the next Arc Bolt or Mending Waters started within 8 seconds can be cast while moving. | Mobile casting through the existing elemental kit. |

This row contains no direct damage or healing increase. It asks whether the Shaman wants an
immediate escape, a movement burst, or a mobile cast.

### Level 8: defense and survivability

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Stoneward | Grants one active shield for the Shaman or an ally. It lasts 60 seconds and holds six charges. Taking damage consumes one charge to heal 5% maximum health, with a 3-second internal cooldown. | Prepared protection for the expected damage target. |
| Warded Elements | Thunder Ward retaliation grants 10% damage reduction for 3 seconds. | Sustained protection while under direct pressure. |
| Ancestral Mending | Taking at least 15% maximum health from one hit heals 12% maximum health, once every 20 seconds. | Automatic recovery from unpredictable burst. |

Stoneward is the only new action granted by this row. The other choices modify existing states
or respond automatically.

### Level 11: crowd control

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Fault Rebuke | Earthen Jolt interrupts spellcasting and locks that school for 4 seconds. | Stops dangerous casts on demand. |
| Rime Lock | Rime Jolt roots its target for 2 seconds. | Stops one moving enemy through an existing action. |
| Gripping Earth | Grants a target-centered Groundsnare with a 30-second cooldown. Enemies within 4 yards are rooted for 2 seconds and then slowed by 40% for 6 seconds. | Controls a group at a planned location. |

Gripping Earth is the only new action granted by this row. Default target-centered placement gives
mobile players the full effect without precision ground input.

### Level 14: kit management and amplification

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Flow State | After spending 120 Mana, the next Shaman action that costs Mana costs 40 less. The ready state has no short expiry and is shown on eligible actions. | Predictable Mana efficiency across every role. |
| Imbue Mastery | Pyrebrand grants an additional Thunder charge every third Arc Bolt. Galeheart echoes deal 25% more damage, Stonebound gains 5% additional damage reduction, and Lifespring increases Mending Current deposits by 20%. | Commits more strongly to the specialization's weapon enhancement. |
| Ward Cycle | A successful Arc Bolt, Ancestral Strike, or Mending Waters restores one canonical defensive Thunder Ward charge and 10 Mana, once every 6 seconds. | Links the core rotation to defense and sustain. |

Flow State is the simple resource choice. Imbue Mastery changes the selected specialization engine.
Ward Cycle rewards maintaining the core rotation without confusing defensive Ward charges with
Thundercall's offensive bank.

### Level 17: major cooldown or power spike

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Primal Exaltation | Grants one 12-second active with a 120-second cooldown. Thundercall Arc Bolts cast 50% faster and grant two Thunder charges. Warspirit triggers its cadence every second landed melee attack. Spiritmend deposits 50% more Mending Current healing and Tidecall charges recharge twice as quickly. | A specialization-specific throughput window using the normal rotation. |
| Wayfarer Grace | When ready, exiting Shadewolf allows casting while moving for 8 seconds. This can occur once every 90 seconds. | Maintains damage or healing through extended movement. |
| Ancestral Bulwark | Activating Thunder Ward grants 40% damage reduction for 6 seconds, with a 120-second internal cooldown. | Converts the existing shield action into a major defensive window. |

Primal Exaltation is the only new action granted by this row. Wayfarer Grace and Ancestral Bulwark
reuse Shadewolf and Thunder Ward.

### Level 20: build-defining capstone

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Deep Reservoir | Thundercall retains two Thunder charges after a full vent. Warspirit retains one cadence step after consuming Stormcast. Spiritmend reseeds every Mending Current consumed by Cascading Mend with a new pool equal to 25% of the consumed amount. | Shortens the rebuild period after the specialization payoff. |
| Echoing Elements | A full Thundercall vent echoes for 40% after 1 second. Warspirit's Stormcast spell echoes for 40%. Spiritmend's Mending Current-consumption healing echoes for 40% after 2 seconds. Echoes cannot trigger further effects. | Adds a delayed second impact to the specialization payoff. |
| Living Weapon | After a full vent, Pyrebrand makes the next Arc Bolt instant. Galeheart's final echo cleaves for 50% to two nearby enemies, while Stonebound Stormcast grants an 8% maximum-health absorb. Lifespring causes Tidecall to deposit 50% of its amount into one nearby injured ally. | Makes the selected weapon enhancement define the build. |

No capstone grants another action or resource bar. Deep Reservoir favors repeated cycles, Echoing
Elements favors large payoff moments, and Living Weapon makes the specialization enhancement the
center of the build.

## Relationship to PR #1980

Retain and extract the approved shared primitives and the Stormbank and Skyrend concepts.
Returning Current is replaced by the Mending Current pool and Cascading Mend consumption design in this
document. Shaman-specific mechanics belong in the Shaman class PR. Generic proc, bank, cleanup,
observation, and cue infrastructure belongs in the approved shared-system PRs.

## Acceptance criteria

- Thundercall has a readable build-and-vent decision without another resource bar.
- Warspirit has deterministic Galeheart, one visible melee-to-cast cadence, and a tested off-tank
  posture with a real damage tradeoff.
- Spiritmend can create, enlarge, display, tick, refresh, and cap one Mending Current per ally.
- Cascading Mend consumes the Mending Current on every ally it reaches and converts each remaining pool into a
  proposed 125% immediate burst without changing canonical bounce selection.
- Storm Chorus is baseline at level 20 rather than a mandatory capstone choice.
- The six class-wide rows contain exactly 18 choices and add at most one possible action per row.
- No shared talent option is dead for a specialization.
- Required rotations fit a mobile action layout and use generous reaction windows.
- PBE Wave A validates bank visibility, melee-to-cast timing, mana efficiency, host parity, and
  off-tank benchmark limits.
