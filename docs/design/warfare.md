# Warfare tuning

Warfare is one player-facing PvP combat rating. On the character sheet it shows
both effects together: the percentage increase to damage dealt to hostile players
and the percentage reduction to damage taken from hostile players.

The implementation keeps separate offense and defense fractions so their caps can
be tuned independently, but those are internal mechanics rather than separate
player-facing stats. Every current FURY item grants the same Warfare rating to
both sides.

Warfare applies to ALL hostile player-versus-player combat and never to PvE
(owner rule, 2026-09-24). Both sides of a hit resolve to the player who controls
them (`pvpController`), so a pet, guardian or totem deals damage with its owner's
Offense and takes it with its owner's Defense, and a WARFARE signature fires
against a hostile player's pet as it does against the player. Friendly damage,
self-damage, and anything touching a mob no player controls (player-versus-mob
and mob-versus-player) do not read Warfare.

## Rating curve and cap

Ten rating grants one percentage point (`PVP_RATING_PER_PCT`). Both effective
fractions cap at 30 percent (`PVP_OFFENSE_CAP` and `PVP_DEFENSE_CAP` in
`src/sim/pvp/power.ts`). The combat path clamps defensively and the derived
character-sheet stats are also capped, so the displayed value always matches the
applied value.

FURY's epics sit at item level 31, level with the heroic five-man and rift
clear-time epics, and each carries Offense and Defense Rating equal to the full
primary-stat budget of its slot (`WARFARE_RATING_FRACTION`, 1.0, on every slot).
The arithmetic that reaches the cap:

| Wearing | Offense / Defense rating | Result |
| --- | --- | --- |
| The seven set armor pieces | 120 / 120 | |
| The four unsettable slots (main hand, neck, two rings) | 62 / 62 | |
| **Complete 11-slot kit, before any set bonus** | **182 / 182** | 18.2% / 18.2% |
| Complete kit plus the 2-piece bonus | 182 / 222 | 18.2% / 22.2% |
| Complete kit plus the 4-piece bonus | 222 / 222 | 22.2% / 22.2% |
| **Complete kit plus the seven-piece set** | **302 / 302** | **30.0% / 30.0%** (clamped) |

The two points over 300 are rounding slack, nothing more. The set carries 120 of
a fully geared character's 302 rating, about 40 percent: it is a meaningful
top-up that rewards completion, not the main event. The 18.2 percent base is a
rise over the 16.8 the tier shipped with, so no partial kit is a per-piece
regression while a player is mid-grind.

The two honor trinkets sold beside the kit (`WARFARE_TRINKET_STOCK` in
`src/sim/content/pvp_honor.ts`, 800 honor each, defs in
`src/sim/content/trinkets.ts`) carry Warfare on the jewelry rule: one attribute
at `WARFARE_JEWELRY_STAT_FRACTION` of the item-level-31 trinket line (10 of 13,
with no stamina top-up because the trinket slot is outside the stamina model)
and Offense and Defense Rating at the full line (13 each). They sit outside the
eleven-slot kit and carry no set tag, so the table above is unchanged: both
trinkets on top of the complete kit read 208 / 208 (20.8 percent) before any set
bonus, and the kit plus the seven-piece set stays clamped at the 30 percent cap.

Read the 2- and 4-piece rows as progress rather than as builds. Armor is ranked,
so a class equips its own weight and anything below it: cloth wearers have
exactly one usable family, leather wearers would never drop to cloth and lose
armor, and only the mail classes have two families, which they would never mix
because one is Strength and the other caster. The intermediate tiers exist to pay
a player while they are buying.

The whole schedule is pinned by `tests/pvp_honor_gear.test.ts` (the per-item
budget, price and jewelry guards) and `tests/warfare_gear_tier.test.ts` (the
tier arithmetic and the anti-hybrid property).

Warfare ratings are secondary ratings, like Crit Rating and Haste Rating. They do
not replace or inflate authored primary attributes.

The combat API receives damage after the caller's armor or resist calculation, so
Warfare multiplies that resolved amount before absorb shields. Keeping it as a
single, isolated multiplier makes the interaction explicit; mathematically it is
independent of mitigation apart from the engine's integer-rounding boundary.

## Vitality: honor gear's health bonus

Owner rule (2026-09-24): PvP gear gives players significantly more health than
players without it, and it never works in dungeons or raids. The same combined
Warfare Defense Rating (gear plus set) also grants maximum health
(`pvpVitalityFromRating` in `src/sim/pvp/power.ts`): six rating per percent,
capped at +80 percent (`PVP_VITALITY_RATING_PER_PCT`, `PVP_VITALITY_CAP`; raised from
+50 for Warfare Season 2, which alone carries the rating past a Season 1 kit). A full
11-slot kit alone (182 rating) gives about +30 percent and the seven-piece set
(+120) lands at about +50 percent.

Where it applies (`src/sim/pvp/vitality.ts`, safest-first): anywhere on the
instance plane (dungeons, raids, delves, rift floors, any instance added later)
it is OFF, unless the player is in a battleground or arena match; everywhere else
(the open world) it is ON. It is decided on the world PvP pass twice a second,
also on a realm whose world PvP switch is off, and a player whose state flips is
recalculated once with the health fraction preserved, so a switch never gains or
loses health.

What it does to the numbers, level 20, full honor kit, measured on the Sim
(`tmp_pvp_stamina/` probes, 2026-09-24): a fire mage 1,265 to about 2,100 health
in PvP, an arms warrior 1,732 to 2,598. In a mirror duel against the same spec in
raid best-in-slot, the honor kit wins 1.13x (arms) to 2.27x (destruction), where
without Vitality arms (0.76x) and elemental (0.94x) lost and combat and fire were
even. Inside an instance every tank's honor kit stays below raid best-in-slot on
effective health (health over the share of a level-22 boss hit that survives
armor), pinned in `tests/honor.test.ts`.

