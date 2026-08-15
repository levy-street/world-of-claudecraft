# Destruction Warlock

Destruction is a deterministic siege caster. It builds a small secondary resource,
prepares a target with Burning Pact, and chooses between a slow single-target bolt,
sustained ground pressure, or an execute. It does not use Affliction's multi-DoT
engine or Necromancy's summon economy.

## Resource: Ruin

- Ruin has five visible pips and persists as synchronized aura state.
- Gloom Bolt generates one Ruin when its projectile lands.
- Conflagrate generates one Ruin and one Desolation.
- Ruinbolt and Rain of Fire cost three Ruin.
- Duskfire costs one Ruin and refunds it when its claimed target dies within five
  seconds.
- Copied Brand damage and Pyre Colossus pulses never generate Ruin; the Colossus
  instead grants one Ruin every second while active.

## Rotation

Burning Pact is the setup spell. Conflagrate requires the caster's Burning Pact,
pulls one future tick forward without deleting the effect, and has two charges with
a twelve-second recharge.

Desolation changes the next spender:

- Ruinbolt casts 30% faster.
- Rain of Fire begins with an immediate wave instead of waiting for its first
  interval.

Ruinous Brand marks an enemy for fifteen seconds. The next three direct spells echo
for 25% damage when cast into the branded enemy, or copy 50% of their resolved direct
damage to it when cast into another target. The echoes cannot recurse, generate Ruin,
or repeat proc rolls.

## Major cooldown

Pyre Colossus is a two-second aimed cast with a three-minute cooldown. It impacts
for area Fire damage and fights for thirty seconds as a guardian without replacing
the normal demon. Every two seconds it burns all nearby enemies, and every second it
grants the Warlock one Ruin.

## Localization handoff

Spanish and the newly introduced ability keys are refreshed in this contribution.
The following reworded existing descriptions still need a maintainer translation
pass in every non-English locale except Spanish before release:

- `entities.abilities.rain_of_fire.description`
- `entities.abilities.shadowburn.description`
- `entities.abilities.conflagrate.description`
- `entities.abilities.summon_infernal.description`
- `entities.abilities.chaos_bolt.description`

## Level progression

| Level | Addition |
| --- | --- |
| 5 | Destruction specialization, Ruin, and Conflagrate |
| 10 | Ruinbolt |
| 14 | Duskfire |
| 16 | Ruinous Brand |
| 12 | Rain of Fire, rank 1 (4 sec) |
| 18 | Rain of Fire, rank 2 (6 sec) |
| 20 | Pyre Colossus |

Blackrot, Hex of Anguish, Sear, and Wraithborn are excluded from committed
Destruction. Their definitions remain intact for other Warlock specializations and
save compatibility.

## Tuning anchors

| Ability | Mana / Ruin | Cast/CD | Damage |
| --- | --- | --- | --- |
| Conflagrate | 40 / generates 1 | instant, 2 charges, 12s recharge | 151-179 plus one advanced Burning Pact tick |
| Ruinbolt | 65 / costs 3 | 2.5s, no cooldown | 358-437 |
| Duskfire | 35 / costs 1 | instant, 12s cooldown | 72-84 below 20% health |
| Ruinous Brand | 35 / none | instant, 20s cooldown | three 50% copies |
| Rain of Fire | 45-60 / costs 3 | instant, no cooldown | 5-7 per wave for 4s; rank 2: 8-11 for 6s |
| Pyre Colossus | 100 / generates 1/sec | 2s aimed, 180s cooldown | 58-72 impact; 84 damage every 2s within 8yd for 30s |
