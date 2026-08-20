# Phase 17: Final integration QA and PR

There is no separate phase-17-qa.md: this phase IS the packet-closing QA. It ends by ASKING
whether to open the PR, never by opening one (the standing delivery rule below).

### Starter Prompt
```

STANDING DELIVERY RULE (maintainer, 2026-08-20): THIS PHASE DOES NOT PUSH AND DOES NOT OPEN
A PULL REQUEST. It prepares everything (the green gate, the PR body, the teardown offer, the
final checklist) and then ASKS the maintainer, in words, whether they are ready to open it.
A green gate is not consent. A completed checklist is not consent. Only the maintainer saying
so is consent. This supersedes every "push and open the PR" line in this packet and in the
absorbed farming files.
This is Phase 17 of the Masterwrought feature: final integration QA and the PR. This
phase closes the packet: one branch, one green PR (the delivery contract in state.md).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: execute the whole-feature QA matrix, run the final release sync and the full
release-tier gate, prepare the PR body with screenshots, offer packet teardown, and
push or open the PR ONLY on the maintainer's word.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean (all 16 phases and their QA rounds committed); then the FINAL RELEASE
  SYNC: git fetch origin, merge the newest origin/release/** into feature/masterwrought,
  run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on full-suite contention flakes (run the gate in the
  background, never piped through tail), release-tier i18n notes, PR/CI gotchas,
  never-push-to-fork, PR-merge-requires-approval.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (the COMPLETE ledger and open items),
  docs/prd/masterwrought/progress.md (all rows),
  docs/prd/masterwrought/qa-checklist.md (the whole-feature matrix this phase executes),
  and a summary of the full branch diff against the release base (file list + stats,
  never the whole diff in the main loop).
Return: the matrix's section list, any progress.md row not closed, any state.md open
item still unresolved. An unresolved open item is a FAIL until fixed or explicitly CUT.

STEP 2 - EXECUTE THE MATRIX (parallel fan-out by matrix section, explicitly):
Run EVERY row of qa-checklist.md: three-host parity, determinism, i18n completeness,
persistence, performance, classic fidelity, copy review. One agent per section, COVERAGE
prompts. Every row gets a PASS with evidence (a named test, a recorded measurement, or
a reviewed diff), never "looks done".

STEP 3 - VALIDATION + REVIEW (matrix in state.md; Review Dispatch Matrix in
implementation-plan.md):
- /qa fan-out over the whole branch diff: the qa-checklist agent plus every domain
  reviewer whose matrix row the diff touches (this diff touches nearly all of them).
  COVERAGE prompts; apply ALL findings (blocking, should-fix, nits); the fix round gets
  its own fresh review.
- node scripts/gate_select.mjs first for fast iteration, then the full npm run gate at
  release tier (this content merges to a release branch: I18N_RELEASE_TIER=1), run in
  the background and judged by exit code. Both must be GREEN.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- fix(<domain>): one commit per finding cluster, as the reviews dictate
- docs(prd): close out the masterwrought packet ledger and matrix results
Rerun the affected suites after every fix batch until the gate is green end to end.

STEP 5 - PR PREPARATION + ACCEPTANCE (prepare everything; do NOT push yet):
- PR body per .github/PULL_REQUEST_TEMPLATE.md: feature summary, the ruling references
  (R1 to R23 where they shaped the design, R17 to R20 the gathering half, R21 to R23 the player-pain block), the
  validation story including the R5
  verdict from power-verification.md, and the committed screenshots from phases 14 and
  16 (docs/screenshots) referenced in the body.
- [ ] Every qa-checklist.md row PASS with evidence
- [ ] Final release sync merged and release-merge-audit clean
- [ ] gate_select AND the full release-tier npm run gate green by exit code
- [ ] /qa findings ALL applied and the fix round re-reviewed
- [ ] No state.md open item unresolved; progress.md rows all closed
- [ ] PR body drafted with screenshots; branch mergeable against the release base
- [ ] Nothing pushed, no PR opened, no teardown performed without the maintainer's word

STEP 6 - DOCS + TEARDOWN OFFER: update progress.md (Phase 17 row) and state.md (final
ledger state); memory notes for the packet close. Then OFFER packet teardown: deleting
docs/prd/masterwrought/ happens ONLY on the maintainer's explicit confirmation, never
by default and never bundled into another action.

STEP 7 - REPORT + THE MAINTAINER'S WORD: report the matrix results, gate status, the PR
body draft, and the teardown offer, then WAIT. Push the branch and open the PR ONLY when
the maintainer says so (standing rules: new branches stay local until okayed; no merge
without approval). If the word is given: push to origin (never a fork), open the PR
against the release branch per the template, and babysit CI per docs/merge-queue.md.

STOPPING RULES: any red gate step, any matrix row without evidence, any unresolved
state.md open item, or a release-tier i18n failure on pending rows (locale fill is the
maintainer's release workflow via the i18n-locale-fill skill; ask, do not hand-fill)
stops this phase. And the hard one: NO push, NO PR, NO teardown without the maintainer's
explicit word.
```

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten. This section is part of it, and it changes this phase's
character, not only its size. Read it after STEP 0 and fold every item into the matching
step.