Caster honor armor and weapons also carry half the stamina premium the physical
piece in the same slot carries (`WARFARE_CASTER_STAMINA_PREMIUM_SHARE`), which
closes most of the cloth gap in honor gear; jewelry is excluded so it stays below
the badge jewelry.

## Stat budgets, and why honor gear is not a PvE shortcut

Three authored fractions shape every FURY item, all named constants in
`src/sim/content/pvp_honor.ts` so the tests pin the constant rather than a
number:

| Constant | Value | Applies to |
| --- | ---: | --- |
| `WARFARE_STAT_FRACTION` | 0.90 | primary stats on armor and weapons |
| `WARFARE_JEWELRY_STAT_FRACTION` | 0.75 | primary stats on neck, rings and the honor trinkets |
| `WARFARE_RATING_FRACTION` | 1.00 | Warfare Offense and Defense Rating, every slot |

Armor mitigation and weapon damage are the slot's inherent baseline rather than
budget-derived, and both sit on the item-level-31 curve beside the same-slot,
same-armor-type PvE epics.

Jewelry is held lower on purpose. What it is calibrated against is the Heroic
Quartermaster's badge jewelry, which sits at item level 26, five levels below
this tier, and carries 25 of a combat rating on every piece. At the armor
fraction a Warfare ring would reach 12 primary points against the badge ring's 11
and a Warfare neck 13 against the badge neck's 12, overtaking a source five item
levels lower on raw stats. At 0.75 the ring lands on 10 and the neck on 11, and
the badge-jewelry guard in `tests/pvp_honor_gear.test.ts` passes untouched.

Badge jewelry is not the only other jewelry source. The rift epic ring
`abysswrought_band` (`src/sim/content/rift/items.ts`) is item level 31, level
with this tier, and carries 13 primary points and 25 Haste Rating against the
Warfare ring's 10 and no rating. A ring above the honor ring therefore already
exists and is farmable. The 0.75 fraction still stands on the reasoning above: it
is what keeps the honor ring from out-statting a lower tier, and a same-tier PvE
ring sitting above it is the ladder working rather than a hole in it.

The rule this tier is built to, which **replaces** the older assertion that honor
gear "never out-stats same-tier PvE gear" (that sentence was written when item
level 28 was the ceiling, and that tier no longer exists):

> Honor gear sits at the current five-man epic item level, carries a deliberate
> primary-stat discount against a same-slot PvE epic, and never reaches raid or
> legendary stat levels. Its advantage over PvE gear is expressed entirely in
> Warfare, which is inert outside hostile player-versus-player combat.

Moving the tier to item level 31 at a 90 percent stat fraction does make a
complete honor kit a credible floor for a player who has no heroic epics. The
answer to "is honor a shortcut past the heroic tier" is structural rather than a
tuning argument:

- Every item-level-31 PvE epic in the game carries a combat rating: hit, crit, or
  haste. **No Warfare piece carries one, and none will.** Pinned from both sides
  by `tests/warfare_gear_tier.test.ts` and `tests/combat_rating.test.ts`.
- A Warfare piece carries 90 percent of the slot's primary-stat budget; every
  item-level-31 PvE epic carries 100 percent. Same-slot, the honor chest is 20
  points against every item-level-31 PvE chest's 22.
- Every Warfare set bonus is a Warfare rating or a PvP-gated effect, so the set
  contributes exactly zero in PvE, while the PvE tier sets contribute attack
  power, stats, haste, and procs.

So the honor kit in PvE is a stat-only kit at a 10 percent discount with no
ratings and no set. That is a legitimate floor for a fresh level 20 and it is not
a substitute for the heroic tier.

One qualification on that discount: it is a throughput discount, not a
survivability one. On the Strength-mail profile the harness gears
(`tests/warfare_balance_harness.test.ts`), the honor kit carries about 9 percent
fewer primary stat points than a same-tier five-man PvE kit (160 against 176) and
yet has MORE effective health in PvE, 3,524 against 3,217, because Warfare armor
sits on the same item-level-31 armor curve while the kit's budget is weighted
toward Stamina. What the honor kit actually gives up is attack power and crit,
which is where the PvE tier spends its extra budget and all of its ratings. A
player who takes the honor kit into PvE is trading damage for durability, not
taking a uniformly worse kit.

## The five Warfare sets

The five armor families are also five item sets (`src/sim/content/item_sets.ts`).
Neck, rings and weapons carry no set tag: they are shared across role profiles,
so the seven armor pieces are the only coherent grouping.

| Set id | Name | Armor | Identity |
| --- | --- | --- | --- |
| `warfare_furyforged` | Furyforged Battlegear | mail | Strength |
| `warfare_stormbound` | Stormbound Vestments | mail | caster |
| `warfare_ashstalker` | Ashstalker Kit | leather | Agility |
| `warfare_cinderweave` | Cinderweave Regalia | cloth | caster |
| `warfare_thornhide` | Thornhide Garb | leather | caster |

Thornhide was added after review, and the gap it fills is worth recording. A
druid's maximum armor weight is LEATHER (`LEATHER_CLASSES` in
`src/sim/equipment_rules.ts`), and before it the only int/spi families were
Stormbound, which is mail and unwearable, and Cinderweave, which is cloth and a
full rank below what the class can wear. A caster druid was therefore giving up
an entire armor rank to a content gap rather than to a decision.

