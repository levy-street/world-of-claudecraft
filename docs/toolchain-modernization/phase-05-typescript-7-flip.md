# Phase 5: The TypeScript 7 flip

One PR off the latest release/** branch. Requires Phase 2 merged (the flat union and
baseUrl removal are what make typescript@7 check the repo clean). Small by design: with
the prerequisites landed, this is a dependency change plus hardening plus docs
(evidence and the dual-alias verification: brainstorm.md, Workstream A).

### Starter Prompt

```
This is Phase 5 of the Toolchain Modernization packet: The TypeScript 7 flip.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: optional; if the docs sweep grows past a handful of files, fan it out as a
small Workflow (one agent per doc plus a verifier) as the implementation plan suggests.

Goal: move the repo to TypeScript 7 for tsc via the official dual-alias install while
svelte-check keeps a working TypeScript 6 JS API, harden the pre-push probe, and update
contributor docs.

STEP 0 - PRE-FLIGHT:
- Confirm Phase 2 has merged. Worktree off the LATEST release/** branch named
  feature/typescript-7. Clean git status.
- Packet bootstrap: if docs/toolchain-modernization/ is absent in this worktree, copy
  it from the main checkout at /home/fernandoramirez/Documents/world-of-claudecraft.
- Freshness check on the plan itself (state.md OPEN item 5): npm view typescript
  dist-tags. If a 7.0.3+ stable exists, first re-run the forward probe
  (npx -y -p typescript@<newest7> tsc --noEmit -p tsconfig.json, expect exit 0) and use
  that version in the alias below; also skim its changelog for union-normalization or
  API-surface changes and record findings in progress.md.
- Memory scan: typescript/toolchain entries.

STEP 1 - LOAD CONTEXT (via an Explore agent):
- docs/toolchain-modernization/state.md (decision D1; the Phase 5 touch set; baselines),
  progress.md (Phase 5 checklist; the Phase 2 recorded timings), this phase file
- package.json (devDependencies, the check:ts/check:admin/check:types scripts),
  .githooks/pre-push (the tsc probe and invocation lines),
  tests/server/new_endpoint.test.ts (how it spawns node_modules/.bin/tsc),
  CONTRIBUTING.md (the typecheck instructions), CLAUDE.md root (typescript mentions),
  tests/ci_workflow.test.ts (nothing here should need changing; verify)
The agent should return: the exact current devDependency line, the pre-push probe
lines, and every doc mention of the typescript version or npx tsc.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (single agent or inline; small coupled change):

Deliverables:
- Dependencies: replace "typescript": "^5.5.0" with the dual alias per decision D1:
  "typescript": "npm:@typescript/typescript6@^6.0.2" and
  "@typescript/native": "npm:typescript@^7.0.2" (or the newest verified 7.0.x). Run npm
  install; commit package.json + package-lock.json together. Verify:
  node_modules/.bin/tsc --version prints the 7.x version (the Go binary; the typescript6
  wrapper ships only a tsc6 bin, so there is no collision), require('typescript')
  resolves the 6.x API with ts.sys present, and npm run check:types is green end to end
  (tsc AND svelte-check).
- Pre-push hardening: change the .githooks/pre-push tsc detection from a file-existence
  probe to executing node_modules/.bin/tsc --version (a TS7 install without its
  platform optionalDependency leaves a bin that exists but fails at runtime; probing by
  execution catches it and skips with the same legible message).
- Docs sweep: CONTRIBUTING.md (npx tsc --noEmit still works, note the new expected
  speed), root CLAUDE.md typescript mentions if any, and a short contributor editor
  note (VS Code needs the TypeScript 7 marketplace extension until built-in support
  ships; other LSP editors work natively). Record the re-evaluation triggers, drop the
  dual alias when the TS 7.1 stable API ships AND sveltejs/language-tools issue 3063
  closes with a release, in a DURABLE location (CONTRIBUTING.md's toolchain note is the
  home; mirror in state.md while the packet exists, but the packet gets deleted at
  teardown, so CONTRIBUTING.md is the copy that counts). Also check the installed
  svelte-check version: the dual-alias layout was verified on 4.7.2 while the lockfile
  pins 4.7.1; bump svelte-check to the verified version in this PR, or re-verify
  check:admin explicitly on 4.7.1 and record which.

INVARIANTS THIS PHASE MUST KEEP:
- The script NAMES check:ts, check:admin, check:types stay stable: CI and gate.mjs
  invoke "npm run check:types" and tests/ci_workflow.test.ts pins those invocation
  strings (it does not read package.json, but the script bodies must keep resolving
  tsc and svelte-check); only the packages behind them change.
- Zero runtime behavior change; the shipped bundles are built by vite/esbuild, which do
  not consume the typescript package (verified in research; re-verify nothing new
  imports it).
- The dependency set gains nothing beyond the aliases (no new install scripts; review
  the package-lock.json diff for the 20 platform packages, which are expected).
- No em dashes, en dashes, or emojis anywhere.

Out of scope (do NOT do in this phase):
- svelte-check --tsgo experiments (blocked on upstream lifecycle; a recorded follow-up).
- Removing the dual alias or bumping to 7.1 (future work on its own triggers).
- Any tsconfig change (Phase 2 finished those).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npm run check:types: green; RECORD the check:ts wall time (target at or under 5s
  local; baseline table in state.md).
- Parallelism sanity: node_modules/.bin/tsc --noEmit --checkers 8: still clean (the
  Phase 2 union removed the repo from the type-ordering cliff; this proves it).
- npx vitest run tests/server/new_endpoint.test.ts tests/ci_workflow.test.ts; a
  pre-push dry run (bash .githooks/pre-push with a no-op ref); npm run ci:changed; then
  the full npm run gate; then push the branch and open a DRAFT PR following
  .github/PULL_REQUEST_TEMPLATE.md for a real CI run: all pr-gate shards plus the
  pr-checks job green (this assumes Phases 3 and 4 have landed per the D5 phase order;
  release-gate does not run on this PR). The QA session marks the PR ready after PASS.
- Review dispatch per the Review Dispatch Matrix in
  docs/toolchain-modernization/implementation-plan.md: this diff (package.json,
  .githooks, docs) typically matches no review row; qa-checklist runs at completion. If
  the lockfile diff shows anything beyond the typescript packages, treat that as a
  stopping rule, not a review question.

STEP 4 - COMMIT CADENCE:
- chore(deps): move tsc to TypeScript 7 with the typescript6 API alias
- fix(hooks): probe tsc by execution in pre-push
- docs(contributing): TypeScript 7 toolchain notes and editor guidance

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] node_modules/.bin/tsc --version prints 7.x; check:types green; check:ts wall time
      recorded (at or under 5s local)
- [ ] tsc --checkers 8 clean
- [ ] tests/server/new_endpoint.test.ts green (golden child tsc on the Go binary)
- [ ] Pre-push dry run green; the broken-install probe path verified (temporarily
      simulate by invoking the probe against a nonexistent binary path)
- [ ] npm run gate fully green; draft-PR CI green
- [ ] package-lock.json diff contains only the expected typescript/alias packages

STEP 6 - DOC UPDATES + MEMORY: progress.md (timings; the version actually installed),
state.md (mark D1 executed; re-evaluation triggers recorded). Memory: record the
dual-alias layout as the project's typescript install shape.

STEP 7 - FINAL RESPONSE FORMAT: phase status, files touched, recorded timings against
baselines, review verdicts, deferrals, one-line handoff for Phase 5 QA (the packet
closer).

STOPPING RULES:
- Stop if the forward probe fails on the chosen 7.x version (newer patch changed
  behavior; bring findings back rather than pinning blindly).
- Stop if svelte-check is not green under the alias layout (upstream drift from the
  verified 2026-07-14 result; check sveltejs/language-tools issue 3063 state first).
- Stop if npm install rewrites the lockfile beyond the typescript packages.
```
