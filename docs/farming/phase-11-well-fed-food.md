# Phase 11: Well-fed food

Farm produce becomes buff food. Per D15, a new ItemDef.wellfed arm mirrors the elixir arm
exactly: inline aura mint, ctx.applyAura, a distinct wellfed_<kind> namespace so food
never clobbers elixirs, modest classic-era magnitudes. Four dishes, one per crop tier,
give the produce ladder a consumer at every rung. docs/farming/state.md is the authority;
if this file contradicts it, state.md wins and this file plus phase-11-qa.md get swept in
the same pass.

Live-surface note (binding): LIVE, additive. The buff dishes join cooking the moment this merges:
any player with produce can cook them, eat them, and carry a well-fed buff. The elixir
slots and every existing elixir behavior are untouched.

### Starter Prompt

```
This is Phase 11 of the Farming feature: Well-fed food.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: farm-fed cooking grants classic well-fed buffs through a new ItemDef.wellfed arm
without touching the elixir slots.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Use
  git -C ~/Documents/woc-farming-plan for every git command.
- git status must be clean. If it is not, stop and surface; never stash or discard WIP
  that is not yours.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create branch
  fix/farming-phase-11-well-fed-food off LOCAL feature/farming-plan (D22: never off
  the release tip, which lacks the packet and all farming work), then MERGE the
  newest release tip INTO the phase branch FIRST: run the release-merge-audit skill
  plus the state.md deviation (al) absorb checklist, re-run the parity and count-pin
  suites, and verify the farming_session golden md5 unchanged. A jump of a minor
  version or more (or a triple-digit intersection) runs
  docs/farming/phase-06b-release-sync.md's shape as its own mid-phase BEFORE this
  phase instead. Record the phase-start commit sha.
- If release moves mid-phase and this branch turns long-lived, merge release in and run
  the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: worktree-cwd-drift-misroutes-git,
  round-trip-pins-reference-aliasing, i18n-semantic-regressions-gate-trap,
  mutation-checks-commit-first, big-diff-reviewer-turn-budgets, no-claude-session-links.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough) to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-11-well-fed-food.md, and these sources:
src/sim/items.ts (the useItem food arm with the p.eating / p.drinking sit-restore slots,
and the elixir arm: inline aura mint from ItemDef.elixir via ctx.applyAura with
elixir_<kind> ids), the module exporting the ItemDef type (locate by symbol), the auras
module ctx.applyAura reaches (locate by symbol), the cooking recipe content module
(locate it), src/ui/sim_i18n.ts (AURA_NAME_KEY), src/ui/auras_view.ts,
src/ui/auras_painter.ts, src/ui/elixir_tooltip_view.ts,
tests/professions_farming.test.ts, tests/recipe_economy.test.ts,
tests/localization_fixes.test.ts, and the CLAUDE.md files: root, src/sim/CLAUDE.md,
src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md. The orchestrator never reads planning
docs or coordinator monoliths directly; the summary is your only context.
The summary must return, explicitly:
- The exact ItemDef.elixir field shape (aura name, kind, value, duration) and the elixir
  arm's application code path, so wellfed can mirror it field for field.
- The food path shape: where consume starts the sit-restore, where completion of the
  sit-restore is observable, and the candidate auras-module hooks for applying a buff at
  completion (the timing decision below needs these).
- The auras module's id semantics: overwrite rules within an id, duration ticking, and
  what happens to active auras across save and load (the transient behavior this phase
  must state and pin).
- How elixir_<kind> namespacing prevents the documented exclusivity-slot clobber, so
  wellfed_<kind> can copy the mechanism.
- The AURA_NAME_KEY row shape in src/ui/sim_i18n.ts, the buff display chain
  (auras_view plus auras_painter), and the tooltip seam beside elixir_tooltip_view.ts.
- The cooking recipe module, the produce item ids per tier, and where the documented
  elixir budget ceilings live (the magnitudes must sit at or below them).
- The names of the aura test suites to run in STEP 3 (list them exactly).
- Any progress.md Notes from earlier phases touching produce, dishes, or auras.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Spawn three implementation agents by vertical slice, each owning its slice plus its
tests. Fan-out reminders: request the fan-out explicitly and spawn all three in one
message so they run in parallel; give each agent ONLY the Explore summary plus its own
bullets (never a planning doc to read); never run a teammate in plan mode.
- Agent A, the wellfed arm (sim): an ItemDef.wellfed shape beside elixir (aura name,
  kind, value, duration), applied from the food path in src/sim/items.ts via
  ctx.applyAura with aura ids in the wellfed_<kind> namespace, never through
  effect_dispatch. Make the application-timing decision IN THIS PHASE: immediate on
  consume versus on completion of the sit-restore. The recommendation is completion (the
  sit-through-the-meal ritual); decide, state the choice and the auras-module hook
  chosen, and document it in the module and in progress.md Notes. Tests: application and
  timing, the namespace-isolation pin (a wellfed buff and an elixir_<kind> buff of the
  same kind coexist; neither overwrites the other), last-eaten-wins within the wellfed
  namespace, duration ticking, and the transient-across-save behavior stated and pinned
  (whatever the auras module does across save and load, state it and pin it).
- Agent B, the dishes (content): four buff dishes, one per crop tier, as cooking recipes
  consuming farm produce. Magnitudes at or below the documented elixir budget ceilings,
  classic-modest, and flagged for the maintainer in the PR body as tuning proposals (the
  state.md OPEN item). Tests: recipe economy green (nothing vendors above its cheapest
  achievable inputs; crafted outputs carry no buyValue), each dish's wellfed field
  well-formed.
- Agent C, names and display (ui plus i18n): an AURA_NAME_KEY row in src/ui/sim_i18n.ts
  for every new aura name; tooltip lines beside the elixir tooltip view
  (src/ui/elixir_tooltip_view.ts is the template); the buff bar shows the wellfed aura
  through the existing auras_view plus auras_painter chain; English t() rows in the
  matching src/ui/i18n.catalog/ module. Tests: S3 (tests/localization_fixes.test.ts) and
  the i18n coverage arms.

INVARIANTS THIS PHASE MUST KEEP
- Every dish's magnitude sits at or below the documented elixir budget ceilings; all
  crafted power stays below the raid floor.
- One knob one job: no food buff ever stacks with itself; within the wellfed namespace,
  last eaten always wins (stated and pinned).
- Every wellfed aura id lives in the wellfed_<kind> namespace; no food buff ever
  clobbers any elixir_<kind> buff, and no elixir ever clobbers any wellfed buff.
- No new effect machinery beyond the aura arm: application goes through ctx.applyAura
  from the food path, never through effect_dispatch.
- Every new aura name has an AURA_NAME_KEY row; every player-visible string added this
  phase is an English t() key in the matching src/ui/i18n.catalog/ module.
- Every existing elixir behavior is preserved unchanged.
- All randomness in src/sim/ goes through ctx.rng; this phase expects zero new draws
  (state that in the module).
- No em dashes, en dashes, or emojis anywhere; every new name is IP-safe per D17.

Out of scope (do NOT do in this phase)
- The shared feast (Phase 12); the tier-4 feast buff application lands there.
- Any non-food buff source.
- Wiki prose and the asset manifest (Phase 13).
- Any change to the elixir arm, elixir ids, or elixir recipes.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/professions_farming.test.ts tests/recipe_economy.test.ts
  tests/architecture.test.ts tests/localization_fixes.test.ts plus the aura suites the
  Explore summary named
- npm run ci:changed
- node scripts/gate_select.mjs
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md
(expected for this diff: architecture-reviewer, cross-platform-sync,
frontend-seam-reviewer for the tooltip and buff bar surface, and qa-checklist at phase
completion). Every review agent gets a hard 30-tool-call budget, the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"), and, if truncated, the resume line: "Stop reading more files. Output
the full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a BODY, explicit paths only, never
git add -A, no session links or Claude attribution:
- feat(sim): the ItemDef.wellfed arm, the application-timing decision, namespace
  isolation and last-eaten-wins (with the sim tests)
- feat(content): four tier buff dishes consuming produce (with recipe economy coverage)
- feat(ui): AURA_NAME_KEY rows and wellfed tooltip lines (with i18n coverage)
- docs(farming): progress, state ledgers, the timing decision record

STEP 5 - ACCEPTANCE CRITERIA
- [ ] ItemDef.wellfed exists beside elixir (aura name, kind, value, duration), applied
      from the food path in src/sim/items.ts via ctx.applyAura with wellfed_<kind> ids,
      never through effect_dispatch.
- [ ] The application-timing decision is made, stated, and documented (recommended:
      completion of the sit-restore), including the auras-module hook chosen.
- [ ] The namespace-isolation pin is green: a wellfed buff and an elixir_<kind> buff of
      the same kind coexist and neither overwrites the other.
- [ ] Last-eaten-wins within the wellfed namespace is stated and pinned; no food buff
      stacks with itself.
- [ ] Every new aura name has an AURA_NAME_KEY row.
- [ ] Tooltip lines render beside the elixir tooltip view; the buff bar shows the
      wellfed aura with its remaining time.
- [ ] Four buff dishes, one per crop tier, consume produce; magnitudes at or below the
      documented elixir budget ceilings and flagged for the maintainer in the PR body.
- [ ] Tests green: application and timing, isolation, duration ticking, the
      transient-across-save pin, recipe economy, S3 and i18n coverage.
- [ ] Every STEP 3 validation row green; gate_select green modulo the armory exception.

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (the Phase 11 status row, the acceptance list above
copied with its check states, a Notes block including the timing decision and the
proposed magnitudes) and the docs/farming/state.md ledgers (new items and recipes, new
i18n keys and AURA_NAME_KEY rows, the timing decision as a locked deviation entry if it
refines D15). Any deviation decided in-phase gets swept into
docs/farming/phase-11-well-fed-food.md AND docs/farming/phase-11-qa.md in the same pass.
Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched, grouped by
surface; validation results per command; review verdicts per agent; deferrals with
reasons; one line handing off to the Phase 11 QA session.

STOPPING RULES
- Stop if a dish cannot stay inside the documented budget ceilings without a maintainer
  call: propose the magnitudes in the PR body and surface; never invent a higher
  ceiling.
- Stop if the auras module offers no clean completion hook and the timing decision would
  require new effect machinery: surface the design instead of building machinery.
- Stop if git status is dirty at STEP 0 or the newest release branch cannot be resolved.
- Stop while any review BLOCKING stands.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the standing
environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker, never trust a piped exit code;
PR CI is the arbiter). Push and open the PR against the release branch this phase was
based on, following .github/PULL_REQUEST_TEMPLATE.md. Screenshots via the pr-screenshots
skill apply to the visual phases (12 and 13); this phase needs none. No Claude
attribution or session links in commits or PR text.
```
