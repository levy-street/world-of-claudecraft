# Heroic Nythraxis: raid tier + encounter

Branch: `feature/heroic-nythraxis-tier` (worktree `woc-heroic-nyth`), based on
`origin/release/v0.24.0`. Not pushed yet.

## Goal

Heroic Nythraxis shared the normal loot table and only appended 2 heroic epics,
so a heroic kill dropped 4 normal-tier pieces on top of 2 heroic ones (6 total,
mixed tiers). Make the heroic raid its own clean tier (5 drops, all `[HEROIC]`,
item level 33) and add difficulty via three summoned adds and four mechanics.

## Status

| Part | What | State |
|---|---|---|
| A | 7 raid epics rebalanced item level 31 -> 33 | Done, committed |
| B | Raid drop table 2 groups -> 5 groups (5 drops) | Done, committed |
| C | Suppress normal-tier loot on a heroic raid kill | Done, committed |
| D | `[HEROIC]` tooltip type-line tag | Not started |
| E | Three add mobs (Aldren / Malric / Voss) + models | Not started |
| F | Summon channel after a successful pillar pop | Not started |
| G | Tank-swap stacking curse (both phases) | Not started |
| H | Voss taunt-immune caster-seeking threat AI | Not started |
| I | Heroic versions of the two legendary weapons (ilvl 37) | Not started |
| J | Heroic set pieces share normal set ids (mix for bonuses) | Not started |

Commit so far: `feat(loot): Heroic Nythraxis drops 5 ilvl-33 raid epics, no normal gear`

## Part A: item level 33 rebalance (committed)

The 7 raid heroic epics moved from item level 31 to 33 (a clear step above heroic
dungeon gear: variants 28, dungeon final-boss sets 31). Item level is derived from
a source level plus the epic bump (+6), so a new raid-only source level 27 gives
33 while the five-mans stay at 25 (item level 31).

`src/sim/content/heroic_loot.ts`

```
export const NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL = 27;
export const NYTHRAXIS_RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
```

`src/sim/item_level.ts` registers the raid boss table at 27, the five-mans at 25:

```
for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
  const src =
    bossId === NYTHRAXIS_RAID_BOSS_ID
      ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL
      : HEROIC_LOOT_SOURCE_LEVEL;
  for (const entry of entries) {
    if (entry.itemId) bump(entry.itemId, src, false);
  }
}
```

Stat budgets are exact for item level 33 (mainhand/chest = 23, legs = 21,
helmet = 20), pinned by `tests/item_level.test.ts`:

| Item | Slot | Was | Now (ilvl 33) |
|---|---|---|---|
| Scepter of the Deathless Court | mainhand | int 12, spi 10 | int 13, spi 10 |
| Deathless Warguard Legmail | legs | str 11, sta 9 | str 12, sta 9 |
| Soulrend Diadem | helmet | int 10, spi 8 | int 11, spi 9 |
| Scourgehide Carapace | chest | agi 12, sta 10 | agi 13, sta 10 |
| Deathless Greatblade | mainhand | str 13, sta 9 | str 14, sta 9 |
| Soulforged Warplate | chest | int 12, spi 10 | int 13, spi 10 |
| Stormcaller's Focus | mainhand | int 13, spi 9 | int 14, spi 9 |

## Part B: 5 drops (committed)

The raid table went from 2 roll groups (2 drops) to 5, each group summing to 1.0
so exactly one item drops per group. Grouped by archetype:

- Group 1 (str plate/mail): Deathless Warguard Legmail | Deathless Greatblade
- Group 2 (heal-mail): Soulforged Warplate | Stormcaller's Focus
- Group 3: Scepter of the Deathless Court (guaranteed)
- Group 4: Soulrend Diadem (guaranteed)
- Group 5: Scourgehide Carapace (guaranteed)

## Part C: normal-loot suppression (committed)

`src/sim/loot/loot_roll.ts`: on a heroic claim of the raid boss, the boss's
normal-tier roll groups are skipped (copper still drops), so all 5 drops are
`[HEROIC]` item-level-33 epics. Scoped to the raid boss (the five-mans keep their
normal + heroic mix). Suppression draws no rng and only fires on a heroic claim,
so parity goldens are byte-identical.

```
const suppressBaseGroups = isHeroic && mob.templateId === NYTHRAXIS_RAID_BOSS_ID;
...
if (entry.rollGroup) {
  if (suppressBaseGroups) continue;   // skip normal-tier groups on a heroic raid
  ...
}
```

Note: the two legendary chase drops (Heartwood of the Deathless Crown, Thronebane)
sit inside the normal roll groups, so with suppression they no longer drop on
heroic. Resolved by Part I: heroic gets its own item-level-35 legendary versions
rather than the normal ones.

## Tests (committed, green)

- `tests/item_level.test.ts`: heroic sweep split into five-man (source 25, ilvl 31)
  and raid (source 27, ilvl 33) tiers, all budget-exact.
- `tests/dungeons.test.ts`: heroic Nythraxis drop test pins 5 drops and asserts no
  normal-tier gear leaks onto a heroic corpse.
