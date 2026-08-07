# Phase 16 QA: verify polish and content surfaces

### QA Starter Prompt
```
This is Phase 16 QA of the Masterwrought feature, the last per-phase QA before the
packet-closing phase.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the polish sweep for fairness compliance, icon and guide completeness,
admin localization, and screenshot readiness so Phase 17 inherits a finished surface.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (Phase 16 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), guide freshness gate, M16
wordy fills, screenshot traps.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (the full item ledger), progress.md
Phase 16 checklist, phase-16-polish.md (what was promised),
docs/design/graphics-settings-fairness.md, git diff against the phase-start commit, and
every file the diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Fairness agent: the orange treatment is cosmetic only on EVERY preset and tier (shedding
it hides no actionable information; nothing reads the FPS governor); the render module
stands alone (no renderer.ts method bank); the fairness tests would fail if the
treatment leaked gameplay signal (mutate mentally).
Completeness agent: independently enumerate the state.md item ledger against the icon
table (every material, intermediate, pattern, apex piece, consumable, and the Deed of
Making has a row); guide coverage spans patterns, materials, the cap, Perfecting, and
the orange, spoiler-safe; the wiki regen is fresh (tests/guide.test.ts green from a
clean run, not a stale artifact); screenshots exist for desktop AND mobile under
docs/screenshots.
i18n and admin agent: every admin string localized (operators are users); every new
guide.* key present; M16 non-Latin fills done for wordy keys; no English fallback or
concat paths; any new server read uses the cached-read seams and any stored series has
a retention story.
Test-decisiveness agent: fairness and freshness pins fail on regression; no
constant-self-comparison pins; icon enumeration is asserted, not sampled.
Cleanup agent: no dead assets, no hand-edited generated files, no unused imports.
Dispatch per the Review Dispatch Matrix: frontend-seam-reviewer,
privacy-security-review (src/admin/), database-performance-reviewer if SQL call sites
changed, plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 16
validation set including the wiki regen and fairness tests; separate fix commits with
explicit paths. The fix round is itself unreviewed code: have a fresh reviewer pass
over the fix diff.

STEP 4 - DOCS: progress.md (Phase 16 QA row), state.md drift, memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 17 (the packet-closing QA and PR phase). Follow-ups are CUT-or-fix decisions,
never future-PR items.
```
