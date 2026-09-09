# Instance equipment budgets

The v0.42.0 equipment cadence is one item per five intended players per boss kill.
The budget uses the encounter's intended size, not the number of players present.

| Content | Normal equipment | Heroic equipment |
| --- | --- | --- |
| Nythraxis (10 players) | 2 | 2 |
| Ignivar and Varkhul (10 players) | 2 | 2 |
| Five-player dungeon encounters | Existing Normal tables | 1 |

Gold, participation marks, quest items, bags, materials, recipes, seeds and mounts
remain outside the equipment budget. Their existing chances or amounts are retained.
Trash and outdoor rares retain their existing tables.

## Nythraxis

`src/sim/content/nythraxis_loot.ts` owns two equipment partitions. The first is
shared across difficulties and includes every existing base equipment item.
Deathless Heartwood and Kingsbane retain a 3% chance each per kill. They now
share a slot, so they cannot both drop on the same kill.

The remaining first-slot weight is distributed among epics in proportion to
their summed weights in the former tables. The maul, Bramblehide and gap-fill
items compete within this budget instead of creating bonus equipment drops.

Normal's second slot draws from the epic pool. The existing duplicate resolver
falls forward within that pool if it selects the first slot's item.
Heroic skips this Normal-only slot and pays one existing heroic-exclusive weapon
instead. The first slot still upgrades eligible base equipment to its existing
heroic variant.

## Five-player heroics

Each named dungeon boss replaces its Normal equipment rolls with one combined
Heroic partition. All existing equipment paths remain represented, including
upgraded base drops and bespoke Heroic drops. Relative weights are normalized
within the combined partition. Optional rare encounters, including the Fanglord
Beastmaster, keep their existing bonus-drop rules. Newly moved base-path entries retain their
existing source tier, so changing the loot table does not increase item stats.

Normal-only flags apply to entire exclusive groups. Where a Normal group mixes
equipment and a bag, its Heroic bag chance remains separate from the equipment
partition.

## Verification

`tests/nythraxis_loot_budget.test.ts` and `tests/heroic_loot_budget.test.ts`
exercise the production loot roller. `tests/weighted_loot_group.test.ts` pins
normalization, reserved legendary odds and the final RNG boundary.
`tests/ignivar_loot.test.ts` retains the Crucible cadence checks.

The loot resolver's RNG implementation is unchanged. Consolidating partitions
intentionally changes the number of loot draws and the subsequent shared RNG
stream. Re-record affected parity scenarios with the canonical harness and review
their changes beginning at the affected boss's death. Non-equipment chances stay
the same; a particular seed can produce different non-equipment results.

## Local QA receipt (2026-09-09)

Base: `origin/release/v0.42.0` at `7951dfdd1b4d2a95f0e8428e93d9c517cf4df7a5`.
Initial implementation checkpoint on `fix/loot-budget-v042`, before publication.
The PR records subsequent publication and CI results.

- Focused regression command below: **506 passed**, 13 files.
- `npx vitest run tests/parity -t 'heroic_five_man_clear|nythraxis_(full_pull|heroic_claim)' --maxWorkers=1`: **9 passed**, 257 filtered.
- `pnpm exec turbo run check:types build:env build:server build:bot --ui=stream`: **5 tasks passed**.
- `pnpm exec turbo run build:bundle --ui=stream`: **3 tasks passed**.
- Direct `pnpm exec biome check --max-diagnostics=0` over all 24 changed/new TypeScript files: passed with warnings; `git diff --check` passed. The gate's `ci:changed` saw zero files because this work is unstaged.
- `npm run test:browser`: 394 passed, two focus-related failures. Unchanged serial rerun with `npm run test:browser -- tests/browser/stale_focus_space.browser.test.ts tests/browser/focus_indicator.browser.test.ts --maxWorkers=1`: **20 passed**.
- `npm run gate`: artifact generation/freshness and malware checks passed. The broad test phase was stopped (exit 130), so this is **not a green full Gate**. It ran before the obsolete heroic-clear assertion was updated; the corrected assertion passes in the final replay check. A shard-partition check also reported failure during shutdown; its unchanged isolated rerun (`npx vitest run tests/ci_shard_partition.test.ts --maxWorkers=1`) passed all 19 tests.
- Independent simulation and test-coverage reviews completed; their source-tier, bag-provenance and helper-validation findings were addressed.

```sh
npx vitest run tests/heroic_loot_budget.test.ts tests/nythraxis_loot_budget.test.ts tests/weighted_loot_group.test.ts tests/heroic_loot_flair.test.ts tests/item_level.test.ts tests/reliquary_content.test.ts tests/rift_loot_pools.test.ts tests/dungeon_finder_view.test.ts tests/nythraxis_raid_unit.test.ts tests/loot_roll.test.ts tests/ignivar_loot.test.ts tests/dungeons.test.ts tests/wildheart.test.ts --maxWorkers=2
```

A release-baseline comparison of all 1,301 item definitions and item levels is
identical (SHA-256 `4df2c7d2613897c0cac6608673b100a24efbcfdb7ce0d8c7cf95764f708f7987`).
The Normal and Heroic rift reward arrays also match exactly. Tests retain literal
baseline equipment inventories, item hashes and bag source levels.

Three goldens were regenerated with the canonical `UPDATE_PARITY=1` harness:
`nythraxis_full_pull`, `nythraxis_heroic_claim` and `heroic_five_man_clear`.
Each first changes at the boss-death frame; preceding frames are identical.
No live raid or dungeon playtest was performed. Complete CI remains pending
publication.

Publication-time dependency audit: `npm audit --json` cannot run without an npm
lockfile (`ENOLOCK`); this repository uses pnpm. `pnpm audit --json` reports four
unignored package advisories in the unchanged release lockfile: sharp and js-yaml
(high), vitest and @vitest/mocker (moderate), plus the existing ignored register.
This loot change does not alter dependencies; audit remediation remains a separate
release concern.
