# Phase 24 starter prompt: Per-frame core perf hardening

Paste the fenced block below into a fresh Claude Code session. It is
self-contained; do not rely on this surrounding prose at runtime.

### Starter Prompt

```
This is Phase 24 of the UI Architecture and HUD Modularization feature: Per-frame core perf hardening.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is NOT batch-heavy (it is a measure-first probe followed by at most three tiny, dependent edits), so a Workflow is overkill. Do not add the keyword ultracode. Run it as one focused session with targeted subagent fan-out only for the measurement and review steps. (If, and only if, the trace later justifies all three edits and you want them executed strictly in parallel on disjoint anchors, you may add ultracode then, but that is rarely worth it here.)

GOAL: Harvest the three known GC micro-wins on the per-frame hot path without regressing it, behind the skip-rate gate, by measuring first and only acting on what the trace proves.

================================================================
STEP 0 - PRE-FLIGHT
================================================================
- Run `git status`. This checkout may be shared with a concurrent session. If the tree is dirty with files you did not create, STOP and ask the operator which changes are yours before touching anything. Only the docs/ui-architecture-hud-modularization/ packet and your own Phase 24 branch should be in flight.
- Confirm Phase 1 (perf-budget gate, HUD harness) and Phase 9 (ReactiveDiff parity test) have already landed; this phase depends on `tests/hud_perf_budget.test.ts`, `tests/hud_harness.test.ts`, and `tests/reactive_diff.test.ts` existing. If any is missing, STOP and surface it (the prerequisite phase did not land).
- Scan Claude Code memory before starting: read MEMORY.md and the entries for hud, shared-worktree commit care, never-push-to-fork, and no-em-dashes-or-emojis. Honor all of them.

================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or hud.ts directly in the main loop)
================================================================
Spawn ONE Explore agent. Its job is to read and return a tight summary; do not pull these files into the main context yourself (hud.ts is ~6,280 lines, renderer.ts is large). The Explore agent must summarize:
- docs/ui-architecture-hud-modularization/state.md (locked decisions, the non-negotiable invariants, the validation matrix, the review-dispatch matrix, the anchors index, the OPEN items).
- docs/ui-architecture-hud-modularization/progress.md, Phase 24 section only (deliverables + acceptance for this phase).
- This Phase 24 starter prompt (so the agent knows the measure-first gate and the stopping rules).
- The exact source sites this phase may touch, each read individually and reported with its surrounding consumer logic (re-grep every symbol; line numbers DRIFT, do not trust the numbers below):
  - src/render/renderer.ts: the `AnimState` object literal built per visible entity per frame (grep `const st: AnimState`, anchor ~:1201). Report WHO consumes `st`, whether the consumer reads it synchronously, and whether any reference to it is retained past the call (stored on the view, pushed into an array, closed over).
  - src/ui/hud.ts: the three minimap `Set`s rebuilt every ~100ms (grep `new Set(social.friends`, `new Set(social?.guild`, `new Set(this.sim.partyInfo`, anchor ~:1952-1954). Report what invalidates them (a social/party change) and where they are read.
  - src/ui/hud.ts: the aura signature using `.map().join()` (grep the aura sig build near `lastPetBarSig`/the aura recompute, anchor ~:1838). Report the exact current signature shape and the diff gate it feeds.
  - src/game/perf.ts: how the `/perf` overlay is enabled at runtime, what it measures (per-subsystem p95/max, GC if surfaced), and how to read it via the `window.__game` hook.
No web-research agent is needed; this phase names no external surface (the only tools are the in-repo `/perf` overlay and the existing E2E scripts).

================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (measure first; gate every edit on the trace)
================================================================
Request fan-out explicitly. Give each agent ONLY the Explore summary, never the raw planning docs. Never put a teammate in plan mode.

Agent A - MEASUREMENT PASS (this is the gate; runs first, alone):
- Stand up the running game (`npm run dev`, and `npm run server` if the busy scene needs the online path) and enable the `/perf` overlay on a DELIBERATELY busy scene: 50+ entities plus active VFX (use the `window.__game` hook and, in a dev build with ALLOW_DEV_COMMANDS=1, spawn/teleport to crowd the scene; dev only). Capture two profiles: desktop, and a throttled mobile profile (CPU throttle + a phone viewport).
- Deliverable: the per-frame trace for both profiles, explicitly answering ONE question: is GC visible in the trace (sawtooth heap / measurable GC pauses attributable to the per-frame core)? Report the numbers, not a vibe.
- HARD GATE: if GC is NOT visible in either profile, STOP THE PHASE HERE. Do not write any optimization. Go to the stopping rules and close the phase as "no action, perf already adequate". Speculative allocation changes into the least-tested hot path are forbidden.

ONLY IF Agent A confirms GC is visible, fan out the three edits (B, C, D). Each owns a complete vertical slice (the edit plus its verification). They touch disjoint anchors, so they can run in parallel; if you prefer, do them sequentially since each is tiny.

Agent B - POOL THE AnimState LITERAL (only the wins the trace justified):
- Replace the per-entity-per-frame `AnimState` object literal (renderer.ts ~:1201) with a per-EntityView scratch object that is mutated in place and reused each frame.
- MANDATORY precondition from the Explore summary: confirm the consumer reads `st` synchronously within the same call and does NOT retain the reference (does not store it on the view, push it into an array, or close over it for later). If the consumer retains it, pooling aliases stale state across entities/frames - do NOT pool in that case; report it and skip this edit.
- Deliverable: the scratch object lives on the EntityView, is reset/mutated in place, allocates zero new objects on the hot path.

Agent C - CACHE THE THREE MINIMAP SETS:
- Cache the three minimap `Set`s (hud.ts ~:1952-1954) behind a social/party-changed flag instead of rebuilding them every ~100ms. Rebuild ONLY when the social/party data that feeds them actually changed; otherwise reuse the cached Sets.
- Deliverable: the Sets are rebuilt iff the underlying friends/guild/party data changed, the minimap reads identical contents, and the flag invalidation is correct (a real social/party change still refreshes them).

Agent D - CHEAPEN THE AURA SIGNATURE:
- Replace the aura signature's `.map().join()` (hud.ts ~:1838) with a cheaper signature: a count plus a rolling numeric hash over the same fields, producing exactly the same change-detection semantics.
- MANDATORY: extend the Phase 9 parity test (tests/reactive_diff.test.ts, the "new sig flips iff old sig flipped" pattern) to cover the new aura signature with fixtures, so a silent regression that stops detecting a real aura change red-fails the suite.
- Deliverable: the new aura sig is allocation-cheaper, fires iff the aura state actually changed, and is locked by the extended parity test.

================================================================
INVARIANTS THIS PHASE MUST KEEP (cite by number from state.md)
================================================================
- Invariant 5 (Signature stability): the aura signature change must keep exact diff semantics - it fires iff real aura state changed. A silent signature regression ships a stale-UI bug with no compile guard. The extended fixture parity test (Agent D) is mandatory, not optional.
- Invariant 6 (Per-frame core stays imperative, no new per-frame allocations): the player/target frame, cast bar, action bar, auras, and minimap stay imperative under rAF. This phase REMOVES per-frame allocations; it must add none. No frameworkization.
- Skip rate still > 0.8: the hot-write skip rate (`tests/hud_perf_budget.test.ts`) must stay above the 0.8 floor over steady-state frames after every edit.
- Invariant 8 (Shared-worktree commit hygiene): stage only this card's files by explicit path; never `git add -A`; one branch (`feature/p3-perf-hardening` or similar); push to origin (levy-street), never the fork.
- Invariant 9 (No em dashes or emojis) in any code comment, doc, or string you touch.

================================================================
OUT OF SCOPE (do not do these)
================================================================
- Any structural extraction (no new src/ui/hud/ module, no moving methods out of hud.ts). This phase mutates three hot sites in place, nothing more.
- Any perf work NOT justified by the trace. Do not optimize speculatively. If the trace does not show GC, you do nothing (see stopping rules).
- Any new IWorld member, SimEvent, wire field, endpoint, table, or i18n key. None is expected; an addition here is a red flag - record and justify or back out.
- Any behavior change visible to the player. This is a pure allocation/cost refactor; rendered output must be byte-identical.

================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================
Run the validation matrix for this change type (DOM/UI logic plus a src/render touch):
- `npx vitest run tests/hud_perf_budget.test.ts tests/reactive_diff.test.ts tests/hud_harness.test.ts`
- `npx tsc --noEmit`
- `npm run perf:tour`
- `npm run asset:budget`
All must be green. The skip-rate assertion in hud_perf_budget must still pass (> 0.8) and the extended reactive_diff parity test (aura sig) must pass.

Review dispatch (spawn ONLY the agents whose surface the diff touches; check `git diff --name-only` against the phase-start commit):
- `qa-checklist` ONLY. This packet is client-only; this phase touches src/render and src/ui but adds NO IWorld member and NO sim behavior, so `cross-platform-sync` is NOT needed, and `privacy-security-review` / `migration-safety` are not in play. Do not default to running all four.
- ADDITIONALLY, spawn a fresh subagent to review the diff specifically for: (1) object aliasing across entities or across frames (the pooled AnimState scratch object must never leak one entity's state into another or persist a stale frame), and (2) any signature (the new aura sig, the minimap-Set invalidation flag) that could STOP detecting a real change. This is the highest-risk failure mode of the phase; the review must explicitly clear both.

Prompt every review agent for COVERAGE, not filtering: "Report every issue including low-severity and uncertain ones; ranking is a later step." If a review agent truncates, resume it with exactly: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." Do not commit until each review reports no BLOCKING issues.

================================================================
STEP 4 - COMMIT CADENCE (explicit paths only, never `git add -A`)
================================================================
Branch first (`feature/p3-perf-hardening` off the packet branch). Stage only this card's files by explicit path. Suggested headlines (only commit the edits the trace justified; skip a commit if its edit was not taken):
- `perf(render): pool AnimState into a per-EntityView scratch object` (src/render/renderer.ts)
- `perf(ui): cache minimap Sets behind a social/party-changed flag` (src/ui/hud.ts)
- `perf(ui): cheapen aura signature to count + rolling hash` (src/ui/hud.ts)
- `test(ui): extend reactive-diff parity to cover the aura signature` (tests/reactive_diff.test.ts)
- `docs(ui): record Phase 24 perf-hardening outcome in progress + state` (docs/ui-architecture-hud-modularization/progress.md, docs/ui-architecture-hud-modularization/state.md)
If the measurement pass closed the phase with no action, make a single docs-only commit recording that outcome and stop.

================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 24)
================================================================
- [ ] Measured first: the `/perf` overlay was enabled on a busy scene (50+ entities + active VFX) on both desktop and a throttled mobile profile, and the trace was reported. Only proceeded past measurement if GC was visible.
- [ ] If confirmed by the trace: AnimState pooled (renderer.ts ~:1201) into a per-EntityView scratch object mutated in place, with the consumer confirmed to read it synchronously and not retain it.
- [ ] If confirmed by the trace: the three minimap Sets (hud.ts ~:1952-1954) cached behind a social/party-changed flag.
- [ ] If confirmed by the trace: the aura signature (hud.ts ~:1838) cheapened from `.map().join()` to a count plus rolling numeric hash, with the Phase 9 parity test extended to cover it.
- [ ] A fresh subagent reviewed the diff for object aliasing (across entities/frames) and for stale-signature risk; both cleared. Skip rate still > 0.8.

================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================
- Update docs/ui-architecture-hud-modularization/progress.md: set Phase 24 status (complete, or "no action - perf adequate" if the trace gate closed it), check the acceptance boxes that apply, and add a Notes line recording the measured trace outcome (which edits were taken and which were skipped, with the numbers).
- Update docs/ui-architecture-hud-modularization/state.md: record in the ledger which hot sites changed (or that none did and why), update the OPEN-items / performance-reality note to reflect what the trace actually showed, and confirm no new IWorld member / SimEvent / i18n key was added.
- Record a memory note: the measured GC reality of the per-frame core on a busy scene (visible or not), and which of the three micro-wins were justified by the trace. This saves the next perf probe from re-measuring blind.

================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================
Report back, concisely:
- Phase status: complete, complete-with-deferrals, or no-action (perf already adequate, trace gate closed it).
- Files touched (absolute paths).
- Validation results: the four commands above, pass/fail each, plus the measured skip rate and the aura-sig parity result.
- Review verdicts: qa-checklist verdict, and the aliasing/stale-signature subagent verdict (both must be no-BLOCKING).
- Deferrals: any of the three edits skipped because the trace did not justify it.
- One-line handoff to the QA session (Phase 25): what to re-verify (the measured trace, the skip rate, that rendered output is byte-identical).

================================================================
STOPPING RULES
================================================================
- If GC is NOT visible in the trace (either profile), STOP and do nothing: close the phase as "no action, perf already adequate", make only the docs-only commit recording the measurement, and hand off. Do not ship any allocation change.
- NEVER ship a speculative allocation change into this least-tested hot path. Every edit must be justified by the trace from Agent A.
- If pooling the AnimState would alias a retained reference (the consumer keeps `st`), STOP that edit and report it; do not pool.
- If the skip-rate gate drops to or below 0.8, or the aura-sig parity test fails, revert the offending edit before committing.
- If a phase prerequisite (the Phase 1 perf gate / harness or the Phase 9 reactive_diff parity test) is missing, STOP and surface it rather than recreating it here.
```
