# Phase 13 (impl) - P2-Spellbook: Extract the Spellbook window (the worked template)

Paste everything inside the fenced block below into a fresh Claude Code session.
It is self-contained; do not rely on any other open file or prior transcript.

### Starter Prompt

```
This is Phase 13 of the UI Architecture and HUD Modularization feature: Extract the Spellbook window (the worked template).

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is a compact window extraction (read-mostly, no per-frame update, a single #spellbook root) but NOT a fully disjoint one: Spellbook drags abilities onto the action bar, so it shares the action-bar drag state (dragAction / writeDraggedAction / clearActionDropTargets) that stays in hud.ts. It is the worked template precisely because it exercises that shared-drag seam (and the closeManagedWindow co-edit), not because it is isolated; whichever window extracts first establishes the drag-state-via-HudContext seam for Bags and Talents too. A small Workflow is overkill here, so ultracode is OPTIONAL. The two slices (A: move + delegate, B: test + document the seam) fan out cleanly as two parallel Agents. Add the keyword ultracode only if you want the orchestration formalized; otherwise drive two Agents directly. The window phases that follow (15-23) are more batch-amenable, but that is not this phase.

Goal: move the Spellbook window verbatim into src/ui/hud/spellbook.ts as a class taking HudContext, wire Hud to delegate, and document the extraction seam in state.md as the reusable template for the remaining 9 windows.

STEP 0 - PRE-FLIGHT
- Run `git status`. This is a shared worktree with concurrent sessions; if it is dirty with files you do not recognize, STOP and ask the operator before touching anything. Only proceed on a clean tree (or after the operator confirms the stray files are unrelated and you will stage only your own paths).
- Scan Claude Code memory: read MEMORY.md and the topic notes for hud, i18n, shared-worktree commit care, and never-push-to-fork. Honor them (stage only your card's files with explicit paths, never `git add -A`; push to origin levy-street, never the fork; no em dashes or emojis anywhere).

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts directly in the main loop; that file is ~6,280 lines and will blow context)
- Spawn ONE Explore agent. Tell it to read and summarize, tightly:
  - docs/ui-architecture-hud-modularization/state.md (locked decisions, the non-negotiable invariants, the validation matrix, the review-dispatch matrix, the anchors index, the ledger of files created by prior phases).
  - docs/ui-architecture-hud-modularization/progress.md, Phase 13 deliverables and acceptance only.
  - This phase prompt (the one you are reading).
  - The Spellbook window source: re-grep src/ui/hud.ts for the Spellbook anchor (search the symbol/markup, e.g. `#spellbook` and the Spellbook render/toggle/update methods; the anchors index lists it around :4191 but LINE NUMBERS DRIFT, so anchor on the symbol, never the number). Have the agent return the full method bodies for the methods Spellbook actually has (toggle and render; it is read-mostly with NO per-frame update path, so do not expect or manufacture an update() method, single #spellbook root) plus any private helpers used only by them, every selector string and `t()` key they use, and every Hud field/helper they reference. Have it explicitly flag the action-bar drag plumbing the render path uses (it sets dragAction and calls writeDraggedAction / clearActionDropTargets, plus hideTooltip / attachTooltip / abilityTooltip) so those become HudContext members rather than duplicated state.
  - HudContext from Phase 11: src/ui/hud/hud_context.ts (the shared service bag: gate, window manager, icon/tooltip/money helpers, sim: IWorld, renderer-pick, keybinds, t). Have the agent enumerate the exact members HudContext exposes and check them against Spellbook's needs. Spellbook is NOT fully disjoint: expect it to need the action-bar drag-drop state dragAction, writeDraggedAction, clearActionDropTargets (shared with the action bar and with Bags/Talents), plus hideTooltip, attachTooltip, abilityTooltip, and the close hook for the closeManagedWindow co-edit. If any of those is missing from the seam, that is the seam to EXTEND here (this extraction establishes the shared-drag seam for the later windows); surface it rather than duplicating the state in the module.
  - src/ui/hud/hot_write_gate.ts (Phase 7) so you know how the single HotWriteGate is threaded by reference.
  - For reference shape only: one already-extracted module if one exists under src/ui/hud/ from a prior window, plus an existing pure UI module (e.g. src/ui/hotbar.ts) to match the file/class/test conventions.
- No web-research agent is needed; this phase names no external surface.
- Work from the Explore summary; do not re-read hud.ts wholesale in the main loop.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Request fan-out explicitly. Spawn two parallel Agents, each owning a complete vertical slice. Give each agent ONLY the Explore summary (the relevant method bodies, the HudContext member list, the selector/key inventory), not the raw planning docs and not the whole hud.ts.

