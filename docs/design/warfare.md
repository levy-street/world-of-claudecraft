# Warfare tuning

Warfare is one player-facing PvP combat rating. On the character sheet it shows
both effects together: the percentage increase to damage dealt to hostile players
and the percentage reduction to damage taken from hostile players.

The implementation keeps separate offense and defense fractions so their caps can
be tuned independently, but those are internal mechanics rather than separate
player-facing stats. Every current FURY item grants the same Warfare rating to
both sides.

Both are inert outside hostile player-versus-player combat. Friendly damage,
self-damage, pets, player-versus-mob damage, and mob-versus-player damage do not
read Warfare.

## Rating curve and cap

Ten rating grants one percentage point. Both effective fractions cap at 20
percent. The combat path clamps defensively and the derived character-sheet
stats are also capped, so the displayed value always matches the applied value.

FURY's item-level 28 epics carry Offense and Defense Rating equal to the slot's
item-level primary-stat budget. A complete 11-slot kit totals 168 of each rating,
or 16.8 percent Offense and 16.8 percent Defense. This lands below the cap and
leaves room for later progression.

Warfare ratings are secondary ratings, like Crit Rating and Haste Rating. They do
not replace or inflate authored primary attributes. Each item still satisfies
the existing exact primary-stat budget for an item-level 28 epic, while the
Warfare schedule is pinned separately by the PvP catalog tests. The raw PvE tier
remains below item-level 31 heroic raid gear, and Warfare adds value only against
players.

The combat API receives damage after the caller's armor or resist calculation, so
Warfare multiplies that resolved amount before absorb shields. Keeping it as a
single, isolated multiplier makes the interaction explicit; mathematically it is
independent of mitigation apart from the engine's integer-rounding boundary.

## Honor income

Phase 1 starts with these owner-selected values:

- Ranked 1v1 win: 25 Honor.
- Ranked 2v2 win: 50 Honor per winning player.
- Fiesta takedown: 20 Honor.
- Completed Fiesta match: 20 Honor.
- Fiesta win bonus: 40 Honor.

Only the first ranked Arena win against the same opponent or team pays Honor
each UTC day. Repeated Fiesta rewards against the same opposition pay 100, 50,
25, then 0 percent.
Ranked wins also taper after 10 wins in one UTC day to 50 percent, then after 15
wins to a 25 percent floor. These values are named constants and can be tuned
without changing rating, matchmaking, or combat rules.

Offline Fiesta practice pays no Honor. Fiesta forfeits pay no completion or win
bonus. Ranked and Fiesta result accounting is exactly once, including a
disconnect during the post-match return delay.

## FURY prices

FURY sells one item-level 28 epic tier for every equipment slot the game
currently supports. Prices are per purchase:

| Slot | Honor |
| --- | ---: |
| Main hand | 800 |
| Chest | 700 |
| Legs | 600 |
| Helmet | 500 |
| Shoulder | 400 |
| Gloves | 300 |
| Feet | 300 |
| Waist | 250 |
| Neck | 225 |
| Ring | 150 |

The current equipment model has main hand, helmet, neck, shoulder, chest, waist,
legs, gloves, feet, and two ring positions. It does not yet have cloak, wrist,
trinket, offhand, or ranged equipment positions.
