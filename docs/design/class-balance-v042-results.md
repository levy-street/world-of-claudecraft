# v0.42.0 class balance measurements

Implementation targets [the approved proposal](class-balance-v042.md). Measurements below use the actual simulation, fixed legal fixtures, finite resources and paired random seeds. They describe these fixtures, not live population balance or an optimized rotation.

Baseline: release/v0.42.0 at 357b1932c2ca5eee11cadf520b7caaf61c141196. An unchanged baseline bundle was compiled before any gameplay edits. All 24-seed matrices use seeds 4242 + i * 7919 for i = 0..23. Ambient camps, NPCs and ground objects are empty.

## Offensive numerical package

180 seconds, 24 seeds per specialization. Owned-class rows use the existing level-22 Nythraxis single-target profile and exact PBE fixtures. Warlock rows use the existing heroic Nythraxis prepared-pull fixture. Rogue rows use the existing 798-armor dummy fixture. The arm uses a frozen candidate bundle; no prototype damage wrappers are installed.

| Spec | Before DPS | After DPS | Change |
| --- | ---: | ---: | ---: |
| Wildfang | 128.866 | 142.546 | +10.62% |
| Thundercall | 136.214 | 149.580 | +9.81% |
| Fieldcraft | 143.256 | 157.518 | +9.96% |
| Ruination | 188.994 | 207.585 | +9.84% |
| Knifework | 198.931 | 218.596 | +9.89% |
| Necromancy | 177.634 | 212.264 | +19.50% |
| Vespers, one target | 156.529 | 160.629 | +2.62% |
| Skulduggery, generic rogue policy | 184.277 | 161.240 | -12.50% |
| Warspirit control | 164.904 | 164.904 | 0.00% |
| Packlord control | 159.652 | 159.652 | 0.00% |
| Moongrove control | 137.732 | 137.732 | 0.00% |
| Hexcraft control | 192.544 | 192.544 | 0.00% |
| Thuggery control | 210.041 | 210.041 | 0.00% |

The Vespers row isolates the complete Dirge power-scaling fix; it does not measure the pack-refresh benefit. Coldsight's combined numerical and shot-choice package is measured separately below. Doctrine's complete spell and wand packets are covered by integration tests; a level-20 encounter healing ceiling is not inferred from the supplied low-level parses.

Reproduction uses the existing owned_class_balance_probe.ts, warlock_balance_probe.ts and rogue_dps_probe.ts functions with the listed settings. The exact frozen-bundle runner and raw records are /tmp/woc-v042-measure.mjs, /tmp/woc-v042-measure-baseline.jsonl and /tmp/woc-v042-measure-numeric-candidate.jsonl. These temporary receipts are session evidence; the protocol and aggregate values are preserved here.

## Skulduggery stealth identity

A separate actual-implementation comparison uses the ordinary equipment IDs and legal talents from public fight 78192, character 116838, without external raid buffs. It starts behind a stationary level-20 training dummy with 798 armor. Rotation: Gloam/Veil Lurker's Strike, Tempo refresh at two combo points, otherwise Red Ribbon; no offensive cooldowns. Both arms use the same inputs.

Across 24 seeds, the first actual-stealth Lurker's Strike averages 262.875 before and 407.833 after, a 55.14% increase. Its stronger weapon and flat components land immediately.

| Start | Window | Before DPS | After DPS | Change |
| --- | ---: | ---: | ---: | ---: |
| Actual stealth | 15 sec | 306.12 | 278.74 | -8.95% |
| Actual stealth | 120 sec | 220.77 | 197.85 | -10.38% |
| Actual stealth | 180 sec | 221.54 | 197.68 | -10.77% |
| No stealth | 15 sec | 164.39 | 154.21 | -6.19% |
| No stealth | 120 sec | 210.46 | 187.40 | -10.96% |
| No stealth | 180 sec | 213.86 | 189.98 | -11.17% |

A stronger first strike does not imply higher aggregate damage throughout the opening 15 seconds: weaker repeatable strikes and ordinary output already contribute during that window. The generic rogue policy above loses more than this live-gear policy; neither is claimed to cover every build or PvP burst case.

Receipts: /tmp/woc-v042-stealth-accepted.mjs and /tmp/woc-v042-stealth-{baseline,candidate}.jsonl. Each arm contains 144 runs.

## Coldsight combined budget

