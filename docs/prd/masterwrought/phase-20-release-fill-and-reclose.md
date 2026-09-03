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

### Amendments at Phase 20 execution (2026-09-02, verified against the tree at 103934491b before the first step ran)

Each item corrects one line of the Starter Prompt above; the prompt stays as written and
these read with it.

1. STEP 0, the sync: origin/release/v0.42.0 is the newest release by version sort and its
   tip da6458493f is already an ancestor of HEAD (the eleventh sync 2ebe95e731);
   `git fetch origin --prune` brought nothing. No merge, no audit, no rider: the no-op.
2. STEP 0, "the fill edits 20 overlay files": the fill has FIVE channels, not one: the 18
   base overlays under src/ui/i18n.locales (es_ES and fr_CA inherit; en_CA inherits
   English), the 18 base overlays under src/admin/i18n.locales (718 admin rows over 39
   keys), the per-locale BASE_DICT blocks of src/ui/sim_i18n.ts and the BASE_NEW blocks of
   src/ui/sim_i18n.newlocales.ts (4,309 sim rows over 246 keys, es_ES and fr_CA as their
   own blocks), the 18 deed chunks under src/ui/deed_i18n.locales, and the 18 reliquary
   chunks under src/ui/reliquary_i18n.locales (the last two outside the registry, proven
   by their release-tier arms alone).
3. STEP 1, "grep the literal heading": the literal 'RELEASE-FILL OBLIGATIONS' hits 11
   blocks; the ledgers spell the obligation at least eight other ways ('Release-fill
   obligations minted this phase' at state.md 4078 and 4904, 'Release-fill obligation
   added by this audit' 6937, 'RELEASE-FILL FLAGS' 2515, 'RELEASE-FILL REGISTER
   OBLIGATION' 2218, 'RELEASE-FILL OBLIGATION ADDED' 3435, 'RELEASE-FILL NOTE' 2123,
   'Release-fill obligations minted' 5159, the Phase 18 bullet at 24657) plus sixty-odd
   plain sentences ('ride the release fill'). The derivation greps case-insensitively for
   'release-fill' and 'release fill' over state.md, farming/state.md, farming/progress.md
   and the phase-*-qa.md and phase-19-*.md docs (94 + 15 + 23 hits at execution), one
   reader per block, then a completeness critic over the merged list.
4. STEP 1, the guide.gear.masterwroughtBody rule: that key was RETIRED at Phase 16
   (scripts/i18n_retired_keys.mjs, the 2026-08-30 reword block, commit c4213e984d; the
   readers' completeness critic corrected this line's first 'Phase 14'), so its 15 Latin
   rows are `blocked`, never pending,
   and never reach the worklist; the live key is guide.gear.masterwroughtBodyLegendary
   (15 Latin rows pending, human-required), and ITS Latin fills extend BOTH tables in
   tests/masterwrought_cap.test.ts, CAP_PROSE_BY_LOCALE and LEGENDARY_PROSE_BY_LOCALE, in
   the same change. The catalog comment at src/ui/i18n.catalog/guide.ts ('masterwroughtBody
   stays in the catalog at its original English until the release-tier fill retires it')
   is stale by one phase; corrected in this phase's docs rider.
5. STEP 1, the worklist's own split (absent from the prompt): scripts/i18n_fill_worklist.mjs
   classifies pending rows blocked-by-default. At execution: 14,290 pending rows over 940
   distinct keys in 20 locales, 8,476 autoFillable (sim chrome 3,826, hudChrome 3,617,
   admin 718, itemUi 240, hud and abilityUi 75) and 5,814 humanRequired (entities.items
   2,676, guide.profPages 1,350, sim dialogue and lore 483, entities.quests 395,
   guide.professions 210, entities.npcs 192, entities.abilities 182, the rest under 65
   each); the five non-Latin locales carry 188 rows each (172 auto, 16 human), the fifteen
   Latin locales 848 to 911. The skill's 'never machine-fill humanRequired' line is the
   contributor default; every prior release fill (v0.19.0 to v0.23.0, memory
   i18n-release-fill-workflow) filled the whole pending set under the maintainer's word, so
   the humanRequired half is filled here ONLY under that same in-session word, asked for
   explicitly at the STEP 1 confirmation, with the entity-name conventions (reuse a shipped
   localized stem, transliterate proper nouns per locale, the glossary's locked terms).
6. STEP 3, the stamp: 'the frozen bounded stamp (database vars unset ...) against the
   Phase 18 QA stamp' is amended to the Phase 19G form by the maintainer's instruction at
   the Phase 20 launch: the stamp is the pg-armed gate's full-suite step (TEST_DATABASE_URL
   only, DATABASE_URL never exported, 8 workers), predicted before the run and attributed
   against the 19G reading, Test Files 3670 passed / 1 skipped (3671) and Tests 54,550
   passed / 9 expected fail / 28 skipped (54,587); no separate unarmed run is owed.
7. STEP 3, the PR body base: the Phase 17 draft lived only in that session's scratchpad
   (the Phase 17 ledger says 're-draft from the ledger if lost'); it was recovered at
   execution from the 2026-08-30 session's scratchpad (pr-body-draft.md, 156 lines, target
   branch release/v0.41.0), and the refreshed body is committed at
   docs/prd/masterwrought/pr-body-draft.md so it survives the session. The draft uses the
   word 'phase' throughout; the standing rule (never write 'phase' into PR text) governs
   the refresh, so every occurrence is reworded.
