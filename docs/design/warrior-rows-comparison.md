# Warrior Choice Rows: Current Flip vs Blaine1705 Port

This compares the warrior choice rows that were in the flip branch with Blaine1705's
live-realm-playtested warrior rows from PR #1609. Recommendation defaults to Blaine's content
because his tuning was playtested, especially the survival/resource rows. Names below use the
IP-safe shipped coinages where the port replaced verbatim names.

| Level | Slot | Flip before port | Blaine1705 source | Recommended | Why |
|---|---:|---|---|---|---|
| 5 | 1 | Juggernaut: Onrush cooldown reduced by 50% | Double Charge | Twin Onrush (Blaine) | Playtested mobility choice is richer. Ported as `bonusCharges: 1` on Onrush. |
| 5 | 2 | Warleap grant | Pursuit | Hot Pursuit (Blaine) | Kill-speed loop is more warrior-specific than another movement active. Ported as `onKillSpeedPct`. |
| 5 | 3 | Warbringer: Onrush roots for 1.5 sec | Crushing Charge | Crushing Onrush (Blaine) | Same mechanic family, but Blaine's 4 sec root plus 50% slow for 15 sec is the tested version. |
| 8 | 1 | Jawcrack grant | Second Wind | Rallying Breath (Blaine) | Blaine explicitly nerfed this from 3% to 1.5% per sec after playtest. Ported as conditional regen below 35%. |
| 8 | 2 | Concussive Clap: Quaking Blow AoE root | Die by the Sword | Swordguard (Blaine) | Survival active is a cleaner row identity than more control. Ported as a granted defensive cooldown. |
| 8 | 3 | Crippling Strikes: Hobbling Cut cheaper and stronger slow | Victory Rush | Triumph Rush (Blaine) | Kill-window self-heal gives warrior sustain without passively overbuffing Hobbling Cut. |
| 11 | 1 | Seething Fury grant | Piercing Howl | Razor Howl (Blaine) | AoE slow fills group control better than raw rage. Ported as `aoeSlow`. |
| 11 | 2 | Furious Bloodrage: Blood Toll cooldown and rage buff | Storm Bolt | Stormthrow (Blaine) | Ranged stun is a clearer control option. Ported as a granted projectile stun. |
| 11 | 3 | Commanding Presence: shout buffs increased by 50% | Lingering Dread | Lingering Dread (Blaine) | Novel fear-break budget is stronger design space. Ported as `fearBreakPct`. |
| 14 | 1 | Crippling Blows: Bladed Gyre slows | Anger Management | Rage Discipline (Blaine) | Resource economy row beats another slow. Ported as auto and ability rage multipliers. |
| 14 | 2 | Bladed Gyre grant | Blood Offering | Blood Offering (Blaine) | Owner note preferred improving Blood Toll rather than granting a duplicate. |
| 14 | 3 | Executioner: Early Grave cheaper and stronger | Battle Rhythm | Battle Rhythm (Blaine) | Every-third-cast rhythm is more interactive. Ported as deterministic cast counter. |
| 17 | 1 | Bulwark grant | Recklessness | Reckless Vow (Blaine) | Offensive cooldown row is a better tier identity. Ported as crit and rage-generation self-buffs. |
| 17 | 2 | Eleventh Hour grant | Avatar | Colossus (Blaine) | Existing Colossus active was already present but upgraded to Blaine's control break plus damage amp. |
| 17 | 3 | Iron Hide: 12% armor | Bloodbath | Red Harvest (Blaine) | Kill-stacking offensive payoff is more distinctive than passive armor. |
| 20 | 1 | Steel Cyclone grant | Colossal Might | Giant's Momentum (Blaine) | Rage-spend cooldown refund creates a capstone loop. Ported as `cdrPerRage`. |
| 20 | 2 | Colossus grant | Bladestorm | Steel Cyclone (Blaine and existing) | Existing safe-named Steel Cyclone already mapped to Blaine's channel concept. Kept as the active capstone. |
| 20 | 3 | Muster grant | Sanguine Aura | Red Banner (Blaine) | Party offensive aura is more warrior-leader flavored than another AP shout. Ported as haste plus damage ally buffs. |

No warrior slot kept the old flip option as the recommended winner. The only old content retained is
the existing IP-safe ability shell for Colossus and Steel Cyclone, updated or reused to carry Blaine's
mechanics.

## Blind panel re-evaluation (2026-07-10) — the real best-of-both

The first pass above defaulted to Blaine's content ("because his tuning was
playtested"). That biased the result to 6-0. A blind re-run corrected it: both
row sets were anonymized (provenance + Blaine's giveaway prefix stripped, all
grants equally expanded, 6 options per level shuffled), and a 3-judge panel
scored every option 1-10 on merit with no knowledge of authorship.

Result: **Blaine 4 rows, flip 2 rows** (not 6-0).

| Level | Flip avg | Blaine avg | Winner |
|---|---:|---:|---|
| 5 | 6.0 | 7.0 | Blaine |
| 8 | 7.2 | 5.0 | Flip |
| 11 | 4.3 | 7.0 | Blaine |
| 14 | 7.0 | 5.0 | Flip |
| 17 | 5.2 | 7.6 | Blaine |
| 20 | 6.1 | 6.7 | Blaine |

The panel rewarded behavior-changing options and punished flat passives
regardless of author. Blaine's two most-cited "playtested" options scored the
LOWEST in the whole set: Rallying Breath (1.5%/sec regen) and Rage Discipline
(+25% rage) both averaged 3, as invisible passives. The flip's level-8 Jawcrack
interrupt tied for the single best option overall (8.0).

**Final shipped set (the merge the blind numbers support):** Blaine's rows
5/11/17/20 + the flip's rows 8 (Jawcrack interrupt / Crippling Strikes 70% slow
/ Concussive Clap root) and 14 (Executioner / Bladed Gyre / Crippling Blows).
Every option in the final set is behavior-changing or an active; no flat
passive survives. Blaine's row-8 mechanics (secondWind regen, triumph_rush,
swordguard) are now orphaned defs, kept for possible reuse.