24 paired seeds, 180 seconds, the same owned-class level-22 Nythraxis profile as the baseline. Numerical tuning and the actual Read lifecycle together increase mean DPS from 142.812 to 157.845. Mean paired gain is **10.53%**, with a conditional 95% t interval of 10.30-10.75% and a seed range of 9.57-11.76%.

Every pair preserves gear, talents, stats, resources, casts, cooldown uses, idle time and outcomes. Long Draw contributes +11.941 DPS, Fevered Draw +1.824 and Measured Shot +1.269; both autoattack sources remain unchanged. A read-only trace of seed 4242 records 14 grants, 14 accepted Long Draw reservations and 14 actual 1.5x primary hits. Its aggregate result exactly matches the uninstrumented run.

The mechanic is included in the approximately 10% budget. This stationary policy does not measure Fell Shot choices, movement-heavy encounters or every gear profile. Lifecycle integration tests separately cover the two spending choices and interruptions.

Receipts: /tmp/woc-v042-coldsight-summary.json, /tmp/woc-v042-final-coldsight-candidate.jsonl and /tmp/woc-v042-coldsight-state-proof.json.

## Hunter CI fixture after release integration (2026-09-08)

Compared feature `637196e2eb` with release `f664efc1ea` on the same world layout using
the unmodified `scripts/hunter_dps_probe.ts`: level 20, auto-equipped gear, no choice rows,
90 seconds, seeds 29001..29005, one and three targets (30 runs per ref). The PR diet
uses the first two seeds. All ten paired Packlord records match exactly, including
damage breakdowns, after excluding the source-ref label.

| Spec | Release DPS (five seeds, one target) | Feature DPS | Gain (five seeds) | Gain (two seeds) |
| --- | ---: | ---: | ---: | ---: |
| Packlord | 78.440 | 78.440 | 0.00% | 0.00% |
| Coldsight | 112.411 | 127.640 | +13.55% | +13.73% |
| Fieldcraft | 95.280 | 104.733 | +9.92% | +9.89% |

Coldsight's five-seed gain comprises Long Draw +12.451 DPS, Fevered Draw +1.778,
and Measured Shot +1.000; both autoattack buckets are unchanged. Code inspection
confirms that offense tuning scales the base and power rider separately once, followed
by Read's complete-hit multiplier. These results describe this fixture; the preceding
24-seed geared measurement remains a separate profile. Gear, rotation and rounding
affect the realized gain, and these comparisons do not establish a universal +10%.

Only three stale ceilings change. For each, multiply the new ratio by the former
ceiling/actual margin and round to the nearest hundredth:

| Ratio | New actual | Former margin | New ceiling |
| --- | ---: | --- | ---: |
| Coldsight/Packlord, five seeds | 1.627231 | 1.58 / 1.5227 | 1.69 |
| Coldsight/Packlord, two seeds | 1.689376 | 1.64 / 1.5864 | 1.75 |
| Fieldcraft/Packlord, five seeds | 1.335203 | 1.29 / 1.2010 | 1.43 |

Fieldcraft's two-seed ratio 1.409778 passes its unchanged 1.47 ceiling. Packlord's
three-target ratios (0.805808 five-seed, 0.797080 two-seed) pass the unchanged bounds.
Design floors, seeds, duration and timeouts remain unchanged. These broad legacy
corridors guard further drift; passing them does not demonstrate design parity.

Receipts: /tmp/woc-hunter-feature-comparison.jsonl and
/tmp/woc-hunter-release-comparison.jsonl, with seed, target, spec and damage breakdowns.

## Groveheart calibration

The starting 1.20 primary factor, combined with correcting the omitted Healing Power multipliers on Wildbloom replants, produced roughly 36-39% more engine healing. The approved proposal explicitly counts this correction toward the total budget, so the final primary factor is 1.05.

24 paired seeds, 180 seconds, four level-20 warrior party allies, exact legal equipment, finite mana, Seedspread/Nature's Echo/Lifesap. The rotation casts Overbloom at five Verdance, maintains Wildbloom and Second Bloom, and uses Wildmend as filler. Capacity testing continually supplies missing health; it is not an encounter-survival forecast.

| Gear profile | Before effective HPS | After effective HPS | Mean paired gain | Conditional 95% interval |
| --- | ---: | ---: | ---: | --- |
| Nonset | 220.63 | 261.94 | +18.72% | 18.67-18.77% |
| Grovespring 4pc | 250.84 | 303.25 | +20.89% | 20.82-20.97% |

