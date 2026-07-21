# Phase 5 starter prompt: Playwright DOM-HUD visual baselines + MCP QA runbook

Paste the fenced block below into a fresh Claude Code session. It is
self-contained. Do not rely on anything outside the repo and the packet docs it
names.

### Starter Prompt

```
This is Phase 5 of the UI Architecture and HUD Modularization feature: Playwright DOM-HUD visual baselines + MCP QA runbook.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is moderately batch-heavy (multiple visual spec files plus a doc). If you want it orchestrated as a Workflow with fan-out subagents, add the keyword ultracode to your run; otherwise two parallel Agents (A and B) are enough.

GOAL: Baseline the DOM HUD overlay (desktop + mobile) on the CURRENT pre-refactor HUD as the golden master, and write the reusable Playwright-MCP QA runbook that every later QA phase follows.

----------------------------------------------------------------
STEP 0 - PRE-FLIGHT
----------------------------------------------------------------
- This checkout is a SHARED worktree; a concurrent session may be editing it. Run `git status`. If it is dirty with files you did not create, STOP and ask the human before touching anything. Do not stage or revert another session's work.
- This phase creates new files only (package.json is the one shared edit). Work on a fresh branch: `git switch -c feature/phase-05-playwright-visual-baselines` off the current branch. One card, one branch, one PR. Push only to origin (levy-street), never the fork.
- Memory scan: read MEMORY.md and the topic notes relevant to this phase: i18n-resolved-baseline-and-assembly, shared-worktree-commit-care, never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds. Honor them. In particular: no em dashes, no emojis, anywhere (docs, code, comments, strings).

----------------------------------------------------------------
STEP 1 - LOAD CONTEXT (do not read planning docs or hud.ts in the main loop)
----------------------------------------------------------------
Do NOT open the giant src/ui/hud.ts and do NOT read the planning docs directly in the main loop (save context). Instead spawn ONE Explore agent (read-only) with this brief, and have it return a tight summary:

Explore agent brief - "Summarize for a Playwright visual-baseline + QA-runbook phase. Read and condense, do not paste whole files:
  - docs/ui-architecture-hud-modularization/state.md  (locked decisions, the non-negotiable invariants, the validation matrix, the review-dispatch matrix, the Phase 5 ledger row, OPEN items about visual baselines and happy-dom/canvas)
  - docs/ui-architecture-hud-modularization/progress.md  (ONLY the Phase 5 deliverables/acceptance checklist and the QA-phase checklist)
  - this Phase 5 starter prompt (the file you are running from)
  - package.json  (existing scripts: dev, server, build, build:env, build:server, test; current devDependencies; confirm @playwright/test is NOT yet present)
  - vite.config.ts  (where the Vitest `test:` block lives; confirm there is no DOM env yet and Playwright must NOT be wired into Vitest)
  - index.html  (the auth/login -> offline-character flow and the ~214 id contract; specifically the ids on the offline boot path and the major window toggles)
  - src/main.ts  (the `window.__game` debug hook and the offline boot function; report the EXACT shape of window.__game and the exact ids/functions on the offline-start path)
  - the existing E2E scripts that already drive the live game for precedent: scripts/feel_smoke.mjs, scripts/perf_tour.mjs, scripts/arena_visual.mjs, scripts/market_visual.mjs, and one mobile_*_shot.mjs  (report: how they launch a browser, how they reach a playable offline state, what viewport mobile uses, whether they set ALLOW_DEV_COMMANDS, and how they poll window.__game readiness)
  Return: the exact offline boot click-flow and its ids; the exact window.__game member list; the mobile viewport the repo already uses; the exact validation commands from the state.md matrix for a Visual + dep-adding change; the review-dispatch rule for this diff; and any OPEN item about canvas/pixels."

Anchors and line numbers in the packet docs DRIFT. Whenever the Explore summary or a doc cites a symbol or id, re-grep the symbol in the live tree before relying on it (for example: `grep -n "__game" src/main.ts`, `grep -n "btn-start-offline\|btn-offline" index.html`). Trust the grep, not a remembered line number.

Also spawn ONE web-research agent (this phase names an external surface, the Playwright APIs):
Web-research agent brief - "Verify against current official Playwright docs (cite URLs):
  1. expect(locator|page).toHaveScreenshot() options: confirm `maxDiffPixelRatio`, `maxDiffPixels`, `mask`, `stylePath`, `animations`, `caret`, `threshold` exist and their meaning; confirm the per-test/per-project `snapshotDir`/`snapshotPathTemplate` and the `_snapshots` default location; confirm how `--update-snapshots` generates first-run baselines.
  2. playwright.config.ts: confirm `projects` (with per-project `use.viewport`/devices), top-level `expect.toHaveScreenshot` defaults, `testDir`, and `webServer` (so Playwright can boot `npm run dev` itself) are current and how to scope a test dir so the game (main) Vite build never imports the specs.
  3. @playwright/mcp tool names: confirm the current tool names (for example browser_navigate, browser_snapshot, browser_click, browser_type, browser_take_screenshot, browser_wait_for, browser_evaluate or equivalent) and that browser_snapshot returns the accessibility tree (not pixels).
  Mark ANYTHING you cannot verify against official docs as OPEN with a one-line reason; do not guess option names. Return a short verified-facts list plus an OPEN list."

Give every subagent ONLY the Explore summary plus this prompt, never the raw planning docs. Never run a teammate in plan mode.

----------------------------------------------------------------
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
----------------------------------------------------------------
Request fan-out explicitly. Two parallel Agents, each owning a complete vertical slice. Hand each ONLY the Explore summary and the web-research verified-facts (not raw docs):

Agent A - Playwright config + DOM HUD visual specs + bundle-footprint proof. Deliverables:
  - package.json: add `@playwright/test` to devDependencies ONLY (never dependencies). Keep the dependency set tiny. If a Playwright runner script helps (for example `"test:visual": "playwright test"`), add it, but do NOT wire Playwright into the Vitest `test` script; the PR-tier `npm test` must stay Vitest-only and Playwright runs as its own pre-merge step.
  - vite.config.ts: this is the ONE exception to the "do not touch vite.config.ts" rule (see Out of scope below) and it is REQUIRED, not optional. Add `'**/tests/visual/**'` to the Vitest `test.exclude` array. Without it, the Vitest default include glob matches `tests/visual/*.spec.ts` (the Playwright `testDir` scopes only the Playwright runner, NOT Vitest collection), so `npm test` collects the Playwright specs and exits non-zero the moment a spec imports `@playwright/test`. Do NOT add a DOM env or any other Vitest config here; this single exclude line is the only edit. Acceptance: `npm test` collects ZERO Playwright specs.
  - playwright.config.ts at repo root: a `desktop` project and a `mobile` project (use the SAME phone viewport the repo's mobile_*_shot.mjs scripts already use, re-grep it; do not invent one); `expect.toHaveScreenshot` defaults with `animations: 'disabled'`, a sane `maxDiffPixelRatio` (use the web-research value; if unverified, pick a conservative starting value and add a comment marking it OPEN/tunable), and a `webServer` that boots `npm run dev` so the run is self-contained; a pinned, explicit viewport per project (no device auto-sizing surprises); a dedicated `testDir` of `tests/visual`; an explicit snapshot location so baselines land in a committed folder. Pin the environment so baselines are reproducible (fixed viewport, deviceScaleFactor, color-scheme, disabled animations).
  - tests/visual/*.spec.ts: baseline the KEY DOM HUD screens on the CURRENT pre-refactor HUD, both desktop and mobile projects:
      * the login / auth screen,
      * the in-world persistent chrome (player frame, action bar, minimap, chat) after a deterministic offline boot,
      * each major window opened on demand (Spellbook, Talents, Character, Bags, QuestLog, Map, Social, Trade, Market, Arena, Options) via window.__game plus the dev-open path the HUD exposes.
    Reach the in-world state by the EXACT offline boot flow the Explore agent reported (re-grep the ids; the visible control is `#btn-start-offline`, reached via the offline-character panel; `#btn-offline` is an aria-hidden compat trigger), then poll until `window.__game` is populated before screenshotting. Open windows by toggling through window.__game.hud / the documented key, not by guessing selectors.
    MASK every live-changing region so baselines are stable: HP/resource numbers, timers and cast bars, money/copper, the clock, FCT, latency, anything that ticks. Use `mask` (and `stylePath` if a region cannot be masked by locator). The baseline must capture LAYOUT and CHROME, not volatile values.
    The WebGL canvas is flaky across machines: do NOT baseline canvas pixels. Where layout sits over the canvas, mask the canvas region. Verify canvas STATE (camera/player/target/zone) via a documented `page.evaluate(() => window.__game...)` assertion helper, not pixels. Include that state-assertion helper pattern in the specs (a small reusable function) and reference it from the runbook (Agent B documents the pattern).
  - Bundle-footprint proof: run `npm run build` and confirm the game (`main`) Vite bundle does NOT pull in `@playwright/test` (it is dev-only). Capture the evidence (the build output / the absence of any playwright chunk in the emitted manifest) for the final report. If Playwright leaks into the main bundle, STOP (see stopping rules).
  - CI integration (THIS PHASE OWNS IT): this is the single place CI learns about Playwright. Without it the new browser/visual gates are local-only and the program's "no visual regression" definition of done is unenforced. Edit `.github/workflows/ci.yml` and add a Playwright job to BOTH the `pr-gate` and the `release-gate`:
      * The job runs `npx playwright install` (or `--with-deps` on CI) then `npx playwright test` for the DOM-HUD visual specs in `tests/visual/`. Playwright boots its own dev server via the `webServer` config, so the job needs no separate `npm run dev` step; do NOT set `ALLOW_DEV_COMMANDS=1` (the offline boot does not need it).
      * Structure the job so the later UX/a11y packet can extend it with the `@axe-core/playwright` AAA sweep without re-plumbing CI: give it a clear name (for example `playwright-gates`), keep the install + run steps factored, and leave a comment noting where the axe Playwright specs slot in.
      * In the SAME ci.yml edit, add an explicit assertion that the Vitest-hosted browser/perf gates run under `npm test` in CI: the DOM HUD harness (Phase 1) and the perf-budget gate (`tests/hud_perf_budget.test.ts`) must be covered by the existing `npm test` step. If they already are (they ride Vitest by design), state that in a comment so a later reader does not re-add them; if a path filter would skip them, fix it.
    Note for the final report: this phase is the ONLY one that touches CI for the browser/visual tier. Editing a CI yml means the review-dispatch (Step 3) now ALSO triggers `privacy-security-review`.

Agent B - the MCP QA runbook doc. Deliverable: docs/ui-architecture-hud-modularization/mcp-qa-runbook.md, a reusable procedure every QA phase follows to drive the LIVE game via Playwright MCP. It must document, concretely and copy-pasteably:
  - Prereqs: `npm run dev` running (and `npm run server` only when an online path is under test); dev commands gate behind ALLOW_DEV_COMMANDS=1 and are DEV ONLY, never production.
  - Deterministic boot: navigate to the dev URL, reach the offline-character panel, click `#btn-start-offline` (re-grep ids), then WAIT for `window.__game` to be populated before asserting anything. Give the exact MCP tool sequence using the web-research-verified tool names (browser_navigate, browser_snapshot, browser_click, browser_take_screenshot, browser_wait_for/browser_evaluate, etc.); if a tool name was unverified, mark it OPEN inline.
  - Accessibility-tree verification: read the a11y tree (browser_snapshot) to verify labels and i18n. This is where English-leaks surface: a label that should be a t() key but rendered English shows up in the tree. Document how to spot an untranslated string and how to switch locale to confirm.
  - Canvas is a11y-blind: screenshot the canvas (browser_take_screenshot) for human eyeballing, and assert canvas STATE via page.evaluate / browser_evaluate on window.__game (its members: re-grep `window.__game` in src/main.ts and list them). Document the state-assertion helper pattern Agent A used.
  - A short per-window checklist a QA session walks (open, read a11y tree for English-leaks, screenshot, assert window.__game state) and how this complements the pre-merge Playwright DOM baselines (baselines catch layout regressions; MCP catches behavior + i18n).
  - Re-baselining policy: baselines are the golden master; re-baseline only deliberately, with a reviewed diff, when a window extraction intentionally changes pixels. An unintended diff is a regression.

Code hygiene: new files get no dead code; no TODO/FIXME left (use OPEN with a reason instead); no em dashes or emojis anywhere.

----------------------------------------------------------------
INVARIANTS THIS PHASE MUST KEEP (cite state.md)
----------------------------------------------------------------
- Locked decision 5 (state.md): Playwright @playwright/test for DOM-HUD visual-regression baselines pre-merge + Playwright MCP for live-game QA; keep puppeteer-core; canvas verified via window.__game STATE, not pixels.
- Locked decision 7 / Non-negotiable invariant set: new deps are devDependencies ONLY; ZERO new runtime deps in the game bundle (`npm run build` must prove the main bundle is unchanged in dependency footprint).
- Baselines are the GOLDEN MASTER: re-baseline only deliberately with a reviewed diff (state.md OPEN items + re-baselining policy). An unintended pixel diff is a regression, not a free update.
- Verify the canvas via STATE not pixels; do NOT gate canvas pixels in CI (the WebGL surface is flaky across machines).
- Pin the environment so baselines are reproducible (fixed viewport, deviceScaleFactor, animations disabled, masks over volatile regions).
- DOM id/class contract (invariant 3): this phase READS the ~214 ids; it must not change any. The visual specs target existing ids byte-identical.
- t()-only render sink (invariant 2): do not introduce any player- or operator-visible string; the runbook and specs are dev tooling/docs (English is fine for docs and spec code, but never assert that an English-leak in the UI is acceptable).
- No em dashes or emojis (invariant 9), shared-worktree commit hygiene (invariant 8): stage only this card's files with explicit paths, never `git add -A`.

----------------------------------------------------------------
OUT OF SCOPE (do not do these; prevent scope creep)
----------------------------------------------------------------
- Do NOT migrate or delete the existing puppeteer-core scripts. They stay.
- Do NOT touch src/ui/hud.ts or any HUD source. This phase only baselines the CURRENT HUD; it changes no behavior.
- Do NOT gate canvas pixels in CI, and do NOT add a Docker/GPU WebGL pixel pipeline (state.md OPEN item, off the critical path).
- Do NOT wire Playwright INTO the Vitest run: the only vite.config.ts edit permitted is the `'**/tests/visual/**'` entry in `test.exclude` (Agent A above), which keeps Vitest from collecting the Playwright specs. Do NOT add a DOM env here (that is Phase 1) or any other Vitest config. Playwright is its own pre-merge step that this phase wires into CI as a separate job (see the CI-integration deliverable in Agent A).
- Do NOT add any runtime dependency or any framework. No sim/server/net/IWorld changes (a new IWorld member is a stop-and-surface event).

----------------------------------------------------------------
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
----------------------------------------------------------------
Run the exact validation for a Visual + dep-adding change from the state.md matrix:
  1. `npx playwright test`  (first run generates the baselines with `--update-snapshots`, the second run verifies them green). Run it once with the update flag to author baselines, then a clean `npx playwright test` to prove they pass.
  2. `npm run build`  (proves the game `main` bundle does NOT pull in Playwright; this is the bundle-footprint check the matrix requires for any dep-adding phase). Capture the evidence.
  3. `npx tsc --noEmit`  (playwright.config.ts and the spec files are TypeScript; keep the tree compiling).
Sanity: confirm `npm test` (Vitest) still runs and collects ZERO Playwright specs (the `'**/tests/visual/**'` Vitest `exclude` in vite.config.ts is what enforces this; the Playwright `testDir` alone does NOT). Confirm the DOM HUD harness and `tests/hud_perf_budget.test.ts` still run under `npm test`.

Review-dispatch (state.md matrix): check `git diff --name-only` against the phase-start commit and spawn ONLY the agents whose surface the diff touches. This diff is package.json + playwright.config.ts + vite.config.ts + tests/visual/* + .github/workflows/ci.yml + a doc, so it triggers:
  - qa-checklist  (the completion gate; ALWAYS).
  - privacy-security-review (ALWAYS for this phase, because it edits `.github/workflows/ci.yml`; confirm the Playwright CI job does NOT set `ALLOW_DEV_COMMANDS=1` and leaks no secrets).
Do NOT spawn migration-safety or cross-platform-sync (no server/persistence, no IWorld/sim/wire/matcher changes).

Prompt every review agent for COVERAGE not filtering: "Report every issue including low-severity and uncertain ones; ranking is a later step. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." If an agent truncates, resume it with EXACTLY: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit until each spawned agent reports no BLOCKING issues.

Opus self-verify: before declaring done, have a fresh subagent review your own diff for correctness and requirement gaps (not style): does it baseline desktop AND mobile, mask all volatile regions, keep Playwright dev-only and out of the main bundle, document the window.__game state-assertion pattern and the exact offline boot flow.

----------------------------------------------------------------
STEP 4 - COMMIT CADENCE (explicit paths only, never git add -A)
----------------------------------------------------------------
2 to 5 commits, Conventional Commits with a scope, explicit paths only:
  1. `test(ui): add @playwright/test dev dep + playwright.config.ts (desktop+mobile, animations disabled, masks)`  -> git add package.json package-lock.json playwright.config.ts vite.config.ts
  2. `test(ui): baseline DOM HUD visual screens desktop+mobile on pre-refactor HUD`  -> git add tests/visual (specs + the committed baseline snapshot folder)
  3. `ci(ui): add Playwright visual gate to pr-gate + release-gate; assert harness/perf gates ride npm test`  -> git add .github/workflows/ci.yml
  4. `docs(ui): add Playwright-MCP live-game QA runbook`  -> git add docs/ui-architecture-hud-modularization/mcp-qa-runbook.md
  5. `docs(ui): record Phase 5 in progress.md + state.md ledger`  -> git add docs/ui-architecture-hud-modularization/progress.md docs/ui-architecture-hud-modularization/state.md
Commit the generated baseline images alongside the specs (they ARE the golden master and must be version-controlled). Never `git add -A`; stage only the paths above so a concurrent session's files are untouched.

----------------------------------------------------------------
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 5)
----------------------------------------------------------------
- [ ] `@playwright/test` added (devDependency ONLY); `playwright.config.ts` with desktop + mobile projects, `animations:'disabled'`, masks for live numbers/timers/money.
- [ ] `tests/visual/*.spec.ts` baseline the DOM HUD overlay screens (desktop + mobile) on the CURRENT pre-refactor HUD; committed baseline images exist.
- [ ] `window.__game` state-assertion helper pattern documented for canvas verification (canvas verified by STATE, not pixels).
- [ ] `mcp-qa-runbook.md` written: a reusable Playwright-MCP QA procedure every QA phase follows (deterministic offline boot, a11y-tree i18n check, canvas screenshot + state assertion, per-window checklist, re-baselining policy).
- [ ] `npm run build` proves the game (`main`) bundle does NOT pull in Playwright.
- [ ] `npx playwright test` is green (baselines generated then verified); `npx tsc --noEmit` green; `npm test` (Vitest) unaffected and collects ZERO Playwright specs (the `'**/tests/visual/**'` Vitest `exclude` is present in vite.config.ts).
- [ ] `.github/workflows/ci.yml` gains a Playwright job in BOTH `pr-gate` and `release-gate` that runs the `tests/visual/` specs (structured so the UX/a11y packet can extend it with the `@axe-core/playwright` sweep), and the DOM HUD harness + `tests/hud_perf_budget.test.ts` are asserted to run under the CI `npm test` step. This phase is the single place CI learns about Playwright.

----------------------------------------------------------------
STEP 6 - DOC UPDATES + MEMORY
----------------------------------------------------------------
- progress.md: flip Phase 5 status to complete (set Completed date), tick the Phase 5 acceptance boxes you met, note any deferral in Notes.
- state.md: in the "Created by this packet (ledger)" section confirm/keep the Phase 5 row (playwright.config.ts, tests/visual/*.spec.ts, mcp-qa-runbook.md); set "Current phase"; update the OPEN items (record the resolved maxDiffPixelRatio value, the confirmed mobile viewport, and any Playwright MCP tool name that stayed OPEN). If the deterministic offline boot flow needed any special handling, record it in OPEN items / gotchas so Phase 6 QA and later window phases reuse it.
- Memory: add a short note capturing the surprising/durable facts: the exact offline boot flow (`#btn-start-offline` via the offline-character panel; `#btn-offline` is the aria-hidden compat trigger), the window.__game member list used for state assertions, the chosen mobile viewport, and that Playwright is dev-only and must never enter the main bundle. Keep it terse.

----------------------------------------------------------------
STEP 7 - FINAL RESPONSE FORMAT
----------------------------------------------------------------
Report back, concisely:
- Phase status (complete / blocked) and the branch name.
- Files touched (absolute paths): package.json, package-lock.json, playwright.config.ts, vite.config.ts, tests/visual/* (list the spec files and note the baseline folder), .github/workflows/ci.yml, docs/ui-architecture-hud-modularization/mcp-qa-runbook.md, progress.md, state.md.
- Validation results: `npx playwright test` (generate + verify), `npm run build` bundle-footprint proof (state the evidence Playwright is NOT in the main bundle), `npx tsc --noEmit`, that `npm test` is unaffected and collects zero Playwright specs, and the ci.yml Playwright job wiring (pr-gate + release-gate) plus the assertion that the harness/perf gates ride `npm test`.
- Review verdicts: qa-checklist verdict (and privacy-security-review only if it was triggered); the self-verify subagent's verdict.
- Deferrals / OPEN items carried forward (any unverified Playwright API or MCP tool name, the maxDiffPixelRatio tuning note).
- One-line handoff to the Phase 6 QA session (point it at mcp-qa-runbook.md and the committed baselines).

----------------------------------------------------------------
STOPPING RULES
----------------------------------------------------------------
- STOP and DOCUMENT if Playwright cannot reach a deterministic offline game boot (for example window.__game never populates, or the offline panel/`#btn-start-offline` flow is flaky). Capture the EXACT boot flow you tried in mcp-qa-runbook.md and surface the blocker; do not ship flaky baselines.
- STOP if `@playwright/test` leaks into the game (`main`) bundle (the bundle-footprint check fails). The dep must be dev-only; resolve the leak before committing or surface it.
- STOP and surface if this phase appears to need a new IWorld member, any hud.ts change, or any sim/server/net change (out of scope; the seam should already expose what the HUD reads).
- If `git status` was dirty with another session's files at pre-flight, STOP and ask before proceeding.
```