The 7-piece capstone made that worse rather than better. While WARFARE items
carried no set at all, a druid could mix cloth and leather freely and lose
nothing; the capstone turned that hedge into a forfeit, since six Cinderweave
plus a leather chest gains armor but gives up the 80/80 and drops Warfare from 30
to 20 percent. Adding the family removes the trap rather than tuning around it.

Its stat identity is Cinderweave's, slot for slot, because the caster budget is
the caster budget. Its armor is Ashstalker's, slot for slot, because armor is a
function of weight and item level rather than of stat identity. It carries no
`requiredClass`: like every WARFARE piece it gates on armor type, so a rogue may
wear it and gain nothing, exactly as with Cinderweave today.

Breakpoints are 2, 4 and 7 of the seven armor pieces, the same in every family:

| Tier | Bonus |
| --- | --- |
| 2 pieces | +40 Warfare Defense Rating |
| 4 pieces | +40 Warfare Offense Rating, and crowd control cast on you by hostile players lasts 15 percent less |
| 7 pieces | +80 Warfare Offense and Defense Rating, plus the family signature |

The 4-piece wording is deliberate: no pet applies hard crowd control today (pet
abilities apply slows, damage over time and a spell-vulnerability mark, none of
which pass through `Sim.diminishedCrowdControlDuration`), so "cast on you by
hostile players" is exact. A future pet stun or fear must route through that
funnel and resolve its caster with `pvpController` so the reduction covers it.

Signatures, all `pvpOnly` and therefore inert in PvE by construction (the gate in
`src/sim/combat/set_procs.ts` sits before the chance roll, so a signature draws
no rng outside hostile player-versus-player combat):

| Set | Signature | Trigger | Effect |
| --- | --- | --- | --- |
| Furyforged | Unbroken Oath | kill | Killing a hostile player grants a 200-damage absorb for 10 sec |
| Ashstalker | Ashen Step | kill | Killing a hostile player grants +40 percent movement speed for 6 sec |
| Stormbound, Cinderweave | Emberward | spell cast | 15 percent chance on cast to grant a 120-damage absorb for 8 sec, 20 sec internal cooldown |
| Thornhide | Thornguard | spell cast | 15 percent chance on cast to grant +15 percent dodge for 6 sec, 20 sec internal cooldown |

Movement speed on the Agility set is tuned for Thornhollow Fields, which is a
capture-the-flag mode.

Thornguard is dodge rather than a third absorb on purpose. Thornhide carries
Cinderweave's stats on Ashstalker's armor, so it is the furthest ahead of the
five families and the last one that should be handed more effective health.
Dodge is AVOIDANCE, so it does not compound the stamina weighting the caster
families already gain against their PvE counterparts, and it answers melee
pressure, which is the caster druid's actual weakness. For scale, a real
defensive cooldown is much larger: Evasion is 25 percent and Deterrence 30.

Note also that Stormbound and Cinderweave share Emberward, so five families carry
four distinct signatures. That is deliberate rather than an oversight (armor is
ranked, so the two caster families never compete for the same wearer) but it is
worth stating so it is not read as a gap.

### Why the capstone is 7 of 7

An earlier draft used 2, 4 and 6, on the reasoning that leaving one armor slot
free was a build decision. It was not a decision: the seventh slot had one right
answer, which was to abandon the chest, the most expensive armor piece and the
one with the best PvE replacement. Measured against a tier-1 plus tier-2 warrior,
the six-piece design's full honor kit cost 5,400 honor in armor and measured
1.03x, while six pieces plus a raid chest, a raid weapon and badge jewelry cost
4,200 and measured 0.89x. The cheaper build won outright.

At 7 of 7, dropping the chest forfeits both the 22-rating piece and the 80/80
capstone: 30.0 percent Warfare falls to 20.0, and the same hybrid build measures
1.34x. `tests/warfare_gear_tier.test.ts` pins the property (the loss must exceed
the chest's own rating by a wide margin, proving the capstone and not merely the
piece is lost) and `tests/warfare_balance_harness.test.ts` pins the ratio.

### The replacement invariant

Every Warfare set bonus is either a Warfare rating or a PvP-gated effect, never a
flat stat. This is what makes "honor gear is never better than raid gear in a
raid" structural rather than a balance argument, and it is enforced rather than
documented: `tests/warfare_gear_tier.test.ts` rejects any other effect key on a
Warfare tier, and asserts that the resolved capstone aggregate leaves every
non-Warfare field at zero.

## The main hand is a contested slot, deliberately

The main hand remains dominated by PvE drops for anyone who has them. An
item-level-31 honor weapon carries 20 primary stats and 15.9 weapon DPS; the
item-level-33 raid epic carries 30 and 19.1, and the item-level-37 rift legendary
carries 49 and 21.4. A full honor kit that swaps in the raid epic weapon goes
from 1.03x to 0.89x, and with the legendary to 0.81x. No Warfare budget a single
main hand can carry closes a two-tier item-level gap, and raising it would not
help: a complete kit already sits at the cap, so rating above 300 is discarded
and the first slot dropped is nearly free.

It also loses inside its own tier, which the item-level argument above does not
reach. Holding the Warfare armor fixed and varying only the main hand against the
harness's PvE reference (lower is better for the honor side), the honor
one-hander measures 0.988x against the same-tier five-man one-hander's 1.004x
(`gravewyrm_cleaver`), so it is the correct ONE-HANDER at its item level. The
same-tier five-man TWO-HANDER (`greatfang_of_the_basin`) measures 0.884x: a
farmable item-level-31 drop beats the honor weapon outright, and the honor weapon
carries the joint highest price in the catalog while losing to it. Further up,
the item-level-33 raid two-hander measures 0.856x and the legendary 0.781x.

