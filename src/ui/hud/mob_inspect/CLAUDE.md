# src/ui/hud/mob_inspect: the mob inspect window

Inspect any unowned mob (hostile or not, alive or a corpse) from the target frame
menu (right-click, long press or double tap on the target frame, or a nameplate's
menu gesture) to see its level, rank, family, traits, live combat stats and its
full loot table with per-kill drop chances.

## Shape
- `mob_inspect_view.ts`: the pure core. Static content (family, rank, traits, the
  template `loot` plus `HEROIC_BOSS_LOOT`) is read directly, the Loot Explorer
  precedent. The loot model MIRRORS `rollLoot` (`src/sim/loot/loot_roll.ts`):
  independent chance rows, one exclusive draw per `rollGroup`, `questId` and
  `normalOnly` gates, the 0.6x to 1.4x coin band, and for a mob a Heroic claim
  can cover, the whole Heroic table (variant swaps via `heroicLootItemId`, the
  `heroicCopper` base, the `HEROIC_BOSS_LOOT` append). The post-roll quality
  upgrade (`rollEnemyLootQuality`) is deliberately not shown: it changes a
  copy's grade, never what drops. A change to the roller's rules changes this
  model in the same change.
- `roll_group_odds_core.ts`: exact per-kill odds for exclusive roll groups.
  Groups that share items (Nythraxis's two pools) are solved together by
  enumerating every outcome through the PRODUCTION `pickRollGroupWinner`, so
  its fall-forward past an already-won item is called, never re-implemented.
  Such a cluster renders as one box labeled with its roll count; every row's
  chance is per kill. `tests/roll_group_odds_core.test.ts` pins that every
  shipped table enumerates exactly (no estimate ever reaches the window).
- `mob_inspect_window.ts`: the cold painter. It rebuilds on open, once when the
  live read settles (guarded by a per-open generation, so a late answer for an
  earlier mob never paints), and on `relocalize()`.
- `mob_target_menu_view.ts` + `mob_target_menu_controller.ts`: the unowned-mob
  target menu, moved out of `Hud.openMarkerMenu`. Every such mob gets Inspect;
  the raid-marker picker keeps its old gate (a live hostile mob while in a party).

## The live stat read is the one IWorld dependency
Health, weapon damage, swing time, armor and the crowd-control / slow
immunities (template OR spawn flag, the rule combat applies) come ONLY from
`IWorld.mobInspectInfo`, never from the template: instance tuning (heroic and
normal dungeon retunes, rift ranks) rewrites the template before `createMob`
stamps the spawn, so a template-derived number would be wrong for exactly the
mobs players most want to read. The sim half is `src/sim/mob/inspection.ts`
(disclosure-bounded: unowned mobs only, same world or instance, inside the
interest drop edge); online it is the `inspectMob` wire command
(`server/mob_inspection.ts`, `src/net/mob_inspect_request.ts`). The spawn
formula itself has one owner, `src/sim/mob/combat_stats.ts`.

## Tests
`tests/mob_inspect_view.test.ts` (core + menu rows), `tests/mob_inspect_window.test.ts`
(happy-dom painter + menu controller), `tests/mob_inspection.test.ts` (sim),
`tests/server/mob_inspection.test.ts`, `tests/mob_inspect_transport.test.ts`.
