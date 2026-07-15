# Phase 4: Test-suite sharding

One PR off the latest release/** branch (after Phase 3 merges; it edits the same
ci.yml region). Brings the PR gate to the 4-minute target by splitting the 502s vitest
step across a shard matrix (evidence: brainstorm.md, Workstream C; shard safety and the
worst-shard model were established there, with one OPEN measurement this phase settles
first).

### Starter Prompt

```
This is Phase 4 of the Toolchain Modernization packet: Test-suite sharding.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: not required; the measurement and matrix work is sequential.

Goal: convert the CI test step to a 4-shard matrix (npm test -- --shard=i/4), split the
heaviest test file so the shards balance, mirror the matrix on release-gate, and land
the PR gate at or under 4 minutes wall.

STEP 0 - PRE-FLIGHT:
- Confirm Phase 3 has merged (this phase edits the post-Phase-3 ci.yml). Worktree off
  the LATEST release/** branch named feature/ci-test-sharding. Clean git status.
- Packet bootstrap: if docs/toolchain-modernization/ is absent in this worktree, copy it
  from the main checkout at /home/fernandoramirez/Documents/world-of-claudecraft (Phase
  1's PR carries the packet to the release base; until that merges, copy by hand).
- Memory scan: CI entries.

STEP 1 - LOAD CONTEXT (via an Explore agent):
- docs/toolchain-modernization/state.md (decision D7; baselines; OPEN item 1),
  progress.md (Phase 4 checklist), this phase file
- .github/workflows/ci.yml (post-Phase-3 shape), tests/ci_workflow.test.ts (pins),
  vite.config.ts (the test block: globalSetup, exclude, env), tests/global_setup.ts,
  tests/vale_cup.test.ts (its describe structure, for the split), package.json (test +
  pretest scripts)
- docs/toolchain-modernization/implementation-plan.md (Team Workflow + the Review
  Dispatch Matrix), CLAUDE.md (root), tests/CLAUDE.md, scripts/CLAUDE.md
The agent should return: the current job layout, the pins, the vale_cup describe map,
and the pretest chain.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (sequential; measure before committing to N).
Request any fan-out explicitly; never mode: "plan" on teammates; isolation: "worktree"
only for overlapping parallel edits.

Deliverable 1, settle OPEN item 1 (the measurement): run npm test locally with the
vitest verbose/json reporter and explain the large aggregate "setup" bucket from the CI
timing breakdown (per-fork worker prep versus something a shard would duplicate). Then
run two probe shards locally (npm test -- --shard=1/4 and 4/4), record wall times, and
confirm the worst-shard model (roughly 160s tests plus overhead) holds. If the
measurement contradicts the model badly, re-derive N (3 or 5) and record why.

Deliverable 2, flatten the worst shard: split tests/vale_cup.test.ts into 2 to 3 files
along its describe boundaries (a pure move: identical test bodies, shared helpers
extracted to a local util if needed; no logic or assertion changes). Re-run the split
files plus the sha1-shard simulation to confirm the heavy files no longer co-locate.

Deliverable 3, the matrix: in ci.yml, give pr-gate strategy.matrix.shard [1..N] and
make its test step npm test -- --shard=${{ matrix.shard }}/N (N=4 unless deliverable 1
re-derived it). The job id stays pr-gate; the if-conditions stay verbatim; no
I18N_RELEASE_TIER string may enter the job (the pin forbids it). Each shard keeps the
full checkout + setup-node + npm ci + FFmpeg provisioning (as Phase 3 left it) +
npm test (pretest runs per shard BY DESIGN: the S3 guard, guide freshness, and the
git-subprocess suites need the generated artifacts and a clean tree).

Deliverable 4, release-gate: apply the same matrix there, KEEPING its I18N_RELEASE_TIER
env and tier pins, and gate every non-test step still in that job (i18n:gen + the
freshness diff + the audit-summary step + security:gate + check:types + the builds) to
a single shard via if: matrix.shard == 1 so the matrix does not duplicate them (do NOT
split release-gate into a separate checks job this phase; npm test's pretest still
regenerates artifacts in every shard). Update tests/ci_workflow.test.ts coordinately
for both jobs, and the ci.yml/gate.mjs sync comments (gate.mjs stays a serial single
vitest run locally; that is by design, bounded workers).

INVARIANTS THIS PHASE MUST KEEP:
- Never bare npx vitest in CI: npm test (with pretest) per shard.
- Every test file runs in exactly one shard (vitest --shard partitions files); nothing
  excluded, nothing double-counted. The browser suite stays its own job.
- Pinned tests updated in the SAME commit as the pinned surface.
- No em dashes, en dashes, or emojis anywhere.

Out of scope (do NOT do in this phase):
- Optimizing individual slow tests beyond the vale_cup file split (follow-up material).
- Coverage reporting, blob reports, or merge-reports machinery (no CI coverage exists;
  shards pass or fail independently).
- Larger runners (D7: free standard runners).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx vitest run tests/ci_workflow.test.ts plus the split vale_cup files locally; npm
  run ci:changed; npm run gate.
- Push the branch and open a draft PR following .github/PULL_REQUEST_TEMPLATE.md (the
  QA session marks it ready after PASS): THREE consecutive CI runs; record each shard's
  wall time and the job total. Acceptance needs all three at or under 4 minutes.
- Verify shard-completeness: first record a fresh SINGLE-RUN test-file count on THIS
  branch (after the vale_cup split; a local npm test log line suffices), then assert
  the per-shard "test files" counts across all N shards sum exactly to that post-split
  count, catching any file the shard hash dropped or duplicated. Do not compare against
  pre-split counts from earlier logs: the split adds 1 to 2 files by design.
- Release-gate verification: its if-conditions fire only on release-to-main PRs or
  pushes to refs/heads/release/**, so verify via a scratch release/** branch push
  (delete the branch afterward), or explicitly defer this criterion to the next real
  release push and mark it deferred in progress.md.
- Review dispatch per the Review Dispatch Matrix in
  docs/toolchain-modernization/implementation-plan.md (ci.yml matches
  privacy-security-review); qa-checklist at completion.

STEP 4 - COMMIT CADENCE:
- test(valecup): split the suite along describe boundaries for shard balance
- ci(gate): shard the PR and release test steps four ways
- test(ci): repin the workflow shape for the shard matrix

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] OPEN item 1 (the setup bucket) explained in progress.md with the measurement
- [ ] Three consecutive PR-gate runs at or under 4 minutes wall, shard times recorded
- [ ] Shard-completeness check passes against the fresh post-split single-run count (no
      file lost or duplicated)
- [ ] All shards green including tests/localization_fixes.test.ts, tests/guide.test.ts,
      tests/i18n_status_registry.test.ts, tests/i18n_resolved_equivalence.test.ts
      (the suites that need pretest artifacts and git subprocesses)
- [ ] release-gate matrix green on a scratch release/** push (branch deleted after), or
      the criterion explicitly deferred to the next real release push in progress.md
- [ ] npm run gate unchanged and green locally

STEP 6 - DOC UPDATES + MEMORY: progress.md (measurements, shard times), state.md
(final N; if N != 4, amend decision D7 with the measurement rationale; drift).

STEP 7 - FINAL RESPONSE FORMAT: phase status, files touched, the three recorded run
times against the 4-minute target, review verdicts, deferrals, handoff for Phase 4 QA.

STOPPING RULES:
- Stop and report if any suite fails ONLY under sharding (an isolation bug; do not
  paper over it with excludes or retries).
- If all three runs are under 5 minutes but any exceeds 4: re-derive N per deliverable
  1 and re-measure once; if still over 4 minutes, stop and bring the measurements back
  to the user. If three consecutive runs cannot meet 5 minutes even at N=5, stop
  immediately: the model is wrong; do not escalate shard count further.
```