This is accepted rather than fought. It is classic-authentic (PvP sets were
armor; weapons came from raids), it is a real build decision, and the honor
weapon remains the correct main hand for a player who has not yet farmed a
two-hander at this item level or above. Jewelry, by contrast, lands almost
exactly even against badge jewelry, which is the right shape for a choice.

## Arena and duels

`PVP_OFFENSE_CAP` and `PVP_DEFENSE_CAP` are global, and `isHostileTo` is true for
ranked arena and duels as well as battlegrounds. Raising both from 0.20 to 0.30
takes the maximum gear swing from 1.2 / 0.8 = 1.50x to 1.3 / 0.7 = **1.86x**, and
the sets' PvP-gated procs and crowd-control reduction fire in all three contexts.

This is accepted for the tier refactor: an ungeared level 20 losing badly to a
fully geared one is the intended shape, and ranked arena has its own rating
ladder that matches like against like. The lever if live data says the swing is
too wide is pre-identified: `PvpCaps` already takes independent offense and
defense caps and `pvpFractionsFromRatings` already threads them, so a split (for
example 0.25 offense against 0.30 defense) is a constant edit with no structural
change.

## Honor income

Phase 1 starts with these owner-selected values:

- Ranked 1v1 win: 25 Honor.
- Ranked 2v2 win: 50 Honor per winning player.
- Fiesta takedown: 20 Honor.
- Completed Fiesta match: 20 Honor.
- Fiesta win bonus: 40 Honor.
- Thornhollow Fields battleground win: 120 Honor per winning player
  (`BATTLEGROUND_WIN_HONOR`).
- Thornhollow Fields battleground loss, played out to a result: 40 Honor
  (`BATTLEGROUND_LOSS_HONOR`); a draw pays the loss amount to both sides.
- First Thornhollow Fields WIN of each UTC day: a flat 40 Honor on top of the win
  award (`BATTLEGROUND_FIRST_WIN_BONUS_HONOR`), so the day's first win pays 160
  against a routine 120, a ratio of 1.33x.
- Killing blow 10, assist 4 (`BATTLEGROUND_KILL_HONOR`,
  `BATTLEGROUND_ASSIST_HONOR`).

