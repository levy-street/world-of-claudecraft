# Phase 3 QA: Verify the parallel checks job + FFmpeg provisioning

### QA Starter Prompt

```
This is Phase 3 QA of the Toolchain Modernization packet: Verify the CI parallel checks
job and the FFmpeg static-binary provisioning.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: optional; useful if findings need adversarial confirmation.

Goal: audit Phase 3 for check-coverage preservation (nothing silently dropped from CI),
FFmpeg correctness across environments, and pin-test integrity.

STEP 0 - PRE-FLIGHT: feature/ci-parallel-checks worktree; git status clean (packet
bootstrap: if docs/toolchain-modernization/ is absent, copy it from the main checkout).
Memory scan for CI/sfx entries.

STEP 1 - LOAD CONTEXT (via an Explore agent): state.md (D7, D8), progress.md (Phase 3
checklist, go/no-go verdict, timings), phase-03-ci-parallel-checks-ffmpeg.md, the full
phase diff, the live run logs of the draft PR (gh run view), CLAUDE.md (root), and
scripts/CLAUDE.md. Return: deliverables, touched files, observed timings.

STEP 2 - QA AUDIT (parallel agents; COVERAGE not filtering: report every issue
including low-severity and uncertain ones; ranking happens in a later step):

Check-coverage agent (the core audit):
- Build a step-by-step before/after table of EVERY step in EVERY ci.yml job; prove the
  after-set is a superset reordering of the before-set (nothing dropped, no condition
  weakened, if-expressions preserved verbatim where pinned). The Phase 1 audit-summary
  step must appear in the table as a named relocation into pr-checks, after i18n:gen.
- Verify the freshness diff still runs against the pull_request merge ref (checkout
  config unchanged in the new job) and reds on a staled slice (re-run the probe).
- Verify failure UX: a failing typecheck now surfaces in pr-checks minutes earlier than
  before; confirm on the draft PR by pushing a deliberate one-commit type error and
  reverting it.

FFmpeg agent:
- Re-run the four sfx suites in a shell with NO system ffmpeg (assert the static path
  is really what runs; verify with the suite passing AND scripts spawning the expected
  binary path). If Phase 3 recorded NO-GO, verify the symlink step exists in both jobs
  and the spawns are untouched.
- gate.mjs preflight and tests/sfx_gate_preflight.test.ts agree with the chosen design;
  a dev machine without apt ffmpeg can run npm run gate end to end.

Pin agent:
- tests/ci_workflow.test.ts assertions re-derived from the NEW ci.yml by hand (not just
  "the test passes"): count check:types occurrences, verify the job-slicing regex still
  terminates correctly with the new job present, verify release-gate pins untouched.

Multi-agent review dispatch per the implementation-plan.md matrix (ci.yml matches
privacy-security-review), plus qa-checklist. Standard truncation-resume message.

STEP 3 - FIX: apply BLOCKING and SHOULD-FIX; re-run the Phase 3 validation rows and a
fresh draft-PR run; commit with EXPLICIT paths.

STEP 4 - UPDATE DOCS + MEMORY: progress.md, state.md.

STEP 5 - PACKET TEARDOWN: skip (not the final phase).

STEP 6 - FINAL RESPONSE FORMAT: QA verdict, counts found/fixed, deferred items,
one-line handoff for Phase 4.

STOPPING RULES:
- Stop and surface if any check present before the phase no longer runs on PRs.
```
