# Druid v0.29 class design

Status: implemented from `druid-class-directions-v029.pdf`.

## Direction

The Druid remains one class with four forms and three specialization engines.
Mana, rage, energy, combo points, and the existing form bars remain intact.
Engine payoffs replace existing actions in place, so saved bars never gain a
second copy of the button. Every bank is a visible, persistent aura and advances
only from the Druid's own completed presses or landed strikes.

| Level | Row job |
|---|---|
| 5 | movement |
| 8 | defense |
| 11 | control |
| 14 | engine economy |
| 17 | major cooldown |
| 20 | engine capstone |

Every old option id remains in its slot. Character content revision 3 gives
Druids a free row repick and removes retired row grants from saved bars.

## Moongrove

Moongrove operates only in Moonwing Form and runs ONE bank. Completed
Wildbolt, Skyfall, and Moonseed casts each add a Moontide stage, to three. At
full Moontide BOTH payoff buttons light up at once and the player chooses:
the Moonseed button becomes Moonsurge, a heavy Arcane strike (the damage
pick), and the Skyfall button becomes Sunwake, a Nature strike and burn that
restores mana (the economy pick). Either press spends the whole bank and
both buttons revert: one payoff per cycle, the player's call. Below full
bank, Skyfall stays a normal castable nuke and Moonseed keeps its base job
(a stage plus a Lunar Tempest extension), the same below-the-bank contract
as Gorebite and Swiftmend.

