# World Quest Rewards and the Vault's World Row

Design brief, 2026-09-19. Written against `integration/world-quests-v0440` at feb78a1998 (World Quests 3847, Weekly Quests 4051, Clue Scrolls 4110, Weekly Vault 4052). Sources: the code on that branch, `docs/design/weekly-vault.md`, and World Quests Scope v1.1 (`docs/prd/world-quests/scope.md`). Every claim below was read from the code; the file anchors are listed at the end.

The ask: a PR against the integration branch that (1) gives world quests a real reward system and (2) fills the Weekly Vault's world-quest row. Your framing: daily rewards randomly generated from the "level 20 to 26" bracket and directly equippable by the character, the vault paying previous raid tier as solid catch-up loot, and loot tables across all 27 specs.

## 1. One correction to the framing first

The character level cap is 20 (`MAX_LEVEL`, `src/sim/types.ts`). Nothing beyond it exists except the cosmetic virtual level. So "20 to 26" is an item-level band, not a character band, and every equip gate clamps to 20. That turns out to be a good band to have named: it is exactly the pre-heroic shelf.

| Source | Item level | Notes |
|---|---|---|
| Quest rewards | 3 to 23 | Top rung is rare, source level 20 |
| Dungeon normal | 11 to 26 | Epics land at 26 |
| Heroic Mark vendor | 26 | 10 jewelry pieces, class-neutral |
| Dungeon heroic, generated variants | 25 rare, 28 epic | `heroic_<base>` ids, art inherited from the base |
| WARFARE (rated PvP) | 28 | |
| Nythraxis raid normal | 29 | The previous tier |
| Dungeon heroic, bespoke set | 31 | The "lucky" tier the scope doc names |
| Nythraxis raid heroic | 33 | |
| Ignivar, Crucible of the Last Spring | 35 | The current tier, normal and heroic pay the same pieces |
| Riftbound bands | 20 to 34 | The only per-copy scaled items in the game |

So your two targets map cleanly: daily world-quest gear lives in the 20 to 26 shelf with a deliberately rare 31, and the vault's world row pays Nythraxis normal at 29 (optionally heroic at 33). The scope doc says the same thing in its own words: "useful iLvl 20+ items, with rare lucky outcomes reaching iLvl 31", and it flags iLvl 31 as "an existing five-player heroic boss gear tier" whose appearance "must be tuned accordingly".

Two ladder holes to know about before you filter by item level: delve chest gear (the `reliquary_*` and `litany_*` pieces) and all 15 faction quartermaster items have no derivable item level at all, because neither route is registered in `buildSourceIndex` (`src/sim/item_level.ts`). Their tooltips show no item-level line and their equip gates fall back to quality bands. Any "20 to 26 band" filter silently excludes them, and the scope rule "rewards must state both item level and equip level" cannot hold for them until they are registered.

## 2. What the branch already gives you

World quests today pay exactly one of XP, copper, or a fixed item (`WorldQuestReward` is a three-arm union, one `reward` per quest). Only two of the 25 quests pay an item and it is the same one, `rift_essence`, a currency tool, not gear. Faction standing is added on top of every completion (30 below level 16, 80 or 100 above). There is not a single `ctx.rng` draw anywhere on the completion path, which matters below. The daily board is 16 quests (one rotating slot per zone plus three always-on dailies), the cycle id is `wq1_<day>`, the reroll is deterministic, and per-character progress plus a durable once-only claim token per quest are already saved.

The Clue Scroll work already added the two hooks a daily gear reward wants: `worldQuestSlateComplete` (every rotating slot the character can start, dailies excluded) and a once-per-cycle mark on the character (`clueScrollCycle`). Clue Scrolls gate at level 16. That is the natural home for "the daily completionist reward" the scope doc mentions.

The vault's world row is fully plumbed and only stubbed shut. Milestones are fixed at 2, 4 and 8 completions (`WEEKLY_THRESHOLDS.world`), `state.world` is saved and capped, `recordWeeklyWorldQuest` exists and is called from nowhere, `weeklyLootPool('world')` returns an empty list, and `worldQuestsAvailable` is hardcoded false. Lighting it up is four edits: call the recorder from `creditWorldQuest` after the once-only guard, give the pool a world arm, flip the flag, add world to the playtest fixture. The sanitizer only accepts rare or epic weapons, armor or held offhands as a vault choice, so the world pool must be real equipment. There is no difficulty dimension on the world row (no `world_heroic` pool id), unlike raids and dungeons.

