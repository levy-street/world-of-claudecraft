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
