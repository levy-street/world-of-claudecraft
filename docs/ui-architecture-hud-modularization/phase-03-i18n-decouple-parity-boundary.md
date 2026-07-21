# Phase 3 starter prompt: Decouple i18n guard + IWorld read-surface parity + sim-purity boundary/ESLint

This file is a self-contained starter prompt. Open a fresh Claude Code session,
paste everything inside the fenced block below, and execute. Do not rely on any
other open file or prior conversation; the prompt points at the packet docs by
path when it needs a fact.

### Starter Prompt

```
This is Phase 3 of the UI Architecture and HUD Modularization feature: Decouple
i18n guard + IWorld read-surface parity + sim-purity boundary/ESLint.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (three disjoint deliverables, each its own
test surface, run in parallel). Add the keyword ultracode so you orchestrate via
a Workflow with parallel agent fan-out rather than doing the three slices
serially in the main loop.

GOAL (one sentence): Convert three source-coupled or convention-only invariants
(the i18n drift guard, the IWorld read-surface contract, the sim-purity boundary)
into behavioral machine checks without weakening their coverage.

================================================================================
STEP 0 - PRE-FLIGHT
================================================================================
- Run `git status`. This is a SHARED worktree; a concurrent session may be
  mid-edit. If the tree is dirty with files outside this phase's scope (the
  scope is listed under STEP 4), STOP and ask the operator before touching
  anything. Do not stash or revert another session's work.
- This phase edits the i18n matcher area. The Social window phase (Phase 19) also
  touches that area and is BLOCKED on this phase. If another session reports it is
  mid-edit on `src/ui/sim_i18n.ts`, `src/ui/server_i18n.ts`, or the matcher bodies
  in `src/ui/hud.ts`, coordinate loudly and let the lower-id card land first.
- Scan Claude Code memory before starting: read MEMORY.md and the entries for
  i18n (i18n-resolved-baseline-and-assembly), shared-worktree commit care,
  never-push-to-fork, and no-em-dashes-or-emojis. Honor all of them.

================================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or hud.ts directly)
================================================================================
Spawn ONE Explore agent (read-only, no plan mode) to read and summarize, into a
single brief you keep in the main loop:
- docs/ui-architecture-hud-modularization/state.md  (focus: Locked decisions,
  Non-negotiable invariants 1/2/7/8, the Validation matrix rows for "i18n matcher
  change", "IWorld parity", and "Sim-purity boundary", the Review-dispatch matrix,
  the "Key file paths" and "Anchors index", and the OPEN items).
- docs/ui-architecture-hud-modularization/progress.md  (ONLY the "Phase 3 - i18n
  decouple + IWorld parity + sim-purity gates" deliverables/acceptance block, and
  the Phase 3 status row).
- This phase prompt
  (docs/ui-architecture-hud-modularization/phase-03-i18n-decouple-parity-boundary.md).
- The SPECIFIC source files this phase touches, summarized individually (shape,
  exports, how they are wired, NOT a full paste):
  - tests/localization_fixes.test.ts  (the B1 group "all three hud matchers call
    AND return the localizeServerText fallback" and the S3 group that
    fs.readFileSync src/ui/hud.ts + src/sim/sim.ts and regex-extracts the bodies
    of localizeErrorText / localizeSystemText / localizeLootText; note every place
    it reads source and every place it instead exercises real runtime functions
    like localizeServerText / localizeSimText).
  - src/ui/sim_i18n.ts  (public entry points; confirmed: localizeSimText,
    localizeSimAuraName, tSim, DICT, SimMessageKey).
  - src/ui/server_i18n.ts  (public entry points; confirmed: localizeServerText,
    tServer, DICT).
  - src/ui/i18n.ts  (t(), supportedLanguages export, SupportedLanguage type,
    getLanguage/setLanguage).
  - src/world_api.ts  (the IWorld interface; enumerate the read-side members ->
    the getters/properties render/ui consume, anchor around the interface body,
    re-grep the symbol IWorld; line numbers DRIFT).
  - tests/snapshots.test.ts and tests/interest.test.ts  (the existing Sim-vs-
    ClientWorld parity precedent: how they construct both worlds, seed a scenario,
    and compare; mirror their construction style).
- DO NOT read src/ui/hud.ts in the main loop (6,280 lines). For the matcher trio,
  have the Explore agent report ONLY: the names, what English each arm maps to a
  t() key for, and that each ends by delegating to localizeServerText(text) and
  returning it when non-null. You do not need the full method bodies; you are
  testing them through their public effect, not their source shape.

Anchors drift: instruct the Explore agent to re-grep every symbol it cites
(`grep -n "<symbol>"`) and report current line numbers, never trust the numbers
printed in state.md or here.

No web-research agent is needed: this phase names no external surface (ESLint flat
config is a stable, in-repo concern; if the flat-config rule syntax is uncertain,
check the installed eslint version's docs locally, do not guess).

================================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
================================================================================
Request fan-out explicitly: three DISJOINT, PARALLEL implementation agents. Give
each agent ONLY the Explore summary from STEP 1 (not the raw planning docs, not
this prompt verbatim). Each agent owns a complete vertical slice (the change plus
its test) and must keep the build green for its slice.

Agent A - i18n drift guard, source-regex -> runtime behavior.
  Deliverable: rewrite the S3 + B1 groups of tests/localization_fixes.test.ts so
  they assert RUNTIME localization instead of reading src/ui/hud.ts (or
  src/sim/sim.ts) as a string and regex-matching method bodies.
  - Feed the known sim/server English strings (the ones the existing guard already
    enumerates) through the PUBLIC localization entry points (localizeServerText,
    localizeSimText, and the matcher trio's observable effect) for EVERY locale in
    supportedLanguages (import the live array from src/ui/i18n.ts; never hard-code
    a locale list).
  - Assert: each known English string resolves to the correct t() output per
    locale (non-null, localized, and the right key), and an unrecognized string
    falls through deterministically (returns null / unchanged) the same way in
    every locale.
  - The drift contract MUST be preserved: every sim/server English emit still has
    a matcher arm or key, and the test still fails if an emit loses its mapping.
    You are changing HOW it is checked (behavior, not source shape), NOT WHAT it
    guarantees. Coverage may not shrink: if the old regex group asserted N
    distinct strings/arms, the new behavioral group must cover at least those N.
  - Remove the now-dead fs.readFileSync of hud.ts / sim.ts and the body-extraction
    regex helpers ONLY where they are fully superseded by behavioral assertions;
    do not delete coverage you did not replace.

Agent B - IWorld read-surface parity test.
  Deliverable: new file tests/iworld_read_surface.test.ts.
  - Enumerate the IWorld accessors that src/render/ and src/ui/ actually consume.
    Do this empirically: `grep -rn "this\.sim\." src/render/ src/ui/` (and any
    other IWorld-typed handle name those modules use) to build the consumed
    read-surface set; cross-check against the read-side members of the IWorld
    interface in src/world_api.ts. Report the enumerated list in the test as data.
  - On a seeded scenario (mirror the construction in tests/snapshots.test.ts /
    tests/interest.test.ts), assert that BOTH the offline Sim and the online
    ClientWorld expose the SAME shape/presence for every consumed accessor
    (property present, getter callable, same kind of value). This is a presence-
    and-shape parity check, not a deep value-equality check.
  - The test MUST be able to FAIL: prove that deleting (or renaming) one consumed
    accessor from one world makes it red. If you cannot make it fail that way, the
    test is not real (see STOPPING RULES) - STOP and surface.

Agent C - sim-purity import-boundary test + ESLint rule.
  Deliverables: new file tests/architecture_boundaries.test.ts; new file
  eslint.config.js (flat config); wire linting into the npm scripts.
  - The boundary test scans src/sim/** and asserts: no import from render/, ui/,
    game/, net/, no DOM/browser/Three.js import, and no Math.random / Date.now /
    performance.now usage in sim source. Both must be GREEN now (the invariant
    already holds) and a deliberately injected violation must turn them RED (prove
    it locally, then remove the injected violation).
  - eslint.config.js: flat config, a SINGLE rule pairing scoped to src/sim/**
    using no-restricted-globals (Math is not a global to restrict, so use
    no-restricted-syntax for the Math.random member-expression and Date.now /
    performance.now call patterns; restrict the browser/DOM/three import specifiers
    as appropriate). Keep it minimal: one focused config object for the sim scope,
    not a repo-wide style regime. Confirm `eslint` resolves; if it is not yet a
    devDependency, add it as a devDependency ONLY (zero new runtime deps).
  - Add `npm run lint` (or fold lint into `npm test` if that is cleaner for CI
    parity) so the rule actually runs in the gate. Update package.json scripts
    with an explicit, minimal edit.

OUT OF SCOPE for all three agents (enforce hard; do not let scope creep in):
- Do NOT actually move the matcher trio (localizeErrorText / localizeSystemText /
  localizeLootText) out of src/ui/hud.ts. That move happens in the Social window
  phase (Phase 19). This phase only makes the move POSSIBLE. To PROVE it is
  possible: trial-move the trio (or just confirm by inspection that the rewritten
  guard no longer references hud.ts source), run the validation suite, then REVERT
  the trial move so the diff for this phase contains zero changes to the matcher
  bodies in hud.ts.
- Do NOT add any new IWorld member, SimEvent, wire field, endpoint, table, or i18n
  key. state.md says NONE are expected this packet; any addition is a red flag.
  If a parity gap looks like it needs a new IWorld member, STOP and surface (the
  seam should already expose everything the HUD reads).
- Do NOT refactor or "improve" the matchers, the sim, or hud.ts beyond the test
  changes. Additive-only: new test files, a rewritten guard, an ESLint config, a
  package.json script line.
- Do NOT install a DOM env or Playwright (those are Phase 1 / Phase 5). The new
  tests here run in the default node Vitest env.

================================================================================
INVARIANTS THIS PHASE MUST KEEP (cite state.md)
================================================================================
- Non-negotiable invariant 1 (IWorld-only access): the parity test reads through
  IWorld only; it must not import Sim/ClientWorld concretely except where the
  precedent tests (snapshots/interest) already construct them for the comparison.
  Adding an IWorld member is a STOP-and-surface event.
- Non-negotiable invariant 2 (t()-only render sink): the rewritten i18n guard
  asserts that player/operator text resolves through t() per locale; do not
  introduce any fallback-literal assertion that would bless non-t() text.
- Non-negotiable invariant 7 (determinism / sim purity): the boundary test and
  ESLint rule enforce that src/sim/** uses no Math.random / Date.now /
  performance.now and stays DOM/Three-free. The test must prove it can catch a
  violation.
- Non-negotiable invariant 8 (shared-worktree commit hygiene): stage only this
  card's files with explicit paths; never `git add -A`; one branch, one PR; push
  to origin (levy-street), never the fork.
- Invariant 9 (no em dashes or emojis) in every new test, comment, and doc edit.
- The drift-coverage contract from this phase's own goal: change HOW the i18n
  drift is checked (source-regex -> runtime behavior), never WHAT it guarantees.
  Coverage must not shrink.

================================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================================
Run the exact validation commands for this change type (from the state.md
Validation matrix, the i18n-matcher + IWorld-parity + sim-purity rows):
  npx vitest run tests/localization_fixes.test.ts tests/iworld_read_surface.test.ts tests/architecture_boundaries.test.ts
  npx tsc --noEmit
  npm run lint
Then run the full suite once to confirm nothing else regressed:
  npm test
Also confirm the existing parity precedent still passes (you should not have
touched it, but the IWorld work sits next to it):
  npx vitest run tests/snapshots.test.ts tests/interest.test.ts

Prove the negative cases before you trust the gates:
- Drift guard: temporarily break one matcher mapping (or remove one known
  English->key), confirm tests/localization_fixes.test.ts goes RED, then revert.
- Parity: delete one consumed accessor from one world, confirm
  tests/iworld_read_surface.test.ts goes RED, then revert.
- Boundary: inject a Date.now() (or a render/ import) into a sim file, confirm
  tests/architecture_boundaries.test.ts and `npm run lint` go RED, then revert.
Report each negative-case result in your final response.

Multi-agent review (review-dispatch matrix in state.md): run `git diff --name-only`
against the phase-start commit and spawn ONLY the agents whose surface the diff
touches. For this phase that is:
- cross-platform-sync (the diff touches the matcher area src/ui/sim_i18n.ts /
  src/ui/server_i18n.ts usage and the IWorld read-surface / world_api.ts contract:
  exactly its trigger). Ask it to verify the runtime i18n guard still covers every
  sim/server emit and that the parity test reflects the true consumed surface.
- qa-checklist (the completion gate, every phase).
Do NOT spawn privacy-security-review or migration-safety: this phase touches no
server/, no src/admin/, no src/net/, no CI/secret/SQL/auth/persistence surface
(if your diff somehow does, re-read the matrix and reconsider scope).

Prompt every review agent for COVERAGE, not filtering: "Report every issue
including low-severity and uncertain ones; ranking is a later step." If an agent
truncates, resume it with exactly: "Stop reading more files. Output the full
report now based on what you've already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
Do not commit until each spawned reviewer reports no BLOCKING issues.

================================================================================
STEP 4 - COMMIT CADENCE (explicit paths only; never `git add -A`)
================================================================================
One branch for this card: feature/p0-345-i18n-decouple-parity-boundary
(branch from main, or from the packet feature branch if that is the workflow in
use; confirm with `git branch --show-current` first).

2 to 5 commits, each staging explicit paths:
1. test(i18n): assert runtime localization across locales, drop hud.ts source scrape
   - git add tests/localization_fixes.test.ts
2. test(ui): IWorld read-surface parity between Sim and ClientWorld
   - git add tests/iworld_read_surface.test.ts
3. test(sim): boundary test for sim-purity import + no wall-clock/random
   - git add tests/architecture_boundaries.test.ts
4. build(lint): flat ESLint rule scoping sim purity + wire npm run lint
   - git add eslint.config.js package.json (and package-lock.json if eslint was added)
5. docs(ui): record Phase 3 gates in progress.md and state.md ledger
   - git add docs/ui-architecture-hud-modularization/progress.md docs/ui-architecture-hud-modularization/state.md
Collapse adjacent commits if a slice is trivial, but keep the doc update as its
own final commit. Do not stage any file you did not intend (especially not
src/ui/hud.ts: the trial-move must be reverted to a clean diff there).

================================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 3)
================================================================================
- [ ] localization_fixes.test.ts S3/B1 asserts runtime localization across all
      supportedLanguages, not hud.ts source shape; the matcher trio could move out
      of hud.ts without breaking it (proved by trial-move, then reverted).
- [ ] Drift coverage unchanged: every sim/server emit still has a matcher/key, and
      the test still fails when an emit loses its mapping (negative case proved).
- [ ] tests/iworld_read_surface.test.ts: Sim and ClientWorld expose an identical
      render/ui read surface; deleting an accessor from one world fails it
      (negative case proved).
- [ ] tests/architecture_boundaries.test.ts + eslint.config.js: src/sim/** imports
      nothing from DOM/three/render/ui/game/net and uses no Math.random / Date.now
      / performance.now; both green now, a deliberate violation fails (negative
      case proved); `npm run lint` runs the rule.
- [ ] No new IWorld member / SimEvent / wire field / endpoint / table / i18n key
      was added. No runtime dependency was added (eslint is devDependency only).
- [ ] `npx tsc --noEmit`, the three named test files, `npm run lint`, and full
      `npm test` are all green; snapshots/interest parity still green.

================================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================================
- progress.md: set the Phase 3 status row to complete (with the date), and tick
  the Phase 3 acceptance checkboxes that are met. Note any deferral in the Notes
  section.
- state.md: in the "Created by this packet (ledger)" list, confirm the Phase 3
  entries (tests/iworld_read_surface.test.ts, tests/architecture_boundaries.test.ts,
  eslint.config.js) and add the npm script change. Update "Current phase". If you
  resolved an OPEN item or learned a gotcha (for example the exact public entry
  point used to drive the runtime i18n guard, or the consumed-accessor enumeration
  method), record it under OPEN items / gotchas so the Social window phase inherits
  it. Note explicitly that Phase 19 (Social) is now UNBLOCKED on the matcher
  decouple (the guard no longer reads hud.ts source).
- Memory: if anything here was surprising or load-bearing for future sessions
  (the runtime-guard rewrite approach, the parity enumeration technique, the flat
  ESLint scoping), add a short memory note. Keep it terse.
- Commit doc updates with explicit paths as commit 5 above.

================================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================================
Report, concisely:
- Phase status (complete / blocked / needs-input) and the branch name.
- Files touched (absolute or repo-relative paths), grouped new vs modified.
- Validation results: the three named test files, tsc, npm run lint, full npm test,
  and snapshots/interest, each pass/fail; plus the three negative-case proofs
  (drift / parity / boundary each confirmed RED on injected violation, then green
  on revert).
- Review verdicts: cross-platform-sync and qa-checklist final VERDICT lines and
  whether any BLOCKING issues were raised and fixed.
- Deferrals: confirm the matcher trio was NOT moved (trial-move reverted; hud.ts
  diff clean) and that Phase 19 (Social) is now unblocked.
- One-line handoff to the QA session (Phase 4): what to re-verify.

================================================================================
STOPPING RULES (stop and surface to the operator)
================================================================================
- STOP if decoupling the i18n guard would reduce drift coverage. If you cannot
  rewrite a given source-regex assertion as an equivalent-or-stronger runtime
  behavioral assertion, leave that assertion in place and surface the gap rather
  than deleting coverage.
- STOP if the IWorld parity test cannot be made to FAIL when a consumed accessor
  is deleted from one world. A parity test that cannot detect drift is not a real
  gate; surface it instead of committing a green-but-toothless test.
- STOP and ask if STEP 0 found the shared worktree dirty with another session's
  in-progress matcher or world_api edits.
- STOP and surface if any parity or guard work appears to require a NEW IWorld
  member, a new i18n key, or any sim/server/wire change: that is out of scope for
  this client-only packet and signals a real design gap.
```
