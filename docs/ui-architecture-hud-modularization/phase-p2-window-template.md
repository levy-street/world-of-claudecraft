# P2 Window Extraction Template (Phases 15-23)

This is the REUSABLE starter prompt for the nine on-demand windows extracted
after the Spellbook worked example (Phase 13): Talents, QuestLog, Character,
Options, Social, Trade, Bags, Market, Arena. Use it ONCE PER WINDOW, one fresh
Claude Code session, one branch, one PR each. The Spellbook concrete file
(`phase-13-p2-spellbook.md`) is the worked reference; this template generalizes
it.

How to use this file:
1. Pick the next window from the P2 order table in `implementation-plan.md` and
   the per-window status table in `progress.md` (lowest-id, not-blocked first).
2. Copy the fenced "Starter Prompt" block below into a new session.
3. Replace every `{Window}`, `{window}`, `{anchor}`, and `{id-root}` placeholder
   with that window's values BEFORE running. `{Window}` is the PascalCase name
   (e.g. `Talents`), `{window}` is the lowercase file slug (e.g. `talents`),
   `{anchor}` is the toggle/render/update symbol set you re-grep (state.md line
   numbers DRIFT, never paste them as truth), `{id-root}` is the window's DOM id
   root (e.g. `#talents`).
4. Read the "Per-window special notes" table below the block and fold that
   window's row into the prompt before running.

Placeholders are intentionally un-filled in the block. A session that leaves a
`{...}` token in place has not been parameterized; fix it before executing.

---

### Starter Prompt

