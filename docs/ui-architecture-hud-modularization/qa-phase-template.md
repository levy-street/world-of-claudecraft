# QA Phase Template (reusable for every QA phase)

This ONE template is the starter prompt for EVERY QA phase in the UI Architecture
and HUD Modularization packet: Phases 2, 4, 6, 8, 10, 12, 14, the QA half of each
P2 window (15-23), and Phase 25 (which additionally runs packet teardown). It is
parameterized by the phase number N being verified.

How to parameterize:
- Replace every `N` with the implementation phase number under audit (the EVEN
  phase verifies the ODD phase before it: Phase 2 verifies Phase 1, Phase 4
  verifies Phase 3, and so on; each window QA verifies its own window impl phase;
  Phase 25 verifies the final phase AND the whole packet).
- Replace `<Phase N title>` with that phase's title from `progress.md` /
  `implementation-plan.md` (for example "DOM test harness + perf-budget gate").
- The phase-start commit is the commit immediately BEFORE Phase N's first commit;
  use it as the base for `git diff --name-only` to see what Phase N actually
  changed. If unsure, the Explore agent confirms it from the git log.
- TEARDOWN (STEP 5) runs ONLY when N is the final phase of the packet (Phase 25)
  AND every phase is green. Skip STEP 5 entirely for every non-final QA phase.

Paste everything in the fenced block below into a fresh Claude Code session.

### QA Starter Prompt

