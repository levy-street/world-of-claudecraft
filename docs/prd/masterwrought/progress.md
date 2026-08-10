# Masterwrought: progress

| Phase | Title | Status | Started | Completed |
|---|---|---|---|---|
| 01 | Masterwrought equip cap | complete | 2026-08-07 | 2026-08-07 |
| 01 QA | verify | complete | 2026-08-07 | 2026-08-07 |
| 02 | Pattern items and recipe learning | complete | 2026-08-07 | 2026-08-07 |
| 02 QA | verify | complete | 2026-08-07 | 2026-08-07 |
| 03 | IP naming sweep | complete | 2026-08-07 | 2026-08-07 |
| 03 QA | verify | complete | 2026-08-08 | 2026-08-08 |
| 04 | Materials backbone | complete | 2026-08-08 | 2026-08-08 |
| 04 QA | verify | complete | 2026-08-10 | 2026-08-10 |
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
- Phase 02 (2026-08-07): pattern-item machinery shipped in both hosts with zero new IWorld
  members, wire fields, or server handlers. ItemKind 'recipe' + RecipeItemDef.teachesRecipeId;
  learn flow behind SimContext in professions/pattern_items.ts (already-known, unpracticed
  profession, tier via the shared teachTierMet; acquireRecipe's first real caller; consume
  exactly one on success; refusals single-line ctx.error, never consuming); success rides the
  text-free trainResult ok event. Three refusal rows localized in all 20 non-en sim DICT
  blocks (already-known copied verbatim from the trainer line per locale); pattern kind label
  plus tooltip (teaches, requirement mirroring both gates, known state) as t() keys; patterns
  unstacked, market-listable, 'other'-bucketed, parchment-iconed. No shipped content carries
  the kind yet (phase 11 authors the drops on this machinery). Reviewed by
  architecture-reviewer, cross-platform-sync, frontend-seam-reviewer (0 blocking), all
  findings applied; the fix round was itself verified by a fresh qa-checklist agent whose one
  blocking claim (S3 corpus miss) was refuted with a byte-mutation probe and whose 6
  should-fix + 6 nits were applied in a second reviewed round. Decisions, traps, and phase 11
  obligations recorded in the Phase 02 ledger in state.md.
- Phase 02 QA (2026-08-07): seven-auditor fan-out (correctness plus a surfaces child,
  rng-and-golden, test-decisiveness, cleanup, architecture-reviewer, cross-platform-sync,
  qa-checklist) over git diff 80d4afd062..b873eac88e, after re-merging the moved
  release/v0.36.0 tip (merge 0fc4e544d6, release-merge-audit clean; the merge also fixed
  the inherited hunter_ghost red via PR 3111). Verdict PASS after the fix round: 0
  blocking, 9 should-fix, 14 nits found across the seven reports (deduped); every finding
  applied or recorded in the Phase 02 QA ledger in state.md, none deferred. Three findings
  REFUTED with the file open plus live probes (the S3 corpus miss re-raise, twice-probed
  byte mutation both directions; the no-online-test claim; the unguarded-rod-fee claim).
  The stated QA focus verified with hard evidence: zero rng draws walked transitively and
  pinned with positive-controlled observers over success AND every refusal arm; the
  frozen-id golden untouched and green with zero kind:'recipe' content anywhere (and
  recorded as a deletion guard, the content sweep being the real addition guard); S3
  coverage of every refusal line proven by emit-side and DICT-side byte probes. Fix round
  (6175c95836): RecipeItemDef use/stackSize never-fields, cast-free fixtures, the
  grandfathered no-acquisition fixture both suites, the hover-click cross-check matrix,
  refusal-arm draw-free sweep, tradable-drop def sweep (quality/soulbound/noMarketList),
  the two missed every-non-quest-kind lists, the rodFeePaid-naming assertion message,
  hotbar-exclusion ruling comment, and seven comment/docs corrections; every new pin
  proven decisive by live mutation probes (all red on target, tree restored by edit).
  Validation green: tsc, recipe_pattern_items, recipe_pattern_tooltip_view, architecture,
  localization_fixes, crafted_item_tooltip_coverage, i18n_completeness,
  bag_quest_mark_view, quest_item_tooltip_view, professions_rod_recipes,
  stack_size_tooltip_view, item_instance_tooltip, bags_view, bag_filter, hud_perf_budget,
  i18n:gen freshness, biome on all touched files.
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

- Phase 03 (IP naming sweep): 2605 unique shipped proper nouns web-verified (20-agent
  workflow + adversarial verify + 4 hunters); 52 display strings renamed (ids frozen),
  15 maintainer borderlines recorded, 92 flagged-kept; registry confirmed with one
  amendment (Prismglass Setting). Deliverables: naming-audit.md (per-name verdicts +
  evidence), the residual-locale coin strip (91 rows, commit 6e93deadc1), non-Latin
  refills + 720 Latin strips per the rename protocol, NAME-MAP amendment + ip_scrub
  arming + originality pins, parity re-mint proven by the slice-scoped rename state
  proof, wiki regenerated, and the standing authoring-time IP check codified in the
  root and src/sim/content CLAUDE.md files. Full ledger in state.md.

