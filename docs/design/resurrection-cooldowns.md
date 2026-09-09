# Resurrection coverage and cooldowns

Owner directive (2026-09-01): every primary healer spec fields a resurrection,
and every healer resurrection shares one five-minute cooldown. Recorded here so
the numbers stop being folklore; `tests/healer_rez_parity.test.ts` pins all of
it.

## The roster

| Class (spec) | Ability | Kind |
| --- | --- | --- |
| Paladin (any, quest-earned) | Recall the Fallen | Out-of-combat single revive; the Sunmender rite answers for the whole group from level 16 (`src/sim/combat/paladin_rite_of_many.ts`) |
| Priest (Benison and Doctrine) | Prayer of Returning | Out-of-combat group revive |
| Shaman (Spiritmend) | Ancestors' Return | Out-of-combat group revive |
| Druid (Groveheart) | Wildwake | In-combat single revive |
| Druid (Groveheart) | Grove Awakening | Out-of-combat group revive |
| Mage (Chronomancy) | Temporal Reversal | In-combat single revive |
| Mage (Chronomancy) | Collective Reversal | Out-of-combat group revive |

## The cooldown rule

- Every healer resurrection above runs on a five-minute cooldown, and the group
  revives are pinned equal to Collective Reversal's so no mass revive outclasses
  another.
- `requiresOutOfCombat` blocks group resurrection while the hate-table or
  boss-group combat hold remains active. The five-minute cooldown limits
  repeated resurrection across encounters and after the boss resets.
- The one deliberate exception: Temporal Reversal keeps its ten-minute
  cooldown. Chronomancy fielded the game's first combat resurrection and its
  longer clock keeps a death costly there; Wildwake's five minutes follows the
  shared healer rule instead.

## Mechanics shared by every revive

All player revives route through the offer flow
(`src/sim/combat/resurrection_offer.ts`): only the dead player may accept, the
offer expires, and the accept returns them at the caster's side with no
resurrection sickness. Reach (range plus line of sight, 40 yd ceiling) comes
from `src/sim/combat/resurrection_reach.ts`; mass revives sweep the authoritative
group or raid roster (`src/sim/combat/mass_resurrection.ts`).
