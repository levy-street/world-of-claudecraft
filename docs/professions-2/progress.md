# Professions 2.0: progress

Update this file at the end of every implementation and QA session. Statuses:
`not started` / `in progress` / `complete` / `deferred (note why)`.

## Status table

| Phase | Title | Status | Started | Completed |
|---|---|---|---|---|
| 1 | Ring and identity foundations | not started | | |
| 1 QA | Verify ring and identity foundations | not started | | |
| 2 | Masterwork model | not started | | |
| 2 QA | Verify masterwork model | not started | | |
| 3 | Host-parity bug fixes | not started | | |
| 3 QA | Verify host-parity bug fixes | not started | | |
| 4 | Node materials and pristine veins | not started | | |
| 4 QA | Verify node materials and pristine veins | not started | | |
| 5 | The professions wheel window | not started | | |
| 5 QA | Verify the professions wheel window | not started | | |
| 6 | Crafting window upgrades and celebrations | not started | | |
| 6 QA | Verify crafting window upgrades | not started | | |
| 7 | The Guild letter and quest objectives | not started | | |
| 7 QA | Verify the Guild letter and quest objectives | not started | | |
| 8 | Stations and masters (sim and server) | not started | | |
| 8 QA | Verify stations and masters | not started | | |
| 9 | Station presence and recipe training | not started | | |
| 9 QA | Verify station presence and training | not started | | |
| 10 | Recipe ladders and materials content | not started | | |
| 10 QA | Verify recipe ladders and materials | not started | | |
| 11 | Fishing joins the framework | not started | | |
| 11 QA | Verify fishing framework | not started | | |
| 12 | Base tool tier gating | not started | | |
| 12 QA | Verify tool tier gating | not started | | |
| 13 | Enchanting reachable | not started | | |
| 13 QA | Verify enchanting reachable | not started | | |
| 14 | Attunement quests and nudges | not started | | |
| 14 QA | Verify attunement quests and nudges | not started | | |
| 15 | Deeds, tuning, and polish | not started | | |
| 15 QA | Final integration QA and packet teardown | not started | | |

## Per-phase deliverable checklists

Each phase file (`phase-NN-*.md`) carries the authoritative acceptance
criteria; mirror the checkboxes here as phases complete.

### Phase 1: Ring and identity foundations
- [ ] `CRAFT_RING` adopts the blueprint ring order (design-doc order); geometry tests re-pinned
- [ ] `ArchetypeState` carries per-archetype attunement history (JSONB additive, back-compat load)
- [ ] Combo eligibility requires the matching attunement in the shared rule, both hosts
- [ ] Pair-named archetype title keys land (Smith, Outfitter, Apothecary, Bombardier + the six future pairs)
- [ ] PR 2039 should-fix items resolved; ring adoption landed inside its merge window

### Phase 2: Masterwork model
- [ ] Craft outputs deterministic; five-way quality roll retired; `trivialAt` retired
- [ ] Masterwork proc (skill, self-signed, specialization inputs) with pinned rng-draw contract
- [ ] Masterwork stats baked via `item_budget` into `instance.rolled.stats`; deeds reader still coherent
- [ ] Masterwork SimEvent with celebration payload; power-ceiling tuning targets in `state.md`

### Phase 3: Host-parity bug fixes
- [ ] Trade carries `ItemInstancePayload` end to end (regression test)
- [ ] `harvestClaimedBy` mirrored online; corpse picker stops offering claimed corpses
- [ ] Crafting view consumes the shared combo-eligibility rule in both hosts

### Phase 4: Node materials and pristine veins
- [ ] Per-rarity node material tables replace placeholder junk (zone-1 stays low-tier)
- [ ] Rare+ node yields signed like corpse yields
- [ ] Pristine vein rare event (spawn, soft broadcast, deed mark)
- [ ] `gatherResult` consumed: gather cue + rarity-colored loot line

### Phase 5: The professions wheel window
- [ ] New window at deeds quality per DESIGN.md: view core (UI_PURE_CORES), painter, styles, i18n
- [ ] Ring visualization, per-craft skill bars, tier pips, title/majors/hobby, live perks
- [ ] Desktop + mobile responsive; screenshots captured for the PR
- [ ] Launchers (minimap or window row + keybind) consistent with existing windows

### Phase 6: Crafting window upgrades and celebrations
- [ ] Recipe rows show profession + required skill + skill-gain difficulty tint (#2037)
- [ ] Combo rows name their requirement; station-bound rows show a badge and disable reason
- [ ] Masterwork toast + zone-chat broadcast; maker's mark and masterwork in item tooltips
- [ ] Craft button never lies: same eligibility rule as the sim in both hosts

### Phase 7: The Guild letter and quest objectives
- [ ] Craft/gather quest objective types (minimal set for the letter quest)
- [ ] The Guild letter arrives via the mail system on trend detection; starts the first-attunement quest hook
- [ ] S3 scanner gap closed: `src/sim/quests/quest_commands.ts` in scan scope, guard test updated

### Phase 8: Stations and masters (sim and server)
- [ ] Station registry generalizes `requiresHubStation` to typed stations (forge, kitchens, apothecary, tannery, loom)
- [ ] Master NPC content records (shop, teach, quest-hook capable) for the six deep crafts
- [ ] Automated placement-safety test: no profession NPC or station within aggro-plus-buffer of hostile spawns
- [ ] Mobile crafting station perk activates (bypasses the station gate; specialization-gated)

### Phase 9: Station presence and recipe training
- [ ] Stations render as world props; masters render and are interactable; minimap markers
- [ ] Recipe training at masters on the `acquireRecipe` gate; every existing recipe grandfathered known
- [ ] Master shops stocked (base tools, reagents); training fees are gold sinks
- [ ] Hands-vs-stations split live: field recipes craft anywhere, uncommon+ at stations

### Phase 10: Recipe ladders and materials content
- [ ] Tier ladders for all six deep crafts (common through rare at minimum) with material families
- [ ] Cloth sourcing: humanoid components + plant fiber; corpse component quest-item collision ended
- [ ] Economy invariant test pinned: no recipe vendors for more than its inputs
- [ ] Wiki content regenerated; recipe data feeds the guide

### Phase 11: Fishing joins the framework
- [ ] Fishing proficiency (additive, framework-integrated) while the minigame stays as-is
- [ ] Catch rarity ladder feeds cooking tiers; rare catch integrates (deed intact)

### Phase 12: Base tool tier gating
- [ ] Nodes carry tiers; tool tier + skill gate node and corpse-material access
- [ ] The 15 existing tools change outcomes; stale no-op test pin replaced
- [ ] Tool effects remain parked (explicitly out of scope)

### Phase 13: Enchanting reachable
- [ ] Disenchant + enchant-apply on IWorld, wire commands, bags context UI, both hosts
- [ ] Enchanting skill visible in the wheel window

### Phase 14: Attunement quests and nudges
- [ ] Acceptance lore quests at the masters for all four wave-one archetypes
- [ ] Repeatable-quest support; make-amends wired; cheap-first-switch costs
- [ ] Trend nudges (chat first, Guild letter voice); attunement summary explains everything before commit
- [ ] Title celebration on attunement

### Phase 15: Deeds, tuning, and polish
- [ ] Basic universal profession deeds (first craft, first masterwork, first attunement, tier milestones, the rare fish)
- [ ] Economy tuning targets applied (#1301 fee/throttle, training fees, masterwork bounds)
- [ ] Guide/wiki professions page rewritten; asset manifest final
- [ ] Whole-feature qa-checklist.md matrix green; packet teardown offered

## Notes

(append per-phase notes, deferrals, and surprises here as sessions complete)