On class and spec fit, three things exist and one trap:

- `canEquipItem(cls, item)` is the one legality rule (`src/sim/equipment_rules.ts`). Trap: for anything with an armor type it checks armor weight only and never reads `requiredClass`, so every class-appropriate pool in the repo re-checks `requiredClass` by hand (`weeklyLootPool` does; `emissaryCachePoolForClass` checks only `requiredClass`; the Clue casket's lowest delve rung is class-blind and can hand a mage a mail shoulder).
- The active spec is explicit, not derived: `TalentAllocation.spec` and `TalentModifiers.role`, exposed as `talentSpec` and `talentRole` on both worlds. No talent-point counting needed.
- The 27-spec table already exists: `DEV_KIT_ROLES` in `src/sim/content/dev_kit_roles.ts`, one record per class-and-spec pair with stat weights, melee, healer, tank and hands flags, pinned by a test against `SpecDef.role`, plus `roleItemScore(role, item)`. It is labelled a testing convenience, not a balance statement. Two roles are not the genre default and the table knows it: arcane mage is a healer, feral druid is a tank. Armor weight is per class, not per spec (mail for warrior, paladin, shaman; leather for druid, rogue, hunter; cloth otherwise; there is no plate).

On "randomly generated": there is no random-suffix or affix system and no per-instance item ids (a deliberate anti-dupe decision). Two generation precedents exist. The heroic variant generator (`buildHeroicVariants`) mints static `heroic_<base>` ids scaled to a source level, inheriting the base's art and name. Riftbound bands are static shells with per-copy rolled stats (`ItemInstancePayload.rolled`). Those are your only two shapes for "generated" gear.

## 3. The decisions

D1. What triggers daily gear. Options: a gear chance on every quest; one guaranteed piece on slate completion; both. Recommendation: one guaranteed usable piece on slate completion for the 16 to 20 bracket, reusing the slate predicate and a once-per-cycle mark, plus a small per-quest chance if you want texture. Per-quest-only makes coverage impossible to reason about and pushes a rng draw into 16 completions a day.

D2. Where the item comes from. Three models:

| Model | What it is | Cost | Risk |
|---|---|---|---|
| A. Pick an existing item | Filter the live catalog to the 20 to 26 band, class and spec, draw one | No new ids, no art, no golden growth | Coverage is whatever the catalog happens to hold: 154 gear items in the band today (cloth 43, mail 38, leather 31, weapons 29, jewelry 11, offhands 2). Some spec-by-slot cells will be empty or thin, and most of the band gates at level 20 |
| B. A generated world-quest family | New static ids minted from chosen bases at a chosen source level, the heroic variant recipe with a `wq_` prefix and tag | Art inherited from the base, names resolve to the base; shipped-id golden and art audit counts grow by N; the reward matrix is an explicit, reviewable table | You author the matrix once (slot by armor weight by role); a moderate amount of new content plumbing |
| C. Per-copy rolled stats | Static shells, stats scaled per copy at award time, like riftbound bands | Scales to the exact player level; fewest ids | Most code: bags, tooltips, compare, perfecting and market all reason about `rolled`; widest anti-dupe and economy surface |

Recommendation: A for the vault row (the Nythraxis normal pool already exists as items) and B for daily gear, because it is the only model that lets you hand the scope doc its reward matrix and lets you say what every spec gets in every slot. Run the coverage script in section 6 first; if A's numbers turn out fine you can start there and move to B later without changing the roll seam.

D3. What "usable" means. Legal (they can wear it) is `canEquipItem` plus the explicit `requiredClass` re-check. Appropriate (they would want it) needs two more rules: armor weight equals the class's maximum, and the piece scores above zero for the active spec under `roleItemScore` (no int plate for warriors, no spirit for rogues). Decide the fallback when `spec` is null: class-wide pool. Decide whether hunters and enhancement shamans count weapons the same way the scorer does today. If you go this way, promote `dev_kit_roles` from a testing table to a content table with a name that says so, keeping its pin against `SpecDef.role`.

D4. Equip level for 16 to 19. Rare-or-better gear derives its equip level from its source level, so a source-20 piece is unequippable until 20. Options: mint two rungs (source 16 and source 20); one rung with an explicit `requiredLevel` override at 16; or accept that 16 to 19 bank the piece. The scope doc wants both numbers stated on the reward, so whichever you pick, the tooltip must say them.

D5. The lucky 31. Pool is the bespoke `HEROIC_ITEMS` set. Decide odds (the casket uses 10 percent for a gear piece and 1.5 percent for the mount), whether it is once per day or per slate, and whether it is class-filtered the same way.

D6. Binding and duplicates. Mark the daily piece `soulbound` or it becomes the World Market's catch-up dump. There is no unique flag; uniqueness is derived from quality, so repeats will happen under a uniform draw. A cheap smart-loot rule is to exclude ids the character already carries or wears (a deterministic bag scan). Decide vendor value.

D7. The vault pool. Nythraxis normal (29) filtered by `weeklyLootPool`'s strict filter, excluding set pieces the way the Emissary's Cache does (`isRaidGear`). Decide whether the 8-completion milestone should reach Nythraxis heroic (33): the row has no difficulty tier today, so that would be new UI. One tension to settle either way: the Emissary's Cache from the weekly quests branch already pays one raid piece from a pool that includes Ignivar at 35 for a single weekly charge, so a vault row paying 29 for eight world quests reads as the weaker weekly. Aligning those two is a design call, not a code one.

D8. Presentation. The board shows the reward today (`src/ui/world_quest_view.ts`). A random piece cannot be shown before the roll, so decide between a "gear reward" glyph plus band text, or rolling at the start of the day so the board can show the actual item. Rolling at day start is deterministic and previewable but needs the roll to live in the daily state; rolling at award time is simpler and matches the casket.

D9. Bundles. The reward model is one reward per quest. Gear as the slate-completion extra keeps XP, copper and standing as they are and avoids the model, payout and presentation changes the scope doc's correction warns about. If you want gear plus copper on individual quests, the union grows and the tracker and log change with it.

## 4. Recommended shape

Module-first, behind the seams the repo already has:

- `src/sim/world_quest_gear.ts`: the pool builder (band, class, spec, appropriateness) and the roll. Pure functions over `ITEMS` plus one `ctx.rng` consumer, unit-tested directly.
- `src/sim/content/world_quest_gear.ts`: the reward matrix as data (bases per slot, armor weight and role; the lucky pool; odds). Data-as-code is exempt from the size rules.
- The hook lands in `creditWorldQuest` immediately after the once-only claim token and before the clue entitlement, at a fixed position, and it draws every time it runs even when nothing is granted, so ownership can never fork the draw order. This is the first rng draw that path has ever made; the parity harness pins draw order per frame, so `world_quest_lifecycle` and any scenario that completes a world quest re-mints in the same change, with the diff read to confirm only the new draws moved.
- State: one `wqGearCycle` mark on the world-quest player state, saved beside `clueScrollCycle`, with a sanitizer arm. Nothing new on the wire unless the UI needs "today's gear claimed".
- The vault: the four edits from section 2, a `world` arm in `weeklyLootPool`, and the `worldUnavailable` copy retired or kept for custom worlds.
- Spec table: promote `dev_kit_roles` to a gameplay content table; keep its role pin.
- Register world quests as a source in `buildSourceIndex` so the new pieces derive an item level and an equip level and the tooltip can state both.

## 5. What CI will demand

- New item ids (model B): a `public/ui/items/<id>.webp` and a `mapping.json` owner each, unless the variant path inherits the base painting the way heroic variants do; `tests/shipped_item_ids.golden.json` re-minted; `scripts/item_art_audit.mjs` expected counts re-measured; the level-20 shelf pin in `tests/crafted_wearability.test.ts` (515 today) re-pinned if any new rare-or-better piece sources at 20 or above; `entities.items.<id>.name` catalog rows unless names resolve to the base; the naming and IP check.
- Player copy: every new string is a `t()` key in the matching catalog module, and wordy English needs its five non-Latin fills in the same change (M16). The vault's world copy is already in five locales.
- Deeds and Reliquary: catch-up gear is not conquerable unique loot, so Reliquary pages do not apply; a deed for the first world-quest piece is optional and cosmetic only.
- Wiki regen (`npm run wiki:content`) and the guide freshness test.
- Parity goldens as above. IWorld parity pins only if a new facet member is added (none needed for the recommended shape).
- Vault tests: `tests/weekly_rewards.test.ts` and the wire and window tests pin `worldQuestsAvailable` false and the empty world row today; they flip with the feature.
- Reviewers: `content-obligations-reviewer` on the content diff, `architecture-reviewer` on the sim diff for rng draw order and the SimContext seam, `qa-checklist` at the end.

## 6. Suggested split and first step

Two PRs against `integration/world-quests-v0440`, not one: the vault row first (small, mostly wiring, a pool and its tests, plus one golden re-mint if a parity scenario completes a world quest), then daily gear. The second is where the design decisions live and it should not hold the first hostage.

First concrete step before any of the decisions above: a coverage script over the live catalog that, for every class, spec and slot, counts the 20 to 26 band items that pass legality, weight and the spec scorer. That table tells you in one screen whether model A covers the matrix or model B is required, and it becomes the reward matrix's starting point either way.

## 7. Open questions only you can answer

1. Slate completion, per quest, or both (D1)?
2. Existing items or a generated world-quest family for daily gear (D2)?
3. Do 16 to 19 characters get gear they can equip now, or gear that waits for 20 (D4)?
4. Odds and cadence for the lucky 31 (D5)?
5. Does the vault's world row stop at Nythraxis normal, and how does it sit against the Emissary's Cache (D7)?
6. Should the board show the actual piece before it is earned (D8)?

## Anchors

`src/sim/world_quests.ts` (`awardWorldQuest`, `creditWorldQuest`), `src/sim/world_quest_state.ts`, `src/sim/world_quest_rotation.ts`, `src/sim/clue_scrolls.ts` (`worldQuestSlateComplete`), `src/sim/clue_casket.ts`, `src/sim/emissary_cache.ts`, `src/sim/weekly_rewards.ts` (`WEEKLY_THRESHOLDS`, `weeklyLootPool`, `recordWeeklyWorldQuest`, `weeklyRewardInfoFor`), `src/sim/weekly_reward_open.ts`, `src/sim/equipment_rules.ts` (`canEquipItem`, `maxArmorTypeForClass`), `src/sim/content/dev_kit_roles.ts`, `src/sim/dev_kit.ts` (`roleItemScore`), `src/sim/content/talents.ts` (`SpecDef.role`), `src/sim/item_level.ts` (`buildSourceIndex`, `itemLevel`), `src/sim/item_level_req.ts`, `src/sim/content/heroic_variants.ts` (`buildHeroicVariants`), `src/sim/rift/progression.ts` (`createRiftGearInstance`), `src/sim/types.ts` (`WorldQuestReward`, `MAX_LEVEL`, `ItemDef`), `docs/design/weekly-vault.md`, `docs/prd/world-quests/scope.md`.


## 8. Decisions taken (owner, 2026-09-19)

Recorded from the owner's direction after the brief was read. These supersede the open questions above where they overlap.

- Every world quest pays XP and faction standing. Standing already does; XP becomes universal, which changes the reward record from "one of XP, copper, item" to a bundle.
- Copper stays as a component and scales with level, highest at 20, under a hard budget: completing every world quest on a day at level 20 must not total more than 10 gold. Today's copper formula pays 60 silver per copper quest at 20, so 16 quests at that rate would already be 9.6 gold before the bonus purses (hard wisp maze 35 silver, glider 70 silver, ley boards, the champion, the salvage ambush). The per-quest base or the purses have to come down to fit, and the budget is what the tests should pin.
- Three quests per day carry an item reward, the same three for every player on the realm. The pick is deterministic from the cycle id, never an rng draw at completion. Recommended and not yet decided: make the item itself deterministic per day and per class as well (a hash of cycle, zone slot and class into the class table), so the board can show the actual piece before it is earned and everyone of a class sees the same one; attach the item to the zone slot so a reroll in that zone keeps the day's item.
- Nine loot tables, one per class, not 27. A class table spans its specs on purpose, for variety; the system consumes item ids per class and the owner authors the lists. Tests pin that every entry is legal and appropriate for its class (armor weight equals the class maximum, weapon proficiency, explicit class lock) and print a slot coverage matrix per class.
- The vault's world row pays Nythraxis, usable by the character. Implemented in the first PR as every Nythraxis Normal drop (item level 29) through the vault's strict usability filter, ungated by raid kills, no Heroic rung. The owner's "26 to 31" phrasing describes the shelf around that tier, not Nythraxis itself; widening the pool to that shelf is a one-line change if wanted.

- Hovering a world quest on the map must show the rewards the player will get for it that day. The map hover already exists (`src/ui/hud/map/map_marker_tooltip_content.ts`, `worldQuest` arm, built from `worldQuestRewardLine` in `src/ui/world_quest_view.ts`) and shows title, faction, status, objective progress, the reward line (today: XP or copper or the fixed item, plus standing) and time remaining. The second PR extends that line to the bundle (XP, copper, standing) on every quest and, on the three item days, the piece itself with icon, item level and equip level. That presentation is only possible because the day's item is fixed per day and class, which settles the "deterministic item" recommendation above in favour of yes. While in that file: the faction line and the standing text are hardcoded English rather than `t()` keys, an i18n gap inherited from PR 3847 to close in the same change.

Delivery order stays as section 6: the vault row first (landed as its own PR), then the daily reward model, the deterministic item pick and the nine class tables.

## 9. Coverage of the existing shelf (measured 2026-09-19)

The first step from section 6 was run; the full matrix and per-class candidate lists sit beside this file (`loot-coverage-20-26.md`, `loot-candidates-20-26.json`). The item level 20 to 26 shelf holds 127 gear items (41 epic, 69 rare, 17 uncommon); 76 of them gate at level 20, 17 at level 1, the rest between 14 and 19. Appropriate pieces per class (legal, class-maximum armor weight, scoring for at least one spec): priest, mage and warlock 55 each and identical, shaman 54, paladin 52, hunter 51, rogue 47, warrior 46, druid 33. The thin cells are helmets and shoulders (one or two for most classes), druid chest, legs and waist, hunter and rogue waist, and offhands (none except one for hunters). Conclusion: nine distinct tables with slot coverage cannot come from the existing shelf alone; the thin cells need new items, most naturally the generated world-quest family (model B), and the three cloth classes need distinct lists or they share one.

## 10. What the second PR built (2026-09-19)

The daily reward model from section 8, built under two stated defaults because the owner's inputs were still open: the class tables come from the existing shelf, and the copper number falls out of the budget. Both are one-file changes.

- The reward record is a bundle. `WorldQuestReward` is `{ xpRate?, copper?, extraItem? }` and a quest's `reward` is optional; every quest pays XP at `WORLD_QUEST_XP_RATE` (twelve percent of the level's bar) and copper on `WORLD_QUEST_COPPER` (700 plus 120 per level: 31 silver at level 20, 19 silver at 10), then standing as before. The glider keeps its richer purse (70 silver at 20) and the two rift essence quests keep the essence as an extra on top. The defaults that used to sit on the 25 quest records are gone.
- The budget is a constant, `WORLD_QUEST_DAILY_COPPER_BUDGET` (10 gold), and `tests/world_quest_rewards.test.ts` walks a month of boards against it at the cap, counting every purse a day can pay: the champion purse on every eligible quest, the salvage ambush, the hard wisp maze and both ley bonus boards. The worst day lands near 9.9 gold. Lowering copper further is one constant; the pins in `tests/world_quests.test.ts`, `tests/world_quest_view.test.ts` and `tests/parity/coverage_c.test.ts` carry the same literal.
- Three item slots a day, the same three realm-wide. `src/sim/world_quest_item_slots.ts` draws three of the thirteen rotating zones per cycle and fixes the piece per cycle, zone and class from the class table, both through a locally seeded `Rng` keyed on the cycle number, so the completion path still draws nothing from `ctx.rng` and the hover and the award compute the same answer. The item rides the zone's rotating quest: a reroll in that zone keeps the day's piece, and the always-active dailies never carry one, so an evergarden day pays three pieces and never a duplicate fourth. Every component pays at the level the character had on turn-in, so a ding on the quest's XP never adds an item or a higher standing rate the hover did not show; the first cycles' zones and items are pinned as literals against a silent reshuffle. Items pay from level 16 (`WORLD_QUEST_ITEM_MIN_LEVEL`, the Clue Scroll bracket); a full bag loses the piece and says so.
- Nine class tables in `src/sim/content/world_quest_loot.ts`, generated from `loot-candidates-20-26.json`: within each armor-weight trio the plentiful slots are split so the three tables differ and the scarce slots are shared. `tests/world_quest_loot_tables.test.ts` pins legality and appropriateness per class, trio distinctness, full slot coverage per class, and the table sizes. The file is data for the owner to edit; the thin cells from section 9 still want new items.
- The map hover shows the bundle and, on an item day, the piece by name with its item level and equip level (text lines; the tooltip family has no icon row). The faction line and the standing text now come from `t()` keys with their five non-Latin fills, closing the gap inherited from PR 3847.
