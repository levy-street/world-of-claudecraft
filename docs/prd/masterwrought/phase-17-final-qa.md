# Phase 17: Final integration QA and PR

There is no separate phase-17-qa.md: this phase IS the packet-closing QA, and it ends
with the PR.

### Starter Prompt
```
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
  (R1 to R16 where they shaped the design), the validation story including the R5
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
