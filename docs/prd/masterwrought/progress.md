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
| 05 | Jewelcrafting base catalog | complete | 2026-08-10 | 2026-08-10 |
| 05 QA | verify | complete | 2026-08-10 | 2026-08-10 |
| 06 | Inscription base catalog | complete | 2026-08-11 | 2026-08-11 |
| 06 QA | verify | complete | 2026-08-11 | 2026-08-11 |
| 07 | Intermediates and the Quickening Catalyst | complete | 2026-08-11 | 2026-08-12 |
| 07 QA | verify | complete | 2026-08-12 | 2026-08-12 |
| 08 | Apex armor catalogs | complete | 2026-08-12 | 2026-08-12 |
| 08 QA | verify | complete | 2026-08-13 | 2026-08-13 |
| 09 | Apex weapons, jewelry, gadgets | complete | 2026-08-13 | 2026-08-13 |
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
- Phase 05 QA (verify): PASS. Release/v0.37.0 synced first (merge b70c9f7aeb, 40
  conflict files: CLAUDE.md hand-merged keeping the naming-originality block,
  overlays took the release's v0.36.0 staleness fill per hunk with all branch keys
  verified surviving, bundles regenerated; release-merge-audit CLEAN, the fill ate
  zero phase pending rows, portrait manifest fresh). Eight-auditor fan-out (five-agent
  workflow incl. test-decisiveness in an isolated worktree running 8 mutation probes,
  plus content-obligations, frontend-seam, qa-checklist): ZERO blocking anywhere; the
  catalog verified formula-exact, R14-clean, economy-exact, XP-sane (50 crafts to
  rung 50, cap reachable), station decision code-true. All four queued rulings taken:
  quality ladder APPROVED, Trapper flip KEEP, deed pair AUTHOR NOW, heroic-raid
  epics SUNDERABLE (implementation with phase 12). Fix round, six commits: three
  stale comments, the hint-view supersede arm rebuilt as an explicit craft-naming
  allowlist with pins, five non-Latin faq.a1 count corrections, the full
  reagent-literal table + pvp liveness + equip-gate pins (closing the one real
  coverage gap a mutation probe exposed), the dev-kit epsilon tie band (one-ulp
  IEEE754 fragility proven and retired), and the ruled deed pair authored in full
  (Facet and Filigree + Grandmaster Jewelcrafting, crests, fills, 274/3185/43-title
  pins, falsified deedsBody + deferred-pair prose reworded). Ledger corrections:
  release-fill counts fixed (19 keys, 130 stripped rows, 91 deed-channel rows).
  Fresh fix-round review + deed obligations review applied. Full ledger in state.md.
- Phase 05 (2026-08-10): jewelcrafting exists. Nine trainer-taught jewelry items
  across the 0/25/50 rungs (2 rings + 1 necklace per rung, str/int ring + agi neck
  identities, budgets exactly formula-derived at ilvl 11/16/23: 3/4/8 points, pure
  primary + stamina, zero ratings per R14), nine JEWELCRAFTING_RECIPES (own array,
  LADDER_RECIPES untouched) consuming existing ores (copper/iron/thorium), the
  disenchant ladder standing in for the nonexistent salvage gems (dust/essence,
  never shard; premise correction in the ledger), and the shared smithing_flux;
  every recipe stationType 'forge' + acquisition ['trainer'] per the serial station
  decision (no new station type; Forgemistress Darva teaches by derivation). The
  rare rung-50 outputs pulled jewelcrafting into the deed rare-tier derivation, so
  prog_jewelcrafting_rare ("Polished to Brilliance") shipped in-change with its
  crest art (DEED_ORDER 272). Quality ladder ships uncommon/uncommon/rare, RULING
  WANTED at QA (common jewelry is statless by formula; doctrine + classic-era both
  start equip jewelry at uncommon). All nine names web-verified CLEAR (four
  candidates rejected for collisions, registry updated); rung-50 displays use the
  Osmium register (ids keep thorium). Full per-id art obligation paid: nine opaque
  128px WebPs + mapping.json rows + CREDITS + audit admission (825 to 834 / 840 to
  849); M16 non-Latin fills for all nine names + new guide keys; wiki regenerated
  (jewelcrafting page goes live), seven falsified guide.professions lines reworded
  with fills refreshed; portrait manifest re-minted via the receipt flow. New
  decisive pin suite tests/jewelcrafting_catalog.test.ts; blob ceiling re-minted
  measured. Full ledger in state.md.
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
- Phase 06 (2026-08-11): inscription exists, power-safe. Six trainer-taught records
  at Alchemist Verane's apothecary (explicit per-record stationType, no new station
  type or NPC: the serial decision, four-leg rationale in state.md): three CASTER_ALL
  held-offhand tomes (budgets 3/5/10 formula-exact at ilvl 11/16/23,
  uncommon/uncommon/rare extending the phase 05 quality ruling) and three buff
  scrolls on the NEW ItemKind 'scroll', each an alternative source of its band's
  stamina elixir aura (same aura id, same display names; applyAura same-id
  replacement makes either order replace and never stack, with zero changes to
  combat/exclusive_aura.ts or aura_stacking.ts). Deed trio + the horizons_titles
  slot + masterwork:inscription in all three mark tables and the glossary; full
  per-id art/M16/wiki obligations paid and the falsified-claims prose sweep done.
  New suites: inscription_catalog, inscription_flow, inscription_scroll_exclusivity.
  Four reviewer reports + a fresh fix-round review applied; gate PASS all 8 at
  3c732e20d6. Rulings queued for QA: scroll cost parity vs the pristine_venom_gland
  sole sink, tome GLBs vs the model-less debt, prog_ringwright design. Full ledger
  in state.md.