```
This is Phase N of the UI Architecture and HUD Modularization feature: Extract the {Window} window.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: if this window is large (Talents or Market) add the keyword ultracode so the session orchestrates the verbatim move + delegation + test as a small Workflow; for the smaller windows (QuestLog, Bags, Trade, Character, Options, Social, Arena) hand-spawn agents instead.

Goal: move the {Window} window out of src/ui/hud.ts into src/ui/hud/{window}.ts verbatim, as a class that takes HudContext and exposes ONLY the methods this window actually has (the surface is NOT a uniform render()/toggle()/update() triad: some windows are toggle+render only, e.g. Spellbook/Talents/QuestLog/Character which have no per-frame update; Trade is update-only with no toggle/render and a sim-derived open state; Arena keeps both toggle/render plus a per-frame update; Market/Social keep toggle/render with conditional re-render). Hud instantiates it and delegates, with every DOM selector and every signature string byte-identical.

STEP 0 - PRE-FLIGHT
- Run `git status`. This checkout is shared with concurrent sessions. If it is dirty with files you do not own, STOP and ask the user before touching anything. Stage only this card's files later, with explicit paths, never `git add -A`.
- Confirm only one session is touching hud.ts. If another window delegation is mid-flight on hud.ts, land the lower-id card first and rebase onto it; delegation edits are tiny and rebase cleanly when windows are disjoint.
- Scan Claude Code memory: read MEMORY.md and the entries for hud, i18n, shared-worktree, and never-push-to-fork.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or src/ui/hud.ts directly in the main loop; they are huge and burn context)
- Spawn ONE Explore agent. Tell it to read and summarize, for THIS window only:
  - docs/ui-architecture-hud-modularization/state.md (locked decisions, the nine invariants, validation matrix, review-dispatch matrix, the Anchors index, the ledger).
  - docs/ui-architecture-hud-modularization/progress.md (this window's row in the P2 tracking table + the templated acceptance list).
  - This phase prompt (the one you are running).
  - The Spellbook worked example: src/ui/hud/spellbook.ts and tests/hud_spellbook.test.ts (the seam to copy), plus phase-13-p2-spellbook.md.
  - The HudContext seam: src/ui/hud/hud_context.ts (what helpers it already exposes), src/ui/hud/hot_write_gate.ts (the one shared gate), src/ui/hud/reactive_diff.ts (ReactiveDiff/StructuralDiff), src/ui/hud/icon_service.ts. Expected HudContext members the window may need to thread (confirm against the actual seam): gate, icons, sim (IWorld), keybinds, t, formatMoney/formatNumber/formatDateTime, the close hook from the closeManagedWindow co-edit (a per-window onClose / ctx.windows.closeManagedWindow), and the action-bar drag-drop state dragAction, writeDraggedAction, clearActionDropTargets. dragAction is SHARED drag state between the action bar and any window that drags items/abilities onto it (Bags and Spellbook, and Talents); a dragging window must thread it through HudContext, never duplicate it in the module.
  - The {Window} window region of src/ui/hud.ts ONLY: have the agent grep the {Window} toggle*/render*/update* symbols and report the method names, their exact signatures, every #id / .class selector they touch, which hotWriteCache setters and signature fields they use, and which HudContext members they need. It must NOT dump the whole file.
  - src/world_api.ts (the IWorld read surface) so the agent can flag any data the window reads that is not already on IWorld or HudContext.
- For the Social window only, also have the Explore agent summarize src/ui/sim_i18n.ts and src/ui/server_i18n.ts (the matcher mirrors) and confirm Phase 3 has LANDED. If Phase 3 has not landed, STOP now (Social is BLOCKED on Phase 3).
- No web-research agent is needed; this is a pure-internal refactor.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Give every agent ONLY the Explore summary, never the raw planning docs or raw hud.ts. Request fan-out explicitly. Use `isolation: "worktree"` only if two agents would edit overlapping files in parallel; here the move and the test are separable so usually they do not.
- Agent A - Extraction. Re-grep the {Window} symbols in src/ui/hud.ts (anchors drift; trust the symbol, not any line number). Do a CALL-SITE SWEEP for ALL of this window's methods, not just toggle/render/update: grep every invocation of every method the window owns (e.g. render{Window}, refresh{Window}List, update{Window}Window, and any window-specific helper Hud calls), so you discover every entry point Hud uses, including ones outside the {toggle*/render*/update*} symbol set. Some windows are re-entered by name from refreshLocalizedDynamicUi (re-grep that method) and from the per-frame update() tier dispatch (e.g. renderSocial, refreshSocialList, refreshMarket, updateTradeWindow). Rewiring those call sites to delegate into the extracted module IS a permitted, required exception to the "do not touch the per-frame core" invariant for this card: you may re-point the dispatch into the module, but do not reframework the per-frame core itself. Move those methods (and any private helpers used only by them) VERBATIM into a new class in src/ui/hud/{window}.ts that takes HudContext in its constructor and exposes ONLY the methods this window actually has (do NOT manufacture a render()/toggle()/update() triad for a window that lacks one of them; see Goal: read-mostly windows expose toggle+render only, Trade exposes update/sync only, etc.). Rewire internal references: this.setText -> ctx.gate.setText (the one shared HotWriteGate, never a new cache), this.closeOtherWindows -> ctx.windows.closeOtherWindows, icon helpers -> ctx.icons, money/number/date formatting -> ctx.formatMoney/formatNumber/formatDateTime (or Intl), world reads -> ctx.sim (IWorld), t -> ctx.t. Keep every #id / .class selector and every signature string byte-identical. Deliverable: src/ui/hud/{window}.ts plus the exact list of HudContext members it consumed.
- Agent B - Delegation. After A lands, make Hud construct the {Window} module once (threading the single shared HudContext, so the gate is shared by reference) and delegate every entry point the call-site sweep found (not only toggle/render/update) to the module. Remove the now-dead methods from hud.ts. CO-EDITED SURFACE: closeManagedWindow's per-window switch in hud.ts (re-grep `closeManagedWindow` and its switch; the anchors index hints around :669-682 but LINE NUMBERS DRIFT) is a SHARED surface that EVERY window extraction touches. Six windows (Talents, Bags, Trade, Market, Social, Options) have a per-window case in that switch (closeOptions/closeMarket/cancelPetFeed/talentStage reset, etc.) that lives inside the region you are moving; you MUST co-edit that switch when their close-side-effect leaves hud.ts. Do NOT assume windows are disjoint there. Thread a close hook through HudContext (a per-window onClose callback, or ctx.windows.closeManagedWindow delegating to the extracted module) so the switch case delegates into the module rather than reaching into now-moved internals. Deliverable: the hud.ts delegation diff (including the closeManagedWindow switch edit) with no orphaned code or imports.
- Agent C - Test. Write tests/hud_{window}.test.ts (opt the file into the DOM env per-file with `// @vitest-environment happy-dom`, or jsdom if the window needs a canvas 2D context, e.g. Character's preview). Assert the window's REAL surface against the fake world (tests/helpers/fake_world.ts): open/close for windows that toggle, render for windows that render, and the per-frame update/sync path for windows that have one. Do not assert an open/close path for an update-only window (Trade has no toggle/render entry) or an update path for a window that has none (Spellbook/Talents/QuestLog/Character). Assert its rendered text comes from t(). Deliverable: tests/hud_{window}.test.ts green.
If a needed helper is missing from HudContext, EXTEND HudContext (src/ui/hud/hud_context.ts) to expose it from the data Hud already has. If the window reads data that is NOT already on IWorld, STOP and surface it to the user; do NOT invent a new IWorld member (Invariant 1).

