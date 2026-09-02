# Phase 20: The release-tier fill and the packet re-close

Appended 2026-08-30 under ruling qr-18-REOPEN. The last phase before the PR: the
maintainer's release-tier locale fill runs through the `i18n-locale-fill` skill (never
hand-filled), the release-tier six suites go GREEN, the Phase 17 validation battery
re-runs whole at the final tip, the PR body is refreshed, and the packet stops again on the
standing delivery rule with a close-out list that holds ip-17-PUSH alone.

### Starter Prompt
```
STANDING DELIVERY RULE (unchanged): THIS PHASE DOES NOT PUSH AND DOES NOT OPEN A PULL
REQUEST. It ends by ASKING, in words, whether to open it. LOCAL ONLY.
This is Phase 20 of the Masterwrought feature: the release-tier fill and the re-close.
Model: xhigh effort. ULTRACODE: yes (the fill runs as the skill's translate-then-verify
Workflow per base locale; the re-close matrix delta and the reviews run as Workflows).

WORKTREE GUARD (FIRST): run pwd. If not in /Users/fernando/Documents/wocc-masterwrought,
switch NOW with EnterWorktree (path: /Users/fernando/Documents/wocc-masterwrought). If it
refuses, STOP.

STEP 0 - PRE-FLIGHT: git status clean at the Phase 19 close; the newest origin/release/**
re-resolved by version sort and merged with the release-merge-audit if it moved (riders
as in Phase 18; a moved release ALSO moves the pending set, so regenerate the worklist
after the merge). CONFIRM THE FILL IN WORDS: the maintainer scheduled this phase, and the
fill still starts only on the maintainer's confirmation in this session (the fill edits
20 overlay files the contributor rule reserves for the maintainer). Memory scan: the
i18n-release-fill-workflow memory (base locales only, dialects inherit; sim DICTs carry
NO dialect inheritance; the "todo" guard; commit the regen before the freshness suites
pass), i18n-resolved-baseline-and-assembly, the i18n traps cluster (placeholder host
tokens, reword staleness, overlay multiline insert, key deletion forces regen).

STEP 1 - THE FILL SET (the sharp half is invisible to the pending count):
- npm run i18n:gen then npm run i18n:worklist; read the per-locale briefs.
- The reword-staleness package: re-derive it from EVERY "RELEASE-FILL OBLIGATIONS" block
  in state.md (grep the literal heading; the 11g alternate phrasing is recorded at
  state.md's 11g section), the farming handoff table's deferred-to-release-fill rows, and
  the "machine-anchored" fills flagged for re-judgement (Phase 08's thirteen keys, 11o's
  engineering prose, Phase 14's bind copy and wyrmfall line). The Phase 17 close recorded
  the shape: about 78 translated-but-stale rows of which about 24 no gate can see, 11
  deed-channel rows (deed text is its own generated channel, added by hand), two
  whole-block regens (the five-non-Latin FAQ q1 to a8 block against CURRENT English; the
  ru_RU whole-file craft-name register pass), and the special rules: THE FILL IS A FULL
  REPLACEMENT OF THE VALUE, never an append; guide.gear.masterwroughtBody's Latin fills
  extend CAP_PROSE_BY_LOCALE in tests/masterwrought_cap.test.ts in the SAME change; 18
  overlay files are 20 rendered locales (es_ES and fr_CA inherit).
- Present the machine-anchored sets to the maintainer for RE-JUDGEMENT before they are
  treated as filled (the register nits are listed in their originating review reports).

STEP 2 - THE FILL (the i18n-locale-fill skill, exactly): one translate-then-verify agent
pair per BASE locale, briefs read by absolute path, results returned as {key: value}
data (never agent writes to the overlays), a scratchpad validator (placeholder multiset
equals English, brand terms verbatim, no em or en dash or emoji, the "todo" guard, the
dialect divergence-only rule), then the inserter, then npm run i18n:gen and the regen
COMMITTED with the overlays (the freshness suites fail on uncommitted regen). Then the
reword-staleness rows as FULL REPLACEMENTS through the same pipeline, the deed channel
by hand, the two whole-block regens as blocks. Release-time wiki seed regen rides here
too: npm run wiki:seed and RECOMMIT mediawiki/seed/pages.xml (the seed bakes the live
sim content tables, so any packet content change moves it; zero-diff is also a valid
outcome, recorded). Verify: I18N_RELEASE_TIER=1 over the six
release-tier suites (deed_i18n, i18n_status_registry, i18n_t_behavior,
localization_coverage, localization_fixes, reliquary_i18n): ALL GREEN, pending 0, and
the summary's pending count 0 (pending=0 is not full coverage: the reword-staleness rows
are the proof of the rest, recorded by key).

STEP 3 - THE RE-CLOSE (the Phase 17 battery, whole, at the final tip):
- The union matrix DELTA: re-run every matrix row Phases 18 to 20 could have moved (i18n
  in full; persistence, server authority and hot path for the Phase 18 server units;
  UX, fairness and the perf budget for the frontend units; render for the farm
  producer; the census row; the three union-only rows) as Workflow lanes with per-row
  evidence; rows the phases could not have moved cite the Phase 17 evidence.
- The Review Dispatch Matrix over the Phase 18 to 20 diff (typed reviewers via the Agent
  tool), a fresh reader over each fix round, qa-checklist LAST.
- node scripts/gate_select.mjs on the committed tree; the full npm run gate in the
  background (pg armed; TIP first, EXIT last; exit code AND markers); the release-tier
  six suites GREEN; the frozen bounded stamp (database vars unset, porcelain clean,
  drift PREDICTED then attributed against the Phase 18 QA stamp); the census RESULT PASS.
- The PR body refreshed (the Phase 17 draft is the base: the validation table, the
  fill line now reading pending 0, the three new phases in the summary, both screenshot
  subtrees, the honest R5 story unchanged).

- tests/shipped_item_ids.golden.json re-minted with UPDATE_SHIPPED_ITEMS=1 and the diff
  reviewed for ADDITIONS ONLY, if anything in this phase mints an item id. A removed line
  means a shipped id died and the fix is a retirement, never a re-mint. RESTORED 2026-09-01
  by ruling qr-19-shipped-id-golden-remint-cadence: five phases dropped this acceptance line
  while deviating to a release-time cadence, and the cadence is now per content change.

STEP 4 - DOCS: progress.md Phase 20 row; the Phase 20 ledger in state.md (the fill by
locale and by class, the re-close matrix delta, the stamps); the close-out list, which
must now read ip-17-PUSH alone (anything else still open carries a Phase 19 ruling id
that says the maintainer deferred it past the PR).

STOPPING RULES: never hand-fill; a locale whose verifier found defects is re-verified
fresh before insertion; a release-tier suite still red after the fill is a FAIL to fix,
not a lane to record; any red gate step; NO push, NO PR, NO teardown.

REPORT: the fill counts (by locale, by class, the reword-staleness rows replaced), the
release-tier result, the re-close matrix delta, the drift-attributed stamp, the refreshed
PR body, the teardown OFFER (unchanged shape, the blast-radius addendum in
decisions-index.md), and then ASK for the word: push and open the PR.
```