**STEP 0 additions.**
- DECISION 3 (the delivery-contract amendment) IS SETTLED (2026-08-20, rows 11b-D-3 and
  ip-GATE-17), BOTH halves, and nothing here is confirmed. Farming is absorbed, D22 and its
  addendum are superseded IN PLACE with a dated banner rather than deleted, and D22's absorb
  discipline is adopted upstream (newest-release re-resolution by version sort, the
  sync-mid-phase rule, `--no-ff` phase merges, one teardown decision covering both trees).
  The second half is the ruling this phase RECORDS: an "accepted-by-design" handoff row
  ALREADY constitutes an explicit record and satisfies the delivery contract's CUT
  requirement. So this phase closes the 51 maintainer-gated rows from farming's Phase 13 QA
  classification and NOT the 44 accepted-by-design ones (farming's own Phase 14 already
  cleared the 13 actionable-in-repo rows), and it records that ruling in `decisions-index.md`
  and in the packet record BEFORE the closing matrix runs. Refusing the second half would
  nearly double the matrix, 51 rows to 95, to re-record decisions already recorded.
- DECISION 10 (packet teardown) IS SETTLED (2026-08-20, row ip-17-TEARDOWN): TEARDOWN IS CUT
  from this PR and recorded as a post-merge chore whose shape is fixed now, because the packet
  docs are the review evidence for a seventeen-phase PR and deleting them in the same PR
  removes the reviewer's map at the exact moment it is needed. When teardown is taken later,
  both doc trees go as ONE decision, the eleven screenshot cone rows are re-homed in the same
  change, and `docs/design/farming-asset-manifest.json` is deliberately preserved. WHAT STILL
  LANDS IN THIS PACKET, because live tests cite them by path: `naming-audit.md` and
  `power-verification.md` are PROMOTED into `docs/design/` on farming's asset-manifest
  precedent, with every citation re-pointed in the same change
  (`tests/originality_renames.test.ts`, `tests/ip_scrub.test.ts`), and the cone rows
  `tests/ci_workflow.test.ts` guards are re-homed. That promotion is owed regardless of when
  teardown happens (NEW WORK N13).
- Memory scan gains: the release-merge gate surprises (a non-trivial release merge reds
  the gate three non-code ways), and the release-tier i18n fill workflow.

**STEP 1 additions (Explore agent).**
- BOTH closing matrices: `docs/prd/masterwrought/qa-checklist.md` and
  `docs/prd/masterwrought/farming/qa-checklist.md`.
- `docs/prd/masterwrought/farming/state.md`, this packet's open-item collection point:
  its 117-row handoff table with a real status vocabulary is where masterwrought's open
  decisions now append as new rows at the end.
- `docs/prd/masterwrought/decisions-index.md` for the R / D / deviation / F namespaces.
Return additionally: the union section list, the count of maintainer-gated rows still
open, and every row of either matrix with no evidence attached.

