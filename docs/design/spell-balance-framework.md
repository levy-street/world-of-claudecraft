# Spell and Ability Balance Framework

Status: living measurement contract.

This framework defines how class power is measured. The complexity and talent rules live in
`docs/design/class-design-rules.md`. The Frost and Fury application lives in
`docs/design/frost-fury-rebalance.md`.

## Existing tools

| Tool | Current use | Current limitation |
|---|---|---|
| `scripts/balance_report.mjs` | Analytical caster spell comparison | It does not model a specialization rotation, melee, rage, pets, or raid buffs |
| `scripts/dummy_sim.mjs` | Empirical direct-cast checks against the real simulation | It does not select a specialization and resets resources, so it is not a Fury or finite-mana authority |
| `tests/spell_balance.test.ts` | Proportionality and no-strict-dominance regression checks | It does not enforce the cross-spec DPS band |

Run the direct comparisons with `npx tsx scripts/balance_report.mjs` and
`npx tsx scripts/dummy_sim.mjs`; pass a class such as `mage` to the latter to limit its output.

The existing scripts remain useful for identifying a direct spell that is strictly dominated by
another direct spell. Their class-rotation rows must not be cited as Frost, Fury, or nine-class
balance proof until the missing specialization and resource behavior is implemented.

## Required empirical profiles

Every damage specialization needs the same deterministic profiles:

| Profile | Duration | Targets | Purpose |
|---|---:|---:|---|
| Sustained | 180 sec | 1 | Rotation DPS and resource stability |
| Burst | 60 sec | 1 | Cooldown stacking and opener ceiling |
| Area | 60 sec | 5 | Cleave scaling and target caps |

Each profile fixes:

- Simulation seed.
- Player level and specialization.
- Gear and item level.
- Talent selections.
- Target armor, resistances, level, and position.
- Resource regeneration rules.
- Rotation policy.
- External buffs and debuffs.

The fixture never restores mana or rage each tick. If a profile requires an artificial resource
condition, it must be named separately and cannot serve as the parity gate.

## Required report

The report contains:

- Total damage and DPS.
- Main-hand and offhand white damage.
- Damage by active ability.
- Damage by proc, pet, copied output, and aura.
- Resource generated, spent, expired, and wasted at cap.
- Major offensive cooldown uptime.
- Proc generation, consumption, expiration, and waste.
- Random draw count and digest when the profile exercises randomness.

Source attribution follows the real simulation source ids. Autonomous pet damage and copied
output cannot disappear from a player's report because their source entity differs from the
player entity.

## Balancing rules

1. Proportionality: comparable direct attacks and spells pay for damage through cast time,
   weapon speed, resource cost, cooldown, range, and risk.
2. No strict dominance: an action that loses on damage, efficiency, mobility, and utility has no
   legal role.
3. One owner per output: each damage packet, proc, resource gain, and cooldown reduction names the
   slot or talent that owns its budget.
4. Class parity: the highest comparable damage specialization remains no more than 10 to 15 percent
   above the lowest in sustained single-target DPS at the level cap.
5. Burst visibility: burst is reported separately and cannot hide behind an acceptable sustained
   average.
6. Area payment: area strength comes from a lateral choice or target rule. It does not stack on
   top of the strongest single-target build for free.
7. Resource stability: a correct continuous rotation neither starves indefinitely nor remains at
   the cap while its intended spender is available.

## Level-band checks

Level-cap parity is not enough for a short leveling game. Resource and action changes run at the
spec-selection level and at representative later unlocks through the level cap. Each checkpoint
uses gear intended for that level.

For Warrior, report white DPS and rage per second by hand. For Mage, report finite-mana duration
and proc cadence. A cap fix that breaks an early-level rotation is not complete.

## Raid evidence

Raid logs are used to identify suspicious profiles and to validate the result after a deterministic
fix. Compare only parses with the same encounter, duration window, target count, relevant gear,
and external buffs.

Report median and upper-tail results rather than one maximum. Encounter-specific damage should be
separated from class-owned damage where the log format permits it.

## Change protocol

1. Add or update the deterministic fixture and show the pre-change failure.
2. Change one source of power.
3. Show the same fixture passing.
4. Run parity and deterministic replay checks.
5. Re-run the three profiles.
6. Record any remaining live-raid or PBE validation gap in the PR.

Gameplay coefficients require a classic-era formula, a checked-in reference, or a measured result
from this framework. A design preference alone is not numeric evidence.