INVARIANTS THIS PHASE MUST KEEP (from state.md)
- 3 DOM id/class contract: every #id and .class index.html and the CSS depend on stays byte-identical through the move.
- 4 One shared hotWriteCache: thread the single HotWriteGate by reference via ctx.gate; never construct a second cache in the module, or the skip rate regresses.
- 5 Signature stability: recompute signatures keep exact diff semantics; the signature strings stay byte-identical, so they still fire iff real state changed.
- 6 Per-frame core stays untouched: do NOT move or reframework the player/target frame, cast bar, action bar, auras, or minimap; this card touches an on-demand window only.
- 2 t()-only render sink and 9 no em dashes/emojis apply to any string you so much as move past.
- 8 Shared-worktree hygiene: explicit paths only, one branch (feature/p2-{window}-extract), push to origin (levy-street), never the fork.

OUT OF SCOPE (do not let the move grow)
- No behavior change, no visual change, no copy change, no new t() keys (extraction preserves existing keys verbatim).
- No touching the per-frame core, the window manager internals beyond what the move requires, the matchers (except Social, which only consumes existing matcher output), or any other window. EXCEPTION: the closeManagedWindow per-window switch is a shared co-edited surface (above) and MUST be touched when this window's close-side-effect leaves hud.ts; that is a required edit, not a scope violation.
- No new IWorld member, SimEvent, wire field, endpoint, table, or runtime dependency.
- No refactor-for-its-own-sake inside the moved methods; move them verbatim, then rewire references only.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run the DOM/UI-logic row of the state.md validation matrix for this window:
- `npx vitest run tests/hud_{window}.test.ts tests/hud_harness.test.ts tests/hud_perf_budget.test.ts tests/localization_fixes.test.ts`
- `npx tsc --noEmit`
- `npm run build`
- With `npm run dev` running, exercise the {Window} window's REAL surface in the browser and confirm it behaves exactly as before: open/close it if it toggles (Trade has no open/close entry to drive directly, so reach it via its in-world trigger), and watch it refresh if it has an update/sync path (Spellbook and the other read-mostly windows have no per-frame update to observe).
Then review per the state.md review-dispatch matrix, spawning ONLY the agents whose surface the diff touches (check `git diff --name-only` vs the phase-start commit):
- `qa-checklist` - always (the completion gate).
- `cross-platform-sync` - for the Social window ONLY (it touches the matcher area), or for any window that unexpectedly touches src/world_api.ts or a matcher.
Prompt every review agent for COVERAGE not filtering: "report every issue including low-severity and uncertain ones; ranking is a later step." If a review agent truncates, resume it with: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit until each reports no BLOCKING issues.

STEP 4 - COMMIT CADENCE (explicit paths only, never git add -A)
- `feat(ui): extract {Window} window to src/ui/hud/{window}.ts` (paths: src/ui/hud/{window}.ts, plus any HudContext extension in src/ui/hud/hud_context.ts)
- `refactor(ui): Hud delegates {Window} window` (path: src/ui/hud.ts)
- `test(ui): {Window} window` (path: tests/hud_{window}.test.ts)
- `docs(ui): record {Window} extraction in progress.md and state.md` (paths: the two docs)