**STEP 2 additions: run the UNION, not masterwrought's matrix alone.** Farming's matrix
contributes whole sections masterwrought's lacks:
- THE ANTI-CHORE AUDIT, farming's load-bearing design promise, which nothing in
  masterwrought's matrix protects: at most two visits per growth cycle, nothing rots,
  absence is never punished, risk is opt-in, and the timer UI is honest.
- OFFLINE-DEGRADATION PARITY: offline growth degrades to the documented session-local
  taster without error.
- SERVER AUTHORITY for plant, harvest, knob, and feast.
Plus farming's row-level additions inside masterwrought's existing sections: the
`farming_session` parity scenario and draw-count contract, the farming vendor buyValue
rules and produce market listability, the merged `characters.state` blob arm, the
`AURA_NAME_KEY` rows and the RETIRED_KEYS exclusion in the pending generator, the D17
naming audit result, the merged deed set including its art-pending rows, and farming's
graphics-fairness row.

**STEP 2 additions: three rows NEITHER packet has today.**
- WELL-FED UNIFICATION PINNED: exactly one well-fed system ships, and the exclusivity is
  pinned rather than described.
- MONOLITH CEILINGS RE-DERIVED ONCE on the merged tree, for every ceiling literal either
  packet touched, with the Phase 14 `hud.ts` payback landed and the ceiling lowered.
- THE EXPORT AND SYMBOL CENSUS FROM 11d RE-RUN AS A DELIVERY GATE. This is the packet's
  single most important closing check. Every re-minted artifact in this merge agrees with
  whatever the resolution produced, so a green gate proves the tree is self-consistent,
  not that it is correct. The census (every exported symbol, content-table row id, i18n
  key, and `SimEvent` name present on either parent is present in the merged tree unless
  it is on a written deletion list) is the only mechanical check that says otherwise. Run
  it here against the final tip, not against 11d's.

**STEP 3 additions.**
- ADOPT FARMING'S LOG-MARKER DISCIPLINE on top of the green-by-exit-code standard: a
  printed FAIL marker overrides a zero exit. Masterwrought's standard is the stricter of
  the two and it now inherits farming's flake classes (armory browser red as the standing
  environmental exception, `druid_engines` contention), so judge by exit code AND by the
  log.
- RELEASE-TIER i18n FILL IS A REAL LINE ITEM, not a checkbox, and it is not compressible.
  The merged pending set is masterwrought's 60 Latin pending rows, plus its Phase 11
  reword obligations, plus farming's deferred rows, plus the second v0.39.0 deed-locale
  fill (15 manifest rows). `I18N_RELEASE_TIER=1` hard-fails on any pending row. It is a
  maintainer-only pass through the `i18n-locale-fill` skill; schedule it, ask for it
  early, and never hand-fill. Where 11c retired one of two competing tooltip key pairs,
  one set's existing locale fills were discarded; confirm the surviving pair is the one
  whose coverage was compared, not assumed.

**STEP 5 and 6 additions (PR body and teardown).**
- The PR body references R1 to R23, farming's D-series decisions and its deviations (a)
  through (ca), BOTH screenshot subtrees, and ONE R5 verdict that covers both consumable
  systems.
- The teardown offer covers `docs/prd/masterwrought/` and `docs/prd/masterwrought/farming/`
  as ONE decision, executed only on the maintainer's explicit word. If it fires, the
  eleven screenshot cone rows are re-homed and the out-of-packet comment citations
  discharged IN THE SAME CHANGE, never after, and `docs/design/farming-asset-manifest.json`
  is deliberately PRESERVED (it was placed outside the packet to survive teardown).

**STEP 5 additions (acceptance).**
- [ ] The UNION matrix executed, every row PASS with evidence, farming's sections included
- [ ] Well-fed unification pinned; ceilings re-derived once on the merged tree
- [ ] Export and symbol census re-run GREEN against the final tip
- [ ] The 51 maintainer-gated rows closed; the accepted-by-design ruling recorded
- [ ] Gate judged by exit code AND by printed FAIL markers
- [ ] Release-tier i18n fill complete across the merged pending set
- [ ] `naming-audit.md` and `power-verification.md` promoted into `docs/design/`
- [ ] Teardown offered once, over both trees, with the manifest preserved