```
This is Phase N QA of the UI Architecture and HUD Modularization feature: Verify <Phase N title>.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: if Phase N was a large or high-risk phase (Phase 3 i18n/IWorld decouple, Phase 9 seven-site migration, or any window with a preview canvas, drag-drop, keybind capture, or matcher touch: Character, Options, Social, Bags, Arena), add the keyword ultracode so this QA runs as an adversarial-verify Workflow where every BLOCKING/SHOULD-FIX finding is independently confirmed by a second skeptic agent before it is accepted. For a small phase, plain Claude Code is enough.

GOAL: Audit Phase N for correctness, missing tests, dead code, determinism, three-host/IWorld parity where relevant, and i18n completeness (no English leak to a translated locale), then run a live-game Playwright MCP walkthrough of the surfaces Phase N touched. Apply all BLOCKING and SHOULD-FIX items, rerun the validation matrix, and record the verdict.

STEP 0 - PRE-FLIGHT
- Run `git status`. Phase N must already be committed; the tree should be clean. This checkout may be shared by a concurrent session, so if it is dirty, STOP and ask the user whether those changes are theirs before touching anything. Never `git add -A`; never revert another session's work.
- Confirm the current branch is Phase N's branch (or the packet branch with Phase N merged). If you cannot tell which commits are Phase N's, ask.
- Scan Claude Code memory: read MEMORY.md and the entries for the phase domain (hud, i18n, shared-worktree, never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds). Honor: push only to origin (levy-street), never the fork; no em dashes or emojis anywhere; stage only your own files.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts in the main loop; save context)
Spawn ONE Explore agent. Give it these exact targets and ask for a tight summary, not a dump:
- docs/ui-architecture-hud-modularization/state.md (locked decisions, the non-negotiable invariants, the validation matrix, the review-dispatch matrix, anchors index, the OPEN items, and the ledger row for Phase N).
- docs/ui-architecture-hud-modularization/progress.md (the Phase N deliverables AND acceptance criteria checklist, plus the QA phase checklist at the bottom).
- The Phase N implementation starter prompt (docs/ui-architecture-hud-modularization/phase-NN-*.md, or the window template phase-p2-window-template.md if Phase N was a P2 window).
- The mcp-qa-runbook (docs/ui-architecture-hud-modularization/mcp-qa-runbook.md) for the live-game QA procedure.
- ALL files Phase N changed: run `git diff --name-only <phase-start-commit>..HEAD` and have the agent read each changed source and test file individually (NOT hud.ts in full if it was only delegated to; read just the delegation diff via `git diff <phase-start-commit>..HEAD -- src/ui/hud.ts`).
The Explore agent returns: the Phase N deliverable list, the acceptance criteria, the exact set of changed files, any known issues or deferrals the impl session recorded in progress.md/state.md, and which review agents the diff surface triggers (see STEP 2 dispatch).

STEP 2 - QA AUDIT (spawn the review agents in parallel; request fan-out explicitly; give each agent ONLY the Explore summary, never the raw planning docs)
Prompt EVERY agent for COVERAGE, not filtering: "Report every issue you find including low-severity and uncertain ones; ranking and triage happen later. Format your report as BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Spawn these three audit agents:
- Correctness agent: confirm every Phase N deliverable and every acceptance criterion in progress.md is actually met by the diff (not just claimed). Hunt logic bugs and edge cases. Where the change is parity-relevant, confirm the offline Sim path and the online ClientWorld path behave identically (the IWorld read surface is the same on both; an accessor must not exist on one and not the other). Verify no behavior changed that was supposed to be preserved (extraction phases move code verbatim: selectors, signatures, and string formatting must be byte-identical).
- Test-coverage agent: find new code paths with no test; add the missing unit tests. For any new sim-adjacent or signature/diff logic, add or confirm a determinism / "new sig flips iff old sig flipped" fixture test. Remove tests this phase orphaned. Confirm assertions are meaningful (a test that cannot fail is a finding). Confirm the HUD harness (tests/hud_harness.test.ts) and the perf skip-rate gate (tests/hud_perf_budget.test.ts) still pass, and that any text the phase touched is covered by tests/localization_fixes.test.ts.
- Dead-code / cleanup agent: find unused imports, types, and functions left by the extraction; confirm the import invariant holds (src/sim imports nothing from render/ui/game/net and has no DOM/Three import; the new src/ui/hud/ modules import only IWorld, their VM type, and the shared HudContext); confirm no commented-out code, no leftover TODO/FIXME, no dead `lastXSig` field or `hotWriteCache` duplicate left behind, and no em dashes or emojis introduced.

Then the multi-agent review dispatch. Run `git diff --name-only <phase-start-commit>..HEAD` and spawn ONLY the agents whose surface the Phase N diff actually touches (do NOT default to all of them):
- qa-checklist: ALWAYS (the completion gate for every phase).
- cross-platform-sync: ONLY if the diff touches src/world_api.ts, src/sim/ behavior/obs/SimEvent, src/net/online.ts, server/game.ts wire/dispatch, the matchers src/ui/sim_i18n.ts or src/ui/server_i18n.ts, or the RL surface. In this packet that is Phase 3 (matcher decouple + IWorld parity), Phase 19 / the Social window (touches the matcher area), and any phase that unexpectedly touches IWorld.
- privacy-security-review: ONLY if the diff edits server/, src/admin/, src/net/, a deploy/secret/CI file, or introduces Math.random/Date.now/performance.now in src/sim/ or toggles ALLOW_DEV_COMMANDS. Rare here (only a CI yml or E2E-script change would trip it).
- migration-safety: never in this packet (no server/persistence changes). If the diff somehow touches a server/*_db.ts or a characters.state JSONB path, STOP and surface, because that is out of packet scope.
If any review or audit agent starts truncating or reading endlessly, resume it with exactly: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 2b - LIVE-GAME QA (Playwright MCP; follow docs/ui-architecture-hud-modularization/mcp-qa-runbook.md)
- Ensure the game is running: `npm run dev` (start `npm run server` too if the surface under test is online-only). Use the live-site / test creds from memory only if a flow requires login.
- Drive the running game via Playwright MCP. Open and close the window(s) or exercise the flow(s) Phase N touched (for a primitive-only phase like 7/9/11, exercise the windows that consume that primitive; for a window phase, open/close/use that specific window).
- Read the HUD accessibility tree to confirm labels, roles, and i18n: every player- and operator-visible string resolves through t(), and there is NO English leak when the locale is switched to a translated language (switch locales and re-read the tree). The a11y tree is the right tool for i18n because it exposes the resolved text.
- Screenshot the canvas-backed surfaces (minimap, character preview) where the a11y tree is blind, and assert canvas/game state via window.__game + page.evaluate rather than pixels.
- Confirm the Playwright DOM visual baselines are unchanged: `npx playwright test`. If a window extraction intentionally changed pixels, re-baseline deliberately and review the diff (an UNINTENDED visual diff is a regression, not a re-baseline). For a phase that touches no visible DOM, the baselines must be byte-identical.
- Online-mode leg (for HUD-behavior phases): the offline `Sim` harness drives steady state only, so run the surface once against the online path too. Start `npm run server` alongside `npm run dev`, log in through `ClientWorld`, and confirm parity with the offline run while exercising interest-scoped (~120 yd) partial snapshots, latency, and target loss (open the window, move out of interest range, lose the current target). Per-frame surfaces (player/target frame, nameplates, cast bar, Social online announcements) are the ones most likely to diverge under snapshot churn; for a per-frame phase you may also simulate this offline via the Phase 1 `fake_world` entity-drop mutator. A primitive-only phase (7/9/11) exercises this through the windows that consume the primitive.

STEP 3 - FIX
Apply every BLOCKING and every SHOULD-FIX item the agents (and the live walkthrough) surfaced. Triage NICE-TO-HAVE items: fix the cheap ones, defer the rest with a one-line note. Then rerun the validation matrix for Phase N's change type (from state.md), which for most phases is:
- DOM/UI logic (default): `npx tsc --noEmit` + `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts <the phase's own test>`; if any player text or a matcher moved, also `npx vitest run tests/localization_fixes.test.ts`.
- i18n matcher change (Phase 3, Social window): `npx vitest run tests/localization_fixes.test.ts` + `npx tsc --noEmit`.
- IWorld parity (Phase 3): `npx vitest run tests/iworld_read_surface.test.ts tests/snapshots.test.ts tests/interest.test.ts`.
- Sim-purity boundary (Phase 3): `npx vitest run tests/architecture_boundaries.test.ts` + `npm run lint`.
- Visual (Phase 5 and any window touch): `npx playwright test` + the mobile screenshot script against a phone viewport with `npm run dev` running.
- Before declaring PASS, run the CI-equivalent gate once: `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`. The final `npm run build` must show the game (main) bundle did not pull in any new dev dep (happy-dom / Playwright stay dev-only).
Commit fixes in commits SEPARATE from the verdict/doc commit, with explicit paths only (never `git add -A`). Suggested fix headline: `fix(ui): address Phase N QA findings (<area>)` or `test(ui): add Phase N coverage for <area>`.

