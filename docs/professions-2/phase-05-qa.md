# Phase 05 QA: Verify the professions wheel window

Audit the Phase 05 diff for correctness, missing tests, dead code, determinism, three-host
parity, and i18n completeness, then fix what the audit finds.

## Phase-specific QA emphasis

- Painter write-elision and rebuild discipline: an unchanged refresh signature must produce zero
  DOM writes, and a full rebuild must preserve scroll position and keyboard focus.
- The ring rendering path: if canvas, token reads must be cached (no per-frame getComputedStyle)
  and contain zero hex literals; if DOM, the same token-only rule applies. Verify the recorded
  rationale for the choice exists in the phase notes.
- The ClientWorld pre-cprof (synced false) empty state: the window must render a sane empty
  state online before the first cprof delta arrives, with no crash, no NaN bars, and no
  misleading identity claim. Distinguish it from the SIMPLIFIED unattuned/pre-first-tier
  state below: syncing is a wire condition, simplified is a design state; they must not be
  conflated.
- The 2026-07-17 amendment deliverables: the absorbed model preserves per-craft role
  (major/hobby/dormant/unattuned), ceiling, nudges, and tutorial state; the next-unlock
  and switch-cost lines render from existing reads (switchCount on CraftingIdentityView;
  no new wire data); the simplified unattuned/pre-first-tier state shows one clear next
  step and the full ring takes over at first tier or attunement. Probe each with a real
  render, not a grep.

## QA Starter Prompt

```
This is Phase 05 QA of the Professions 2.0 feature: verify the professions wheel window.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 05 diff for correctness, missing tests, dead code, determinism, three-host
parity (the window renders from both Sim- and ClientWorld-shaped inputs with no new IWorld
members), and i18n completeness for THIS phase; then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean (a concurrent session may share it).
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  the node25-breaks-jsdom-gate rule (run gate commands under Node 24), the PR 2039 state (the
  cprof key and identity card this window builds on), and the design-language program entry
  (DESIGN.md adopted but unlanded; no piecemeal re-lands).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-05-wheel-window.md (the acceptance criteria and invariants)
- git diff against the phase-start commit recorded in the progress.md Phase 5 notes (name-only
  first, then the full diff of the touched files)
The summary must return: every file the phase touched, every acceptance criterion with where it
claims to be satisfied, the validation commands the phase file names, the canvas-vs-DOM and
absorb-vs-compose decisions and their recorded rationale, and any deliverable the diff appears
to be missing.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents; give each ONLY the Explore summary plus its block below.
Prompt every agent for COVERAGE, not filtering: report every gap with confidence and severity
(BLOCKING / SHOULD-FIX / NIT); filtering happens in STEP 3. If any agent's output is truncated,
re-spawn it to resume from its last complete finding; never act on a truncated report.

Agent Correctness:
- Verify every deliverable and every acceptance criterion in phase-05-wheel-window.md against
  the real code, not the phase report.
- Run the phase's validation commands (the ui/render and i18n matrix rows from state.md,
  including the mobile guard trio and the S3 guard) and record each result.
- Exercise the real behavior: open the window on the desktop keybind and from the mobile More
  tray via a screenshot script run; check the identity card, ring, ten skill bars, tier pips,
  and perks readout against Sim-shaped and ClientWorld-shaped inputs, including the pre-cprof
  (synced false) empty state.
- Probe the phase-specific emphasis items: write-elision on an unchanged refresh signature,
  focus and scroll preservation across a rebuild, and cached token reads in the ring path with
  zero hex literals.

Agent Test coverage:
- Find untested paths in professions_view.ts and professions_window.ts (empty states, a hobby
  chord with no hobby, skill at tier boundaries, the 75-skill perk threshold, refresh-signature
  stability) and add the missing tests.
- Add a determinism test if any sim logic changed (none should have; if it did, that is also a
  BLOCKING scope finding).
- Remove orphaned tests: anything pinning the pre-window identity card wiring or a superseded
  view path.
- Verify the icons bijection test really pins the converter scaffold and that the empty image
  set passes.

Agent Dead code and cleanup:
- Unused imports, types, and exports across the new files; leftover TODOs and commented-out
  blocks.
- Sim purity: confirm the phase added nothing to src/sim/ and nothing in the new UI files leaks
  into sim; tests/architecture.test.ts must be green.
- If the identity card was absorbed, confirm the old profession_identity_view wiring is fully
  retired (no dead module, no stale UI_PURE_CORES entry); if composed, confirm no duplicated
  model logic.
- Zero hex literals and no DESIGN.md phase vocabulary anywhere in the new css/ts.

Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows (expected: frontend-seam-reviewer; plus the qa-checklist agent, since the phase deliverable
set is complete). Prompt them for COVERAGE, not filtering, with the same truncation-resume rule.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding; record NITs as deferrals with reasons.
- Rerun the full validation set from STEP 2 after the fixes.
- Commit with explicit paths, never git add -A; Conventional Commits with a body, no em dashes
  or emojis (for example fix(ui): harden professions window empty state, or
  test(ui): cover professions view tier boundaries).

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md: the Phase 5 QA row (status, dates) and any checklist
  corrections; append findings and deferrals to the Notes section.
- Update docs/professions-2/state.md only if QA changed a surface the phase recorded.
- Record durable surprises (a trap in the deeds pattern, a guard-test gap) to memory.

STEP 5 - PACKET TEARDOWN:
Not applicable; the packet-teardown offer happens only in Phase 15 QA.

STEP 6 - FINAL RESPONSE FORMAT:
Report: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); finding counts by severity and how many
were fixed; tests added and removed; validation results after fixes; deferrals with reasons; and
a one-line handoff naming the next phase (Phase 6, crafting window upgrades).

STOPPING RULES:
- Stop if a fix would require a new design token beyond the phase's ONE-semantic-token allowance
  or any DESIGN.md ramp vocabulary; surface the gap to the maintainer instead.
- Stop if a fix would require new wire data, a new IWorld member, or crafting-window changes;
  those are out of scope (Phase 6 or later), so file the finding as a deferral rather than
  expanding the diff.
```