Owner rulings, in order: the v1 two-pole engine read as an inverting
rotation; the v2 auto-alternating payoff removed the tracking but also the
agency; v3 keeps the one unchanging loop and gives the payoff moment to the
player. The retired Skyborne instant-cast window stays dead (mobility is the
Skylark row's job), and Moonsurge fires through Moonseed's own recharge (a
cooldown-free transform casts through the base clock, the Unleash Beast
grammar), so a full bank is never gated by the builder's cooldown. While the
bank is full the Moonseed button IS the payoff, so holding a spend also
holds the dot extension: deliberate tension. Leaving Moonwing freezes the
bank and disarms both payoffs without discarding anything. Moonsurge must
measurably out-damage Sunwake's hit plus burn, or the mana refund makes
Sunwake strictly better and the choice dies; the probe owns that margin.

Moongrove is a spell caster, and its damage scales with spell power like one.
The Moontide payoffs (Moonsurge and Sunwake) carry a spell-power rider, and the
flat base numbers were re-banded down to match, so un-geared it sits inside the
naked peer band rather than towering over it on flat numbers alone. The rider was
calibrated against the endgame searched best-in-slot (spell power near 150), where
the cross-spec Nythraxis montecarlo seats the spec at the ~200 DPS anchor; an
earlier over-scaled pass read 258 there and the coefficients were pulled down to
hit 200. The owned-class harness runs a level-20 fixed loadout that caps near
spell power 105, so it reads Balance as a low-SP proxy (~160), not the real BiS
anchor: naked parity is owned by that harness, but real best-in-slot balance is
owned by the montecarlo.

Two deliberate boundaries on the no-decay promise. The BANK never decays: a
full Moontide holds until spent. And a resisted Wildbolt or Skyfall still
banks its stage: the caster bank counts the player's completed presses, so
spell RNG cannot take a stage away. Wildfang's landed-only rule below is the
melee grammar, not an inconsistency.

## Wildfang

Old Blood is one three-stage bank shared by Wolf and Bruin forms. It advances
only when Rendclaw, Flense, Bloodrift, Gorebite, Bonecrush, or Sweeping Claws
lands. Shifting preserves it; leaving combat clears it.

At full Old Blood, Gorebite becomes Redharvest in Wolf Form. Redharvest
consumes the bank, detonates the Druid's remaining Flense and Bloodrift damage
on the target, and restores energy. Combo points are OPTIONAL on the press:
any points held strengthen the bite, none are required (owner playtest: the
natural sequence ends Bloodrift at zero points, and a payoff the loop itself
locks out is a dead button). The bleeds run long (Flense 18 sec, Bloodrift
24 sec, totals unchanged) so building a point or two before detonating no
longer forfeits the first bleed. In Bruin Form, Bonecrush becomes
Marrowbreak. Above half health, Marrowbreak deals a burst with snap threat.
Below half health, it instead converts the bank into an absorb based on maximum
health and restores rage.

Wildfang may select either tank or damage in Dungeon Finder. Bruin remains the
tank form and Wolf has a full damage budget.

## Groveheart

Completed Wildbloom and Second Bloom casts that plant a new owned HoT add one
Verdance, to five. HoT ticks and casts that refresh an existing owned HoT do not
add stages. At full Verdance, Swiftmend becomes Overbloom.

Overbloom removes every HoT the caster owns on every friendly ally and
immediately heals each ally for 60% of that HoT's remaining healing. Overhealing
is lost normally. It then plants a fresh Wildbloom on the cast target.
Seedspread replants every harvested ally instead.

Swiftmend and Overbloom run on ONE shared slot cooldown: a cooldown-carrying
transform checks and arms the base button's clock (`cooldownId` on
`ResolvedAbility`, stamped by `src/sim/combat/action_replacement.ts`). Base
Swiftmend therefore cannot fire the moment Overbloom lands and eat the fresh
replant; the garden gets its 8 seconds to tick. Cooldown-free payoffs
(Redharvest, Marrowbreak, the hunter's Unleash Beast) keep casting through the
base button's recharge, unchanged.

## Rows

- Level 5: Wildshift, Loping Stride, Skylark.
- Level 8: Oakhide Reflex, Ironhide Reflex, Bear-Blood Mending.
- Level 11: Typhoon, Gripping Ambush, Concussive Economy.
- Level 14: Highmoon Tithe, Blooddrunk, Seedspread.
- Level 17: Red Haze, Gladesong, Lifesap.
- Level 20: Nature's Echo, Wild Apex, Quickening.

Nature's Echo seeds the next engine cycle with one stage. Wild Apex increases
every engine payoff by 25%. Quickening restores the resource matching the
Druid's current form whenever an engine stage is banked.

Wild Apex scales the Marrowbreak guard absorb too (18% of maximum health
becomes 22.5% with the capstone). The absorb IS the payoff in the guard arm,
and a capstone that serves all three engines cannot go dead for the tank half
of Wildfang; the direction PDF's 15 to 20% band describes the base value, and
the tank profile probe owns whether the scaled value holds up.

## Lifecycle and delivery contract

Engine auras do not age while banked. Respec, row repick, specialization change,
death, logout, and character reload cannot carry an invalid bank forward.
Old Blood also clears at combat end. Curated default bars expose Moonseed and
the engine's base replacement buttons, and the aura tooltips explain the bank,
stage cap, builder, and payoff.

Behavior is pinned by `tests/druid_engines.test.ts` and the `druid_engines`
parity scenario. `scripts/druid_balance_probe.ts` runs one-target Moongrove,
three-target Moongrove, Wolf damage, and three-ally Groveheart pressure for 123
seconds over eight deterministic seeds in level-20 fixed PBE gear. It measures
all three capstones and also runs Moonwing, Wolf, and Bruin rotations against an
attacking live mob.

Two role profiles complete the balance contract. `runDruidBruinTankProbe` is
the druid arm of the owned-class off-tank probe: real-swing mitigation of
Bruin against Wolf posture, threat per 100 damage under the bear multiplier,
full-bank Marrowbreak snap threat, Menace forced-target uptime, and the 110%
threat handoff after leaving the form (pinned in
`tests/druid_balance_probe.test.ts`). Groveheart heals from a dedicated
intellect-leather fixture (the shared agility loadout starves the healer's
mana pool) and is pinned inside the peer healer envelope on the owned-class
HPS harness at a shared seed (`tests/owned_class_balance_harness.test.ts`).
Groveheart's three-ally throughput sits with the triage healers, well under
the AoE ceiling of Spiritmend chain healing: a flagged PBE tuning question,
deliberately not resolved by inventing base heal values here.