Every Thornhollow Fields award above was DOUBLED on 2026-09-25 (owner tuning,
alongside King of the Hill's ramp) so Warfare Season 2 gear is a goal of weeks,
not a season: the figures further down that quote 60/20 and a 900-a-day session
are the pre-doubling record.

Every weekend is the Double Honor Weekend: every Thornhollow Fields Honor
award (the result, the kill and assist drip, and the first-win bonus) pays
`DOUBLE_HONOR_MULTIPLIER` (2x) times its normal amount while the weekend
window is open (`src/sim/pvp/honor_event.ts`, applied by the battleground
award paths in `honor.ts` before their single floor). The window opens
`DOUBLE_HONOR_LEAD_HOURS` (12) before the Saturday reset window and closes
at Monday's reset: in realm time that is Friday 3 PM to Monday 3 AM. The
open rides a second host-fed key (`eventLeadDay`, the reset-day key probed
that many hours ahead), the close rides the reset-day boundary like every
other daily window, and a host that sets no calendar (both keys empty)
never runs it. Battleground only, never arena or Fiesta Honor: that is the
scope the feature request asked for by name, and it is the classic-era shape,
where a battleground holiday weekend boosted one battleground's faucet.

While the event window is open, a played-out loss or draw also pays the WIN
base (still decayed on `BATTLEGROUND_RESULT_DR`, still doubled): owner tuning
for the early, gearless realm, so queueing on an event day is never a wasted
evening for the side that stayed. Winning still pays more through the
first-win bonus and the natural kill-drip edge, forfeits still pay nothing on
either side, and weekday loss economics are untouched. Both the 2x and the
loss boost are owner tuning to revisit against live weekend queue data. The
diminishing-returns curves below apply first, then the event: the weekend
raises income without weakening any anti-farm rule.

Only the first ranked Arena win against the same opponent or team pays Honor
each UTC day. Repeated Fiesta rewards against the same opposition pay 100, 50,
25, then 0 percent (`HONOR_REPEAT_DR`, shared with battleground kill and assist
honor). Thornhollow Fields RESULTS decay on their own curve,
`BATTLEGROUND_RESULT_DR`, which pays 100, 50, 25, then a 25 percent floor per
repeated opposing-team identity each UTC day: a full 5v5 match is long enough
that the arena's first-win-only rule would be needlessly punishing, and long
enough that a repeated opponent is queue shape rather than collusion.
Ranked wins also taper after 10 wins in one UTC day to 50 percent, then after 15
wins to a 25 percent floor. These values are named constants and can be tuned
without changing rating, matchmaking, or combat rules.

The two decay curves are deliberately separate. The zero floor is right where it
came from: in arena, meeting the same team repeatedly is evidence of win-trading.
In a 5v5 battleground on a low-population realm it is simply what the queue
produces, and the code cannot tell the two apart, so a zero floor made grind
length swing about 1.7x on queue variety rather than on effort. A 25 percent
floor keeps farming one premade heavily penalised (15 Honor against 60) while
honest repeat play never pays literally nothing. Battleground kill and assist
honor stay on the shared curve because their counters live on the match and reset
every match, so they never had this problem.

The daily bonus is flat rather than a multiple of the win award. An earlier shape
derived it (win times two, so the day's first win paid 180, three times a routine
one), which paid logging in for a single win better than it paid playing a
session, and on a day spent against one stable premade accounted for 53 percent
of all result honor: it was propping up the zero floor above rather than doing
its own job. The two are now sized independently.

The thing to watch after launch is the distribution of distinct opposing team
identities faced per player per day, bucketed by realm population. If thin realms
still cluster near one or two, the floor is set too low. That is a matchmaking
property, so the response is not a price change, which would compensate for it
everywhere else and mask it.

Offline Fiesta practice pays no Honor. Fiesta forfeits pay no completion or win
bonus, and a forfeited Thornhollow Fields match pays nothing on either side (the leavers'
opponents still take the rating win). A Thornhollow Fields deserter takes the loss on
the spot: leaving, disconnecting, or being jailed out of a live match records
the L and applies the loss-side rating delta immediately, so pulling the plug
while losing never protects a rating. Ranked, Fiesta, and Thornhollow Fields result
accounting is exactly once, including a disconnect during the post-match return
delay.

Honor itself is per CHARACTER, not per account (`PlayerMeta.honor`, and
`lifetimeHonor` beside it), so an alt starts the tier from zero and the rank
titles in the Book of Deeds are earned per character too. That is consistent with
how every other currency in the game is held, but it is worth stating plainly
next to a 7,550 honor kit: rolling a second character means earning it again.

Thornhollow Fields rating is its own per-character ladder (base 1500, floor 100), moved
zero-sum by the arena's Elo over team-average ratings; a draw applies the 0.5
draw score. The queue is rated but NOT rating-matched: matchmaking fills
first-come from the queue, and strict banding is an explicitly deferred
follow-up.

## World PvP income

The `/pvp` flag (`src/sim/pvp/world_pvp.ts`, rules in `world_pvp_rules.ts`, the
ground policy in `world_pvp_zones.ts`) is the open road to the same Warfare
vendor: no queue, no rating, no match clock. The verdict for a pair of players is
`worldPvpPairHostile`, and it reads the two flags AND the ground under each of
them. A flag takes `WORLD_PVP_DISARM_SECONDS` (300, the classic five minutes) to
come down and the drop waits for combat to end, so switching off can never fizzle
the blow already on its way. Raising it needs `WORLD_PVP_MIN_LEVEL` (10).

Three kinds of ground, declared per zone as `ZoneDef.worldPvp` (data-as-code in
`src/sim/content/`) and resolved by `worldPvpZonePolicyAt` through the strict
rectangle containment, so the instance plane reads as contested rather than as
whichever overworld zone a clamping lookup would misreport:

- `'sanctuary'`: no world PvP at all, flagged or not, under EITHER player. The
  Proving Shore (`content/proving_shore.ts`) and Eastbrook Vale
  (`content/zone1.ts`), so a new character can never be fought before they know
  what the flag is.
- `'ffa'`: free-for-all. Everyone standing there is hostile to everyone else
  standing there, flag or no flag, whatever their levels (owner spec,
  2026-09-24: anyone on free-for-all ground is fair game), and every level
  hears the crossing notices. The flag's level gate still holds for the flag
  itself: an under-level character cannot raise one, so their hits there mark
  nobody and they stake no gold; the grey rule keeps their deaths worthless to
  a far higher killer. The
  Drakelands, the Frostveil Reach and the Amberfall (`content/drakelands.ts`,
  `content/frostveil.ts`, `content/amberfall.ts`): the three northernmost zones,
  the top row of the map (owner pick, 2026-09-24), the far edge of the world and
  its richest ground carrying the most risk.
- `'contested'`: everywhere else, and the default for a zone record with no
  `worldPvp` field. Two flagged players and nothing more.

The one exemption cuts through all three (`worldPvpPairExempt`): the same
player and two members of one party or raid are never hostile, in a
free-for-all zone as much as anywhere. A shared guild is not an exemption
(owner spec, 2026-09-24): guildmates outside one group fight like strangers,
and a guild that wants to stand together forms a party. Outside a
free-for-all zone every unflagged character is exactly as safe as before (the
#96 griefing invariant), and a flagged player can never touch an unflagged one.

Marking (`worldPvpHitMarksAttacker`): landing a hostile hit that needed NO flag
raises the attacker's own flag, which is only ever the free-for-all arm, an
unflagged attacker on an unflagged victim (`WORLD_PVP_MARKED_LINE`). Hitting a
player who is already flagged never marks anyone, so the victim, and anyone
defending them or defending a third party who is not marked, fights for free
while the aggressor ends up carrying the stake. A hit on a player's PET is
judged against the pet's owner (`worldPvpOnOwnedPetDamaged`, marking only: the
assist books key on the owner being hit), so opening on a stranger's pet marks
you exactly as opening on the stranger would. Crossing into and out of a
free-for-all zone is announced, and a FLAGGED player entering a sanctuary is told
the flag is idle there (`WORLD_PVP_FFA_ENTER_LINE`, `WORLD_PVP_FFA_LEAVE_LINE`,
`WORLD_PVP_SANCTUARY_LINE`; the zone pass in `updateWorldPvp`, on the dueness
form like the books sweep, never a modulo of the tick count).

The verdict is live, not fixed at application time: periodic harm between two
players (a bleed, a curse, a Maledict Gaze) re-asks `isHostileTo` before every
damaging tick (`src/sim/combat/periodic_harm.ts`), and a tick the verdict
refuses is skipped while the aura expires on the spot. An unflagged victim who
walks out of a free-for-all zone, or anyone who reaches a sanctuary, sheds the
bleed at the line instead of dying to it on ground where they could not be hit;
a source who has died keeps their ticks landing, the classic rule.

Two players mid-duel with each other are the duel's business, never the
world's: `isWorldPvpHostile` steps aside for that pair, so a duel fought on
free-for-all ground marks neither duelist and books no blow as a world kill; a
live battleground or arena does the same for everyone inside it.

A world kill moves a GOLD stake and pays an HONOR pool, both split across every
contributor: the killing blow, everyone who damaged the victim inside
`WORLD_PVP_ASSIST_WINDOW` (10 s, the battleground's window), and every flagged
healer who kept one of those damagers standing. The split is equal, with the
integer remainder going to the blow, so a clean 1v1 pays the whole of both and a
five-player gank pays each of them a fifth: more honor and more gold for fighting
alone is the owner's stated shape.

- Gold: the smaller of `WORLD_PVP_STAKE_CAP_COPPER` (5 gold) and
  `WORLD_PVP_STAKE_FRACTION` (10 percent) of the victim's purse, staked by a
  FLAGGED victim only. An unflagged player killed in a free-for-all zone loses
  nothing: they never opted in, so the ground may cost them a corpse run but
  never their purse. The victim is charged exactly what was paid out, never more.
  Only a FLAGGED contributor takes gold: an unflagged player who opens on
  flagged strangers in a free-for-all zone earns the honor and nothing else, so
  gold only ever moves between two players who both carry the stake, and
  hunting flags from behind no flag is never the best play.
- Honor: `WORLD_PVP_KILL_HONOR` (10) per kill, the whole pool, split as above.
  Deliberately BELOW the instanced faucets: a Thornhollow Fields win pays 120 plus
  its drip and a ranked 1v1 win pays 25, so a player who wants Warfare gear
  fastest still queues. Battleground and arena pay more; world PvP pays for
  being out in the world. The Double Honor Weekend does not apply to it (that
  event is battleground-only by design).
- Raids earn nothing (`worldPvpGroupEarns`, owner rule 2026-09-25, the King of
  the Hill raid rule carried to kills): a contributor in a raid group takes no
  honor and no gold and is left out of the split, so a zerg pays nobody and never
  dilutes a party's share; a kill by a raid alone stakes nothing from the victim.
- Anti-farm: the per-PAIR diminishing returns ride `HONOR_REPEAT_DR` (100, 50,
  25, then 0 percent) for honor AND gold alike, counted by `worldPvpPairRepeats`
  on a rolling `WORLD_PVP_DR_WINDOW_SECONDS` (one hour) window that opens at the
  FIRST kill of that victim by that contributor, not on a calendar day. The book
  is the session one (`WorldPvpBooks.killsByPair`, keyed by both characters'
  rename-proof identities), so a relog cannot reset it and a realm restart does:
  camping one player pays three times an hour and then nothing, a fully decayed
  kill is not counted, and the victim is not charged for a fully decayed
  contributor. The old persisted UTC-day counter is gone.
- The aid rule: an unflagged player who heals, shields or buffs a FLAGGED player
  who is in a world fight (hit by an enemy, or hitting one, inside the assist
  window) raises their own flag first, the classic rule, so nobody sustains a
  killer from behind a flag they do not wear. One shared hook,
  `worldPvpOnPlayerAided`, carries all three: `combat/heal.ts` for heals and
  `combat/effect_dispatch.ts` at the `absorb` and `buffTarget` sites. Aid to an
  UNFLAGGED player marks nobody, so keeping a bystander alive stays free. Under
  `WORLD_PVP_MIN_LEVEL` the raise is refused like every other and the aid earns
  nothing. The rule's consequence is deliberate and said out loud: once the
  helper is flagged, they and the stranger they were keeping up are two flagged
  strangers, enemies under the pair rule, and the next heal, shield or buff on
  that stranger is REFUSED with `WORLD_PVP_AID_REFUSED_LINE` (the friendly
  target resolution in `combat/casting_lifecycle.ts`) rather than self-cast in
  silence. The way to keep aiding a flagged fighter is the exemption: a party.
  Only the open-world arm refuses; a duel, arena or battleground opponent on
  the target still self-casts, the habit those modes' healers rely on.
- The flag cannot be flapped: accepted changes are `WORLD_PVP_TOGGLE_COOLDOWN`
  (2 s) apart, refused with a notice in between.
- Operator kill switch: `WORLD_PVP_DISABLED=1` on the realm refuses every raise
  and loads every saved flag down (`SimConfig.worldPvpDisabled`); flags already
  up keep their ordinary disarm.
- Grey rule: a victim more than `WORLD_PVP_GREY_LEVEL_GAP` (5) levels below a
  contributor pays that contributor nothing (neither honor nor gold), the
  classic grey-kill rule and the reason a capped character cannot farm flagged
  low-level purses.

Deaths to a mob or the environment stake nothing, whatever the flag or the
ground says. A flagged player inside a live battleground or arena is under that
mode's rules, never the open world's, and the jail has its own brawl rule. Every
amount is integer copper and integer honor, the arithmetic is on the sim clock,
and nothing here draws rng, so the offline Sim, the server and the headless env
resolve every kill identically (`tests/world_pvp.test.ts`,
`tests/world_pvp_rules.test.ts`, `tests/world_pvp_zones.test.ts`).

## King of the Hill

Once every `HILL_WINDOW_SECONDS` (three hours) a hill rises somewhere in one of
the free-for-all zones (`src/sim/pvp/hill.ts`, rules in `hill_rules.ts`, the
zone set from `worldPvpFfaZones`). The moment is random: the warning's offset
inside the window is drawn by a private rng derived from the seed and the
window's ordinal (`hillPlanFor`, the natural rift portal precedent, so the
world's own rng stream never moves for a hill and every host resolves the same
time and spot), anywhere from the window's opening to
`HILL_LATEST_WARN_OFFSET_SECONDS` into it, so on schedule the whole hill fits
inside its own window. Only one hill stands at a time. A hill whose warning
sounds late (a spot retry, a `/dev hill` still standing, a realm switched back
on) slides whole (`hillTimesFrom`), so every hill keeps its full warning and
its full stand; the next window waits for it. The first window opens
`HILL_FIRST_WINDOW_AT_SECONDS` after boot.

A hill has three moments, each announced to the whole realm:

1. **The warning** (`hillWarningLine`): the zone and the minutes to the rise.
   The spot is chosen now, a `HILL_RADIUS` (50 yd) circle on dry, open ground,
   clear of the hub settlement and every collider, wholly inside its zone, and
   it is drawn on the ground as a still, faint outline, so parties can form and
   travel. Nothing counts yet. A failed spot search retries a minute on with the
   attempt number salted into the spot rng (so a retry searches new ground); a
   window whose planned stand passes before any spot is found is skipped.
2. **The rise** (`hillRiseLine`), `HILL_WARNING_SECONDS` (15 minutes) after the
   warning. The contest and the payouts run from here.
3. **The fall** (`hillFallenLine`), `HILL_DURATION_SECONDS` (45 minutes) after
   the rise. Banked seconds short of a payout are lost with it.

The realm's `WORLD_PVP_DISABLED` switch turns the hill off with the rest of
world PvP. A realm that slept through whole windows plans the current one.

Control is by headcount inside the circle, by PARTY (owner spec, 2026-09-24:
parties only). A party is one group and a lone player a group of one
(`hillGroupKey`); a raid member does not count at all (`hillStanding`). Any
level counts, since anyone on free-for-all ground is fair game. The
largest group that beats the holder's present members by a strict majority
(`hillChallengeStands`; a tie never moves the hill, an absent holder is beaten
by anyone) is the challenger, and after `HILL_CAPTURE_SECONDS` (60) of
unbroken majority it takes the hill (`hillContestStep`: a lapsed challenge
starts over, a new challenger starts its own clock). The dead do not count.
Everyone standing in the zone is already hostile to every stranger there (the
free-for-all arm, and guildmates outside one party are strangers), so the hill
needs no flag of its own.

Honor RAMPS with the hold (owner tuning 2026-09-25, replacing a flat 1 a minute
that paid 45 for a whole stand): each counted holder standing inside banks a
second per pass, and every `HILL_ACCRUAL_SECONDS` (60) pays `hillHonorPerPayout`
of the seconds the current holder has held the hill, `HILL_RAMP_STEP_HONOR` (2) a
minute for the first `HILL_RAMP_STEP_SECONDS` (five minutes), 2 more each further
five minutes, capped at `HILL_RAMP_MAX_HONOR` (12). The streak belongs to the
holding party and restarts when the hill changes hands, so a long hold is the
thing worth taking. A party's size (five) is the payee cap. A holder who steps
out banks nothing but keeps what they banked; leaving the party or the realm
forfeits it, and a capture clears the books. A full party holding an uncontested
hill for its whole stand earns about 380 each, about three Thornhollow Fields wins
at the doubled award; two held hills a day is about 760, so 10,000 Honor is about
13 days, level with a committed battleground day at the live result floor. No
diminishing returns: the cap and the pace are the limit.

The readout (`IWorld.hillInfo`, the `hill` self key) carries the geometry, the
phase, the holder from the viewer's seat, whether the viewer counts
(`standing`) and the minutes to the next phase change for everyone, and the
live counts and contest clock only for a viewer standing in the hill's zone
while it is risen, so the self wire elides it for everyone else between holder
changes. The HUD bar (`src/ui/hud/hill/`) shows in that zone: while announced,
the rise countdown and the distance to the marked circle; once risen, who holds
it, you against them, the contest fill, the distance and the fall countdown;
and in both, a note when the viewer does not count. The renderer draws the
circle (`src/render/hill_ring.ts`) in the holder's colour; `/hill` in chat says
where it stands or will rise. The state is session-only and never persisted.

Test levers (dev realms only, `ALLOW_DEV_COMMANDS`; also buttons in the dev
command window's Scenarios tab): `/dev hill [zone]` raises a hill at once and
stands you on its rim; `/dev hill warn [zone] [seconds]` starts a countdown (the
full warning, or a shorter one for a quick test); `/dev hill rise` skips the
countdown; `/dev hill end` makes the hill fall; `/dev hill next` runs the real
schedule's next hill now (its own zone and spot, the window spent).

## Season 2 (Vanguard)

A second, top tier of honor gear sells beside the five entry-tier sets above, which stay on
sale unchanged. Full design, the 54 set bonuses and their PvE ceilings:
`docs/design/warfare-season-2.md`.

- **27 spec sets**, one per spec, class-locked, each the five raid-set slots (helmet,
  shoulder, chest, legs, gloves) with a 2-piece and a 4-piece bonus that work everywhere.
- **Four season weapons:** a strength two-hander, a strength one-hander, an agility dagger and
  a caster staff.
- **Item level 35**, level with the Ignivar raid tier, on the honor discount: 0.9 of the line
  budget, the full-budget stamina floor, no hit, crit or haste rating, and 0.9 of raid armor.
  The Warfare ratings are 2.2x (Offense) and 3.4x (Defense) the slot budget, so a Season 2
  kit reaches the 30 percent caps and the +80 percent Vitality cap where a full entry-tier
  kit stops at about +50: about 10 percent more health in PvP (14 for casters), and nothing
  in dungeons or raids.
- **Prices:** 1.5 times the entry tier per slot, 6,600 Honor for a full set, 1,800 per weapon.
- **Pins:** `tests/warfare_season2.test.ts` (stock shape, stat, armor and weapon rules, set
  rows, and the tank effective-health guard).

## FURY prices

FURY sells one item-level 31 epic tier for every equipment slot the game
currently supports. Prices are per purchase:

| Slot | Slot budget | Honor |
| --- | ---: | ---: |
| Main hand | 22 | 1,200 |
| Chest | 22 | 1,200 |
| Legs | 20 | 1,050 |
| Helmet | 18 | 900 |
| Shoulder | 16 | 700 |
| Gloves | 15 | 550 |
| Feet | 14 | 550 |
| Waist | 15 | 450 |
| Neck | 14 | 400 |
| Ring | 13 | 275 |

- The seven-piece armor set, the capstone: **5,400 honor**.
- A complete 11-slot kit: **7,550 honor**.

Roughly 1.75x the schedule the tier launched with. It is now genuinely
best-in-slot for PvP armor and should be earned. The main hand comes down to the
chest's price rather than up: it shares the chest's slot budget of 22, so equal
pricing is the more principled reading of the ladder, and it is the slot most
likely to be replaced by a raid drop, so charging the tier's highest price for
its most replaceable item would be a trap. Rings and the neck stay the cheapest
slots so a new PvP player gets a real upgrade on the first day.

Item ids are frozen and this is a retune in place, so a player already holding an
old-tier piece receives the item-level-31 stats for free at merge, without paying
the rise. That is INTENDED, not merely tolerated: someone who bought into the tier
when it was bad should not be punished for having done so early, and the
alternative (minting parallel ids) would strand their purchase entirely and blank
the slot on load, which is the exact failure the frozen-id rule exists to prevent.

The population it affects is expected to be near zero in any case. The vendor is
unadvertised, the prices were already high relative to the tier's value, and the
gear was measurably worse than what the same player could farm, which is the
problem this whole change exists to fix. Grandfathering is therefore both the
right call and a cheap one.

The planning figures this schedule was set against were about 900 honor for a
committed day of Thornhollow Fields and 450 for a lighter session, which put the
seven-piece set at roughly 6 days of committed play and the complete kit at 8.4.
Those figures assume a mostly fresh opposing roster each match, and at this
game's live population that does not hold: a 5v5 queue recycles the same rosters,
so `BATTLEGROUND_RESULT_DR` sits at its 0.25 floor as the NORMAL case rather than
the tail. Result honor is then about 15 for a win and 5 for a played-out loss,
not 60 and 20. With the kill and assist drip on top, a match pays nearer 30 to 40
honor than the 60 to 80 the 900 figure implies, so the same session length is
worth nearer 400 honor a day: the seven-piece set is roughly 13 days of committed
play and the complete kit roughly 19.

Prices are not changing for this. They were set against the optimistic figure and
are being kept deliberately, so the correction above is a documentation accuracy
fix rather than a retune. Prices stay tunable and should still be revisited
against live battleground throughput. The first thing to look at is queue
variety: result honor decays per opposing team identity per UTC day, so on a thin
realm the grind runs materially longer than on a healthy one. That is a
matchmaking property, not a pricing one, and the response is not a price change.

The current equipment model has main hand, offhand, helmet, neck, shoulder,
chest, waist, legs, gloves, feet, and two ring positions (`EquipSlot` in
`src/sim/types.ts`), plus the trinket positions, where the honor counters sell
the two honor trinkets above. It does not yet have cloak, wrist, or ranged
equipment positions. FURY sells nothing for the offhand; the PvE tables do fill
it, with shields, held offhands, quivers, and their heroic variants.

That leaves a property of the tier worth recording, since it is a consequence of
the schedule rather than an oversight. All three Warfare weapons omit `hand` in
their weapon block, and `weaponHand` in `src/sim/equipment_rules.ts` defaults an
omitted `hand` to `onehand`, so every honor main hand is a one-hander. An honor
buyer therefore keeps an open offhand for whatever the class can put there, while
a two-handed PvE main hand benches the offhand outright for every class except
the Fury warrior's two-hand pairing. Whether the tier should sell an offhand, or
whether the honor weapon should stay a one-hander, is a later decision; this
paragraph records the property and decides nothing.

The same stock list is sold from two placements: FURY in Eastbrook and the named
quartermaster in Highwatch. One stock, two vendors.

Each of those two offers exactly ONE shop row in its gossip menu, the sectioned
Warfare window, and not the generic "Browse Goods" row beside it. Both rows
shipped briefly, on the reasoning that distinct labels made them tellable apart.
They are not really two options: a quartermaster's `vendorItems` IS the whole
Warfare catalog, so the generic grid was a flat copy of what the sectioned window
lays out by family. It was also the unsafe copy, because the ordinary vendor
window buys with no confirmation, while the sectioned window puts every purchase
behind one (`Hud.requestWarfarePurchase`); honor is unrefundable and a set piece
costs tens of thousands of it. The suppression is on the ROW, never on the stock,
since the honor buy path is generic over a non-empty `vendorItems` and would
switch the shop off entirely if the list were emptied. Selling is the one thing
lost at these two NPCs, and nothing is stranded by it: the buyback list is per
player, not per vendor.

Within the window the families are ordered by armor class, heaviest first, so the
list reads mail, then leather, then cloth: Furyforged, Stormbound, Ashstalker,
Thornhide, Cinderweave. The set table above is ordered by when each family was
authored, which is why Thornhide appears last there and fourth in the shop.