8. STEP 2, 'TURBO_FORCE=1 npm run i18n:gen': `npm run i18n:gen` chains the three
   generators directly and has no turbo layer; TURBO_FORCE=1 matters for the GATE's cached
   i18n:gen task (memory turbo-i18n-gen-stale-dict-cache) and is set on every gate run
   here; on the direct regen it is harmless.
9. The 19F hand-carried entry's '4,569 rows' was the count at the D148 fix; D149's 260
   non-Latin rift fills took it to 4,309 (the 19F ledger), and the worklist at execution
   carries exactly 4,309 sim rows (3,826 auto plus 483 dialogue and lore, human-required).
10. The 19G hand-carried entry's arm quotes: the first inscription arm is named 'the
    inscription materials prose states the live scroll bill and its parity with the
    serpent elixir (D171)' and the per-locale farm arm 'the farm beds fills name the
    scribe, the scroll, one gourd, the elixir and the parity in their own locale' (both in
    tests/guide.test.ts).

### The maintainer's word at STEP 1 (2026-09-03, in session: "Let's do all as recommended + the wiki work")

Recorded so the fill session reads the word rather than the recommendation. The nine
decisions of docs/prd/masterwrought/phase-20-fill-package.md, RULED as recommended:

1. The fill is confirmed; it edits the overlays, the sim DICT blocks, the admin overlays, the
   deed chunks and the reliquary chunks.
2. The humanRequired half of the registry (5,844 rows at the post-sync measure) is filled under
   the same word.
3. The eighteen flagged machine-authored sets STAND as written; their recorded register nits
   are fixed inside the register pass, not by re-cutting whole paragraphs.
4. guide.profPages.craftProse.cooking.routeBody: the five non-Latin rows are replaced in full.
5. Class C (the release-inherited stale rows) and class L (the English ability names in the nine
   Latin overlays) are FILLED in this pass, recorded in the PR body as inherited debt closed.
6. English rewords taken: farm.bedsBody's 'by default' qualifier, the commission FAQ q5 and a5
   (D108), the inscription materialsHeading. CARRIED as a maintainer item: the older crafts'
   routeBody closing-register unification (style, not fact; about 140 fills for no falsehood).
7. The eight retired reworded keys are RETIRED in this pass: the English row and every overlay
   row deleted, the RETIRED_KEYS row and the guide-coverage allowlist line removed, a census
   deletion-list row per key, the regen in the same commit.
8. ru_RU guide prose renders craft names in Cyrillic, matching the HUD's profession labels.
9. The four renamed talent titles are re-cut in the fifteen Latin locales to the new names.

Plus the sequencing decision: THE WIKI COMPLETENESS AUDIT RUNS FIRST, as its own session
(docs/prd/masterwrought/phase-20-wiki-audit.md), because every prose correction it lands mints
a new key with pending rows, and an audit after the fill would re-open the staleness the fill
closes. STEP 2 of this phase starts only after that lane's close, and starts by regenerating the
worklist and re-running the commit-walk staleness audit, since the lane moves both.

Two facts the fill session inherits from the art-completion session that ran beside STEP 1:
the tree at 71f32d2e3c carries that pass (37 commits, the Mech Bird mount release sync among
them, every regen fresh), and the registry re-measured there reads 14,455 pending rows over
951 keys (auto 8,611, human 5,844); the MediaWiki seed is stale by about 3,300 lines at that
tip and its recommit stays this phase's.

### Hand-carried fill entries from Phase 19F (2026-09-02)

Written at Phase 19F execution because the registry could not carry them before that wave,
or because a fill's provenance is not something the worklist can say:

- **The sim scope is on the worklist for the first time** (ruling
  qr-19-sim-scope-pending-is-unreachable). `scripts/i18n_scan.mjs` now reads each locale's OWN
  `sim_i18n` source blocks through `simDictProvidedKeys`, so `npm run i18n:worklist` lists the
  sim-scope rows every locale never carried: 4,569 rows across the 20 non-English locales at
  the 19F measurement (206 to 246 per locale; en_CA inherits English and carries none), every
  one byte-identical English today (AMENDED 2026-09-02: 4,309 after D149's 260 non-Latin
  rift fills; the Phase 20 worklist reads exactly 4,309, amendment 9 above). They land in the per-locale `BASE_DICT` blocks of
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