Pooled effective gain is 19.88%; observed gross gain is 19.92%. All 96 runs completed. Every pair retained identical equipment, talents, stats, cast counts, mana endpoint and starvation time. Plain/set rotations cast 13/14 Overblooms respectively. The intervals measure combat RNG conditional on these fixtures, not confidence about live players.

The tradeoff is explicit: direct-only healing and a fresh normal Wildbloom gain about 5%. The corrected replants supply the rest of the full engine's approximately 20% increase. Replanting now matches a normal application at the same stats:

| Healing Power | Old normal tick | Old replant tick | New normal and replant tick |
| --- | ---: | ---: | ---: |
| 149 | 167 | 129 | 175 |
| 190 | 194 | 145 | 204 |

Two-seed finite-mana diagnostics put Spiritmend and Sunmender direct gross healing close to +10%, with Benison and Chronomancy controls identical. Effective HPS under fixed encounter pressure varies with overhealing, deaths and mana; raw spell factors do not promise the same percentage on a healing meter.

Receipts: /tmp/woc-v042-healer-24-summary.json, /tmp/woc-v042-healer-24.mjs, /tmp/woc-v042-healer-24-part{0,1}.jsonl and /tmp/woc-v042-grove-packets.jsonl. The calibrated scratch bundle changes only the Groveheart branch from 1.20 to 1.05; production uses that same calibrated value.

## Validation and release limits