- Agent A (move + delegate): create src/ui/hud/spellbook.ts exporting a Spellbook class whose constructor takes the HudContext. Move the methods Spellbook actually has (toggle + render, plus their private helpers; NO update() since Spellbook has no per-frame update path) VERBATIM into it (logic byte-for-byte; only rewrite references from `this.<hudField>`/`this.<helper>` to the corresponding HudContext member, including the shared drag state dragAction / writeDraggedAction / clearActionDropTargets, and route DOM writes through the single ctx gate, never a new cache). Then edit src/ui/hud.ts so Hud constructs the Spellbook instance with its HudContext and delegates its old Spellbook entry points to it; do a call-site sweep for ALL of Spellbook's methods (not just toggle/render) so no entry point is missed, and co-edit the closeManagedWindow switch if Spellbook has a close-side-effect case there. Delete the now-moved method bodies from hud.ts and remove any imports that become unused. Keep the delegation edit minimal so it rebases cleanly against concurrent sessions.
- Agent B (test + document the seam): write tests/hud_spellbook.test.ts (DOM env via a per-file `// @vitest-environment happy-dom`, falling back to jsdom only if a Spellbook code path needs an API happy-dom lacks; the sim suite stays node env, do not flip the global). Use the Phase 1 fake_world / hud harness helpers to instantiate the window, assert it opens, closes, and renders (Spellbook has NO per-frame update path, so do not assert one), that every rendered string resolves through t() (no English leak, no fallback literal), and that the #spellbook root and child selectors are present and byte-identical. In the SAME slice, document the extraction seam in state.md: add a short, numbered "Window extraction seam (template for windows 15-23)" section capturing the exact repeatable steps this extraction proved (re-grep the anchor; do a call-site sweep for ALL of the window's methods, not just toggle/render/update; expose only the methods the window actually has, not a uniform triad; move them verbatim into src/ui/hud/<window>.ts as a class taking HudContext; rewrite this.* references to ctx members, including shared drag state dragAction / writeDraggedAction / clearActionDropTargets via HudContext rather than a duplicated copy; route writes through the single ctx gate by reference; Hud constructs and delegates, co-editing the shared closeManagedWindow switch when the window has a close-side-effect case there; add tests/hud_<window>.test.ts in the DOM env; run the validation set; selectors and signatures stay byte-identical).

Sync point: Agent A owns hud.ts and spellbook.ts source; Agent B owns the test and the state.md seam doc. They do not edit the same files, so no worktree isolation is required. If both must touch hud.ts at once, land A first.

INVARIANTS THIS PHASE MUST KEEP (from state.md; cite by number)
- Invariant 3 (DOM id/class contract): every #id and .class selector the moved code uses, and the #spellbook root, stay BYTE-IDENTICAL. index.html and CSS depend on them.
- Invariant 4 (one shared hotWriteCache): the extracted Spellbook routes every DOM write through the single HotWriteGate instance threaded by reference via ctx.gate. Never create a second cache in the new module.
- Invariant 5 (signature stability): if Spellbook uses any recompute signature, every signature string stays byte-identical so the diff fires iff real state changed. Do NOT alter diff semantics.
- Invariant 6 (per-frame core stays imperative under rAF): do NOT touch the per-frame core (player/target frame, cast bar, action bar, auras, minimap) or its tier dispatch. Spellbook is read-mostly and on-demand; it is not on the per-frame hot path.
- Invariant 2 (t()-only render sink): every player-visible string still resolves through t(); no concat, fallback literals, default params, or LABELS maps introduced during the move.
- Invariant 8 (shared-worktree commit hygiene) and 9 (no em dashes or emojis).

OUT OF SCOPE (do not let this creep)
- Any window other than Spellbook (Talents, QuestLog, Character, Options, Social, Trade, Bags, Market, Arena). Those are Phases 15-23.
- Any change to Spellbook BEHAVIOR or MARKUP. This is a verbatim move, not a refactor of the window's logic, copy, or layout.
- Any new IWorld member, SimEvent, wire field, endpoint, table, or new i18n key (NONE expected this packet; preserve existing t() keys verbatim).
- The per-frame core, the matcher trio, and any server/net/sim/persistence change.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the validation set for this DOM/UI change type (from the state.md matrix):
- `npx vitest run tests/hud_spellbook.test.ts tests/hud_harness.test.ts tests/hud_perf_budget.test.ts tests/localization_fixes.test.ts`
- `npx tsc --noEmit`
- `npm run build`
- Manual smoke in `npm run dev`: open and close the Spellbook window and confirm it renders and behaves exactly as before (no visual or behavioral change). Spellbook has no per-frame update path, so there is no update to observe; also drag an ability onto the action bar and confirm the shared drag state still works after the move.
All must be green before you commit.