- Phase 04 (2026-08-08): the three chase materials shipped with faucets, gates, and
  persistence in both hosts. Wyrmfall Core: one shared 1-3 roll per credited eligible
  final-boss kill (heroic instances plus the normal raid), appended after rollLoot so
  loot draws never reorder, per-character per-source reset-day gate, marks-style
  present/absent delivery with the new wyrmfall_core_reward letter, the draw-free
  rift A/S first-clear arm (A 1, S 2, R9's daily cap), and the 12-mark quartermaster
  catch-up row. Maker's Ember: weekly bankable accrual anchored on the most recent
  Tuesday DERIVED from ctx.resetDay by pure civil math (no second clock; the
  stopping rule satisfied without stopping), granted on the first eligible
  completion of the week, uncapped accrual per R4, losing A/S rift crews included.
  Sundered Essence: the sundering cast on the enchant-family seam, raid-epic-only
  via the item_level source index, deterministic 1:1 yield, the amendment's
  pinned-slot re-check (splice AND sort-consolidation cases pinned), bag-menu
  Sunder row through the shared destroy-confirm family, extractEssence IWorld
  member + extract_essence wire command. Parity re-minted deliberately with the
  movement characterized (59 state-shape-only, one draw-append in
  nythraxis_full_pull). The pre-flight release sync caught and fixed the release
  wiki-refresh's Gallowmere reintroduction (en + 3 transliterations, guard armed).
  All decisions, numbers, obligations, and the review record in the state.md
  Phase 04 ledger.
- Phase 04 QA (verify): PASS-WITH-FOLLOWUPS. Release/v0.36.0 synced AGAIN first
  (merge f14b6a4e0a: the Reliquary packet had landed, 246 commits incl. the
  10970-row locale fill; 87 conflicts hunk-level, IWorld pin 320, command
  schema 197/210 after catching a genuine silent off-by-one both sides
  auto-merged, 65 goldens re-minted with only nythraxis moving rng digests,
  portrait manifest re-blessed byte-identical, the fill's Gallowmere
  reintroduction caught by overlay_ip_scrub and fixed; 4-agent merge audit
  CLEAN). QA fan-out: ten auditors total (correctness, gate-abuse,
  migration-safety on the load clamp, test-coverage-auditor on the fix-round
  pins, architecture-reviewer, cross-platform-sync, then qa-checklist,
  a fresh fix-round reviewer, and privacy-security-review): ZERO blocking
  anywhere. Fix round: the rift ember decoupled from the core table onto
  EMBER_ELIGIBLE_RIFT_TIERS with the widen-and-restore probe, meta.leaving
  filters, the dev-portal local guard + end-to-end pin, single-pass anchor
  normalization (year pad + range bail), the date load cap, the sunder
  empty-session guard + quest hook, and fifteen-plus new decisive pins
  (faucet literals over self-comparisons, present-only ember, completion-
  not-gate, the client frame shape covering the vacuous addressing-guard
  row, the destroy-race fourth command, vendor buy path, blob-growth
  survival rows, hostile-slot shapes). The nythraxis parity scenario gained
  a live calendar so the golden pins the ember cross-host. Follow-ups are
  recorded in the state.md QA bullets (one ruling wanted on sunder scope:
  heroic-raid epics are NOT sunderable today; the movement:true obligation
  for phase 12; release-owned upstream items), none blocking. Full ledger
  in state.md.
- Phase 03 QA (verify): PASS-WITH-FOLLOWUPS. Release/v0.36.0 synced first (merge
  ed51716964, 30 conflicts; the release's own honor-title re-cut supersedes the
  phase's ladder verdicts: Linebreaker / Fieldreaver / Warcrowned adopted, docs
  amended; 9-agent merge audit, 32 findings triaged). QA fan-out (4 auditors +
  cross-platform-sync + qa-checklist) found and fixed two blockers the English-only
  guards could not see: the composed 'The Hellfire Citadel' rift name (renamed
  Pitfire, pinned) and residual Wyrmcult coins in four Latin overlay rows; plus the
  swapped zh_TW/ja_JP frostbite renderings, deploy-window aliases, Spiritcall
  non-Latin fills, dead-key strips, and the straggler sweep. New standing guard:
  tests/overlay_ip_scrub.test.ts (non-English coin denylist + script-family checks,
  probe-proven). Audit extended with the missed venue/brand/pool domain (14 addendum
  rows, web-verified; appendix reconciled to 2623). Id-safety proven mechanically
  (id-field inventory byte-identical base vs tip; shipped_item_ids untouched-green;
  parity + slice-scoped rename proof green). Follow-ups are recorded in the state.md
  QA bullets (upstream items and cleanup-phase notes), none blocking. Full ledger in
  state.md.