Historical evidence from the initial implementation pass (7 September 2026, before the draft PR's CI repair below); not rerun since.

The final changed-test consolidation ran every modified/new test plus architecture, bare-client defaults, spellbook repaint, client talent authority and saved loadouts. It passed 864 tests; one Ashveil 2pc expectation still used the removed Skulduggery bonuses. The corrected Ashveil file then passed all 17 tests. Every test in the selection now has a passing result; the whole selection was not repeated after that test-only correction. Separate localization and guide checks passed 144 tests, with three existing skips.

Commands and observed outcomes:

- `node_modules/.bin/vitest run --maxWorkers=1 --no-file-parallelism <changed tests and listed guards>`: 35 files, 864 passed and one stale expectation; JSON receipt `/tmp/woc-v042-resume-integrated-tests.json` and explicit file list `/tmp/woc-v042-final-test-files.json`.
- `npx vitest run tests/ignivar_set_bonus_rogue.test.ts --maxWorkers=1`: all 17 tests passed after correcting the stale expectation; receipt /tmp/woc-v042-resume-ashveil-tests.log.
- `node_modules/.bin/vitest run --maxWorkers=1 --no-file-parallelism tests/localization_fixes.test.ts tests/guide.test.ts`: 144 passed, three skipped.
- `npx vitest run tests/v042_coldsight_visibility.test.ts tests/auras_view.test.ts tests/aura_overflow_priority.test.ts --maxWorkers=1`: all 72 tests passed after fixing hidden-marker presentation.
- `npx tsc --noEmit`: passed after correcting the client helper import and test fixture narrowing.
- `npm run ci:changed`: exited successfully but checked zero uncommitted files. Explicit `node_modules/.bin/biome ci --no-errors-on-unmatched <changed/new TypeScript files>` passed across 74 files, with one existing fixture `any` warning. Exact paths: `/tmp/woc-v042-format-files.json`.
- `npm run i18n:gen` and `npm run wiki:content`: passed. No locale overlays were hand-edited.
- `npm run build:bundle`, `npm run build:server` and `npm run build:env`: passed. Vite reported existing admin-locale dynamic/static import warnings.
- `npm run security:gate`: passed, zero high findings after repository priors. This scanner result is not a whole-release contextual malware audit.
- `git diff --check` and an added-line copy scan covering new files: passed.
- `pnpm audit --json`: reported four moderate and five high advisories in the unchanged release dependency lock; none critical. No dependency updates are part of this feature.

The full Gate, browser regression suite, desktop/mobile screenshot review and release translation gate had not been run as of this initial draft. See [PR #3917](https://github.com/levy-street/world-of-claudecraft/pull/3917) for current CI status: the coordinator runs further checks after the CI repair pass below, so this section's "not run" is a dated fact, not a current one. New English keys remain pending translation; release i18n work must be completed before shipping. Existing translated keys also need an explicit refresh: the current scanner does not mark reworded English keys stale. A verified example is the missing Dirge refresh in German. The maintainer worklist must include smite, shadow_word_pain, power_word_shield, ambush.specNote_subtlety, aimed_shot, rapid_fire, Ashveil bonus4, and arcane_shot.specNote_marksmanship plus the new aura text (veiledEdgeStrike, coldsightRead) for the remaining Latin-script locales (only the five non-Latin M16-mandatory locales are filled so far, see CI repair pass below). Scouring Mercy's stale placeholders and mechanics text are fixed across every edited locale and is no longer on this list. A clean pending-key list alone will not prove these translations current. PBE, desktop/mobile screenshots and the remaining release translations stay pending regardless of CI status; this feature remains draft and is not represented as merge-ready.

PBE still needs to cover PvP/critical-hit stealth burst, practiced versus simple Rogue policies, moving/Fell Shot and target-swap Hunter policies, all gear/set combinations, additional Wildfang Bruin scenarios, and Doctrine 1/5/10-player demand and survival across capstones. Dirge pack behavior has integration coverage, but these results do not measure its full large-pack DPS/mana benefit. Profession-gear comparisons also remain separate. No live production change has been made.

## CI repair pass (7 September 2026, draft PR)

Reuben requested all failed CI on the draft PR fixed using Sonnet workers. This pass repaired the scoped set of failures the PR's checks actually surfaced; it is separate from, and later than, the implementation validation above.

- **Stale combat test bands and formulas re-derived from the shipped coefficients.** Rogue Knifework/Skulduggery sustained DPS bands and sibling ordering, the hunter Fieldcraft Bloodhook tick formula, the rogue Venomrend finisher damage and the Veiled Edge aura tooltip descriptor, and the Cinderbark 4pc (druid) and Ruincaller 4pc (warlock) set-bonus accumulators were all pinned against pre-rebalance or pre-correction numbers. Each was independently re-derived from the live production formulas (spec_output_tuning.ts, spec_baselines.ts, talent_hit_mult.ts) and docs/design/class-balance-v042.md, not loosened or skipped.
- **Cinderbark 4pc and Ruincaller 4pc dmgPct coefficients corrected.** The v0.42.0 Wildfang and Ruination offense-only bonuses raise their specs' baseline multipliers (druid feral 1.5 to 1.65; warlock destruction 1.1 to 1.21). Their set-bonus dmgPct rows, sized to deliver an exact advertised percentage against the OLD baseline, were re-sized against the new one: CINDERBARK_4PC_MARROWBREAK_DMG_PCT 0.45 to 0.495 (still exactly 30% at 1.65), RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT to 0.242 (still exactly 20% at 1.21). Neither spec's own damage tuning changed; only the set bonus's delivered-percentage contract was preserved against it.
- **Seven parity golden traces regenerated.** cat_form_auto_swing, druid_engines, fiesta, fiesta_midcast_kill, fiesta_powerups, priest_codex and shaman_engines were re-recorded for the approved damage/healing/AP changes, with RNG draw order and draw counts unchanged and an independent scalar/hash review.
- **Scouring Mercy's stale placeholder and mechanics text fixed across all 18 edited locale overlays** (20 resolved locale outputs after es_ES/fr_CA derivation), replacing the old flat-number tooltip with the resolved-value placeholders and the current Doctrine rescue mechanics (30-yard range, the 15% no-link fallback, the two-target rescue cleave).
- **The three new M16-mandated English values translated in the five required non-Latin locales** (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU): entities.abilities.arcane_shot.specNote_marksmanship, hudChrome.auraEffect.veiledEdgeStrike and hudChrome.auraEffect.coldsightRead. The remaining Latin-script locales still need these three keys; see the worklist above.

Evidence: the parent coordinator's critical-test run passed 57/57 tests across 3 files (`/tmp/woc-v042-ci-coordinator-critical-tests.json`; its reported 22 "test suites" are describe() groups within those 3 files, not 22 files). The coordinator's normal-mode parity check passed 14 checks covering the seven regenerated scenarios, 0 failed (`/tmp/woc-v042-ci-coordinator-parity.json`; the rest of the parity suite was not selected in that run, so this is not the full suite in full mode). The coordinator's i18n check passed 77 of 80 tests with 3 pending skips (`/tmp/woc-v042-ci-coordinator-i18n.json`). The combat-balance test worker's four owned files passed 52/52 in a combined run. None of these is the full Gate, the parity suite in full mode, or GitHub Actions CI; see [PR #3917](https://github.com/levy-street/world-of-claudecraft/pull/3917) for current CI status, and do not read this section as a claim of a green full Gate. The rest of the maintainer translation worklist above, the German Dirge refresh, and PBE/screenshot/remaining-translation work remain outstanding.