STEP 4 - UPDATE DOCS + MEMORY
- progress.md: mark Phase N QA complete in the status table, tick the QA phase checklist at the bottom (deliverables met, tests added, dead code removed, review verdicts, MCP walkthrough done), and note any deferrals in the Notes section.
- state.md: record any drift discovered (anchors that moved, an OPEN item resolved, a new file in the ledger, a gotcha for later phases). Update "Current phase".
- Record any surprising rule or resolution in Claude Code memory (for example the happy-dom-vs-jsdom canvas resolution, or a signature subtlety).
- Commit the doc/memory updates with explicit paths: `docs: record Phase N QA verdict and drift`.

STEP 5 - PACKET TEARDOWN (FINAL PHASE ONLY: run this ONLY when N is the last phase, Phase 25, AND everything is green; otherwise SKIP this entire step)
- First, surface every deferred follow-up collected across all phases (from progress.md Notes and the QA deferrals), so the user decides what carries forward into its own issue/packet.
- Then ask the user, in plain language, for explicit confirmation to delete the planning scaffolding before the PR: "All phases are green. May I delete docs/ui-architecture-hud-modularization/ (the planning packet) before opening the PR? It is no longer needed in the merged history. Reply yes to delete, no to keep it."
- On an explicit yes: delete ONLY that directory by its exact path. If it is tracked, `git rm -r docs/ui-architecture-hud-modularization`; if untracked, `rm -rf docs/ui-architecture-hud-modularization`. Then commit `docs: remove ui-architecture-hud-modularization planning scaffolding`. Never `git add -A`.
- On no (or no clear answer): leave the directory exactly as is and note that teardown was declined.

STEP 6 - FINAL RESPONSE FORMAT (return this, concise)
- QA verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL.
- Counts: BLOCKING found / fixed, SHOULD-FIX found / fixed, NICE-TO-HAVE found / fixed-or-deferred.
- Files touched by the fixes (absolute paths).
- Validation results: the exact commands run and green/red for each (tsc, the phase test, harness, perf gate, i18n guard, playwright, the CI-equivalent gate).
- Review verdicts: one line per agent spawned (qa-checklist, and cross-platform-sync where applicable), with its verdict.
- Deferrals: NICE-TO-HAVE or out-of-scope items pushed forward, one line each.
- Teardown: whether the packet directory was removed (final phase only) or "N/A".
- One-line handoff: the next phase to start (or "packet complete" if this was Phase 25 and teardown ran).

STOPPING RULES
- STOP and surface to the user if any BLOCKING item cannot be fixed without expanding Phase N's scope (for example a fix would require a new IWorld member, a sim/server/wire change, or a new player-facing string: all are out of packet scope and are explicit stop-and-surface events per state.md).
- STOP if the diff touches server/, persistence, or the wire protocol (this is a client-only packet); do not "fix" by editing those, surface instead.
- STOP if the tree is dirty with changes that are not yours (concurrent session); ask before proceeding.
- STOP if a deliberate re-baseline of the visual snapshots looks like it is masking an unintended regression; show the diff and ask.
- Do NOT mark Phase N QA complete while any validation command is red or any review agent still reports a BLOCKING issue.
```
