# Resurrection coverage and cooldowns

Every primary healer spec fields a resurrection. Out-of-combat resurrection
abilities have no cooldown (owner directive, 2026-10-05). Combat resurrection
keeps its existing cooldown. `tests/healer_rez_parity.test.ts` pins the roster,
cooldowns, and successive casts.

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

- Recall the Fallen, Prayer of Returning, Ancestors' Return, Grove Awakening,
  and Collective Reversal have no cooldown. This includes Recall the Fallen's
  Sunmender group upgrade.
- `requiresOutOfCombat` still blocks resurrection while the hate-table or
  boss-group combat hold remains active. Cast times, mana costs, and reach
  restrictions remain unchanged.
- Wildwake keeps its five-minute combat resurrection cooldown, and Temporal
  Reversal keeps its ten-minute combat resurrection cooldown.

## Mechanics shared by every revive

All player revives route through the offer flow
(`src/sim/combat/resurrection_offer.ts`): only the dead player may accept, the
offer expires, and the accept returns them at the caster's side with no
resurrection sickness. Reach (range plus line of sight, 40 yd ceiling) comes
from `src/sim/combat/resurrection_reach.ts`; mass revives sweep the authoritative
group or raid roster (`src/sim/combat/mass_resurrection.ts`).

## Who a single revive is begun over

- The combat revives (Temporal Reversal, Wildwake) need an explicit dead
  group member, through a party-frame mouseover or the current target. In a
  fight, which body gets the one combat revive is the decision.
- Recall the Fallen is the out-of-combat single revive, and it needs no
  selected body, so it works like the group revives. When the press names no
  fallen ally, the rite begins over the current target if that is a fallen
  member (even one out of reach, so a deliberate choice is never swapped),
  and otherwise over the nearest fallen member whose body is within reach
  (`src/sim/combat/fallen_ally_target.ts`, pinned by
  `tests/fallen_ally_target.test.ts`). With nobody to raise, it refuses with
  the group revive wording.
