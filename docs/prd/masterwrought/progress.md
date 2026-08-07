# Masterwrought: progress

| Phase | Title | Status | Started | Completed |
|---|---|---|---|---|
| 01 | Masterwrought equip cap | complete | 2026-08-07 | 2026-08-07 |
| 01 QA | verify | complete | 2026-08-07 | 2026-08-07 |
| 02 | Pattern items and recipe learning | pending | | |
| 02 QA | verify | pending | | |
| 03 | IP naming sweep | pending | | |
| 03 QA | verify | pending | | |
| 04 | Materials backbone | pending | | |
| 04 QA | verify | pending | | |
| 05 | Jewelcrafting base catalog | pending | | |
| 05 QA | verify | pending | | |
| 06 | Inscription base catalog | pending | | |
| 06 QA | verify | pending | | |
| 07 | Intermediates and the Quickening Catalyst | pending | | |
| 07 QA | verify | pending | | |
| 08 | Apex armor catalogs | pending | | |
| 08 QA | verify | pending | | |
| 09 | Apex weapons, jewelry, gadgets | pending | | |
| 09 QA | verify | pending | | |
| 10 | Apex consumables and enchants | pending | | |
| 10 QA | verify | pending | | |
| 11 | Pattern drops and vendors | pending | | |
| 11 QA | verify | pending | | |
| 12 | The Perfecting stage | pending | | |
| 12 QA | verify | pending | | |
| 13 | Orange promotion | pending | | |
| 13 QA | verify | pending | | |
| 14 | Crafting UX beauty pass | pending | | |
| 14 QA | verify | pending | | |
| 15 | Power verification | pending | | |
| 15 QA | verify | pending | | |
| 16 | Polish and content surfaces | pending | | |
| 16 QA | verify | pending | | |
| 17 | Final integration QA and PR | pending | | |

Deliverable checklists live in each phase's section of `implementation-plan.md`; mark them
here per phase as they complete, with a Notes line per phase (deferrals become CUT items,
never future-PR items, per the delivery contract in `state.md`).

## Notes
(append per completed phase)

- Phase 01 (2026-08-07): counted family shipped in both hosts; all four deliverable
  checklist items done. Cap and sub-cap live in `masterwroughtConflictSlot`
  (equipment_rules pure leaf), wired in `equipItem` and the auto-equip silent skip; the
  paperdoll mirror predicts the consumed copy over the mirrored bags. Refusals localized
  in all 20 non-en sim DICT blocks; tooltip tag interpolates {count} from the cap const
  with its five non-Latin fills (15 Latin overlays ride the release fill; en_CA
  auto-resolves and is not one). Reviewed by
  architecture-reviewer, cross-platform-sync, frontend-seam-reviewer (0 blocking); all
  should-fix findings applied, deferrals recorded as open items in state.md. Known
  inherited red: tests/anim_pipeline_hunter_ghost.test.ts is red AT the release tip
  (byte-identical files); not a phase defect, fix belongs upstream.
- Phase 01 QA (2026-08-07): six-auditor fan-out (correctness, test-decisiveness,
  cleanup, architecture-reviewer, cross-platform-sync, qa-checklist) over the four
  phase commits. Verdict PASS after the fix round: 2 blocking (tooltip tag untested;
  the deliberate unique-vs-sub-cap disagreement unpinned), 14 should-fix, 13 nits
  found; every finding applied or recorded, none deferred to a future PR. Fix round
  (itself re-reviewed by a fresh agent, which found 0 blocking + 1 should-fix + 6
  nits, all applied in a second round it then verified): shared effectiveQuality
  helper, hoisted ignoreSlots, flagged-only quality peek at ALL THREE call sites,
  corrected S3 comment twice (final mechanism: a biome wrap adds a trailing comma the
  scanner's closing-paren anchor misses; ternary forms exclude newlines; a
  single-line ternary IS visible), honest mirror-lag comment, itemNumber in the
  tooltip arm, new tests/masterwrought_tooltip suite, R16 + sub-cap
  write-then-read + displaced-slot mirror + distinct-legendary-legacy cases, the
  einst decode in its own tests/equipment_instances_wire.test.ts (null clears to
  empty, absent keeps prior, real map replaces), DICT.en cross-pins, 20-locale
  refusal coverage, char_window source pins, isEquipSlot content-shape tightening.
  Ledger corrections:
  15 (not 16) Latin overlays pending; einst normalization + client API surface
  recorded; pbe_boost hard-throw and the promotion re-validation hole recorded as
  open items. Validation green: tsc, masterwrought_cap, masterwrought_tooltip,
  equip_drop_core, unique_equipped, architecture, localization_fixes,
  world_api_parity, hud_perf_budget, weapon_type_tooltip, i18n_completeness, parity,
  ci:changed (single-file reruns where local contention timed out; no assertion
  failures anywhere).