### Hand-carried fill entries from Phase 19F (2026-09-02)

Written at Phase 19F execution because the registry could not carry them before that wave,
or because a fill's provenance is not something the worklist can say:

- **The sim scope is on the worklist for the first time** (ruling
  qr-19-sim-scope-pending-is-unreachable). `scripts/i18n_scan.mjs` now reads each locale's OWN
  `sim_i18n` source blocks through `simDictProvidedKeys`, so `npm run i18n:worklist` lists the
  sim-scope rows every locale never carried: 4,569 rows across the 20 non-English locales at
  the 19F measurement (206 to 246 per locale; en_CA inherits English and carries none), every
  one byte-identical English today. They land in the per-locale `BASE_DICT` blocks of
  `src/ui/sim_i18n.ts` (or, for the eight newest locales, in `src/ui/sim_i18n.newlocales.ts`,
  whose `BASE_NEW` blocks each `BASE_DICT` block spreads; the passthrough suite
  `tests/sim_i18n_base_new_passthrough.test.ts` guards the spread). The sim DICT has NO dialect
  inheritance: es_ES and fr_CA are filled as their own blocks. The release-tier pin 'the pending
  set is empty' in `tests/i18n_status_registry.test.ts` stays red until they are filled; that is
  the release-i18n job's contract, not a regression.
- **The 52 rift mechanic display names** (ruling qr-19-rift-mechanic-names-translate-or-not,
  option 1: translated everywhere, the shipped precedent of the 16 rift cast ids). The five
  non-Latin fills landed in-change at 19F (machine-authored under the i18n-locale-fill
  conventions, FLAGGED for the maintainer's read in phase-19f-qa.md); the 15 Latin locales'
  780 rows are on the worklist above. Keys: the `aura.rift*` and `mechanic.rift*` block of
  `baseEnTable`, derived from `RIFT_MOBS` and pinned by `tests/sim_i18n_rift_mechanics.test.ts`.
  (This bullet PRE-LANDED in the D148 commit 4b0062dc5b, one commit before the fills it
  describes, so a revert of the D149 commit alone would leave it asserting five fills that
  no longer exist; recorded at the D149 review round.)
- **Four retire-and-re-key successors whose 15 Latin rows the registry now carries as
  pending:** `guide.professions.endgameMaterialsBodyAnyRaid` (D144),
  `guide.profPages.toolsNoteFishingPageMarks` (D161, re-keyed three times inside 19F: toolsNoteFiveLadders was deleted outright at the review round for a false count in its English, toolsNoteFourStarters at the fresh read for a cross-page 'table below' phrase), `guide.profPages.rareBodyFourFlavors` (D169)
  and `guide.profPages.craftProse.engineering.materialsBodyThreeRods` (the D085 review round).
  Their five non-Latin fills each rode the same change, machine-authored and FLAGGED for the
  maintainer's re-judgement at STEP 1 beside the other machine-anchored sets; the retired
  predecessors KEEP their overlay rows (kept, not reviewed: the engineering and rare-finds
  predecessors' non-Latin rows were stale or short when they were retired) and never reach the
  worklist. Named plainly: for each successor the Latin locales that carried a translation of
  the predecessor render ENGLISH on the live page until this fill lands (ten locales for the
  engineering materials prose, per the D085 frontend-seam review); the trade was a stale or
  count-wrong translation for correct English, taken deliberately at 19F.
- **Two ratified keys with a recorded staleness exposure, no fill owed by any gate:** the
  gathering `gatherDeeds.mining/logging/herbalism` rows and the five non-Latin
  `guide.profPages.rareBody` predecessors (which omitted the flavor names and the deed
  sentence before 19F re-keyed the note) are superseded or left as-is per their rulings
  (qr-19-prog-first-harvest-thirteen-catches, qr-19-rarebody-reword-landmine); nothing to
  fill for them.
