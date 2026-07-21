# Phase 1 starter prompt: DOM test harness + perf-budget gate

Paste everything inside the fenced block below into a fresh Claude Code session.
It is self-contained; the runner should not need to open this surrounding file.

### Starter Prompt

```
This is Phase 1 of the UI Architecture and HUD Modularization feature: DOM test harness + perf-budget gate.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is moderately batch-heavy (two parallel agents, three new test files plus one rewrite). If you want this orchestrated as a Workflow with parallel fan-out, add the keyword ultracode to your kickoff so the session orchestrates it; otherwise run the two agents as a manual parallel fan-out.

Goal: instantiate the real Hud against a fake IWorld in a DOM-enabled Vitest environment, and add a perf gate that asserts the hot-write skip rate stays above a named ~80% threshold, without touching hud.ts behavior.

STEP 0 - PRE-FLIGHT
- Run git status. This is a concurrent, shared worktree: a sibling session may be editing the same tree. If the working tree is dirty with files you did not create, STOP and ask the human before proceeding; do not stage or revert another session's work.
- Scan Claude Code memory before doing anything else: read MEMORY.md and the phase-relevant topic notes (shared-worktree commit care, never push to fork, the i18n resolved baseline note, no em dashes or emojis). Honor all of them. In particular: stage only this card's files with explicit paths, never git add -A; push branches to origin (levy-street), never the fork.
- Create the phase branch off the current packet branch: feature/p0-1-2-dom-harness-perf-gate (one card group, one branch, one PR).

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or hud.ts directly in the main loop; preserve context)
Spawn ONE Explore agent. Its job is to read and summarize, returning a tight written brief (not raw file dumps), covering:
- docs/ui-architecture-hud-modularization/state.md: the locked decisions, the non-negotiable invariants (call out #2 t()-only, #3 DOM id/class contract, #4 one shared hotWriteCache, #8 commit hygiene), the validation matrix row for "DOM/UI logic", the review-dispatch matrix, the Anchors index, and the OPEN item about happy-dom lacking a canvas 2D context.
- docs/ui-architecture-hud-modularization/progress.md: the Phase 1 deliverables and acceptance list only.
- The specific source files this phase touches, summarized individually (do NOT dump the giant hud.ts; have the agent grep for and report only the named anchors and their immediate surrounding shape):
  - package.json: current devDependencies, the test script, and whether any DOM env (happy-dom / jsdom / @vitest/browser) is already present (expected: none).
  - vite.config.ts: the existing Vitest test: block (state.md cites it near :97-100); report the current environment setting (expected: node default) and how to opt files in per-file.
  - src/ui/hud.ts: re-grep the Hud constructor (state.md anchors it at :338, line numbers DRIFT) and report its full signature and every injected dependency it requires (renderer, keybinds, hooks, the IWorld it is given, anything else). Re-grep the hotWriteCache (anchored :270) plus the hotDomWrites / hotDomSkippedWrites counters and the setText/setDisplay/setTransform/setWidth setters (anchored :482-505); report how the skip counters are incremented and whether any public accessor exposes them. Re-grep update() (anchored :1556) and report the throttle-tier entry points the harness will drive. Do NOT read the whole file.
  - index.html: report the id/class skeleton the harness must mirror so the Hud can query its DOM nodes (the ~214 ids contract: at minimum #player-frame, #target-frame, #actionbar, #minimap, and whatever the constructor / update() path queries on instantiation).
  - tests/client_shell.test.ts: report exactly what it currently asserts via string-scraping so the replacement preserves intent as behavioral assertions.
  - src/world_api.ts: report the IWorld read surface members the Hud reads (player, target, entities, inventory, equipment, known, marketInfo, socialInfo, and the rest the constructor/update path touch), so fake_world.ts implements the right shape behind IWorld with NO Sim internals.
This phase names no external web surface beyond Vitest's per-file environment directive; if any Vitest env fact is uncertain (the // @vitest-environment happy-dom | jsdom pragma, or whether the chosen DOM lib needs a config flag), add ONE short web-research agent and mark anything unverifiable as OPEN. Do not block on it.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly. Run two agents in parallel; give each ONLY the Explore summary (not the raw planning docs, not raw hud.ts). Never put a teammate in plan mode.
- Agent A (DOM env wiring + canvas-2D shim + fake world + harness test):
  - Add a single DOM dev dependency to package.json as a devDependency only (happy-dom is the default choice). Do NOT flip the global Vitest environment; keep the default on node so the ~150 pure sim tests stay fast. Opt the new HUD/DOM test files into the DOM env per-file via the // @vitest-environment happy-dom pragma (or jsdom for that one file if and only if a needed API is missing; see the canvas gotcha below).
  - Install a canvas 2D context shim BEFORE constructing Hud. The Hud CONSTRUCTOR (not just update()) calls getContext('2d') ~3 times: minimapCtx = mm.getContext('2d')! plus renderTerrainCanvas() and drawPortrait()/iconCanvas(), which createElement('canvas') and call getContext('2d')!. Both happy-dom AND jsdom return null from getContext('2d') (the trailing '!' is a lie), so construction throws "Cannot read properties of null" without a shim. The shim MUST live on HTMLCanvasElement.prototype.getContext (or globalThis / document.createElement), NOT inside fake_world.ts: the terrain and portrait canvases are createElement'd on Hud-owned DOM nodes and a throwaway createElement('canvas'), and never touch the IWorld stub, so a stub on the fake world object would never be reached. Provide a minimal stub returning the 2D-context methods the ctor path calls (clearRect, drawImage, createImageData, getImageData, fillRect, etc.). If jsdom is used for any file instead, note it needs the native node-canvas package (a devDep) to return a real 2D context; happy-dom needs the prototype shim either way.
  - Install the index.html id/class skeleton into document.body BEFORE constructing Hud. The ctor runs ~26 querySelector field initializers before the ctor body and the $ helper casts null to T with no guard (and castbarFillEl/LabelEl/TimerEl immediately call .querySelector('.fill') on castbarEl, so a missing #castbar throws at field-init). The harness must mirror the index.html id/class skeleton byte-identically (the ~214 ids the ctor querySelects: at minimum #player-frame, #target-frame, #actionbar, #minimap, #castbar and its .fill/.label/.timer children, and the rest of the contract) before instantiation, per Invariant #3.
  - Write tests/helpers/fake_world.ts: a hand-rolled IWorld stub that satisfies the IWorld read surface structurally, with simple mutators to drive state for tests: player, target, entities, inventory, equipment, known, marketInfo, socialInfo (plus any other read members the Hud constructor / update path touches per the Explore brief). It must stay behind IWorld and reach into NO Sim or ClientWorld internals. Keep player.targetId = null in the initial fake world so the first-frame target-frame / portrait-draw path is skipped and does not require a target entity to exist. Include an entity-drop / target-loss mutator path (drop an entity from entities and/or clear targetId mid-run) so later per-frame phases and online-mode QA can simulate interest-scoped (~120 yd) snapshot churn; cross-reference the online-mode QA note in state.md.
  - Write tests/hud_harness.test.ts: actually construct the real Hud against fake_world.ts in the DOM env (after the canvas-2D shim and the id/class skeleton are installed), drive a frame or two, and assert that rendered player-visible text comes from t() (not raw English literals) for at least one representative label. This is the characterization harness the later extraction phases reuse.
  - Deliverables: edited package.json (dep) and vite.config.ts (per-file opt-in only), the canvas-2D shim and the index.html id/class skeleton installer (in a shared test helper, e.g. tests/helpers/), tests/helpers/fake_world.ts (with the targetId = null initial state and the entity-drop / target-loss mutator), tests/hud_harness.test.ts.
- Agent B (perf-budget gate + client_shell rewrite):
  - Write tests/hud_perf_budget.test.ts: instantiate the Hud against fake_world.ts, drive a steady-state run of frames through update(), read the hot-write counters (hotDomWrites vs hotDomSkippedWrites), and assert the skip rate exceeds a single named constant (for example const MIN_HOT_WRITE_SKIP_RATE = 0.8) with a comment explaining what it protects and why ~80%. The threshold must be ONE named constant with a comment, not a bare magic number scattered in asserts.
  - If the counters are not exposed by a public accessor, prefer reading them through the smallest existing public surface; do NOT add a behavior-changing accessor to hud.ts. If a read-only getter is genuinely required, treat that as a possible scope concern and surface it before adding it (the phase forbids hud.ts behavior change).
  - Rewrite tests/client_shell.test.ts: replace the source-string scraping with behavioral assertions that instantiate the shell/Hud against the fake world and assert observable DOM/behavior, preserving the original test's intent as reported by the Explore brief.
  - Deliverables: tests/hud_perf_budget.test.ts, rewritten tests/client_shell.test.ts.
Coordinate the shared edits: only Agent A edits package.json and vite.config.ts; both agents depend on tests/helpers/fake_world.ts, so have Agent A land fake_world.ts first (or run with worktree isolation if editing in true parallel) and Agent B import it.

INVARIANTS THIS PHASE MUST KEEP (from state.md; only those in play)
- Invariant #2 (t()-only render sink): the harness asserts rendered text resolves through t(); do not add any literal fallback to make a test pass.
- Invariant #3 (DOM id/class contract): the harness mirrors the index.html id/class skeleton byte-identically; the Hud queries real ids, so do not rename or invent ids.
- Invariant #4 (one shared hotWriteCache): do not duplicate or reset the cache to inflate the skip rate; the gate measures the real single cache.
- Invariant #8 (shared-worktree commit hygiene): stage only this card's files with explicit paths, never git add -A; one card group, one branch, one PR, push to origin not the fork.
- Invariant #9 (no em dashes or emojis) in any code comment, test name, or doc.
- Test-environment rule: do NOT flip the global Vitest env; opt in per-file only, keep the sim suite on node.

OUT OF SCOPE (do not do these; they belong to later phases)
- Extracting anything from hud.ts (no HotWriteGate, ReactiveDiff, IconService, or window modules; that is Phases 7+).
- Any change to hud.ts behavior, signatures, write semantics, or string formatting. The only acceptable hud.ts touch would be a non-behavioral read-only counter accessor, and only after surfacing it per Agent B's note.
- Touching src/sim/, server/, src/net/, or src/world_api.ts (no IWorld member additions; if the Hud appears to need data IWorld does not expose, STOP and surface).
- The i18n matcher decouple, IWorld parity test, or sim-purity boundary (Phase 3); Playwright visual baselines (Phase 5).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the exact validation commands for a DOM/UI-logic change from the state.md matrix:
- npx tsc --noEmit
- npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts
- The full npm test must stay green AND the sim suite speed must be unchanged (confirm the ~150 sim tests still run on node, not the DOM env).
- npx vitest run tests/client_shell.test.ts (the rewritten file passes).
- npm run build must be green and must show the game (main) bundle does not pull in the new DOM dev dep (it is dev-only).
No player text changed and no matcher moved this phase, so the localization_fixes guard is not required by the matrix; run it only if a diff unexpectedly touches player strings.

Review dispatch: check git diff --name-only against the phase-start commit. This phase is pure src/ui-adjacent tests + build config (package.json, vite.config.ts, tests/**); it does NOT touch server/, src/admin/, src/net/, src/world_api.ts, src/sim/ behavior, or the i18n matchers. Per the review-dispatch matrix, spawn qa-checklist ONLY. Do NOT spawn privacy-security-review, migration-safety, or cross-platform-sync (no surface they own is touched). If the diff somehow touches one of those surfaces, add the matching agent.
- Prompt the review agent for COVERAGE, not filtering: "Report every issue including low-severity and uncertain ones; ranking is a later step."
- If a review agent truncates, resume it with exactly: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Do not commit until the review reports no BLOCKING issues.
- For Opus 4.8: before declaring done, have a fresh subagent review the full diff for correctness and requirement gaps (not style), given only the acceptance list and the diff.

STEP 4 - COMMIT CADENCE (explicit paths only, never git add -A)
Aim for 2 to 5 small commits with Conventional Commits scopes:
1. test(ui): add happy-dom Vitest env opt-in (per-file, sim suite stays node) - package.json, vite.config.ts
2. test(ui): add fake IWorld stub for HUD tests - tests/helpers/fake_world.ts
3. test(ui): instantiate Hud in DOM harness and assert t()-sourced text - tests/hud_harness.test.ts
4. test(perf): gate hot-write skip rate above named threshold - tests/hud_perf_budget.test.ts
5. test(ui): replace client_shell string-scraping with behavioral assertions - tests/client_shell.test.ts
Fold the doc updates from Step 6 into the final commit (docs(ui): ... explicit paths). Squash or reorder freely, but never stage files this card did not produce.

STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 1; all must be checkable)
- [ ] DOM dev dep added (happy-dom default), as a devDependency; Vitest opted-in per-file; the ~150-test sim suite stays on the node env.
- [ ] tests/helpers/fake_world.ts implements the IWorld read surface (player, target, entities, inventory, equipment, known, marketInfo, socialInfo, and the rest the Hud touches) with mutators, behind IWorld with no Sim internals.
- [ ] tests/hud_harness.test.ts really instantiates Hud and asserts rendered text comes from t().
- [ ] tests/hud_perf_budget.test.ts asserts the hot-write skip rate is above the named ~0.8 threshold over steady-state frames.
- [ ] tests/client_shell.test.ts string-scraping is replaced with behavioral assertions.
- [ ] npm run build and the full npm test stay green; sim suite speed unchanged.
- [ ] No hud.ts behavior change; no sim/server/net/IWorld change.

STEP 6 - DOC UPDATES + MEMORY
- progress.md: set Phase 1 status to complete with the completion date; check off every Phase 1 deliverable box; add any deferral to the Notes section.
- state.md: update "Current phase"; in the ledger ("Created by this packet"), confirm the new files landed; record the resolution of the happy-dom canvas OPEN item under OPEN items / gotchas (state explicitly the canvas-2D shim location -- HTMLCanvasElement.prototype / globalThis / document.createElement, NOT fake_world.ts -- or whether that one file was opted to jsdom plus node-canvas, and which files use which env). Also record the online-mode QA note: the fake_world entity-drop / target-loss mutator simulates interest-scoped (~120 yd) snapshot churn for later per-frame phases and online-mode (ClientWorld) QA.
- Memory: if you discovered a surprising rule (for example which DOM lib the canvas path needed, or how the hot-write counters are read), record a concise note in Claude Code memory for later phases.

STEP 7 - FINAL RESPONSE FORMAT (return this, concise)
- Phase status: Phase 1 complete / blocked, with one-line reason if blocked.
- Files touched: each with an absolute path and one-line role (created vs edited).
- Validation results: the exact pass/fail of tsc, the two named vitest files, full npm test (and sim-suite speed note), client_shell, and npm run build (with the bundle-footprint confirmation).
- Review verdicts: qa-checklist verdict (and the fresh-subagent diff-review verdict) as BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT.
- Deferrals: anything pushed to a later phase, plus the canvas OPEN-item resolution.
- One-line handoff to the QA session (Phase 2): what to verify first.

STOPPING RULES (stop and surface; do not work around silently)
- The Hud constructor itself (not just update()) calls getContext('2d') ~3 times on createElement'd canvases that never touch the IWorld stub, and both happy-dom and jsdom return null there. So the canvas 2D context shim MUST be installed on HTMLCanvasElement.prototype.getContext (or globalThis / document.createElement) BEFORE constructing Hud, NOT inside fake_world.ts (a fake-world stub is never reached by those canvases). If the chosen DOM env still cannot construct the Hud (minimap, terrain, or character-preview canvas) with the prototype shim in place, STOP the workaround and resolve it by either (a) extending the prototype/global canvas-2D shim, or (b) opting only that one file to jsdom plus the native node-canvas devDep for a real 2D context. Do NOT stub the canvas inside fake_world.ts (the canvases are created via createElement and never hit the IWorld object), and do NOT flip the global env to make it pass. Record the resolution and the shim location in state.md OPEN items.
- If instantiating Hud requires reaching outside IWorld (any data not on the IWorld read surface, or any Sim/ClientWorld internal), STOP: that is an IWorld-parity concern owned by Phase 3 and a seam red flag. Surface it; do not add an IWorld member here.
- If the working tree is dirty with another session's files at Step 0, STOP and ask.
- If a review agent reports a BLOCKING issue, fix it before committing; if it cannot be fixed within this card's scope, surface it rather than expand scope.
```