### Hand-carried fill entries from Phase 19G (2026-09-02)

Written at Phase 19G execution: one fill entry the registry now carries as pending and one
non-fill item recorded here so the re-close reads the packet's own procedure doc correctly.

- **One more retire-and-re-key successor whose 15 Latin rows the registry carries as
  pending:** `guide.profPages.craftProse.inscription.materialsBodyFrostGourd` (D171, ruling
  qr-19-scroll-elixir-15c-parity). The predecessor
  `guide.profPages.craftProse.inscription.materialsBody` told players the double scroll batch
  is 'priced even with the Elixir of the Serpent', false by 15 copper since Phase 11g; the
  repair put the elixir's gourd on the scroll and the successor names it. Its five non-Latin
  fills rode the same change, machine-authored under the i18n-locale-fill conventions,
  fact-checked against the live sim before filling, and FLAGGED for the maintainer's
  re-judgement at STEP 1 in phase-19g-qa.md; the predecessor KEEPS its five reviewed rows
  (stale on the one clause the repair made true) and never reaches the worklist. The fifteen
  Latin locales render ENGLISH on the inscription page until this fill lands, the same trade
  19F took. The English and every fill are pinned per clause by 'the inscription materials
  prose states the live scroll bill and its parity with the serpent elixir (D171)' (the arm
  name corrected 2026-09-02, amendment 10 above) and 'the
  inscription materials fills name the gourd, the serpent elixir and the parity in their
  own locale' in tests/guide.test.ts.
- **One NEW sibling paragraph whose 15 Latin rows the registry carries as pending:**
  `guide.profPages.farm.bedsBodyScribeBuyer` (the D171 review round, frontend-seam-reviewer):
  the farm page's beds prose names two crafts that buy produce (cooking through the kitchens
  and Marlow's ladder, alchemy through the elixirs) and the parity repair made the scribe a
  buyer too; the shipped `guide.profPages.farm.bedsBody` and its reviewed fills stay untouched
  (the page's own convention for later shipments) and the new one-sentence paragraph renders
  right after it, naming the scribe and NO ordinal (the hoe ladder takes fine produce as a
  tool reagent, so 'a third craft' was a count the page never defines, and the five reviewed
  bedsBody fills name only the kitchens, so the ordinal had no antecedent for those readers).
  Its five non-Latin fills rode the same change, machine-authored and FLAGGED for the
  maintainer's re-judgement in phase-19g-qa.md; pinned by 'the farm beds prose names the
  scribe as a produce buyer, and every craft that buys produce is accounted for (D171)' in
  tests/guide.test.ts (the buying crafts derived from the live tables, the hoe ladder pinned as
  the excluded tool buyer) and per locale beside it. OBLIGATION AT THE RE-JUDGEMENT: both farm
  arms and both inscription arms pin the English and every fill as SHAPE anchors (whole
  literals, exact narrowness transforms, a gourd-mention count, a closing clause), so a
  maintainer who re-cuts a fill re-cuts its anchor in tests/guide.test.ts in the same change
  (the arms' comments say which fields); the derived checks beside them then say which fact
  the new text must keep true. CARRIED (the ja_JP verifier, confirmed
  for all five by the round-one frontend read): the shipped `guide.profPages.farm.bedsBody`
  fills in ALL FIVE non-Latin locales render a pre-11g English (the kitchens as the only
  buyer; no Marlow's ladder, no elixirs, no terrace crops in the raid plates and apex flasks,
  no Evergarden capstones) while the registry marks them translated, the D126
  reword-staleness class, and the same five keep 'Vale Wheat' and 'Marsh Rice' in English
  where the items have shipped localized names; maintainer items for these fills, not minted
  here. ALSO FLAGGED for this fill pass: the inscription page's materials heading
  `guide.profPages.craftProse.inscription.materialsHeading` ('Herbs, ink, and a vial to hold
  it') now under-enumerates the rung-50 scroll's bill by the gourd; re-authoring it was
  refused at 19G on cost (a heading re-key mints 15 pending rows and five fills for a section
  whose body names the gourd) and belongs with the Latin rows when they are filled anyway.
- **The CI shard-weight harvest (D168) is ESCALATED, not executed, and waits on the push
  ruling (D022):** its precondition is a green FULL-MODE CI run of a PUSHED branch, and its
  dependency D009+D170 is still escalated from 19A, so it could not be the last code-carrying
  change even with a run in hand. The ready-to-run recipe sits on the D168 row of
  phase-19-new-rows.md; the 'CARRIED to Phase 20' block of docs/qa-gate.md stands until the
  harvest commit replaces it (the recipe names the one step of the block to drop then, its
  biome line); nothing here is a fill item, recorded so the Phase 20 re-close does not read the
  harvest as done and does not take the qa-gate block's 'before the packet's PR is called
  mergeable' as satisfied.
