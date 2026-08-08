# Phase 6: Economy hooks

The farm now produces; this phase makes the rest of the economy consume it. Plain
cooking dishes ladder up beside the existing cooking budget conventions, alchemy
crafts the growth tonic from herbs (the cross-profession trade of D7), and the
consumer rule closes over every Phase 5 material: after this phase, every produce and
the withered husks have a real consumer, not a note.

Live-surface note (binding): Dormant. The new recipes are visible in the crafting window, but
every one has at least one reagent unobtainable until go-live (farm produce or husks
nobody can grow yet). The phase verifies explicitly that no new recipe is craftable
from vendor goods alone.

### Starter Prompt

```
This is Phase 6 of the Farming feature: Economy hooks.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: cooking and alchemy consume the farm.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Prefix every git command with git -C ~/Documents/woc-farming-plan.
- git status must be clean. If it is not, stop and surface.
- Re-resolve the NEWEST release branch: git fetch origin --prune; git branch -r
  --list 'origin/release/*' | sort -V. Create branch
  fix/farming-phase-06-economy-hooks off that tip. Record the phase-start commit
  (git rev-parse HEAD) for the STEP 3 diff. If the branch goes long-lived and
  release moves mid-phase, merge release in and run the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: i18n-semantic-regressions-gate-trap,
  mutation-checks-commit-first, big-diff-reviewer-turn-budgets,
  fanout-agent-delivery-traps, worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-06-economy-hooks.md, and these source
files as earlier phases landed them (state.md's "Key planned files" section records
any refined names): the cooking recipe and dish content modules (locate the existing
cooking ladder and its budget conventions), the alchemy recipe content module and
its herb-input conventions, the farming items content module (produce ids, husks,
growth_tonic), tests/recipe_economy.test.ts, the Phase 5 consumer-note arms in
tests/professions_zone_rollout.test.ts, the professions training/ladder suites that
cover recipe skill progression (name them), and the src/ui/i18n.catalog modules that
carry recipe and item names. Also the relevant CLAUDE.md files: the root CLAUDE.md,
src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/sim/content/CLAUDE.md,
src/ui/CLAUDE.md. The orchestrator never reads planning docs or coordinator
monoliths directly.
The summary MUST return: the cooking ladder's budget conventions (foodHp per skill
band, pricing, skillReq laddering) with the exported symbols that carry them; the
alchemy budget conventions and herb-input precedent; the recipe row shape for both
professions; the exact list of Phase 5 materials carrying a Phase 6 consumer note;
the growth_tonic item id and how Phase 4 consumes it; the names of the professions
recipe suites that must stay green; the recipe-economy invariant's mechanics; the
wiki regen command and freshness gate.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Split into three agents by vertical slice, each owning its slice plus its tests.
Request the fan-out explicitly (these models under-spawn by default). Give each agent
ONLY the Explore summary and its own deliverable list, never the planning docs. Never
set plan mode on a teammate agent. Merge slices only if one turns out to be one or
two trivial changes.

Agent A, cooking dishes:
- One or two plain dishes per crop tier beside the existing cooking ladder budget
  conventions: foodHp only, NO buff machinery this phase (well-fed is Phase 11, the
  ItemDef.wellfed arm does not exist yet and is not added here).
- Each dish consumes farm produce; vendor staples may join per the ladder
  convention, but no dish is vendor-only.
- Recipe rows with laddered skillReq following the cooking ladder's progression.
- Values proposed and maintainer-flagged in comments (classic-modest, no invented
  balance claims).
- English recipe and item-name rows in the matching src/ui/i18n.catalog module;
  names IP-safe per D17.
- Tests: the new rows conform to the ladder conventions; the training/ladder suites
  stay green.

Agent B, the alchemy tonic recipe:
- The growth_tonic recipe with herb inputs per D7 (crafted by alchemy FROM HERBS,
  the cross-profession trade), conforming to the alchemy budget conventions.
- English recipe-name row; tests that the row conforms.

Agent C, closure and dormancy proof:
- The consumer-rule pin closing every Phase 5 material: each produce and the husks
  have at least one recipe or command consumer now. Verify and pin it, and replace
  the Phase 6 consumer notes in the tests/professions_zone_rollout.test.ts farming
  arms with the real consumers.
- The vendor-goods-alone negative: verify (and pin) that every new recipe has at
  least one reagent with no vendor faucet, so nothing new is craftable from vendor
  goods alone before go-live.
- tests/recipe_economy.test.ts green over the new rows; wiki regen
  (npm run wiki:content; tests/guide.test.ts freshness).

INVARIANTS THIS PHASE MUST KEEP
- The recipe economy invariant: EVERY recipe respects it, nothing vendors above its
  cheapest achievable inputs (tests/recipe_economy.test.ts is the guard).
- Classic-modest values everywhere; no invented balance claims; every proposed
  number is maintainer-flagged.
- EVERY new material consumer claim is real: after this phase, every Phase 5 produce
  and the husks have at least one recipe or command consumer, with no remaining
  Phase 6 notes.
- EVERY player-visible string is a t() key added in English only to the matching
  src/ui/i18n.catalog module; never edit locale overlays.
- Sim purity and determinism are untouched: content rows only; no new rng, no
  Math.random, Date.now, or performance.now in src/sim/.

Out of scope (do NOT do in this phase):
- Well-fed buffs and the ItemDef.wellfed arm (Phase 11).
- The shared feast (Phase 12).
- Work orders (Phase 9).
- Vendor stock of any kind (Phase 9).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run tests/recipe_economy.test.ts tests/professions_zone_rollout.test.ts
  tests/localization_fixes.test.ts tests/guide.test.ts tests/architecture.test.ts
- npx vitest run over the professions recipe suites the Explore summary names
- npm run ci:changed
- node scripts/gate_select.mjs
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md.
For this phase's expected diff the matching rows are: architecture-reviewer (any sim
content change that touches the crafting path), frontend-seam-reviewer (the i18n
catalog rows match its matrix row), and qa-checklist (the phase deliverable set is
complete); dispatch cross-platform-sync ONLY if an event or wire surface moved
(pure recipe rows do not move it). Every review agent gets a hard
30-tool-call budget, the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"), and, if truncation looms,
the resume line: "Stop reading more files. Output the full report now based on what
you have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a body (what changed and why),
explicit paths only, never git add -A, no session links or Claude attribution.
Suggested shape:
1. feat(cooking): plain farm dishes per tier with laddered skillReq
2. feat(alchemy): growth tonic recipe from herbs
3. test(economy): consumer-rule closure and the vendor-goods-alone negative
4. docs(farming): wiki regen, progress and state ledger updates

STEP 5 - ACCEPTANCE CRITERIA
- [ ] one or two plain dishes per crop tier exist, consuming farm produce, foodHp
      only with no buff machinery, recipe rows with laddered skillReq beside the
      cooking ladder budget conventions; values proposed and maintainer-flagged
- [ ] the alchemy growth_tonic recipe exists with herb inputs per D7 and conforms to
      the alchemy budget conventions
- [ ] the consumer rule is closed: every Phase 5 produce and the withered husks have
      at least one recipe or command consumer, verified and pinned; the Phase 6
      consumer notes in the rollout arms are replaced by the real consumers
- [ ] no new recipe is craftable from vendor goods alone: every one has at least one
      reagent with no vendor faucet, verified and pinned
- [ ] English recipe and item-name i18n rows exist for every new dish and the tonic
      recipe; tests/localization_fixes.test.ts is green
- [ ] tests/recipe_economy.test.ts and the training/ladder suites are green
- [ ] the recipe economy invariant holds: nothing vendors above its cheapest
      achievable inputs
- [ ] the wiki regenerated and tests/guide.test.ts freshness is green
- [ ] the STEP 3 validation list is green and node scripts/gate_select.mjs passes
      apart from the standing armory browser exception
- [ ] docs/farming/progress.md and docs/farming/state.md ledgers are updated

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (Phase 6 status row, the copied acceptance list with
check states, a Notes block) and the docs/farming/state.md ledgers (new recipes, new
i18n keys, proposed values awaiting the maintainer; mark the consumer notes closed).
Any deviation decided in-phase gets swept into
docs/farming/phase-06-economy-hooks.md AND docs/farming/phase-06-qa.md in the same
pass, plus a line in state.md's "Locked deviations" ledger. Record surprises in
Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or fail);
review verdicts per agent; deferrals with reasons; and a one-line handoff for the QA
session.

STOPPING RULES
- Stop if a dish or the tonic cannot stay inside the documented budget ceilings
  without a maintainer call; surface the numbers instead of inventing a new budget.
- Stop if git status is not clean at STEP 0 or the newest release branch cannot be
  resolved.
- Stop if a BLOCKING review finding cannot be fixed without violating a locked
  decision (D1 to D24); state.md wins over this file, and a contradiction gets swept,
  not coded around.

When everything above is done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "[gate] FAIL";
PR CI is the arbiter), push, and open the PR against the release branch this phase
was based on, following .github/PULL_REQUEST_TEMPLATE.md.
```