- Phase 06 re-audit (2026-08-11, second pass, same day): operator-requested re-walk
  of the whole phase spec. Own release sync first (merge 76a3b43359: native OTA +
  kobold/Grix bodies; the portrait ledger TRIO reconciled after the merge split it,
  a new lesson recorded in the addendum; local rerender byte-identical 230/230, no
  env ping-pong this sync), then a seven-finder verification sweep with per-finding
  adversarial verify and a fresh review of the fix round. Eight should-fix + six
  nits found and applied across the two rounds (headline: the stale jewelcrafting
  routeBody deed claim missed by the phase's inscription-focused sweep, the
  reliquary narrative arithmetic sitting 3 short of every pin, the dropped second
  ringwright doctrine comment, the 35-vs-91 ledger copy-slip, and this missing
  progress.md bullet itself); one finding refuted (scroll-kind Latin overlays are a
  recorded release-fill row). Everything else verified clean: budgets recomputed
  formula-exact, exclusivity pins mutation-proven in an isolated worktree, per-id
  obligations complete. Gate PASS all 8 at 93fc866030. Full record in the state.md
  Phase 06 re-audit addendum.
- Phase 06 QA (2026-08-11): verdict PASS. The release was already synced (the
  re-audit's v0.37.0 merge covered the tip, nothing new landed). Five-agent
  ultracode audit (four finders plus an isolated-worktree decisiveness skeptic:
  all 8 probes red-as-expected, the headline proving the exclusivity pin catches
  a scroll leaving the shared elixir aura id in BOTH orders) plus fresh
  architecture and frontend reviewers: zero blocking in the shipped phase, one
  should-fix (the held-vs-worn tome decision unrecorded; now in the ledger).
  All four queued rulings taken by Fernando: the rung-50 scroll re-priced to
  exact 214 parity with the serpent elixir (materialsBody re-cut, five
  non-Latin refreshes in-change), the three tome held models AUTHORED in this
  PR (procedural fingerprint-pinned GLBs, VAR_BOOK grips, real offhand slots
  for priest/mage/druid with swapOnly bases, warlock keeps its class
  spellbook, in-game A/B evidence committed), prog_ringwright stays reserved,
  and the older crafts' routeBody register is queued to the release fill. The
  bags hover gap was judged fix-not-cut (clickUseInstant, zero new i18n rows)
  and the tray's cap-eviction trade recorded and pinned. The fix round's own
  fresh review caught one blocker: the wiki generator mirrors attach lists, so
  the caster offhand bases would have put the warlock's spellbook in three
  class figures; AttachDef.swapOnly now filters them and the artifact stayed
  byte-identical. Gate PASS at the final tip. Full ledger in state.md.
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
- Phase 07 (2026-08-11 to 12): the ten skill-75 intermediates shipped for all
  ten professions (junk-kind common materials, 75/20/20 trainer teaches,
  station-bound with three per-record foreign binds) plus the Quickening
  Catalyst once-per-day gate: oncePerDay on the recipe record,
  PlayerMeta.craftDaily on the ctx.resetDay idiom with load clamps and
  zero-default serialize omission, the typed daily_limit refusal widened at
  four sites and localized through the craft_denial_line_view pure core, the
  batch affordances capped at one, the wiki badge, ten SVG-derived icons with
  provenance, and the demand math recorded as the phases 08/09 contract. Four
  review rounds during the build; full ledger in state.md.
- Phase 07 QA (2026-08-12): verdict PASS. Five-dimension ultracode fan-out
  (decisiveness probes in an isolated worktree; ten mutation probes
  red-as-expected) plus three domain reviewers, a twice-run fresh fix-round
  review, and qa-checklist (READY): zero blocking in the shipped phase. The
  QA's own fix round closed the unpinned reverse calendar crossing, the
  vacuous en-locale extraction reversal pins, the craftDaily date residue
  corner (source fix plus pins), the parity draw-digest blind spot (the
  professions_craft daily-gate arm), and a decisiveness sweep (literal
  reagent bills, the masterwork signing-arm premise, comment-stripped source
  pins, the daily chip's stylesheet-reach pin). Both deferred follow-ups
  closed with evidence (the mobile Used-by capture, the ten-icon owner
  review). Gate PASS at the final code tip. Full ledger in state.md.
- Phase 08 (2026-08-12): nine apex epic armor pieces at the committed slot
  audit's picks (mail waist/legs/feet, leather chest/legs/gloves, cloth
  chest/legs/gloves) plus the 16-slot tailoring apex bag; every primary sum
  equals primaryStatBudget(31, 'epic', slot), one rating at the band's 40
  (crit x5 / haste x3 / hit x1) complementing each named reference drop,
  armor copied byte-equal from ilvl-31 references; APEX_ARMOR_RECIPES ten
  rows (skill 100, level 25, drop-only per R8, the demand-math bills); the
  R1 masterwork suppression via craftBonusStatsFor at both crafting.ts
  twins (draw unconditional, parity unmoved); pbe_boost and /dev bis cap
  arms; the budget sweep test born; ten SVG-derived icons with provenance;
  guide Masterwrought section and the From a found pattern source arm; five
  review reports applied or ruled-with-reason. Full ledger in state.md.
- Phase 08 QA (2026-08-13): verdict PASS. Six-dimension ultracode fan-out
  (ordering, correctness, R1 suppression, stat shape, cleanup, decisiveness
  in an isolated worktree: eight mutation probes red-as-expected with named
  assertions) plus adversarial verifiers, a context briefing, and
  qa-checklist leads independently closed; two release re-sync merges owned
  by the QA (v0.38.0 tips 51b342bdae and b3832c34fd, generated artifacts
  re-minted from the merged tree). Fix round: portable createRequire in
  both provenance rasterizers, oncePerDay and bag-disenchant pins in the
  sweep, the exact at-cap kit count pinned in pbe_boost, the never-Hit
  clause restored with a dated OUTCOME amendment, ledger prose scoped, an
  unused type import dropped. All three deferred items closed with
  evidence (fresh ten-icon review PASS, the three in-browser captures
  committed, the S2 note surfaced). Gate PASS at the final tip. Full
  ledger in state.md.
- Phase 09 (2026-08-13): ten apex gear ids across four crafts on the exact
  budget curves (1H 16.00 dps, 2H 18.38, per-family rating bands 50/25/20),
  the Maker's Charm as engineering's first tool effect (mint 595/380 over
  the 275 recharge floor), and the Master's Field Forge placing a
  party-shared mobile station through a new ItemUse arm with the crafting
  gate's third arm (party station within radius, type-matched). The mst
  readout became the set-valued activeMobileStationCrafts after review
  reproduced the own-station shadowing; flagged-hand demotion routes
  through fillHands in both kit builders; the worn-offhand coexistence
  ruling is decided and pinned. Six-reviewer round plus a four-agent fix
  round all applied; three open maintainer decisions recorded (reliquary
  curation for the two tools, forge world-visibility, the fired
  masterwork:engineering revisit trigger). Full ledger in state.md.