STEP 5 - ACCEPTANCE CRITERIA (all must be checkable)
- [ ] {Window} lives in its own module src/ui/hud/{window}.ts consuming HudContext, exposing ONLY the methods it actually has (the real surface for this window, not a manufactured render()/toggle()/update() triad).
- [ ] Every #id / .class selector and every signature string is byte-identical to before the move.
- [ ] Hud constructs the module once and delegates; the old methods are gone from hud.ts with no orphaned code or imports.
- [ ] The single shared HotWriteGate is threaded by reference (grep proves no second cache).
- [ ] tests/hud_{window}.test.ts is green.
- [ ] hud_harness + hud_perf_budget (skip rate > 0.8) + the S3 i18n guard (localization_fixes) + `npx tsc --noEmit` + `npm run build` are all green.
- [ ] The window's real surface works in `npm run dev` (open/close if it toggles; refresh if it has an update/sync path) exactly as before the move.

STEP 6 - DOC UPDATES + MEMORY
- progress.md: set this window's row in the P2 tracking table to complete (record the branch); tick the templated acceptance list for it.
- state.md: add src/ui/hud/{window}.ts and tests/hud_{window}.test.ts to the ledger; update "Current phase"; record any HudContext member you had to add and any gotcha you hit.
- Memory: note any surprising per-window detail for the next window session.

STEP 7 - FINAL RESPONSE FORMAT
Report, concisely:
- Phase status (complete / blocked / needs input).
- Files touched (absolute paths).
- Validation results (each command + pass/fail).
- Review verdicts (qa-checklist, and cross-platform-sync if Social).
- Deferrals or surfaced items (e.g. a missing HudContext/IWorld member).
- One-line handoff to the QA session (which uses qa-phase-template.md: Playwright MCP walkthrough + confirm the visual baseline is unchanged).

STOPPING RULES
- STOP if any selector or signature string would have to change to make the move work (that breaks Invariant 3 or 5); surface it instead.
- STOP if the window needs a HudContext member that does not exist AND it would require a new IWorld member; surface it, do not invent the member (Invariant 1).
- STOP, for the Social window, if Phase 3 (matcher decouple + IWorld parity) has not landed.
- STOP if `git status` is dirty with files you do not own, or another session is mid-flight on hud.ts; coordinate first.
```

---

## Per-window special notes (fold this window's row into the prompt before running)

| Window | `{window}` | Special handling | Review |
|---|---|---|---|
| Talents | `talents` | Staged-edit allocation, loadouts, import/export. The staged allocation must stay OWNED by the module across tab switches (do not reset it on every render). Large window: consider `ultracode` + a small Workflow. | qa-checklist |
| QuestLog | `questlog` | Straightforward; no shared state, no canvas. | qa-checklist |
| Character | `character` | Owns a preview canvas. The module must keep driving the `CharacterPreview` sync; verify it still fires after the move. Its test likely needs jsdom (canvas 2D context) rather than happy-dom. | qa-checklist |
| Options | `options` | Keybind capture lives in this window. Keep keybind capture on the MODAL gate (the main.ts modal gate at the documented anchor), not a new mechanism. | qa-checklist |
| Social | `social` | Consumes the `StructuralDiff` from Phase 9 AND touches the matcher area, so it is BLOCKED on Phase 3: do NOT start before Phase 3 lands. Review WITH cross-platform-sync. | qa-checklist + cross-platform-sync |
| Trade | `trade` | Staged items + copper synced via IWorld (read through ctx.sim); do not stash a private copy that can drift from the world. | qa-checklist |
| Bags | `bags` | Drag-drop shares `dragAction` state with the action bar (which stays in hud.ts). Thread that shared drag state via HudContext; do NOT duplicate `dragAction` in the module. | qa-checklist |
| Market | `market` | Browse / sell / collect tabs. Large window: consider `ultracode` + a small Workflow. | qa-checklist |
| Arena | `arena` | Bracket queue + in-match UI + leaderboard fetch. Move all three sub-surfaces together as one window. | qa-checklist |

Re-grep the `{anchor}` symbols for the chosen window in `src/ui/hud.ts` before
editing; the state.md Anchors index line numbers DRIFT and are only a starting
hint. One window per PR so concurrent sessions never collide on `hud.ts`; if two
delegations race, land the lower-id card first and rebase.