Review dispatch: check `git diff --name-only` against the phase-start commit. This is a client-only change (src/ui/hud/spellbook.ts, src/ui/hud.ts, tests/, the state.md doc), so per the review-dispatch matrix spawn qa-checklist ONLY. Do not spawn privacy-security-review, migration-safety, or cross-platform-sync (the diff touches no server/admin/net, no db, and no IWorld/sim/matcher surface). If the diff unexpectedly touches IWorld or a matcher, STOP and surface it; that is a red flag for this phase.
- Prompt the review agent for COVERAGE not filtering: "report every issue including low-severity and uncertain ones; ranking is a later step."
- If the review agent truncates, resume it with exactly: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Do not commit until qa-checklist reports no BLOCKING issues.
- Opus self-verify: before declaring done, have a fresh subagent review your own diff for correctness and requirement gaps (verbatim-move fidelity, selector/signature byte-identity, single-gate threading), not style.

STEP 4 - COMMIT CADENCE (Conventional Commits with a scope; stage explicit paths, NEVER `git add -A`; one branch feature/p2-spellbook-extract; push to origin levy-street)
Aim for 2 to 4 focused commits, for example:
- `refactor(ui): move Spellbook window into src/ui/hud/spellbook.ts` (stage src/ui/hud/spellbook.ts and src/ui/hud.ts).
- `test(ui): add hud_spellbook window test` (stage tests/hud_spellbook.test.ts).
- `docs(ui): document the window extraction seam in state.md` (stage docs/ui-architecture-hud-modularization/state.md).
- `docs(ui): update progress.md ledger for Phase 13` (stage docs/ui-architecture-hud-modularization/progress.md).

STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 13)
- [ ] src/ui/hud/spellbook.ts takes HudContext and exposes the methods Spellbook actually has (toggle() and render()); it has NO update() (read-mostly, no per-frame update path), so do not add one.
- [ ] Methods moved verbatim; #spellbook and every selector and signature string byte-identical.
- [ ] Hud delegates to the new module; the moved method bodies and any now-unused imports are removed from hud.ts.
- [ ] tests/hud_spellbook.test.ts exists and passes; the window opens, closes, and renders in `npm run dev` (no per-frame update path to verify), and the action-bar drag still works.
- [ ] The extraction seam is documented in state.md as the template for windows 15-23.

STEP 6 - DOC UPDATES + MEMORY
- progress.md: set Phase 13 status to complete with the completion date, tick its acceptance boxes, and add a one-line note in the Notes section.
- state.md: add src/ui/hud/spellbook.ts and tests/hud_spellbook.test.ts to the "Created by this packet" ledger; add the numbered "Window extraction seam (template for windows 15-23)" section (Agent B's deliverable); update "Current phase" / critical-path line. If happy-dom needed a canvas stub or a jsdom opt-in for the window test, record that resolution under OPEN items / gotchas.
- Memory: record any surprising rule you hit (e.g. a HudContext member Spellbook needed, or a happy-dom gap) as a short note so windows 15-23 inherit it.

STEP 7 - FINAL RESPONSE FORMAT (return concisely)
- Phase status (complete / blocked) and the branch name.
- Files touched (absolute paths).
- Validation results: the exact commands run and pass/fail for each (vitest set, tsc, build, dev smoke).
- Review verdicts: qa-checklist verdict and the self-verify subagent verdict.
- Deferrals / anything surfaced (e.g. a HudContext gap).
- One-line handoff to the QA session (Phase 14): QA runs the Playwright MCP walkthrough per the runbook and confirms the visual baseline for the Spellbook screen is unchanged.

STOPPING RULES
- STOP if any selector string (#spellbook or any child id/class) or any signature string would change. This is a verbatim move; a byte change is a regression, not progress.
- STOP and surface (do not invent) if Spellbook needs a HudContext member that does not exist. Report exactly what member is missing; do NOT invent a new IWorld member or widen the seam yourself.
- STOP if the git tree is dirty with unrecognized files at pre-flight (concurrent session); ask the operator first.
- STOP if validation will not go green (tsc, the vitest set, build, or the dev smoke); do not commit a red gate.
```
