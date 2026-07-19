# Shaman owner pass for v0.28.0

Status: implementation draft for PBE review. This is a Shaman-only content slice on top of
the shared Talents 2.0 infrastructure. It requires Levy or Fernando approval before landing.

## Goals

- Restore a distinct automatic rotation for each specialization without adding a training card.
- Keep all six choice rows shared across Thundercall, Warspirit, and Spiritmend.
- Follow the row framework: movement, survival, control, amplification, power spike, capstone.
- Keep rows mobile-friendly. Levels 5 to 14 primarily alter existing abilities. Level 17 grants
  exactly one new active, and level 20 offers one active or two passive capstones.
- Let Warspirit cover short off-tank windows without replacing a dedicated tank specialization.

## Automatic specialization identities

### Thundercall: Fulmination

Arc Bolt adds a Thunder Ward charge, up to 9. Each charge gives Arc Bolt a 5% chance to
Overload for a free 50% repeat that can chain once. Earthen Jolt consumes the ward and deals
8 Nature damage per charge to the target and nearby enemies. The existing spell damage and
spell haste bonuses remain.

This gives Thundercall a visible build-and-spend loop while preserving the passive power restored
for v0.28.0.

### Warspirit: Skyrend

Landed auto-attacks and Ancestral Strike build up to 5 Skyrend stacks. Each stack shortens the
next Arc Bolt by 20% and increases its damage by 10%. Arc Bolt consumes the stack, becoming
instant at 5.

Warspirit also gains the minimum off-tank chassis:

- 10% maximum health and 20% armor.
- Stonebound Weapon doubles all threat while active. Switching imbues removes the threat bonus.
- Elemental Demand is granted as a 15 yard taunt.
- The specialization remains a damage role. It has no raid-tank finder role, no passive threat
  unless Stonebound Weapon is active, and no always-on damage reduction.

The intended off-tank build adds a level 8 sustain choice and Stone Aegis at level 17. The player
must deliberately trade damage or utility choices for survival.

### Spiritmend: Cleansing Tides

Completing Chain Heal makes the next Mending Waters within 8 sec cost 50% less. The existing
20% mana-cost reduction remains. This creates a repeatable group-heal to efficient single-heal
loop without another button.

## Shared choice rows

| Level | Theme | Option 1 | Option 2 | Option 3 |
|---|---|---|---|---|
| 5 | Movement | Rebounding Current: completing Arc Bolt grants 30% movement speed for 3 sec | Guiding Spirits: Mending Waters can be cast while moving | Wolfstep: makes Shadewolf instant |
| 8 | Defense | Imbued Lifeblood: imbued auto-attacks heal 4% maximum health, 3 sec internal cooldown | Stonewake Shell: a hit above 15% maximum health grants a 12% maximum-health absorb, 20 sec internal cooldown | Ancestral Mending: the same trigger heals 12% maximum health, 20 sec internal cooldown |
| 11 | Control | Fault Rebuke: Earthen Jolt interrupts with a 2 sec school lockout | Rime Lock: Rime Jolt roots for 2 sec | Gripping Earth: grants an area root |
| 14 | Management | Fault Line: every third Arc Bolt makes the next Jolt free | Imbued Tempo: imbued auto-attacks reduce Jolt cooldowns by 0.5 sec | Returning Current: every third Jolt restores 8% maximum mana |
| 17 | Power spike | Elemental Discharge: an imbue-dependent damage, threat, burn, or slow burst | Stone Aegis: reduces the next 6 direct hits by 20% | Springwell: an instant emergency heal over time |
| 20 | Capstone | Storm Chorus: group attack, cast, and channel haste | Storm Recall: every third Jolt resets Ancestral Strike and primes an instant core cast | Undertow Promise: every third core action heals the Shaman for 10% maximum health |

## Mobile and cross-spec checks

- The level 5 to 14 rows add only one optional active, Gripping Earth.
- The level 17 row adds exactly one active because its three choices are mutually exclusive.
- Fulmination, Skyrend, and Cleansing Tides are automatic and consume no action-bar slots.
- Every row has a valid use for all three specializations. Options can favor a play style, but no
  option requires a different specialization's signature ability to function.
- The Warspirit threat posture is explicit and removable, so damage builds do not pull threat by
  merely selecting the specialization.

## Balance targets for PBE

- Fulmination Overload must remain below the value of banking charges for an Earthen Jolt area
  discharge when several targets are present.
- Skyrend at 5 stacks produces a mobile Arc Bolt, not a replacement for Ancestral Strike or white
  swings.
- A Warspirit using Stonebound Weapon should hold secondary targets against normal damage and
  healing threat, but should remain less durable than Protection, Vanguard, or Bruin Form.
- Spiritmend should gain a mana rhythm, not free Chain Heal spam.
- No choice-row proc may draw random numbers unless its description states a chance.