- `tests/parity`: green, draw-order digest unchanged.

## Remaining plan (Parts D-H)

Confirmed decisions:

- Add summon: fires on EVERY successful pillar pop, 3s channel after the 5s
  Deathless stun expires (heroic only).
- Tank-swap curse: +10% damage taken per stack (max 10 = +100%), cast on the
  current main target every 15s, lasts 45s, both phases. Uses the existing
  `vulnerability` aura kind (dealDamage already multiplies by 1 + sum of values).
- Malric's boss shield: the existing `wardAllies` mob capability (periodic
  `absorb` barrier including the boss); the mob loop skips it while Malric is
  stunned, giving "shield the boss unless you stun the priest" and the
  "Absorb, Absorb" combat text for free.
- Voss: taunt-immune, randomized threat, prefers casters/healers, ~40% of the
  warrior add's damage. The one new sim primitive (a targeting extension).
- Models: Aldren -> `skel_warrior`, Malric -> `skel_necromancer`, Voss ->
  `skel_rogue` (already in the `templateId -> model` map in
  `src/render/characters/manifest.ts`).
- `[HEROIC]` tag: new `ItemDef.heroic` flag, set on the 7 raid items, rendered on
  the tooltip type line ("Epic Armor [HEROIC]"), tag localized across all locales.

## Tier rule: heroic is +4 item levels above normal

The whole heroic Nythraxis set is +4 item levels above its normal counterpart:

- Normal epics are item level 29 (level 20 + epic 6 + raid 3); heroic epics are
  33 (already committed in Part A).
- Normal legendaries are item level 33 (level 20 + legendary 10 + raid 3); heroic
  legendaries are 37 (Part I).

## Part I: heroic legendary weapons (item level 37)

Heroic versions of both Nythraxis legendaries, +4 above the normal pair.

New items (mirror the normal legendaries, keep the same weapon procs and
requiredClass, add the `heroic: true` flag from Part D):

| Heroic id | Base | Slot | Legendary budget @ ilvl 37 |
|---|---|---|---|
| `deathless_heartwood_heroic` | Heartwood of the Deathless Crown | mainhand | 49 (spi/sta/int, keep ratio) |
| `kingsbane_last_oath_heroic` | Thronebane, Last Oath of Thornpeak | mainhand | 49 (str/agi/sta, keep ratio) |

Item level: put them in the raid heroic table so they register at
`NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL` (27); legendary quality (+10) gives item level
37 with no special-casing. Budget math: `round(37 * 1.9 * 1.0 * 0.7) = 49`
(legendary mult 1.9, mainhand mult 1.0). The current legendaries carry 44 at
ilvl 33; use `normalizePrimaryStats(base.stats, 49)` to redistribute on the same
ratio. Add a legendary case to the `tests/item_level.test.ts` heroic sweep (it
only checks epics today).

Drop wiring: keep the raid at FIVE drops. Fold each heroic legendary into one of
the existing five roll groups as a low-chance entry (mirror the normal table,
where a legendary is a ~0.03 chance at the top of a group and the group's epic
chances shrink to keep the group summing to 1.0). So a heroic kill still yields
five items, occasionally a legendary in place of an epic.

i18n: two new legendary weapon names need translation in every locale (item names
are not English-only; the coverage test fails otherwise). The `[HEROIC]` tag from
Part D still comes from its own localized key, so the names themselves just need
the base translation.

## Part J: set bonuses mix across normal and heroic

Set bonuses are counted purely by the `set` string on each equipped item
(`src/sim/entity.ts`: `setCounts.set(item.set, count + 1)`), so a heroic piece
carrying the same `set` id as its normal counterpart counts toward the same
bonus. Goal: wearing e.g. 2 normal + 2 heroic pieces of a set completes it.

The normal Nythraxis sets are `crownforged` (mail, str, warrior/paladin),
`nighttalon` (leather, agi, rogue/hunter/druid), `soulflame` (cloth, caster), and
`stormcallers` (mail, shaman caster). Assign each heroic ARMOR piece the matching
set id by armor type + class archetype, so the heroic pieces extend those sets
into new slots (normal covers head/shoulder + a 3rd; heroic adds chest/legs):

| Heroic item | Slot / type / classes | Set |
|---|---|---|
| `deathless_warguard_legmail` | legs, mail, war/pal/sham | `crownforged` |
| `scourgehide_carapace` | chest, leather, rogue/hunter/druid | `nighttalon` |
| `soulrend_diadem` | helmet, cloth, casters | `soulflame` |
| `soulforged_warplate` | chest, mail, pal/sham | `stormcallers` |

The three weapons (`scepter_of_the_deathless_court`, `deathless_greatblade`,
`stormcallers_focus`) stay setless (weapons are not part of these armor sets).
Adding the `set` field is the whole change; the counting mechanic already mixes
tiers. Add a test: equip 2 normal + 2 heroic pieces of one set and assert the
set-count threshold fires. Flag the exact set assignment for owner review (class
archetypes are close but not identical, e.g. `stormcallers` is shaman-only
normally while `soulforged_warplate` is paladin/shaman).
