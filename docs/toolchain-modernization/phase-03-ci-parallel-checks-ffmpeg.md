# Phase 3: CI parallel checks job + FFmpeg from npm static binaries

One PR off the latest release/** branch. Removes ~90s of serialized checks and the 22s
apt FFmpeg install from the PR gate critical path (evidence: brainstorm.md, Workstream
C). Independent of the TypeScript phases.

### Starter Prompt

```
This is Phase 3 of the Toolchain Modernization packet: CI parallel checks job + FFmpeg
from npm static binaries.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: not required.

Goal: source FFmpeg from the ffmpeg-static/ffprobe-static packages already in the
dependency tree (dropping the apt install from both CI jobs), and move typecheck, the
three builds, the freshness diff, and the malware gate into a checks job that runs in
parallel with the test step.

STEP 0 - PRE-FLIGHT:
- Confirm Phase 1 has merged (it edits the same ci.yml freshness lines and adds the
  audit-summary step this phase must relocate; if its release-cut merge is still
  pending, rebase expectations onto Phase 1's branch and say so in the PR body).
  Worktree off the LATEST release/** branch named feature/ci-parallel-checks. Clean
  git status.
- Packet bootstrap: if docs/toolchain-modernization/ is absent in this worktree, copy
  it from the main checkout at /home/fernandoramirez/Documents/world-of-claudecraft.
- Memory scan: CI or sfx entries.

STEP 1 - LOAD CONTEXT (via an Explore agent):
- docs/toolchain-modernization/state.md (decisions D7, D8; baselines; pinned tests),
  progress.md (Phase 3 checklist), this phase file
- .github/workflows/ci.yml (all jobs and their if-conditions, verbatim),
  scripts/gate.mjs (the preflight and step list), tests/ci_workflow.test.ts (every pin,
  verbatim), tests/sfx_gate_preflight.test.ts, scripts/sfx_studio/audio_io.mjs and
  scripts/sfx_studio/export_bundle.mjs (the hardcoded PATH ffmpeg/ffprobe spawns),
  scripts/sfx_conform.mjs (the ffmpeg-static import pattern to mirror), package.json
  (ffmpeg-static, ffprobe-static, allowScripts)
- docs/toolchain-modernization/implementation-plan.md (Team Workflow + the Review
  Dispatch Matrix), CLAUDE.md (root), scripts/CLAUDE.md, tests/CLAUDE.md
The agent should return: the exact pinned assertions, the exact spawn sites, and the
current job/step layout (including the audit-summary step Phase 1 added).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:

FIRST, the go/no-go (do this before any edits): ffmpeg-static downloads its binary via
an allowlisted install script, so a scripts-skipped install leaves the import pointing
at a missing file; verify BY EXECUTION first (node -p "require('ffmpeg-static')" and
run that path with -version; same for ffprobe-static; reinstall with scripts allowed if
absent). Then run npx vitest run tests/sfx_conform.test.ts tests/sfx_studio.test.ts
tests/sfx_studio_server_security.test.ts tests/sfx_export_bundle.test.ts with PATH
ffmpeg/ffprobe pointing ONLY at the ffmpeg-static and ffprobe-static binaries
(temporary PATH shim; no apt ffmpeg). All green, including the loudness assertions
(ebur128, loudnorm), is GO for the repoint. Any loudness-math failure is NO-GO: fall
back to a CI-only symlink step and leave the spawns untouched. Record the verdict in
progress.md either way.

Agent A (FFmpeg, on GO) deliverables:
- Repoint the ffmpeg/ffprobe spawns in scripts/sfx_studio/audio_io.mjs and
  scripts/sfx_studio/export_bundle.mjs at the ffmpeg-static/ffprobe-static package
  paths, falling back to PATH when the static binary is absent (scripts-skipped
  installs), mirroring scripts/sfx_conform.mjs.
- Update the scripts/gate.mjs preflight (if retired, replace it with an
  execution probe of the static binaries so a broken install still fails fast with a
  legible message) and tests/sfx_gate_preflight.test.ts in the SAME commit.
- Remove the apt FFmpeg install step from BOTH ci.yml jobs.
(On NO-GO: replace the apt step in both jobs with a symlink step exposing the static
binaries on PATH; touch nothing else; record the loudness deltas for a follow-up.)

Agent B (parallel checks job) deliverables:
- New pr-checks job in ci.yml, parallel to pr-gate, carrying: checkout (merge ref, the
  default for pull_request, MUST be preserved: the freshness diff checks the merge
  result), setup-node, npm ci, i18n:gen, the audit-summary step Phase 1 added
  (immediately after i18n:gen, which generates the summary it reads), the freshness git
  diff, security:gate, check:types, build:env, build:server, build (client). Give it
  the same if-conditions as pr-gate. Remove those steps from pr-gate (which keeps
  checkout, setup, npm ci, FFmpeg provisioning if the tests need it, and npm test).
- Update tests/ci_workflow.test.ts coordinately: the check:types occurrence count stays
  exactly 2 workflow-wide (the pr-gate occurrence MOVES to pr-checks; release-gate keeps
  its own), the pr-gate job id and if-fragment pins still hold, the new job id matches
  the lowercase-and-hyphens shape the test's job-slicing regex requires, and no
  I18N_RELEASE_TIER string enters either pr job.
- Update the keep-in-sync comments in ci.yml and scripts/gate.mjs: gate.mjs stays
  serial locally by design; document that CI parallelizes the same step LIST.

INVARIANTS THIS PHASE MUST KEEP:
- The same checks run on every PR as before; nothing is dropped, only reordered and
  re-provisioned. The freshness diff keeps its merge-ref semantics.
- The release-gate job keeps I18N_RELEASE_TIER and its serial shape this phase (Phase 4
  handles its matrix).
- Pinned tests updated in the SAME commit as the pinned surface.
- No em dashes, en dashes, or emojis anywhere.

Out of scope (do NOT do in this phase):
- Sharding the test step or splitting test files (Phase 4).
- Any typescript version change (Phase 5).
- Larger runners or any billed CI feature (decision D7: free standard runners).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx vitest run tests/ci_workflow.test.ts tests/sfx_gate_preflight.test.ts plus the
  four sfx suites; npm run ci:changed; npm run gate (the gate must still pass locally
  with or without apt ffmpeg on PATH, depending on the go/no-go outcome).
- Push the branch and open a draft PR: observe a real run; confirm pr-checks and
  pr-gate run in parallel, total wall time drops (record it), and a deliberately staled
  slice still reds the freshness step in pr-checks.
- Review dispatch per the Review Dispatch Matrix in
  docs/toolchain-modernization/implementation-plan.md: the ci.yml diff matches
  privacy-security-review; qa-checklist at completion. COVERAGE not filtering. The QA
  session marks the draft PR ready after PASS.

STEP 4 - COMMIT CADENCE:
- chore(sfx): source ffmpeg from the static npm binaries (or ci(sfx) on NO-GO)
- ci(gate): split checks into a job parallel to the tests
- test(ci): repin the workflow shape for the parallel checks job

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Go/no-go verdict recorded; the four sfx suites green under the chosen provisioning
- [ ] apt-get absent from both CI jobs; no test or gate step needs system ffmpeg
- [ ] A real PR run shows pr-checks parallel to pr-gate; wall time recorded in
      progress.md (expect the critical path to lose roughly 110s)
- [ ] tests/ci_workflow.test.ts green against the edited workflow
- [ ] Staled-slice probe still turns the freshness step red
- [ ] npm run gate green locally

STEP 6 - DOC UPDATES + MEMORY: progress.md (verdict, timings), state.md (drift).

STEP 7 - FINAL RESPONSE FORMAT: phase status, files touched, the observed CI timings
versus the state.md baselines, review verdicts, deferrals, handoff for Phase 3 QA.

STOPPING RULES:
- Stop on loudness-assertion failures beyond the documented NO-GO fallback (do not
  retune loudness constants to make static ffmpeg pass; that changes shipped audio).
- Stop if the ci_workflow pin rewrite would require renaming the pr-gate job id.
```
