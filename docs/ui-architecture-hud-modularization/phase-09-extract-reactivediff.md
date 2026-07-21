# Phase 9 starter prompt: Extract ReactiveDiff/StructuralDiff + migrate the 7 sites

Paste everything inside the fenced block below into a fresh Claude Code session.
It is self-contained: do not rely on surrounding prose in this file.

### Starter Prompt

```
This is Phase 9 of the UI Architecture and HUD Modularization feature: Extract
ReactiveDiff/StructuralDiff + migrate the 7 sites.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: this phase is batch-heavy (one new helper plus 7 sequential site
migrations, each with its own parity fixture and its own commit). Add the keyword
ultracode to your run so you orchestrate the migrations via a Workflow rather than
hand-driving 7 near-identical edit-test-commit loops. If you do not invoke
ultracode, still run the migrations strictly sequentially (one site, one fixture,
one validation pass, one commit) and never batch edits across sites.

Goal: formalize the 7 copy-pasted recompute-signature gates into one
dependency-free helper, then migrate the 7 sites one commit each, every migration
guarded by a fixture-based parity test that proves the new signature flips iff the
old signature flipped.

================================================================================
STEP 0 - PRE-FLIGHT
================================================================================
1. Run `git status`. This is a concurrent shared worktree; another session may be
   editing the same checkout. If the tree is dirty with files you do not own, STOP
   and ask the human before touching anything. Do not stash or revert another
   session's work.
2. Confirm you are on (or branch from main into) a fresh card branch:
   `feature/p1-b-reactive-diff`. One card, one branch, one PR.
3. Scan Claude Code memory before doing anything else:
   - Read MEMORY.md (the index).
   - Read the topic notes for: hud / ui-architecture, shared-worktree commit care,
     never-push-to-fork, no-em-dashes-or-emojis, i18n baseline.
   These encode hard rules (stage only your card's files, never `git add -A`; push
   to origin levy-street, never the FernandoX7 fork; no em dashes or emojis
   anywhere).

================================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or hud.ts in the main loop)
================================================================================
Do not open the giant src/ui/hud.ts directly and do not read the planning docs in
your main context. Spawn ONE Explore agent (no plan mode) and have it read and
return a tight summary of:
  - docs/ui-architecture-hud-modularization/state.md (locked decisions, the
    non-negotiable invariants, the validation matrix, the review-dispatch matrix,
    the anchors index, the OPEN items).
  - docs/ui-architecture-hud-modularization/progress.md, Phase 9 section only
    (the deliverables and acceptance for this phase).
  - This phase prompt file:
    docs/ui-architecture-hud-modularization/phase-09-extract-reactivediff.md
  - The 7 signature sites in src/ui/hud.ts. Anchors DRIFT, so re-grep each symbol;
    do not trust any line number. Have the agent grep for and quote (with current
    line numbers it finds) the declaration AND the recompute body for each:
      * lastMarketSig  (Market)        - declaration near the field block, body in the Market refresh path
      * lastPartySig   (Party)         - party-frame recompute
      * lastTradeSig   (Trade)         - trade window recompute
      * lastSocialStruct + lastSocialContent (Social) - the DUAL struct-vs-content
        model that preserves typeahead; this is the StructuralDiff case
      * lastPetBarSig  (PetBar)        - pet bar recompute
      * the aura signature gate (search for the aura sig `.map().join()` pattern; it
        is in the per-frame core, already diff-gated)
      * lastArenaSig   (Arena)         - arena window recompute
    For each site the agent must return: the exact field name(s), the exact code
    that BUILDS the signature string (every input field and the join/format), the
    exact code that COMPARES against the last value, and the render/recompute that
    runs only when it differs. Verbatim, because parity is byte-level.
  - The existing precedent the helper generalizes: how setText/setDisplay write
    dedup works (HotWriteGate from Phase 7, src/ui/hud/hot_write_gate.ts) so the new
    helper matches house style and threads no duplicate state.

No web-research agent is needed: this phase names no external surface. Everything
is in-repo TypeScript with zero new dependencies.

================================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
================================================================================
Request fan-out explicitly. Give each agent ONLY the Explore summary from Step 1,
never the raw planning docs or the whole hud.ts.

Agent A (helper + unit test), runs first and lands first:
  - Create src/ui/hud/reactive_diff.ts. Two zero-dependency primitives:
    * ReactiveDiff<T> = { computeSig(snapshot: T): string; render(snapshot: T):
      void } with an INTERNAL lastSig. A single tick() (or update()) method reads
      a snapshot, computes the signature, and calls render only when the signature
      differs from the internally stored lastSig, then stores it. Diff semantics
      must be identical to the in-place pattern: fire iff the signature string
      changed.
    * StructuralDiff<S,C> generalizing the Social dual model: TWO independent
      signatures (a structural sig S and a content sig C) each with its own lastSig
      and its own render callback, so a structural change and a content change fire
      independently (this is what preserves Social typeahead). It must reproduce the
      exact two-axis behavior, not collapse it into one sig.
  - The helper holds zero domain knowledge: it takes the sig-compute and render
    callbacks as inputs. It must not import anything from sim/render/game/net and
    must add NO new dependency (this is the non-dependency answer to "should we
    adopt signals", per locked decision 2).
  - Create tests/reactive_diff.test.ts: unit-test both primitives in isolation
    (render fires on first call, skips when sig unchanged, fires again when sig
    changes; StructuralDiff fires its two axes independently). Opt the file into a
    DOM env only if it needs one; the helper itself should be DOM-free, so prefer
    keeping it on the default node env.

THEN migrate the 7 sites SEQUENTIALLY, one site per commit. For each site, pair:
  Agent (migration) replaces the in-place lastXSig field + inline build/compare/
    render block with a ReactiveDiff (or StructuralDiff for Social) instance, wired
    so computeSig returns the EXACT same string the old code built and render runs
    the EXACT same recompute. No behavior change, no signature input dropped or
    added, no formatting changed (a one-character difference in the joined string
    is a regression).
  Agent B (parity fixture) writes, ALONGSIDE that same migration, a per-site
    fixture-based parity test in tests/reactive_diff.test.ts (or a co-located
    fixtures file it imports). It pins a set of fixed input snapshots and asserts:
    for every adjacent pair of fixtures, the NEW signature flips iff the OLD
    signature would have flipped. Capture the OLD signature by snapshotting the
    pre-migration sig-build expression as a reference function inside the test, so
    the test compares old-vs-new directly across the fixture set. Give special,
    explicit fixture coverage to:
      * the AURA set: many auras, reordered auras, changed stacks/durations,
        added/removed aura, identical frame (must NOT flip).
      * the SOCIAL struct-vs-content split: a structural-only change (roster
        add/remove) must flip struct and not content; a content-only change
        (status text / typeahead-relevant field) must flip content and not struct.

Migration ORDER (lowest-risk first; one commit each):
  1. PetBar   2. Arena   3. Market   4. Party   5. Trade   6. aura   7. Social
(Social last because StructuralDiff is the trickiest; aura second-to-last because
it lives in the per-frame core and must add zero per-frame allocations.)

Do not start a migration until Agent A's helper and its unit test are committed and
green. Run the per-migration validation (below) after EACH site before committing
that site; do not let two migrations share one validation pass.

================================================================================
INVARIANTS THIS PHASE MUST KEEP (cite by number/name from state.md)
================================================================================
- Invariant 5 (Signature stability) is the HEADLINE. Every migrated signature must
  keep exact diff semantics: it fires iff real state changed. A silent signature
  regression ships a stale-UI bug with no compile guard. EACH migration needs the
  fixture-based "new sig flips iff old sig flipped" parity test before its commit.
- Invariant 6 (Per-frame core stays imperative, no per-frame allocations added):
  the aura migration is in the per-frame core. Do not introduce per-frame object
  or closure allocations; reuse the same instance across frames.
- Invariant 4 (One shared hotWriteCache): the render callbacks must keep writing
  through the single shared HotWriteGate by reference. Do not duplicate any cache
  or change how writes are deduped.
- Invariant 2 (t()-only render sink): every player-visible string the render paths
  emit still resolves through t(). Extraction preserves existing t() keys verbatim;
  no new strings, no fallback literals.
- Invariant 3 (DOM id/class contract): all selectors and ids touched stay
  byte-identical.
- Invariant 8 (Shared-worktree commit hygiene): stage only this card's files with
  explicit paths, never `git add -A`; one branch, one PR; push to origin
  (levy-street), never the fork.
- Invariant 9 (No em dashes or emojis) in code, comments, and docs.

================================================================================
OUT OF SCOPE (do not let scope creep in)
================================================================================
- Do NOT extract the windows themselves. This card is the diff helper plus the
  in-place migration of the signature logic only. The Market/Party/Trade/Social/
  PetBar/Arena windows stay in hud.ts; their P2 extraction is later phases.
- Do NOT add any new dependency. Zero new deps, runtime or dev. This is the
  non-dependency answer to "should we adopt signals" (locked decision 2). Do not
  pull in any signals/store/reactivity package.
- Do NOT change any signature's INPUTS or FORMATTING to "improve" it. Exact diff
  semantics must be preserved (fires iff real state changed). If you think a sig is
  buggy, that is a separate card, not this one.
- Do NOT touch the per-frame core beyond the single aura-sig migration. No HUD
  loop, no tier cadence, no other gate changes.
- No sim/server/net/wire/IWorld changes. If you find you need a new IWorld member,
  that is a STOP-and-surface event, not a quiet addition.

================================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================================
PER-MIGRATION validation (run after the helper, then after EACH of the 7 sites,
before that site's commit):
  npx vitest run tests/reactive_diff.test.ts tests/hud_harness.test.ts tests/hud_perf_budget.test.ts
  npx tsc --noEmit
Gates that must hold every time:
  - tests/reactive_diff.test.ts green (helper unit tests + that site's parity test).
  - tests/hud_harness.test.ts green (Hud still instantiates and renders from t()).
  - tests/hud_perf_budget.test.ts green AND the hot-write skip rate still > 0.8
    (do not regress the per-frame budget; the aura migration is the one to watch).
  - npx tsc --noEmit clean.

FINAL validation before the PR (CI-equivalent, mirrors .github/workflows/ci.yml):
  npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build
The `npm run build` must show the game (main) bundle pulled in NO new dependency.

MULTI-AGENT REVIEW (review-dispatch matrix in state.md): run `git diff --name-only`
against the phase-start commit. This diff is src/ui/hud/* + src/ui/hud.ts + tests/*
only (client-only, no server/net/sim/IWorld/admin/CI). So spawn ONLY:
  - qa-checklist (the completion gate; spawn it).
Do NOT spawn privacy-security-review, migration-safety, or cross-platform-sync:
their surfaces are untouched. (If, unexpectedly, the diff touches src/world_api.ts,
src/sim/, src/net/online.ts, server/game.ts, or the matchers sim_i18n.ts /
server_i18n.ts, then and only then add cross-platform-sync.)
Prompt the review agent for COVERAGE, not filtering: "Report every issue including
low-severity and uncertain ones; ranking is a later step." If an agent truncates,
resume it with exactly: "Stop reading more files. Output the full report now based
on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT." Do not open the PR until qa-checklist reports no BLOCKING.

Before declaring done (Opus 4.8 self-verify): spawn a fresh subagent to review the
full diff for correctness and requirement gaps (not style), specifically: does each
migrated computeSig build a byte-identical string to the old code, does StructuralDiff
preserve the two independent axes for Social, and does the aura path add zero
per-frame allocations.

================================================================================
STEP 4 - COMMIT CADENCE (explicit paths only, never `git add -A`)
================================================================================
One commit for the helper, then one commit per migrated site (Conventional Commits
with a scope; stage only the listed files):
  1. feat(ui): add dependency-free ReactiveDiff/StructuralDiff diff helpers
     paths: src/ui/hud/reactive_diff.ts tests/reactive_diff.test.ts
  2. refactor(ui): migrate PetBar signature gate to ReactiveDiff
     paths: src/ui/hud.ts tests/reactive_diff.test.ts (+ any fixtures file)
  3. refactor(ui): migrate Arena and Market signature gates to ReactiveDiff
     (or one commit each if you prefer; one commit per site is the default)
  4. refactor(ui): migrate Party and Trade signature gates to ReactiveDiff
  5. refactor(ui): migrate aura per-frame sig to ReactiveDiff (no per-frame alloc)
     then: refactor(ui): migrate Social dual gate to StructuralDiff
  ... plus one docs commit:
     docs(ui): record Phase 9 ReactiveDiff/StructuralDiff in progress + state ledger
     paths: docs/ui-architecture-hud-modularization/progress.md
            docs/ui-architecture-hud-modularization/state.md
Default to one commit per site (7 site commits + 1 helper + 1 docs). The grouped
examples above are only acceptable if each grouped site still got its own parity
test and its own green validation pass first. Each site's parity fixture rides in
the same commit as that site's migration.

================================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md Phase 9)
================================================================================
- [ ] src/ui/hud/reactive_diff.ts defines ReactiveDiff<T> and StructuralDiff<S,C>
      with exact diff semantics (fires iff the signature string changed), zero
      dependencies, no sim/render/game/net imports.
- [ ] All 7 sites migrated, one commit each: PetBar, Arena, Market, Party, Trade,
      aura, Social (Social uses StructuralDiff).
- [ ] Each migration is guarded by tests/hud_harness.test.ts + the perf skip-rate
      gate + a fixture-based "new sig flips iff old sig flipped" parity test, with
      explicit fixtures for the aura set and the Social struct-vs-content split.
- [ ] Each migrated computeSig produces a byte-identical signature string to the
      old inline code (no input dropped/added, no formatting changed).
- [ ] Skip rate still > 0.8; the aura per-frame path adds no per-frame allocation.
- [ ] No new dependency; `npm run build` shows the game bundle dependency footprint
      unchanged.
- [ ] npx tsc --noEmit clean; the CI-equivalent gate green.

================================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================================
- progress.md: set Phase 9 status to complete (with the completion date), check off
  the Phase 9 deliverables, and add any deferrals to the Notes section.
- state.md (the ledger): under "Created by this packet", confirm the
  (Phase 9) src/ui/hud/reactive_diff.ts, tests/reactive_diff.test.ts entry; note
  in the ledger that the 7 in-place signature gates are now delegated to the helper
  (the lastXSig fields are gone from hud.ts), and record any anchors-index drift you
  hit so the next session re-greps correctly. If any OPEN item was resolved
  (e.g., StructuralDiff shape), note the resolution.
- Memory: record any surprising rule you discovered (for example, a non-obvious
  field in a signature that MUST be preserved, or that the aura sig is in the
  per-frame core and is allocation-sensitive). Keep it terse and in the existing
  topic note for hud / ui-architecture.
Commit doc updates with explicit paths (the docs(ui) commit in Step 4).

================================================================================
STEP 7 - FINAL RESPONSE FORMAT
================================================================================
Return, concisely:
  - Phase status (complete / blocked / partial) and the branch name.
  - Files touched (absolute paths): the new helper, the test/fixtures file, hud.ts,
    and the two doc files.
  - Validation results: the per-migration gate results and the final CI-equivalent
    gate (pass/fail per command); confirm skip rate > 0.8 and zero new deps in the
    game bundle.
  - Review verdicts: qa-checklist BLOCKING/SHOULD-FIX/NICE-TO-HAVE/VERDICT, and the
    fresh-subagent self-verify verdict on byte-identical signatures.
  - Deferrals: anything punted (with the reason and the card it belongs to).
  - One-line handoff to the Phase 10 QA session (what to re-verify first: the aura
    and Social parity fixtures and the per-frame skip rate).

================================================================================
STOPPING RULES
================================================================================
- STOP a migration if its parity test cannot PROVE the new signature flips exactly
  when the old one did (i.e., you cannot construct fixtures that demonstrate new sig
  flips iff old sig flips across the set). Do not migrate that site on faith; leave
  it in-place, record why, and surface it.
- STOP and surface if any migration would require changing a signature's inputs or
  formatting to make it work (that means the helper does not fit and the design
  needs revisiting, not a quiet behavior change).
- STOP if you find you need a new IWorld member, a sim/server/net change, or any new
  dependency. This is a client-only, zero-dependency card.
- STOP if the per-frame skip rate drops to 0.8 or below after the aura migration;
  the per-frame budget regression is a blocker, not a follow-up.
- STOP and ask if the worktree is dirty with files you do not own.
```
